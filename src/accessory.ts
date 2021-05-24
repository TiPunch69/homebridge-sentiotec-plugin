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

/**
 * This example was derived from the Homebridge Accessory template.
 */
let hap: HAP;
/**
 * The maximum sauna temperature
 */
const MAX_TEMPERATURE: number = 120;
/**
 * the ID for the current temperature
 */
const CURRENT_TEMPERATURE_ID: number = 11;
/**
 * the ID for the target temperature
 */
const TARGET_TEMPERATURE_ID: number = 2;
/**
 * the ID for the firmware
 */
const FIRMWARE_ID: number = 21;

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
      .onGet(this.getCurrentTemperature.bind(this))
      .setProps({
        minValue: -20,
        maxValue: MAX_TEMPERATURE,
        minStep: 1
      });
    // target temperature
    this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info("Setting the sauna target temperature to " + value);
        callback();
      })
      .setProps({
        minValue: 50,
        maxValue: MAX_TEMPERATURE,
        minStep: 1
      });
    // temperature units
    this.temperaturService.getCharacteristic(hap.Characteristic.TemperatureDisplayUnits)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      log.info("Getting sauna temperature units in Celsium (cannot be changed)");
      callback(undefined, hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
    })

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
      .setCharacteristic(hap.Characteristic.Name, this.config.name)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.config.serial)
      .setCharacteristic(hap.Characteristic.ProductData, "Sauna heater with Pronet Web interface");
    this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
    log.info("Sauna finished initializing");
  }
  /**
   * This function returns the current temperature in the form of a callback.
   * @return the target temperature
   */
  getCurrentTemperature(): number{
    if (this.sentioAPI.dataExpired){
      // data has expired, so return the old value for now and then send an update to not provoke a timeout error
      this.sentioAPI.getCharacteristic(0, CURRENT_TEMPERATURE_ID, this.config.ip, this.config.password, this.config.serial, this.log)
        .then(value => {
          var intValue :number = parseInt(this.sentioAPI.getCachedCharacteristic(0, CURRENT_TEMPERATURE_ID));
          this.log.info("Updating current sauna temperature on characteristic:" + intValue);
          this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(intValue);
        })
        .catch(error =>  this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(error));  
        return 0; 
    }
    else {
      // data is still current, so update the characteristic now
      return parseInt(this.sentioAPI.getCachedCharacteristic(0, CURRENT_TEMPERATURE_ID));
    }
  }
    /**
   * This function returns the target temperature in the form of a callback
   * @returns the target temperature
   */
  getTargetTemperature(): number{
    if (this.sentioAPI.dataExpired){
      // data has expired, so return the old value for now and then send an update to not provoke a timeout error
      this.sentioAPI.getCharacteristic(0, TARGET_TEMPERATURE_ID, this.config.ip, this.config.password, this.config.serial, this.log)
        .then(value => {
          var intValue :number = parseInt(this.sentioAPI.getCachedCharacteristic(0, TARGET_TEMPERATURE_ID));
          this.log.info("Updating target sauna temperature on characteristic: " + intValue);
          this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature).updateValue(intValue);
        })
        .catch(error =>  this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature).updateValue(error));  
        return 50; 
    }
    else {
      return parseInt(this.sentioAPI.getCachedCharacteristic(0, TARGET_TEMPERATURE_ID));
    }
  }
  /**
   * This function returns the software version of the Sauna control.
   * @returns the software version
   */
  getFirmwareVersion(): string{
    if (this.sentioAPI.dataExpired){
      // data has expired, so return the old value for now and then send an update to not provoke a timeout error
      this.sentioAPI.getCharacteristic(0, FIRMWARE_ID, this.config.ip, this.config.password, this.config.serial, this.log)
        .then(value => {
          var stringValue: string = this.sentioAPI.getCachedCharacteristic(0, FIRMWARE_ID);
          this.log.info("Updating Firmaware revision on characteristic:" + stringValue);
          this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision).updateValue(stringValue);
        })
        .catch(error =>  this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision).updateValue(error));  
        return "UNKNOWN"; 
    }
    else {
      return this.sentioAPI.getCachedCharacteristic(0, FIRMWARE_ID);
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