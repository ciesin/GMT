import { Component, Input } from '@angular/core';
import { Subject } from "rxjs";
import { coverageLabel, dataQualityLabel, mpProgressLabel, policyLabel } from "src/app/constants/indicators.constants";


@Component({
    selector: 'boundary-map-legend',
    templateUrl: './legend.component.html',
    styleUrls: ['./legend.component.less'],
    standalone: false
})
export class BoundaryMapLegendComponent {
  @Input() selectedIndicator: string;
  public coverageLabel = coverageLabel;
  public dataQualityLabel = dataQualityLabel;
  public mpProgressLabel = mpProgressLabel;
  public policyLabel = policyLabel;

  public isLegendOpen: boolean = false;
  private unsubscribe = new Subject();

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  closeLegend() {
    this.isLegendOpen = false;
  }

  toggleLegend() {
    this.isLegendOpen = !this.isLegendOpen;
  }
}
