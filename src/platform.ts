import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HeatingAccessory } from './platformAccessory';
import { RedisConfig, ThermostatConfig} from './config';

// import { platform } from 'os';
// import { format } from 'path';
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */

export class HeatingPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this.log.debug('config', this.config);
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      if (this.config.redis === null) {
        log.info('Plugin configuration incomplete');
        return;
      }
      // run the method to discover / register your devices as accessories
      this.discoverDevices(this.config.thermostats as [ThermostatConfig], this.config.redis as RedisConfig);
      this.discoverThermostats(this.config.thermostats as [ThermostatConfig]);
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  discoverThermostats(thermostats: [ThermostatConfig]) {
    thermostats.forEach( thermostatConfig => {
      this.log.info('thermostat: ', thermostatConfig.identifier);
    });
  }

  discoverDevices(thermostats: [ThermostatConfig], redisConfig: RedisConfig) {
    // loop over the discovered devices and register each one if it has not already been registered
    // for (const device of thermostats) {
    thermostats.forEach(thermostatConfig =>{
      
      const uuid = this.api.hap.uuid.generate(thermostatConfig?.identifier);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        // if (device) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new HeatingAccessory(this, existingAccessory, this.log, redisConfig);
          
        // update accessory cache with any changes to the accessory details and information
        this.api.updatePlatformAccessories([existingAccessory]);
        // } else if (!device) {
        //   // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
        //   // remove platform accessories when no longer present
        //   this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        //   this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        // }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', thermostatConfig.name);

        const accessory = new this.api.platformAccessory(thermostatConfig.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = thermostatConfig;
        new HeatingAccessory(this, accessory, this.log, redisConfig);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    });
  }
}
