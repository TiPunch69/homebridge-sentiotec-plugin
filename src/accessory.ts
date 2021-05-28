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
import {
  SaunaCharacteristic,
  SentiotecAPI,
} from './websocket';


/**
 * Configuration schema https://developers.homebridge.io/#/config-schema
 */

/**
 * This example was derived from the Homebridge Accessory template.
 */
let hap: HAP;
/**
 * the maximum sauna temperature
 */
const MAX_TEMPERATURE = 120;
/**
 * the minimum target temperature
 */
const MIN_TARGET_TEMPERATURE = 50;
/**
 * the minimum current temperature
 */
const MIN_CURRENT_TEMPERATURE = -20;

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
   * a secondary service to display the temperature
   */
  private readonly temperatureService: Service;
  /**
   * the general information service
   */
  private readonly informationService: Service;
  /**
   * the main thermostat service
   */
  private readonly thermostatService: Service;
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

    this.temperatureService = new hap.Service.TemperatureSensor(config.name);

    // Current temperatur
    this.temperatureService.getCharacteristic(hap.Characteristic.CurrentTemperature)
    .onGet(this.getCurrentTemperature.bind(this))
    .setProps({
      minValue: MIN_CURRENT_TEMPERATURE,
      maxValue: MAX_TEMPERATURE,
      minStep: 1,
    });

    this.thermostatService = new hap.Service.Thermostat(config.name);

    // current temperature
    this.thermostatService.getCharacteristic(hap.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
      .setProps({
        minValue: MIN_CURRENT_TEMPERATURE,
        maxValue: MAX_TEMPERATURE,
        minStep: 1,
      });
    // target temperature
    this.thermostatService.getCharacteristic(hap.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperatur.bind(this))
      .setProps({
        minValue: MIN_TARGET_TEMPERATURE,
        maxValue: MAX_TEMPERATURE,
        minStep: 1,
      });
    // temperature units
    this.thermostatService.getCharacteristic(hap.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Getting sauna temperature units in Celsium (cannot be changed)');
        callback(undefined, hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
      });
    // cooling/heating state
    this.thermostatService.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentState.bind(this));
    // target cooling/heating state
    this.thermostatService.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));
    
    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Sentiotec')
      .setCharacteristic(hap.Characteristic.Model, 'Pronet')
      .setCharacteristic(hap.Characteristic.Name, config.name)
      .setCharacteristic(hap.Characteristic.SerialNumber, config.serial)
      .setCharacteristic(hap.Characteristic.ProductData, 'Sauna heater with Pronet Web interface');
    // Firmware
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
  private getCharacteristic(saunaCharacteristic: SaunaCharacteristic,
    converterFunction: (value: string | null) => any, characteristic: Characteristic): any {
    this.sentioAPI.getCharacteristic(saunaCharacteristic)
      .then((value) => {
        if (!this.sentioAPI.connected) {
          // Sauna is not connected to return an error
          this.log.info('Update characteristic "' + saunaCharacteristic.name + '" failed: Sauna not connected');
          characteristic.updateValue(new Error('Update characteristic "' + saunaCharacteristic.name + '" failed: Sauna not connected'));
        } else {
          const convertedValue = converterFunction(value);
          this.log.debug('Updating characteristic "' + saunaCharacteristic.name + '" with value :' + convertedValue);
          characteristic.updateValue(convertedValue);
        }
      })
      .catch(error => {
        this.log.error('Update characteristic "' + saunaCharacteristic.name + '" failed: ' + error);
        characteristic.updateValue(new Error(error));
      });
    return converterFunction(null);
  }

  /**
   * This function returns the current temperature in the form of a callback.
   * @return the target temperature
   */
  getCurrentTemperature(): number {
    return this.getCharacteristic(this.sentioAPI.CURRENT_TEMPERATURE,
      (value: string | null) => {
        if (value === null) {
          return MIN_CURRENT_TEMPERATURE;
        } else {
          return parseInt(value);
        }
      },
      this.thermostatService.getCharacteristic(hap.Characteristic.CurrentTemperature),
    );
  }

  /**
   * This function returns the target temperature in the form of a callback
   * @returns the target temperature
   */
  getTargetTemperature(): number {
    return this.getCharacteristic(this.sentioAPI.TARGET_TEMPERATURE,
      (value: string | null) => {
        if (value === null) {
          return MIN_TARGET_TEMPERATURE;
        } else {
          return parseInt(value);
        }
      },
      this.thermostatService.getCharacteristic(hap.Characteristic.TargetTemperature),
    );
  }

  /**
   * This function returns the software version of the Sauna control.
   * @returns the software version
   */
  getFirmwareVersion(): string {
    return this.getCharacteristic(this.sentioAPI.FIRMWARE,
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
   * This function returns the targetted state
   * @returns the currently active state (either HEAT or OFF, but never COOL)
   */
  getTargetState() {
    return this.getCharacteristic(this.sentioAPI.ACTIVE,
      (value: string | null) => {
        if (value === null) {
          return hap.Characteristic.TargetHeatingCoolingState.OFF;
        }
        if (parseInt(value) === 1) {
          return hap.Characteristic.TargetHeatingCoolingState.HEAT;
        } else {
          return hap.Characteristic.TargetHeatingCoolingState.OFF;
        }
      },
      this.thermostatService.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState),
    );
  }


  /**
   * This function returns the currently active state
   * @returns the currently active state (either HEAT or OFF, but never COOL)
   */
  getCurrentState() {
    return this.getCharacteristic(this.sentioAPI.ACTIVE,
      (value: string | null) => {
        if (value === null) {
          // a valid value has been received
          this.thermostatService.setHiddenService(true);
          return hap.Characteristic.CurrentHeatingCoolingState.OFF;
        } else {
          // a valid value has been received
          this.thermostatService.setHiddenService(false);
        }
        if (parseInt(value) === 1) {
          return hap.Characteristic.CurrentHeatingCoolingState.HEAT;
        } else {
          return hap.Characteristic.CurrentHeatingCoolingState.OFF;
        }
      },
      this.thermostatService.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState),
    );
  }

  /**
   * This function sets the target state
   * @param value the target state
   */
  setTargetState(value) {
    this.log.info('Setting target state to ' + value.toString());
    let target = 0;
    if (value === hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      target = 1;
    }
    this.sentioAPI.setCharacterstic(this.sentioAPI.ACTIVE, target);

  }

  /**
   * This function sets the target temperature
   * @param value the target value
   */
  setTargetTemperatur(value) {
    this.log.info('Setting target temperature to ' + value);
    this.sentioAPI.setCharacterstic(this.sentioAPI.TARGET_TEMPERATURE, value);
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.temperatureService,
      this.thermostatService,
    ];
  }

}