import { Component, EventEmitter, Output } from '@angular/core';

@Component({
    selector: 'location',
    templateUrl: './location.component.html',
    styleUrls: ['./location.component.less'],
    providers: [],
    standalone: false
})
export class LocationComponent {
  @Output() triggerGetLocation = new EventEmitter<boolean>();

  handleTriggerGetLocation(){
    this.triggerGetLocation.next(true);
  }
}
