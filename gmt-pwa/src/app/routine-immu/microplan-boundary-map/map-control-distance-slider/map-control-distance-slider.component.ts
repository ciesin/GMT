import {Component, EventEmitter, Input, Output} from '@angular/core';
import {AppConfigService} from 'src/app/utils/app-config.service';

@Component({
    selector: 'map-control-distance-slider',
    templateUrl: './map-control-distance-slider.component.html',
    styleUrls: ['./map-control-distance-slider.component.less'],
    standalone: false
})
export class MapControlDistanceSliderComponent {

  // note, the default values are [0, AppConfigService.conf.catchment.min_fixed_post_buffer_m]
  public range: number[] = [0, 1];

  // take initial range in meters from parent component
  @Input() distanceMetersInput: [number, number];
  @Output() distanceMeters: EventEmitter<[number, number]> = new EventEmitter();
  // config is loaded async so we set default values
  public handleValuesMapping: {[key:number]: number} = {
      0: 0,
      1: 2,
      2: 5
    };
  public sliderValueStart = 0;
  public sliderValueEnd = 1;
  constructor(){

  }

  ngOnInit(){
    this.handleValuesMapping[1] = AppConfigService.conf.catchment.min_fixed_post_buffer_m;
    this.handleValuesMapping[2] = AppConfigService.conf.catchment.max_fixed_post_buffer_m;
    let min = Object.keys(this.handleValuesMapping).find(key => this.handleValuesMapping[parseInt(key)] == this.distanceMetersInput[0]);
    let max = Object.keys(this.handleValuesMapping).find(key => this.handleValuesMapping[parseInt(key)] == this.distanceMetersInput[1]);
    this.range = [min? parseInt(min): 0, max? parseInt(max): 1];
  }

  public formatLabel(sliderStep: number): string{
     if(this){
        return (this[sliderStep]/1000).toString();
     }

    return sliderStep.toString();
  }
  /**
   * Don't allow select range where both values are equal
   * @param sliderStepStart
   */
  public validateAndChangeDistanceStartInput(sliderStepStart: number){
    this.changeDistanceInput(sliderStepStart, this.sliderValueEnd);
  }
  public validateAndChangeDistanceEndInput(sliderStepEnd: number){
    this.changeDistanceInput(this.sliderValueStart, sliderStepEnd);
  }
  public disableSliderStartIfNeeded(sliderStepStart) {
    if(sliderStepStart.value == 2){
      this.sliderValueStart = 1;
      this.changeDistanceInput(this.sliderValueStart, this.sliderValueEnd);
    } else if (this.sliderValueEnd == 1 && sliderStepStart.value == 1){
      this.sliderValueStart = 0;
      this.changeDistanceInput(this.sliderValueStart, this.sliderValueEnd);
    }
  }

  public disableSliderEndIfNeeded(sliderStepEnd) {
    if(sliderStepEnd.value == 0){
      this.sliderValueEnd = 1;
      this.changeDistanceInput(this.sliderValueStart, this.sliderValueEnd);
    } else if (this.sliderValueStart == 1 && sliderStepEnd.value == 1){
      this.sliderValueEnd = 2;
      this.changeDistanceInput(this.sliderValueStart, this.sliderValueEnd);
    }
  }
  public changeDistanceInput(sliderStepStart: number, sliderStepEnd: number){
    this.distanceMeters.emit([
      this.handleValuesMapping[sliderStepStart],
      this.handleValuesMapping[sliderStepEnd]]);
  }
}
