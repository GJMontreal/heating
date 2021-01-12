import { Service, PlatformAccessory, Logger, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HeatingPlatform } from './platform';
import { RedisConfig } from './config';

import { deserialize } from 'class-transformer';

import redis = require('redis');
import {RedisClient} from 'redis';

declare type RedisMessageHandler = (channel: string, value: string) => void;

class TemperatureMessage {
  value: number;
  units: string;

  constructor (
    value: number,
    units: string,
  ){
    this.units = units;
    this.value = value;
  }
}
class MessageHandler {
  constructor (
  readonly channel: string,
  readonly handler: RedisMessageHandler,
  ){

  }

  execute(message: string) {
    this.handler(this.channel, message);
  }
}

class MessageDispatcher {
  private handlers = {};

  addHandler(handler: MessageHandler) {
    this.handlers[handler.channel] = handler;
  }

  dispatchMessage(channel: string, message: string){
    const channelParts = channel.split('/');
    const handler = this.handlers[channelParts.slice(-1)[0]];
    if(handler !== null){
      handler.execute(message);
    } else {
      console.log(`unhandled channel: ${channelParts.slice(-1)[0]} message: ${message}`);
    }
  }
}
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HeatingAccessory {
  //host needs to be set in configuration

  private messageDispatcher = new MessageDispatcher();
  private service: Service;
  private subscriber: RedisClient; //I don't know what type redis subscribers are
  private client: RedisClient;
  private states = {
    HeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    TargetHeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    CurrentTemperature: 20,
    TargetTemperature: 20,
    DisplayUnits: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
    CurrentRelativeHumidity: 30,
  };

  //we need to pass in information about the redis server
  constructor(
    private readonly platform: HeatingPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
    private readonly redisConfig: RedisConfig,
  ) {
    //this needs to be wrapped in a try handler
    try{
      this.subscriber = redis.createClient(redisConfig.port, redisConfig.host);
      this.client = redis.createClient(redisConfig.port, redisConfig.host);
    } catch(error) {
      log.info(`couldn't connect to redis server${error}`);
    }
    // set accessory information
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
    
    this.setupRedisSubscriber(this.subscriber);
    this.getLastValues();
  }

  getLastValues() {
    const path = `/home/sensors/${this.accessory.context.device.identifier}`;
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
    const path = `/home/sensors/${this.accessory.context.device.identifier}`;
    let channel = `${path}/current_temperature`;
    subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/heating_cooling_state`;
    subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/current_relative_humidity`;
    subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);
   
    this.messageDispatcher.addHandler(new MessageHandler('heating_cooling_state', this.handleHeatingCoolingState.bind(this)));
    this.messageDispatcher.addHandler(new MessageHandler('current_temperature', this.handleCurrentTemperature.bind(this)));
    this.messageDispatcher.addHandler(new MessageHandler('current_relative_humidity', this.handleCurrentRelativeHumidity.bind(this)));
  }

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
    //homekit only handles .5 increments
    // var newValue = Math.round(tempMessage.value * 10 ) / 10 ;
    const newValue = tempMessage.value;
    this.states.CurrentTemperature = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, newValue);
  }

  handleTargetTemperature(message: string) {
    const tempMessage = deserialize(TemperatureMessage, message);
    const newValue = tempMessage.value;
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
    
    const path = `/home/sensors/${this.accessory.context.device.identifier}`;
    const channel = `${path}/target_heatingcooling_state`;

    const message = value as number;

    this.client.publish(channel, message);
    this.client.set(channel, message);
    callback(null);
  }

  getCurrentTemperature(callback: CharacteristicGetCallback) {
    callback(null, this.states.CurrentTemperature);
  }

  getCurrentRelativeHumidity(callback: CharacteristicGetCallback) {
    callback(null, this.states.CurrentRelativeHumidity);
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.states.TargetTemperature = value as number;

    const path = `/home/sensors/${this.accessory.context.device.identifier}`;
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
