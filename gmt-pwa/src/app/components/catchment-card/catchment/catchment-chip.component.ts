import { Component, Input } from '@angular/core';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import {FaIconComponent, IconDefinition} from "@fortawesome/angular-fontawesome";
import {CommonModule} from "@angular/common";

@Component({
    selector: 'gmt-catchment-chip',
    templateUrl: './catchment-chip.component.html',
    styleUrls: ['./catchment-chip.component.less'],
    standalone: true,
  imports: [
    FaIconComponent,
    CommonModule
    ]
})
export class CatchmentChipComponent {
  @Input() title: string;
  @Input() value: number | string;
  @Input() icon: IconProp | IconDefinition;
  @Input() detailValue: number;
  @Input() detailIcon: IconProp | IconDefinition;

  @Input() color: string = 'inherit';
}
