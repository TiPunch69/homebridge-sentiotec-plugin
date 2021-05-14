import WebSocket from "ws";
import {Md5} from 'ts-md5/dist/md5';
import {CharacteristicGetCallback, Logger, HAPStatus} from 'homebridge';

/**
 * the IDs of the different parameters (currently only supported for the first Sauna connected)
 */
export enum PRONET_CHARACTERISTIC{
    CurrentTemperature = "183/0/11",
    TargetTemperature = "183/0/2",
    Status = "183/0/1",
    SoftwareVersion = "183/0/21",
    ConnectionStatus = "183/0/22"
}
/**
 * The interface for a hash.
 */
export interface Hash {
    [indexer: string] : string
}

/**
 * This class is the API via websocket to the Pronet web gateway.
 */
export class SentiotecAPI {
    private serial: string;
    private passwdMD5: string;
    private log: Logger;
    private webSocket: WebSocket;
    // indicates that the websocket is open
    private webSocketOpen: boolean = false;
    // the list of cached values, so it you do not have to poll all the time
    private values: Hash = {};

    /**
     * the constructor
     * @param ip the IP of the pronet gatway
     * @param password the password for login
     * @param serial the serial number of the gateway
     */
    constructor(ip: string, password: string, serial: string, log: Logger) {
        const headers = {
            // add additional headers here
            "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
            "Sec-WebSocket-Key": ""
        } 
        var url:string = "ws://" + ip + ":17001" + "/" + serial;
        this.passwdMD5 = Md5.hashStr(password, false) as string;
        this.serial = serial;
        this.log = log;
        this.webSocket = new WebSocket(url, { headers});
        this.webSocket.on("message", this.messageReceieved.bind(this));
        // charakteristka initialisieren
        Object.keys(this.values).forEach((key) => { this.values[key]= "" });
        // update the data in case it is older than X seconds
        setInterval(() => this.updateCharacteristics(), 10000);
        this.log.info("Connected to Pronet instance via " + url);
    }
    /**
     * This function is called in case a message is received from the websocket
     * @param message the message form the websocket connection
     */
    private messageReceieved(message) : void {
        this.log.debug("Message received: " + message.data);
        var pronetMessage = JSON.parse(message.data);
        switch(pronetMessage.cmd){
            case "cmd_on_accept":
                var authenticationObject = {
                    "cmd":			"cmd_request_auth",
                    "sn":			this.serial,
                    "user":			"root",
                    "passwd":		this.passwdMD5
                }
                this.webSocket.send(JSON.stringify(authenticationObject));
                this.log.debug("Sent authentication details");
                break;
            case "cmd_auth_response":
                if (pronetMessage.value=="true") {
                    this.log.debug("Authentication successful");
                    this.webSocketOpen = true;
                    // initially update the characteristics
                    this.updateCharacteristics();
                } else {
                    this.log.debug("Authentication unsuccessful, terminating websocket.");
                    this.webSocket.close();
                    this.webSocketOpen = false;
                }
                break;
            case "cmd_knx_write":
                for (const value in Object.keys(PRONET_CHARACTERISTIC)) {
                    if (pronetMessage.addr === PRONET_CHARACTERISTIC[value]){
                        // store the characteristic in a hashmap for later use
                        this.values[pronetMessage.addr] = pronetMessage.value;
                    }
                }
        }
    }

    getCharacteristic(callback: CharacteristicGetCallback, characteristic: PRONET_CHARACTERISTIC) : void{
        if (!this.webSocketOpen){
            // websocket is not open
            this.log.error("Websocket is not open");
            callback(HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE, null);
        }
        // data is chached
        this.log.debug("Returnning data for characteristic " + PRONET_CHARACTERISTIC);
        callback(HAPStatus.SUCCESS, this.values[characteristic]);  
    }
    /**
     * Diese Funktion aktualisiert alle Eigenschaften.
     */
    private updateCharacteristics(): void{
        if (!this.webSocketOpen){
            return;
        }
        this.log.debug("Aktualisiere Eigenschaften");
        const query = {
            "cmd": "cmd_request_update_all",
        } 
        this.webSocket.send(JSON.stringify(query));
    }
}