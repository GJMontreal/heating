import { Service, PlatformAccessory, Logger, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HeatingPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HeatingAccessory {
  private subscriber = redis.createClient();
  private client = redis.createClient();

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
    public readonly log: Logger
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
      .on('get', this.getCurrentTemperature.bind(this))
      .setProps({maxValue: 30});

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on('get', this.getTargetTemperature.bind(this))
      .on('set', this.setTargetTemperature.bind(this))
      .setProps({maxValue: 30});

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on('get', this.getDisplayUnits.bind(this))
      .on('set', this.getDisplayUnits.bind(this));

      this.setupRedis();
  }

  setupRedis() {
    this.subscriber.on("message", this.handleSubscribeMessage.bind(this))
    
    
    var channel = `${this.accessory.UUID}:currentTemperature`
    this.subscriber.subscribe(channel);
    console.log(`${this.accessory.displayName} subscribing ${channel}`);

    channel = `${this.accessory.UUID}:heatingCoolingState`
    this.subscriber.subscribe(channel);
    console.log(`${this.accessory.displayName} subscribing ${channel}`);
    //uuid:curentTemperature
    //uuid:targetTemperature

    // client.set(this.accessory.UUID);
    // client.publish(this.accessory.UUID);
  }

  handleSubscribeMessage(channel: String, message: any ) {
    //parse the message removing the uuid
    //we should build a message dispatcher which takes a method and a channel name
    console.log(`channel: ${channel}`);
    console.log(`accesssory: ${this.accessory.displayName}`);
    var subStrings = channel.split(":");
    if (subStrings[1] == "currentTemperature") {  
      var newValue = message as number;
      this.states.CurrentTemperature = newValue;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, newValue);
    } else if (subStrings[1] == "heatingCoolingState") {
      var newValue = message as number;
      this.states.HeatingCoolingState = newValue;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, newValue);
    }
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
    var channel = `${this.accessory.UUID}:targetTemperature`
    this.client.publish(channel, value as number);
    this.client.set(channel, value as number);
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
