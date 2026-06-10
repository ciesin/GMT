import { Injectable } from '@angular/core';
import Feature from 'ol/Feature';
import { Geometry } from 'ol/geom';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  MultiPolygon,
  Polygon as PolygonGeoJson,
} from '../../utils/server-interfaces/GeoJson';

///////////////////////////////////////////////////////////////////////////////
// When user choosing a lat / lon, there will be a map location in the middle of the map
// This is to control its state
export interface MapPointLocationConfig {
  visible: boolean;
  //If true, will send location via the MapPointLocation Observable
  requestMapLocation: boolean;
}

export interface MapPointLocationState {
  latitude: number;
  longitude: number;
  //true if the coordinates are coming from the map
  //This is when sentCurrentLocation is sent via mapPointLocationState
  fromMap: boolean;
}
///////////////////////////////////////////////////////////////////////////////

export interface MapDrawPolygonConfig {
  active: boolean;
}

export interface MapEditPolygonConfig {
  active: boolean;
  selectCurrentFeatures?: boolean;
  features?: Array<Feature<Geometry>>;
}

//When the draw tool has finished drawing a polygon
export interface MapDrawnPolygon {
  polygon: PolygonGeoJson;
}

export interface MapEditedPolygon {
  polygon: MultiPolygon;
}

@Injectable({
  providedIn: 'root',
})
export class MicroplanMapEventsService {
  //Get/Set the lat/lon of the map point location control
  public mapPointLocationState = new Subject<MapPointLocationState>();
  //Send configuration (like visibility) to the map point location control (how a user chooses a lat/lon)
  public mapPointLocationConfig = new Subject<MapPointLocationConfig>();

  public drawPolygonConfig = new Subject<MapDrawPolygonConfig>();
  public drawPolygonResult = new Subject<MapDrawnPolygon>();

  public editPolygonConfig = new Subject<MapEditPolygonConfig>();
  public editPolygonResult = new Subject<MapDrawnPolygon>();

  private settlementPartSelection = new BehaviorSubject<Array<string>>([]);

  // private showSingleCatchment = new Subject<boolean>();
  // private disableSingleCatchment = new Subject<boolean>();
  public hfId = new BehaviorSubject<string>('');
  private updateCatchmentsRelatedData = new Subject();

  //When a outreach / hf is moved, this is to update the blue lines
  //and the distance guides
  private hfMoved = new Subject<string>();

  // emits when distance slider value change [min meters, max meters]
  private distanceSliderValueChange = new Subject<[number, number]>();
  private settlementHighlight = new Subject<string | null>();
  private hfHighlight = new Subject<string | null>();
  private poiHighlight = new Subject<string>();
  private focusedHfs = new Subject<string[]>();
  private focusedSettlements = new Subject<string[]>();
  private removeHfFocus = new Subject<boolean>();
  private removeStFocus = new Subject<boolean>();
  private settlementPartsSelectionChange = new Subject<boolean>();
  private undoForPolygonDrawing = new Subject<boolean>();
  // private editLayerFirstFeature = new Subject<string>();

  //A list of settlement part global_ids
  public getSelectedSettlementPartsObservable(): Observable<Array<string>> {
    return this.settlementPartSelection.asObservable();
  }

  public getSelectedSettlementParts(): Array<string> {
    return this.settlementPartSelection.value;
  }

  public setSelectedSettlementParts(selection: Array<string>) {
    this.settlementPartSelection.next([...new Set(selection)]);
  }

  //Maybe be able to remove this in favour of any time
  //suppressUserInterfaceUpdates.next(false) is called,
  //the catchment is redrawn
  public triggerCatchmentRendering() {
    this.updateCatchmentsRelatedData.next(undefined);
  }

  public redrawCatchmentObs(): Observable<unknown> {
    return this.updateCatchmentsRelatedData.asObservable();
  }

  //The HF guid that just moved
  public hfMovedObs(): Observable<string> {
    return this.hfMoved.asObservable();
  }
  public triggerhfMoved(hfId: string): void {
    this.hfMoved.next(hfId);
  }

  public distanceSliderValueChangeEvent(sliderValues: [number, number]) {
    this.distanceSliderValueChange.next(sliderValues);
  }

  public distanceSliderValueChangeObs(): Observable<[number, number]> {
    return this.distanceSliderValueChange.asObservable();
  }

  public triggerSettlementHighlightEvent(
    highlightedSettlementId: string | null
  ) {
    this.settlementHighlight.next(highlightedSettlementId);
  }

  public settlementHighlightEventObs(): Observable<string | null> {
    return this.settlementHighlight.asObservable();
  }

  public triggerHfHighlightEvent(highlightedHfId: string | null) {
    this.hfHighlight.next(highlightedHfId);
  }

  public hfHighlightEventObs(): Observable<string | null> {
    return this.hfHighlight.asObservable();
  }

  public triggerPoiHighlightEvent(highlightedPoiId: string) {
    this.poiHighlight.next(highlightedPoiId);
  }

  public poiHighlightEventObs(): Observable<string> {
    return this.poiHighlight.asObservable();
  }
  public triggerFocusHf(focusedHfs: string[]) {
    this.focusedHfs.next(focusedHfs);
  }

  /**
   * Get list of global ids of focused HFs
   */
  public focusHfObs(): Observable<string[]> {
    return this.focusedHfs.asObservable();
  }

  public triggerRemoveHfFocus() {
    this.removeHfFocus.next(true);
  }

  /**
   * Get list of global ids of focused HFs
   */
  public removeHfFocusObs(): Observable<boolean> {
    return this.removeHfFocus.asObservable();
  }

  public triggerFocusSettlement(focusedSettlement: string[]) {
    this.focusedSettlements.next(focusedSettlement);
  }

  public focusSettlementObs(): Observable<string[]> {
    return this.focusedSettlements.asObservable();
  }

  public triggerRemoveSettlementFocus() {
    this.removeStFocus.next(true);
  }

  public removeSettlementFocusObs(): Observable<boolean> {
    return this.removeStFocus.asObservable();
  }

  public enableSettlementPartsSelection(enabled: boolean) {
    this.settlementPartsSelectionChange.next(enabled);
  }

  public settlementPartsSelectionObs(): Observable<boolean> {
    return this.settlementPartsSelectionChange.asObservable();
  }
  public triggerUndoForPolygonDrawing() {
    this.undoForPolygonDrawing.next(true);
  }

  public undoForPolygonDrawingObs(): Observable<boolean> {
    return this.undoForPolygonDrawing.asObservable();
  }

  // public triggerEditFirstFeatureInLayer(layerName: string) {
  //   this.editLayerFirstFeature.next(layerName);
  // }
  //
  // public editFirstFeatureInLayerObs(): Observable<string>{
  //   return this.editLayerFirstFeature.asObservable();
  // }
}
