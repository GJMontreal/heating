import { Logger } from 'homebridge';

declare type MessageHandlerCallback = (channel: string, message: string) => void;

export class MessageHandler {
  constructor (
  readonly channel: string,
  readonly handler: MessageHandlerCallback,
  ){

  }

  execute(message: string) {
    this.handler(this.channel, message);
  }
}

export class MessageDispatcher {
  private handlers = {};
  constructor (
  public readonly log?: Logger,
  ){}

  addHandler(handler: MessageHandler) {
    this.handlers[handler.channel] = handler;
  }

  dispatchMessage(channel: string, message: string){
    const handler = this.handlers[channel];
    if(handler !== undefined){
      handler.execute(message);
    } else {
      if(this.log!==undefined) {
        this.log.debug(`unhandled channel: ${channel} message: ${message}`); 
      }
    }
  }
}