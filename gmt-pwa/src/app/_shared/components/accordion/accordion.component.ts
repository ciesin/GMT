import { Component, Input, Type } from '@angular/core';
import { IconProp } from '@fortawesome/fontawesome-svg-core';

@Component({
    selector: 'gmt-accordion',
    templateUrl: './accordion.component.html',
    styleUrls: ['./accordion.component.less'],
    standalone: false
})
export class GmtAccordionComponent {
  @Input() initialPanelOpen: boolean = false;
  @Input() titleIcon: IconProp;
  @Input() title: string = "";
  @Input() contentComponent?: Type<any>;
  panelOpenState: boolean = false;

}
