import { Component, EventEmitter, Output } from '@angular/core';
import {
  faBarsProgress,
  faCalendarCheck,
  faCalendarDays,
  faChartColumn,
  faChartPie,
  faLessThanEqual,
  faPeopleLine,
  faUsersBetweenLines
} from '@fortawesome/free-solid-svg-icons';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { coverageLabel, dataQualityLabel, mpProgressLabel, policyLabel } from "src/app/constants/indicators.constants";

@Component({
    selector: 'toggle-indicators',
    templateUrl: './toggle-indicators.component.html',
    styleUrls: ['./toggle-indicators.component.less'],
    standalone: false
})
export class ToggleIndicatorsComponent {
  @Output() indicatorChange = new EventEmitter<string>();
  public selectedButton = mpProgressLabel;

  buttons = [
    {
      label: mpProgressLabel,
      faIcon: faCalendarCheck
    },
    // {
    //   label: policyLabel,
    //   faIcon: faLessThanEqual
    // },
    {
      label: coverageLabel,
      faIcon: faPeopleLine
    },
    {
      label: dataQualityLabel,
      faIcon: faChartPie
    },
  ];

  constructor() {}


  handleMapToggleChange(event: MatButtonToggleChange) {
    this.selectedButton = event.value;
    this.indicatorChange.next(event.value);
  }
}
