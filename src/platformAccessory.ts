import { Service, PlatformAccessory, Logger, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HeatingPlatform } from './platform';
import { RedisConfig, ThermostatConfig} from './config';

import { deserialize } from 'class-transformer';

const redis = require("redis");

declare type RedisMessageHandler = (channel: String, value: any) => void;

class TemperatureMessage {
  value: number;
  units: string;

  constructor (
    value: number,
    units: string
  ){
    this.units = units;
    this.value = value;
  }
}
class MessageHandler {
  constructor (
  readonly channel: string,
  readonly handler: RedisMessageHandler
  ){

  }

  execute(message: any) {
    this.handler(this.channel, message);
  }
}

class MessageDispatcher {
  private handlers = {};

  addHandler(handler: MessageHandler) {
    this.handlers[handler.channel] = handler;
  }

  dispatchMessage(channel: String, message: any){
    let channelParts = channel.split("/");
    let handler = this.handlers[channelParts.slice(-1)[0]];
    if(handler != null){
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
  private subscriber: any; 
  private client: any;
  private states = {
    HeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    TargetHeatingCoolingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    CurrentTemperature: 20,
    TargetTemperature: 20,
    DisplayUnits: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
    CurrentRelativeHumidity: 30
  };

  //we need to pass in information about the redis server
  constructor(
    private readonly platform: HeatingPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
    private readonly redisConfig: RedisConfig
  ) {
    //this needs to be wrapped in a try handler
    try{
      this.subscriber = redis.createClient(redisConfig.port,redisConfig.host);
      this.client = redis.createClient(redisConfig.port,redisConfig.host);
    } catch(error) {
      log.info(`couldn't connect to redis server`,error);
    }
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BASH')
      .setCharacteristic(this.platform.Characteristic.Model, 'T-1')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '123ABC');

    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);
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
      .setProps({maxValue: 30,minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on('get', this.getTargetTemperature.bind(this))
      .on('set', this.setTargetTemperature.bind(this))
      .setProps({maxValue: 30,minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on('get', this.getDisplayUnits.bind(this))
      .on('set', this.setDisplayUnits.bind(this))
      .setProps({minStep: 0.1});

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .on('get', this.getCurrentRelativeHumidity.bind(this))
    
    this.setupRedis();
  }

  setupRedis() {
    this.subscriber.on("message", this.handleMessage.bind(this))
    var path = `/home/sensors/${this.accessory.context.device.identifier}`;
    var channel = `${path}/current_temperature`;
    this.subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/heating_cooling_state`
    this.subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${path}/current_relative_humidity`;
    this.subscriber.subscribe(channel);
    this.log.debug(`${this.accessory.displayName} subscribing ${channel}`);
   
    this.messageDispatcher.addHandler(new MessageHandler("heating_cooling_state",this.handleHeatingCoolingState.bind(this)));
    this.messageDispatcher.addHandler(new MessageHandler("current_temperature",this.handleCurrentTemperature.bind(this)));
    this.messageDispatcher.addHandler(new MessageHandler("current_relative_humidity",this.handleCurrentRelativeHumidity.bind(this)));
  }

  handleHeatingCoolingState(channel: String, message: any) {
    var newValue = message as number;
    this.states.HeatingCoolingState = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, newValue);
  }

  handleCurrentTemperature(channel: String, message: any) {
    let tempMessage = deserialize(TemperatureMessage,message);
    //homekit only handles .5 increments
    // var newValue = Math.round(tempMessage.value * 10 ) / 10 ;
    var newValue = tempMessage.value;
    this.states.CurrentTemperature = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, newValue);
  }

  handleCurrentRelativeHumidity(channel: String, message: any){
    let tempMessage = deserialize(TemperatureMessage,message);
    //homekit only handles .5 increments
    var newValue = Math.round(tempMessage.value * 10 ) / 10 ;
    this.states.CurrentRelativeHumidity = newValue;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, newValue);
  }

  handleMessage(channel: String, message: any ) {
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
    
    var path = `/home/sensors/${this.accessory.context.device.identifier}`;
    var channel = `${path}/target_heatingcooling_state`;

    var message = value as number;

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

    var path = `/home/sensors/${this.accessory.context.device.identifier}`;
    var channel = `${path}/target_temperature`

    var message = JSON.stringify(new TemperatureMessage(value as number, "C"));

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
