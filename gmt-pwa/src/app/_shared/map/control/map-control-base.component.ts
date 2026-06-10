import { Component, Output, OnInit, EventEmitter } from '@angular/core';
import { BaseMapComponent } from "../panel/base-map.component";


@Component({
    selector: 'map-control',
    template: '<div></div>',
    standalone: false
})
export abstract class MapControlBaseComponent implements OnInit {

  //Note that this appears to not be used...; use instead _mapPanel which is set on bindToMap
  //@Input() mapPanel?: BaseMapComponent
  @Output() bindControl = new EventEmitter<BaseMapComponent>();
  @Output() unbindControl = new EventEmitter<BaseMapComponent>();

  protected _mapPanel: BaseMapComponent | undefined = undefined;



  ngOnInit() {
    // if (this.mapPanel) {
    //   this.bindToMap(this.mapPanel);
    // }
  }

  /**
   * A map control uses this method to bind to events of a map panel.
   * A control can only be bound to one map at a time.
   * @param mapPanel
   * @public
   */
  public bindToMap(mapPanel: BaseMapComponent) {
    if (this._mapPanel && this._mapPanel === mapPanel) {return;}

    // First unbind from a map panel ...
    this.unbindFromMap();



    // ... then bind to the new panel
    this._mapPanel = mapPanel;
    this.bindControl.emit(this._mapPanel);
  }

  /**
   * Unbind a map control from the events of a map panel.
   * A control can only be bound to one map at a time.
   * @public
   */
  public unbindFromMap() {
    if(this._mapPanel !== undefined) {
      const currentMap = this._mapPanel;
      this._mapPanel = undefined;
      this.unbindControl.emit(currentMap);
    }
  }
}
