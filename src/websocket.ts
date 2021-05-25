import WebSocket from 'ws';
import { Md5 } from 'ts-md5/dist/md5';
import {
  Logger,
  Service,
} from 'homebridge';
/**
 *  the timeout to get all the updated data from prnoet
 */
const REFRESH_TIMEOUT = 5000;
/**
 * the timeout for which the data is valid and does not need to be refreshed
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
  private cachedValues: Map<string, string> = new Map();
  /**
   * indicates that a data update is needed
   */
  public dataExpired = true;
  /**
   * indicates that a data refresh is currently in progress
   */
  private dataUpdateInProgress = false;
  /**
   * indicates if a/the Sauna is actually connected to the pronet unit
   */
  public connected = false;
  /**
   * the constructor
   * @param log the logger to be used
   */
  constructor(log: Logger) {
    this.log = log;
  }

  /**
   * This function creates a new websocket and authenticates the user based on the information given in the constructor
   * @param ip the IP of the pronet gatway
   * @param password the password for login
   * @param serial the serial number of the gateway
   * @param log the logger to output status messages
   * @returns a Promise with the created and authenticated websocket
   */
  private connect(ip: string, password: string, serial: string, log: Logger): Promise<WebSocket> {
    // the needed security headers
    const headers = {
      'Origin': 'http://192.168.1.1',
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
      //"Sec-WebSocket-Key": "kvNqQ/cAxjEHzHhjdS3Ayw==",
      'Sec-WebSocket-Version': '13',
    };
    const passwdMD5: string = Md5.hashStr(password, false) as string;
    const url: string = 'ws://' + ip + ':17001' + '/' + serial;

    // create a connection and authenticate in the form of a promise
    return new Promise((resolve, reject) => {
      // set an inital timeout for the whole autentication request
      const timeout: NodeJS.Timeout = setTimeout(() => {
        websocket.close();
        reject(new Error('Authentication timed out'));
      }, 5000);
      const websocket = new WebSocket(url, { headers });
      websocket.onmessage = (message) => {
        const pronetMessage = JSON.parse(message.data.toString());
        const authenticationObject = {
          'cmd': 'cmd_request_auth',
          'sn': serial,
          'user': 'root',
          'passwd': passwdMD5,
        };
        switch (pronetMessage.cmd) {
          case 'cmd_on_accept':
            // step1: connection accepted
            log.debug('Initial connection confirmation received, sending authentication details');
            websocket.send(JSON.stringify(authenticationObject));
            break;
          case 'cmd_auth_response':
            // setp2: authentication
            if (pronetMessage.value === 'true') {
              log.debug('Authentication successful');
              clearTimeout(timeout);
              resolve(websocket);
            } else {
              log.debug('Authentication unsuccessful, terminating websocket.');
              clearTimeout(timeout);
              websocket.close();
              reject(new Error('Authentication unsuccessful'));
            }
            break;
        }
      };
      websocket.onerror = (error) => {
        clearTimeout(timeout);
        websocket.close();
        reject(error);
      };
    });
  }

  /**
   * This function refreshes all characteristics.
   * @param saunaID the number of the sauna in question
   * @param websocket the open websocket
   * @param log the logger to output status messages
   * @returns a Promise that after all have been refreshed
   */
  private querySaunaParameters(saunaID: number, websocket: WebSocket, log: Logger): Promise<Map<string, string>> {

    // the map of values
    const values: Map<string, string> = new Map();

    return new Promise((resolve, reject) => {
      // set an inital timeout for the whole  request
      const timeout: NodeJS.Timeout = setTimeout(() => {
        websocket.close();
        reject(new Error('Refresh of values failed due to timeout'));
      }, REFRESH_TIMEOUT);
      websocket.onmessage = websocket.onmessage = (message) => {
        const pronetMessage = JSON.parse(message.data.toString());
        switch (pronetMessage.cmd) {
          case 'cmd_knx_write':
            //log.debug("Information message received: " + message.data.toString());
            if (pronetMessage.addr === '183/' + saunaID + '/0') {
              if (parseInt(pronetMessage.value) === 1) {
                this.connected = true;
              } else {
                log.info('Sauna not connected');
                this.connected = false;
              }
            }
            values.set(pronetMessage.addr, pronetMessage.value);
            if (pronetMessage.addr === '183/1/47') {
              // all finished, as last dataset was reached
              clearTimeout(timeout);
              // set the expiration timeout of the data and close the websocket
              this.dataExpired = false;
              setTimeout(() => {
                this.dataExpired = true;
              }, DATA_VALID_TIMEOUT);
              websocket.close();
              resolve(values);
            }
            break;
        }
      };
      websocket.onerror = (error) => {
        clearTimeout(timeout);
        websocket.close();
        reject(error);
      };
      // send a request for all characteristics
      const query = {
        'cmd': 'cmd_request_update_all',
        'start': 'true',
      };
      websocket.send(JSON.stringify(query));
    });
  }

  /**
   * This function refreshes all characteristics of the sauna.
   * @param saunaID the ID of the sauna (either 0 for Sauna 1 oder 1 for Sauna 2)
   * @param characteristicID the ID of the characteristic
   * @returns the value
   */
  public refreshCharacteristics(saunaID: number, characteristicID: number,
    ip: string, password: string, serial: string, log: Logger): Promise<undefined> {
    return new Promise( (resolve, reject) => {
      // check if a session is alreay in progress
      if (!this.dataUpdateInProgress) {
        this.dataUpdateInProgress = true;
        // no update in progress, so initiate one
        log.debug('Data is expired, initiating characteristic refresh');
        this.connect(ip, password, serial, log)
          .catch((error) => reject(error))
          .then((websocket) => {
            this.querySaunaParameters(saunaID, websocket as WebSocket, log)
              .catch((error) => reject(error))
              .then((values) => {
                // store the values and end the update
                this.cachedValues = values as Map<string, string>;
                this.dataUpdateInProgress = false;
              });
          });
      } else {
        log.debug('Characteristic refresh is in progress, delay the request');
        setTimeout(() => {
          resolve(undefined);

        }, REFRESH_TIMEOUT / 4);
      }
    });
  }

  /**
   * This function fetches a characteristic from cached map. In case it does not exist an empty string is returned.
   * @param saunaID the ID of the sauna
   * @param characteristicID the ID of the characteristic
   */
  public getCachedCharacteristic(service: Service, saunaID: number, characteristicID: number): string {
    // hide the service in case the Sauna is not connected
    service.setHiddenService(!this.connected);
    const characteristicString: string = '183/' + saunaID + '/' + characteristicID;
    if (this.cachedValues.has(characteristicString)) {
      return this.cachedValues.get(characteristicString) as string;
    } else {
      return '';
    }
  }
}