import { Service, PlatformAccessory, Logger, CharacteristicValue, 
  CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HydronicHeating } from './platform';
import { RedisConfig } from './config';

import { deserialize } from 'class-transformer';
import { MessageHandler, MessageDispatcher } from './messageHandler';
import { TemperatureMessage } from './messageTypes';
import redis = require('redis');
import {RedisClient} from 'redis';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */

export class ThermostatAccessory {

  private messageDispatcher: MessageDispatcher;
  private service: Service;
  private subscriber: RedisClient; 
  private client: RedisClient;
  private states = {
    HeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    TargetHeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    CurrentTemperature: 0,
    TargetTemperature: 20,
    DisplayUnits: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
    CurrentRelativeHumidity: 0,
    CurrentBatteryLevel: 100,
  };

  //we need to pass in information about the redis server
  constructor(
    private readonly platform: HydronicHeating,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger, 
    private readonly redisConfig: RedisConfig,
  ) {
    this.messageDispatcher = new MessageDispatcher(this.log);
    try{
      this.subscriber = redis.createClient(redisConfig.port, redisConfig.host);
      this.client = redis.createClient(redisConfig.port, redisConfig.host);
    } catch(error) {
      this.platform.log.info(`couldn't connect to redis server${error}`);
    }

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BASH')
      .setCharacteristic(this.platform.Characteristic.Model, 'T-1')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '123ABC');

    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
    || this.accessory.addService(this.platform.Service.Thermostat);
    
    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    // see https://developers.homebridge.io/#/service/Thermostat
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.getHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on('get', this.getTargetHeatingCoolingState.bind(this))
      .on('set', this.setTargetHeatingCoolingState.bind(this))
      .setProps({maxValue: this.platform.Characteristic.TargetHeatingCoolingState.HEAT});
   
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this))
      .setProps({maxValue: 30, minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on('get', this.getTargetTemperature.bind(this))
      .on('set', this.setTargetTemperature.bind(this))
      .setProps({maxValue: 30, minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on('get', this.getDisplayUnits.bind(this))
      .on('set', this.setDisplayUnits.bind(this))
      .setProps({minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .on('get', this.getCurrentRelativeHumidity.bind(this));
    
    this.service.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .on('get', this.getCurrentBatteryLevel.bind(this));

    this.setupRedisSubscriber(this.subscriber);
    this.getLastValues();
  }

  getLastValues() {
    const path = this.accessory.context.device.path;

    let channel = `${path}/target_temperature`;
    this.client.get(channel, (err, reply)=>{
      this.handleTargetTemperature(reply);
    });
    
    channel = `${path}/target_heatingcooling_state`;
    this.client.get(channel, (err, reply)=>{
      this.handleTargetHeatingCoolingState(reply);
    });

    channel = `${path}/heating_cooling_state`;
    this.client.get(channel, (err, reply)=>{
      this.handleHeatingCoolingState('', reply);
    });
  }

  setupRedisSubscriber(subscriber: RedisClient) {
    subscriber.on('message', this.handleMessage.bind(this));
    const path = this.accessory.context.device.path;

    let channel = `${path}/current_temperature`;
    subscriber.subscribe(channel);
    this.messageDispatcher.addHandler(new MessageHandler(channel, this.handleCurrentTemperature.bind(this)));
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/heating_cooling_state`;
    subscriber.subscribe(channel);
    this.messageDispatcher.addHandler(new MessageHandler(channel, this.handleHeatingCoolingState.bind(this)));
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/current_relative_humidity`;
    subscriber.subscribe(channel);
    this.messageDispatcher.addHandler(new MessageHandler(channel, this.handleCurrentRelativeHumidity.bind(this)));
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/current_battery_level`;
    subscriber.subscribe(channel);
    this.messageDispatcher.addHandler(new MessageHandler(channel, this.handleCurrentBatteryLevel.bind(this)));
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);
  }

  //add handler for battery level
  handleHeatingCoolingState(channel: string, message: unknown) {
    const newValue = message as number;
    this.states.HeatingCoolingState = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, newValue);
  }

  handleTargetHeatingCoolingState(message: unknown) {
    const newValue = message as number;
    this.states.TargetHeatingCoolingState = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, newValue);
  }

  handleCurrentTemperature(channel: string, message: string) {
    const tempMessage = deserialize(TemperatureMessage, message);
    //homekit accepts step of .1 - why isn't that working?
    // var newValue = Math.round(tempMessage.value * 10 ) / 10 ;
    let newValue = tempMessage.value;
    if (newValue === null) {
      newValue = 0.0;
    }
    // const newValue = tempMessage.value;
    this.states.CurrentTemperature = newValue as number;
    const floatValue = newValue as number;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, floatValue);
  }

  handleTargetTemperature(message: string) {
    const tempMessage = deserialize(TemperatureMessage, message);
    // let newValue = tempMessage;
    let newValue =0.0;
    if ( tempMessage !== null ) {
      newValue = tempMessage.value;
    }
    this.states.TargetTemperature = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, newValue);
  }

  handleCurrentRelativeHumidity(channel: string, message: string){
    const tempMessage = deserialize(TemperatureMessage, message);
    //homekit only handles .5 increments
    const newValue = Math.round(tempMessage.value * 10 ) / 10 ;
    this.states.CurrentRelativeHumidity = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, newValue);
  }

  handleCurrentBatteryLevel(channel: string, message: string){
    //what happens if the deserialization fails? 
    const tempMessage = deserialize(TemperatureMessage, message);
  
    let newValue = tempMessage.value;
    
    if (newValue === undefined) {
      newValue = 0;
    }
    
    this.states.CurrentBatteryLevel = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, newValue);
  }

  handleMessage(channel: string, message: string ) {
    //we need some error checking  
    this.messageDispatcher.dispatchMessage(channel, message);
  }

  getHeatingCoolingState(callback: CharacteristicGetCallback) {
    callback(null, this.states.HeatingCoolingState);
  }

  getTargetHeatingCoolingState(callback: CharacteristicGetCallback) {
    callback(null, this.states.TargetHeatingCoolingState);
  }

  setTargetHeatingCoolingState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.states.TargetHeatingCoolingState = value as number;
    
    const path = this.accessory.context.device.path;
    const channel = `${path}/target_heatingcooling_state`;

    const message = value as number;

    this.client.publish(channel, message);
    this.client.set(channel, message);
    callback(null);
  }

  getCurrentTemperature(callback: CharacteristicGetCallback) {
    // callback(this.platform.connectionProblem); can we have a more specific error message?
    callback(null, this.states.CurrentTemperature);
  }

  getCurrentRelativeHumidity(callback: CharacteristicGetCallback) {
    callback(null, this.states.CurrentRelativeHumidity);
  }

  getCurrentBatteryLevel(callback: CharacteristicGetCallback) {
    this.log.debug('getting battery level');
    callback(null, this.states.CurrentBatteryLevel);
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.states.TargetTemperature = value as number;

    const path = this.accessory.context.device.path;
    const channel = `${path}/target_temperature`;

    const message = JSON.stringify(new TemperatureMessage(value as number, 'C'));

    this.client.publish(channel, message);
    this.client.set(channel, message);
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
