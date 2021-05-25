import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  Characteristic,
  HAP,
  Logging,
  Service,
  HAPStatus,
  HapStatusError
} from "homebridge";
import { timingSafeEqual } from "node:crypto";
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
  api.registerAccessory("Sentiotec Sauna Control Plugin", SentiotecSaunaAccessory);
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
   * 
   */
  private saunaId: number = 0;

  /**
   * the constructor from the HAP API
   */
  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.sentioAPI = new SentiotecAPI(log);
    this.log = log;
    this.config = config;
    this.saunaId = this.config.sauna;
    
    // temperature service
    this.temperaturService = new hap.Service.Thermostat(this.config.name);
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

    this.temperaturService.setCharacteristic(hap.Characteristic.Name, this.config.name);

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
   * This function retrieves a characteristic.
   * @param characteristicID the ID of the characteristic
   * @param characteristicName the human readable name of the characteristic for log output
   * @param converterFunction the converter function to get the correct value
   * @param characteristic the characteristic that should be udpated
   */
  private getCharacteristic(characteristicID: number, characteristicName: string,  converterFunction: (value: string | null) => any, characteristic: Characteristic) : any{
    if (this.sentioAPI.dataExpired){
      // data has expired, so return the old value for now and then send an update to not provoke a timeout error
      this.sentioAPI.refreshCharacteristics(this.saunaId, characteristicID, this.config.ip, this.config.password, this.config.serial, this.log)
        .then(() => {
          if (!this.sentioAPI.connected){
            // Sauna is not connected to return an error
            this.log.info("Sauna \"" +  this.saunaId + "\" not connected");
            characteristic.updateValue(new Error("Update characteristic failed: Sauna \"" +  this.saunaId + "\" not connected"));
          } 
          else {
            var value: string = this.sentioAPI.getCachedCharacteristic(this.temperaturService, this.saunaId, characteristicID);
            var convertedValue = converterFunction(value);
            this.log.debug("Updating characteristic \"" + characteristicName + "\" with value :" + convertedValue);
            characteristic.updateValue(convertedValue);  
          }

        })
        .catch(error =>  characteristic.updateValue(error));  
        return converterFunction(null); 
    }
    else {
      // data is still current
      if (!this.sentioAPI.connected){
        // Sauna is not connected to return an error
        this.log.info("Sauna \"" +  this.saunaId + "\" not connected")
        return null;
      } 
      else {
        var value: string = this.sentioAPI.getCachedCharacteristic(this.temperaturService, this.saunaId, characteristicID);
        var convertedValue = converterFunction(value);
        this.log.debug("Returning characteristic \"" + characteristicName + "\" with value :" + convertedValue);
        return convertedValue;
      }
    }
  }

  /**
   * This function returns the current temperature in the form of a callback.
   * @return the target temperature
   */
  getCurrentTemperature(): number | null{
    return this.getCharacteristic(CURRENT_TEMPERATURE_ID, 
      "Current Temperature",
      (value: string | null) => {
        if (value == null){
          return 0;
        }
        else {
          return parseInt(value);
        }
      },
      this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature) 
    );
  }
    /**
   * This function returns the target temperature in the form of a callback
   * @returns the target temperature
   */
  getTargetTemperature(): number{
    return this.getCharacteristic(TARGET_TEMPERATURE_ID,
      "Target Temperature",
      (value: string | null) => {
        if (value == null){
          return 0;
        }
        else {
          return parseInt(value);
        }
      },
      this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature) 
    );
  }
  /**
   * This function returns the software version of the Sauna control.
   * @returns the software version
   */
  getFirmwareVersion(): string{
    return this.getCharacteristic(FIRMWARE_ID, 
      "Firmware Version",
      (value: string | null) => {
        if (value == null){
          return "UNKNOWN";
        }
        else {
          return value;
        }
      },
      this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision) 
    );
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