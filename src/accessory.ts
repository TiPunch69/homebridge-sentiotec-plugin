import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  Characteristic,
  HAP,
  Logging,
  Service,
} from 'homebridge';
import { SentiotecAPI } from './websocket';


/**
 * Configuration schema https://developers.homebridge.io/#/config-schema
 */

/**
 * This example was derived from the Homebridge Accessory template.
 */
let hap: HAP;
/**
 * the ID to check or set if the sauna is enabled
 */
const ACTIVE = 1;
/**
 * the maximum sauna temperature
 */
const MAX_TEMPERATURE = 120;
/**
 * the ID for the current temperature
 */
const CURRENT_TEMPERATURE_ID = 11;
/**
 * the ID for the target temperature
 */
const TARGET_TEMPERATURE_ID = 2;
/**
 * the ID for the firmware
 */
const FIRMWARE_ID = 21;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory('Sentiotec Sauna Control Plugin', SentiotecSaunaAccessory);
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
   * the constructor from the HAP API
   */
  constructor(log: Logging, config: AccessoryConfig) {
    this.sentioAPI = new SentiotecAPI(log, config);
    this.log = log;

    // temperature service
    this.temperaturService = new hap.Service.Thermostat(config.name);
    // current temperature
    this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
      .setProps({
        minValue: -20,
        maxValue: MAX_TEMPERATURE,
        minStep: 1,
      });
    // target temperature
    this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperatur.bind(this))
      .setProps({
        minValue: 50,
        maxValue: MAX_TEMPERATURE,
        minStep: 1,
      });

    // temperature units
    this.temperaturService.getCharacteristic(hap.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Getting sauna temperature units in Celsium (cannot be changed)');
        callback(undefined, hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
      });

    this.temperaturService.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getActiveState.bind(this));

    this.temperaturService.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getActiveState.bind(this))
      .onSet(this.setActiveState.bind(this));

    this.temperaturService.setCharacteristic(hap.Characteristic.Name, config.name);

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Sentiotec')
      .setCharacteristic(hap.Characteristic.Model, 'Pronet')
      .setCharacteristic(hap.Characteristic.Name, config.name)
      .setCharacteristic(hap.Characteristic.SerialNumber, config.serial)
      .setCharacteristic(hap.Characteristic.ProductData, 'Sauna heater with Pronet Web interface');
    this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));

    log.info('Sauna finished initializing');
  }

  /**
   * This function retrieves a characteristic.
   * @param characteristicID the ID of the characteristic
   * @param characteristicName the human readable name of the characteristic for log output
   * @param converterFunction the converter function to get the correct value
   * @param characteristic the characteristic that should be udpated
   */
  /* eslint-disable @typescript-eslint/no-explicit-any*/
  private getCharacteristic(characteristicID: number, characteristicName: string,
    converterFunction: (value: string | null) => any, characteristic: Characteristic): any {
    this.sentioAPI.getCharacteristic(characteristicID)
      .then((value) => {
        if (!this.sentioAPI.connected) {
          // Sauna is not connected to return an error
          this.log.info('Sauna not connected');
          characteristic.updateValue(new Error('Update characteristic failed: Sauna not connected'));
        } else {
          const convertedValue = converterFunction(value);
          this.log.debug('Updating characteristic "' + characteristicName + '" with value :' + convertedValue);
          characteristic.updateValue(convertedValue);
        }
      })
      .catch(error => characteristic.updateValue(error));
    return converterFunction(null);
  }

  /**
   * This function returns the current temperature in the form of a callback.
   * @return the target temperature
   */
  getCurrentTemperature(): number {
    return this.getCharacteristic(CURRENT_TEMPERATURE_ID,
      'Current Temperature',
      (value: string | null) => {
        if (value === null) {
          return 0;
        } else {
          return parseInt(value);
        }
      },
      this.temperaturService.getCharacteristic(hap.Characteristic.CurrentTemperature),
    );
  }

  /**
   * This function returns the target temperature in the form of a callback
   * @returns the target temperature
   */
  getTargetTemperature(): number {
    return this.getCharacteristic(TARGET_TEMPERATURE_ID,
      'Target Temperature',
      (value: string | null) => {
        if (value === null) {
          return 0;
        } else {
          return parseInt(value);
        }
      },
      this.temperaturService.getCharacteristic(hap.Characteristic.TargetTemperature),
    );
  }

  /**
   * This function returns the software version of the Sauna control.
   * @returns the software version
   */
  getFirmwareVersion(): string {
    return this.getCharacteristic(FIRMWARE_ID,
      'Firmware Version',
      (value: string | null) => {
        if (value === null) {
          return 'UNKNOWN';
        } else {
          return value;
        }
      },
      this.informationService.getCharacteristic(hap.Characteristic.FirmwareRevision),
    );
  }

  /**
   * This function returns the currently active state
   * @returns the currently active state (either HEAT or OFF, but never COOL)
   */
  getActiveState() {
    return this.getCharacteristic(ACTIVE,
      'Sauna Enabled',
      (value: string | null) => {
        if (value === null) {
          return null;
        }
        if (parseInt(value) === 1) {
          return hap.Characteristic.CurrentHeatingCoolingState.HEAT;
        } else {
          return hap.Characteristic.CurrentHeatingCoolingState.OFF;
        }
      },
      this.temperaturService.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState),

    );
  }

  /**
   * This function sets the target state
   * @param value the target state
   */
  setActiveState(value) {
    let target = 0;
    if (value === hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      target = 1;
    }
    this.log.info('Setting target state to :' + target);

  }

  /**
   * This function sets the target temperature
   * @param value the target value
   */
  setTargetTemperatur(value) {
    this.log.info('Setting target temperature to :' + value);
    this.sentioAPI.setCharacterstic(TARGET_TEMPERATURE_ID, value);
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.temperaturService,
    ];
  }

}