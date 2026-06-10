import { Component } from '@angular/core';
import { MapControlBaseComponent } from "../map-control-base.component";


@Component({
    selector: 'map-control-zoom',
    templateUrl: './map-control-zoom.component.html',
    styleUrls: ['./map-control-zoom.component.less'],
    providers: [{ provide: MapControlBaseComponent, useExisting: MapControlZoomComponent }],
    standalone: false
})
export class MapControlZoomComponent extends MapControlBaseComponent {

  zoomIn(animated: boolean) {
    this._mapPanel?.zoomIn(animated);
  }

  zoomOut(animated: boolean) {
    this._mapPanel?.zoomOut(animated);
  }
}
