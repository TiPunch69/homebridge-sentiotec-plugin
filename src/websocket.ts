import WebSocket from 'ws';
import { Md5 } from 'ts-md5/dist/md5';
import {
  Logger,
  AccessoryConfig,
} from 'homebridge';
/**
 *  the timeout for an operation on the websocket (5 sec)
 */
const OPERATION_TIMEOUT = 5000;
/**
 * the timeout how long the websocket connection stays open before closing it (60 sec)
 */
const WEBSOCKET_TIMEOUT = 60000;
/**
 * the timeout for which the data is valid and does not need to be refreshed (30 sec)
 */
const DATA_VALID_TIMEOUT = 30000;
/**
 * This class is the API via websocket to the Pronet web gateway.
 */
export class SentiotecAPI {
  /**
   * the logger that should be used
   */
  private log: Logger;
  /**
   * the map of cached values
   */
  private cachedValues?: Map<string, string>;
  /**
   * indicates that a data refresh is currently in progress
   */
  private dataUpdateInProgress = false;
  /**
   * indicates if a/the Sauna is actually connected to the pronet unit
   */
  public connected = false;
  /**
   * the websocket to be used
   */
  private websocket?: WebSocket;
  /**
   * the timeout for the websocket
   */
  private webSocketTimeout?: NodeJS.Timeout;
  /**
   * the sauna target IP
   */
  private ip: string;
  /**
   * the sauna password
   */
  private password: string;
  /**
   * the sauna serial number
   */
  private serial: string;
  /**
   * the ID of the sauna
   */
  private saunaID = 0;
  /**
   * the constructor
   * @param log the logger to be used
   * @param config the service configuration
   */
  constructor(log: Logger, config: AccessoryConfig) {
    this.log = log;
    this.password = config.password;
    this.serial = config.serial;
    this.ip = config.ip;
    this.saunaID = config.sauna;
  }

  /**
   * This function creates a new websocket and authenticates the user based on the information given in the constructor
   * @returns a Promise to handle the connection and authentication process
   */
  private connect(): Promise<undefined> {
    // the needed security headers
    const headers = {
      'Origin': 'http://192.168.1.1',
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
      'Sec-WebSocket-Version': '13',
    };
    const passwdMD5: string = Md5.hashStr(this.password, false) as string;
    const url: string = 'ws://' + this.ip + ':17001' + '/' + this.serial;

    // set the timer for authentication
    const timeout: NodeJS.Timeout = setTimeout(() => {
      this.close();
      throw new Error('Autentication timed out');
    }, OPERATION_TIMEOUT);

    return new Promise((resolve, reject) => {
      if (this.websocket !== undefined) {
        // websocket is open and ready, so do not authenticate again
        resolve(undefined);
      }
      // set an inital timeout for the whole autentication request
      this.websocket = new WebSocket(url, { headers });
      this.websocket.onmessage = (message) => {
        const pronetMessage = JSON.parse(message.data.toString());
        const authenticationObject = {
          'cmd': 'cmd_request_auth',
          'sn': this.serial,
          'user': 'root',
          'passwd': passwdMD5,
        };
        switch (pronetMessage.cmd) {
          case 'cmd_on_accept':
            // step1: connection accepted
            this.log.debug('Initial connection confirmation received, sending authentication details');
            this.websocket!.send(JSON.stringify(authenticationObject));
            break;
          case 'cmd_auth_response':
            // setp2: authentication
            if (pronetMessage.value === 'true') {
              this.log.debug('Authentication successful');
              // clear the authentication timeout
              clearTimeout(timeout);
              // set the general connection open timeout
              this.webSocketTimeout = setTimeout(() => {
                this.log.debug('Timeout reached, closing websocket');
                this.close();
              }, WEBSOCKET_TIMEOUT);
              resolve(undefined);
            } else {
              this.log.debug('Authentication unsuccessful, terminating websocket.');
              clearTimeout(timeout);
              this.websocket!.close();
              reject(new Error('Authentication unsuccessful'));
            }
            break;
        }
      };
      this.websocket.onerror = (error) => {
        clearTimeout(timeout);
        this.close();
        reject(error);
      };
    });
  }

  /**
   * This function closes the websocket and does the cleanup.
   */
  private close() {
    if (this.websocket !== undefined) {
      this.websocket.close();
      clearTimeout(this.webSocketTimeout!);
      this.websocket = undefined;
      this.webSocketTimeout = undefined;
    }
  }

  /**
   * This function returns a characteristic from the sauna (either cached or directly)
   * @param characteristicID the ID of the characteristic
   */
  public getCharacteristic(characteristicID: number): Promise<string> {
    const characteristicString: string = '183/' + this.saunaID + '/' + characteristicID;

    // check if a data update is in progress and wait the operation timeout, before trying again
    if (this.dataUpdateInProgress) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (this.cachedValues !== undefined) {
            resolve(this.cachedValues.get(characteristicString) as string);
          } else {
            reject('Data could not be fetched, as another process had a problem.');
          }
          this.cachedValues = undefined;
        }, OPERATION_TIMEOUT);
      });
    } else {
      return new Promise((resolve, reject) => {
        if (this.cachedValues !== undefined) {
          // cache is still valid, so return the value directly
          resolve(this.cachedValues.get(characteristicString) as string);
        } else {
          // data needs to be updated first
          this.dataUpdateInProgress = true;
          this.connect()
            .then(() => {
              // set an inital timeout for the whole  request
              const timeout: NodeJS.Timeout = setTimeout(() => {
                this.websocket!.close();
                reject(new Error('Refresh of values failed due to timeout'));
              }, OPERATION_TIMEOUT);
              // initialize the caching map
              this.cachedValues = new Map();
              // wait for the messages
              this.websocket!.onmessage = (message) => {
                const pronetMessage = JSON.parse(message.data.toString());
                switch (pronetMessage.cmd) {
                  case 'cmd_knx_write':
                    //log.debug("Information message received: " + message.data.toString());
                    this.cachedValues!.set(pronetMessage.addr, pronetMessage.value);
                    // first message - sauna active state
                    if (pronetMessage.addr === '183/' + this.saunaID + '/0') {
                      // 0: sauna active information
                      if (parseInt(pronetMessage.value) === 1) {
                        this.connected = true;
                      } else {
                        this.log.info('Sauna not connected');
                        this.connected = false;
                      }
                    }
                    // last message, all data received
                    if (pronetMessage.addr === '183/1/47') {
                      // all finished, as last dataset was reached
                      clearTimeout(timeout);
                      this.dataUpdateInProgress = false;
                      setTimeout(() => {
                        this.cachedValues = undefined;
                      }, DATA_VALID_TIMEOUT);
                      // return the characteristic
                      resolve(this.cachedValues!.get(characteristicString) as string);
                    }
                    break;
                }
              };
              this.websocket!.onerror = (error) => {
                clearTimeout(timeout);
                this.close();
                reject(error);
              };
            })
            .catch((error) => reject(error));
        }
      });
    }
  }

  /**
   * This function sets a characteristic on the sauna.
   * @param characteristicID the ID of the characteristic
   * @param value the corresponding value (currently only active and temperature - both numbers - can be set)
   * @returns a Promise for the execution
   */
  public setCharacterstic(characteristicID: number, value: number): Promise<undefined> {
    return new Promise((resolve, reject) => {
      this.connect()
        .then(() => {
          const setter = {
            'cmd': 'cmd_knx_write',
            'addr': '183/' + this.saunaID + '/' + characteristicID,
            'value': value,
          };
          this.websocket!.send(JSON.stringify(setter));
          resolve(undefined);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }
}