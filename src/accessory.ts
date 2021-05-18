import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  HAPStatus,
  Logging,
  Service
} from "homebridge";
import { SentiotecAPI } from './websocket';


/**
 * Configuration schema https://developers.homebridge.io/#/config-schema
 */

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("SentiotecSaunaAccessory", SentiotecSaunaAccessory);
};

class SentiotecSaunaAccessory implements AccessoryPlugin {
  /**
   * the general log file
   */
  private readonly log: Logging;
  /**
   * the termostat service
   */
  private readonly temperaturService: Service;
  /**
   * the general information service
   */
  private readonly informationService: Service;
  /**
   * the Sentiotec websocket API
   */
  private sentioAPI: SentiotecAPI;
  /**
   * the last current temperature
   */
  private currentTemperature: number = 0;
  /**
   * the configuration of the accessory
   */
  private readonly config: AccessoryConfig;
  /**
   * the constructor from the HAP API
   */
  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.sentioAPI = new SentiotecAPI(log);
    this.log = log;
    this.config = config;
    
    // temperature service
    this.temperaturService = new hap.Service.Thermostat(config.name);
    // current temperature
    this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));
    // target temperature
    this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info("Getting sauna target temperature");
        /*
        TODO: get the target temperature from the API
        */
        callback(undefined, 10);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info("Setting the sauna target temperature to " + value);
        callback();
      });
    // temperature units
    this.temperaturService.getCharacteristic(hap.Characteristic.TemperatureDisplayUnits)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      log.info("Getting sauna temperature units");
      // implement
      callback(undefined, hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

      log.info("Getting sauna temperature units to " + value.toString());
      callback();
    });

    // current cooling state - always on heating (no cooling sauna)
    this.temperaturService.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      callback(undefined, hap.Characteristic.CurrentHeatingCoolingState.HEAT);
    })
    this.temperaturService.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      callback(undefined, hap.Characteristic.TargetHeatingCoolingState.HEAT);
    })

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Sentiotec")
      .setCharacteristic(hap.Characteristic.Model, "Pronet")
      .setCharacteristic(hap.Characteristic.Name, "Sauna")
      /*
       TODO: get this value from the information query
       */
      .setCharacteristic(hap.Characteristic.FirmwareRevision, "B2 Something")
      .setCharacteristic(hap.Characteristic.SerialNumber, "12345")
      .setCharacteristic(hap.Characteristic.ProductData, "Some Product Information with some additional info");
    log.info("Sauna finished initializing");
  }
  /**
   * This function returns the current temperature in the form of a callback
   * @param callback the callback with the information
   */
  getCurrentTemperature(){
    if (this.sentioAPI.dataExpired){
      // data has expired, so return the old value for now and then send an update to not provoke a timeout error
      this.sentioAPI.getCharacteristic(0,11, this.config.ip, this.config.password, this.config.serial, this.log)
        .then(value => {
          var intValue :number = parseInt(value);
          if (intValue > 100){
            intValue = 100;
          }
          this.log.info("Updating current sauna temperature on characteristic:" + intValue);
          this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(intValue);
          this.currentTemperature = intValue;  
        })
        .catch(error =>  this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(error));  
        return this.currentTemperature; 
    }
    else {
      var intValue :number = parseInt(this.sentioAPI.getCachedCharacteristic(0,11));
          if (intValue > 100){
            intValue = 100;
      }
      // data is still current, so update the characteristic now
      this.currentTemperature = intValue;
      return intValue;
    }
  }
  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.temperaturService
    ];
  }

}