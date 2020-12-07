import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { HeatingPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HeatingAccessory {
  private service: Service;

  private states = {
    HeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    TargetHeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    CurrentTemperature: 20,
    TargetTemperature: 20,
    DisplayUnits: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS
  };

  constructor(
    private readonly platform: HeatingPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BASH')
      .setCharacteristic(this.platform.Characteristic.Model, 'T-1')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '123ABC');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);
    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
      // see https://developers.homebridge.io/#/service/Thermostat
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.getHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on('get', this.getTargetHeatingCoolingState.bind(this))
      .on('set', this.setTargetHeatingCoolingState.bind(this))
      .setProps({maxValue: this.platform.Characteristic.TargetHeatingCoolingState.HEAT});
   
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on('get', this.getDisplayUnits.bind(this))
      .on('set', this.getDisplayUnits.bind(this));
  }

  getHeatingCoolingState(callback: CharacteristicGetCallback) {
    callback(null, this.states.HeatingCoolingState);
  }

  getTargetHeatingCoolingState(callback: CharacteristicGetCallback) {
    callback(null, this.states.TargetHeatingCoolingState);
  }

  setTargetHeatingCoolingState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.states.TargetHeatingCoolingState = value as number;
    callback(null);
  }

  getCurrentTemperature(callback: CharacteristicGetCallback) {
    callback(null, this.states.CurrentTemperature);
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.states.TargetTemperature = value as number;
    callback(null);
  }

  getTargetTemperature(callback: CharacteristicGetCallback) {
    callback(null, this.states.TargetTemperature);
  }

  setDisplayUnits(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.states.DisplayUnits = value as number;
    callback(null);
  }

  getDisplayUnits(callback: CharacteristicGetCallback) {
    callback(null, this.states.DisplayUnits);
  }

}
