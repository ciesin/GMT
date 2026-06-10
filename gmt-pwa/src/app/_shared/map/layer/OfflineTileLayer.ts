import { Component, OnInit } from '@angular/core';
import { Tile } from 'ol/layer';

@Component({
  template: '',
})
export abstract class OfflineTileLayer extends Tile {


  /**
   * `OfflineTileLayer` constructor, should be called via super() in implementing classes
   */
  protected constructor() {
    super()
  }

  ngOnInit(): void {

  }

  /**
   * Pre-seeds this layer for the given extent in the offline cache
   */
  public cache_tiles(extent: number[]) {

  }
}
