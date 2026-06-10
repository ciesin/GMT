import {Component, EventEmitter, OnInit, Output} from '@angular/core';


@Component({
    selector: 'boundary-search',
    templateUrl: './boundary-search.component.html',
    styleUrls: ['./boundary-search.component.less'],
    standalone: false
})
export class BoundarySearchComponent implements OnInit {
  filterInputText: string = "";
  @Output() inputChangeEvent = new EventEmitter();

  ngOnInit(){}

  handleFilterChange(newValue: string) {
    this.filterInputText = newValue;
    this.inputChangeEvent.emit(newValue);
    console.log(`Filter Text is ${this.filterInputText}`);
  }
}

