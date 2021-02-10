export class TemperatureMessage {
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