import { Injectable } from "@angular/core";
import { Coordinate } from "ol/coordinate";
import { Extent } from "ol/extent";
import { Pixel } from "ol/pixel";
import { StyleLike } from "ol/style/Style";
import { BehaviorSubject, Observable, Subject } from "rxjs";
import { GeoJsonBase, } from "src/app/utils/server-interfaces/GeoJson";
import { MapVectorLayerName, VisualizationMapVectorLayerName } from "src/app/utils/server-interfaces/VectorLayerName";

export interface MicroplanMapClicked {
  coordinates: Coordinate,
  selectedLayer: MapVectorLayerName | VisualizationMapVectorLayerName | null,
  selectedGlobalId: string | null
}

export enum LayerIds {
  LOCATION = 'locationOverlay',
  CATCHMENT = 'catchmentOverlay',
  POP_RASTER_GENERIC = 'popRasterGenericOverlay',
  POP_RASTER_PROBLEMATIC = 'popRasterProblematicOverlay',
  POP_RASTER = 'popRasterOverlay',
  POP_RASTER_VALUES = 'popRasterValuesOverlay',
  HF_BUFFERS = 'hfBufferOverlay',
  HF_VORONOI = 'hfVoronoiOverlay',
}

//These serve to identify an OverlayLayer but are also used as an index when adding to the map
//By using a const enum, at runtime, these will be numeric constants
//Some of these dont have a LayerId because they share the same layer -- _featureOverlayLayer
export const enum OverlayLayer {
  NORMAL,
  DRAWN_POLYGONS,
  BOUNDARIES,
  EDITD_BOUNDARIES,
  ROADS,
  SELECTED,
  OUTREACH_LINES,
  CATCHMENT,
  POP_RASTER_GENERIC,
  POP_RASTER_PROBLEMATIC,
  POP_RASTER_UNINHABITED,
  POP_RASTER_VALUES,
  HF_BUFFERS,
  HF_VORONOI,
  GNSS_LOCATION,

  //Used only to know the last index needed
  LAST,
  // NORMAL_SELECTED,
}

export interface ServiceApiFeature {
  geo_json : GeoJsonBase,
  style: StyleLike,
  layer: OverlayLayer
}

export enum ZoomMode {
  //Zoom will never change, even if extent will not be visible.
  DONT_CHANGE,
  //Map will only zoom out the smallest amount needed to make extent visible
  ZOOM_OUT_MIN,
  //Map will zoom in as much as it can, leaving the extent visible
  ZOOM_IN_MAX,
}

export interface PanMapArgs {
  //differentiator constant
  movementType: "Pan",
  extent: Extent,
  zoomMode: ZoomMode,
}

export interface CenterArgs {
  movementType: "Center",
  center: Pixel
}

export type MovementType = "Pan" | "Center";

//Union type
export type MapMovement = PanMapArgs | CenterArgs;
export interface MapFeaturePublisher {
  addFeature(feature: ServiceApiFeature, emit: boolean) : void;
  emitOverlayFeatureUpdate() : void;
  removeAllFeatures(layer: OverlayLayer) : void;
}

@Injectable({
  providedIn: 'root'
})
export class MapEventsService implements MapFeaturePublisher {
  private clicked = new Subject<MicroplanMapClicked>();
  //Turns off map interactions
  private interactions = new Subject<boolean>();
  private isWizardEnabled = new BehaviorSubject<boolean>(false);

  //Note for performance this is indexed by the OverlayLayer const enum, which gets transpiled into a number
  private overlayFeatures = new Array<Array<ServiceApiFeature>>();
  private overlayFeaturesObs = new Subject<Array<Array<ServiceApiFeature>>>();
  public layerVisibilityChange = new Subject<{layerId: string, visible: boolean}>();
  public detailsPopupChange = new Subject<{layerId: MapVectorLayerName, featureId: string}>();
  public clearFocus = new Subject<boolean>();
  private mapMovementObs = new Subject<MapMovement>();
  private mapExtentObs = new BehaviorSubject<Extent>([-180, -90, 180, 90] as Extent);
  private isMapInitialized = new BehaviorSubject<boolean>(false);

  //track which lines we drew hf_guid + outreach_guid
  //to only redraw the lines when we need to
  public hfToOutreachDrawnLines = new Set<string>();

  constructor() {
    this.clearAllOverlayFeatures();
  }

  private clearAllOverlayFeatures( ) {
    this.overlayFeatures = [];
    for(let i = 0; i < OverlayLayer.LAST; ++i) {
      this.overlayFeatures.push([]);
    }
  }

  public getClickedObservable(): Observable<MicroplanMapClicked> {
    return this.clicked.asObservable();
  }

  public emitClicked(e: MicroplanMapClicked) {
    this.clicked.next(e);
  }

  public getInteractionsObservable(): Observable<boolean> {
    return this.interactions.asObservable();
  }

  public getIsMapInitialized(): Observable<boolean> {
    return this.isMapInitialized.asObservable();
  }

  public getIsWizardEnabled(): Observable<boolean> {
    return this.isWizardEnabled.asObservable();
  }

  public setIsMapInitialized(isInit: boolean) {
    this.isMapInitialized.next(isInit);
  }

  public emitInteractions(e: boolean) {
    this.interactions.next(e);
  }

  public emitWizardMode(isWizardEnabled: boolean) {
    this.isWizardEnabled.next(isWizardEnabled);
  }

  public addFeature(feature: ServiceApiFeature, emit: boolean = true) {

    if (!feature.geo_json) {
      return;
    }

    this.overlayFeatures[feature.layer].push(feature);

    if (emit) {
      this.emitOverlayFeatureUpdate();
    }
  }
  /**
   *
   * @param catchmentRelated set to true to remove catchment related features, false to remove ad hoc features
   */
  public removeAllFeatures(layer: OverlayLayer | null = null) {

    if (layer === null) {
      this.clearAllOverlayFeatures();
      this.hfToOutreachDrawnLines.clear();
    } else {
      //clear the array https://stackoverflow.com/questions/1232040/how-do-i-empty-an-array-in-javascript
      this.overlayFeatures[layer].length = 0;

      if (layer == OverlayLayer.OUTREACH_LINES) {
        this.hfToOutreachDrawnLines.clear();
      }
    }

    this.emitOverlayFeatureUpdate();
  }

  public getOverlayFeaturesObservable(): Observable<Array<Array<ServiceApiFeature>>> {
    return this.overlayFeaturesObs.asObservable();
  }

  public emitOverlayFeatureUpdate() {
    this.overlayFeaturesObs.next(this.overlayFeatures);
  }

  /**
   * Pans the map to make the given extent visible
   */
  public panToExtent(args: PanMapArgs)
  {
    this.mapMovementObs.next(args);
  }
  public center(args: CenterArgs)
  {
    this.mapMovementObs.next(args);
  }

  public getMapMovementObs() : Observable<MapMovement>
  {
    return this.mapMovementObs.asObservable();
  }

  public extentChange(newExtent: Extent) {
    this.mapExtentObs.next(newExtent);
  }

  public getMapExtentObs() : Observable<Extent>{
    return this.mapExtentObs.asObservable();
  }

  public triggerLayerVisibilityChange(layerId: string, visible: boolean) {
    this.layerVisibilityChange.next({layerId, visible});
  }

  // for now only used for boundary edits, but would be nice if controllers would be sending triggers here
  public layerVisibilityObs(): Observable<{layerId: string, visible: boolean}>{
    return this.layerVisibilityChange.asObservable();
  }

  public triggerDetailsPopupChange(layerId: MapVectorLayerName, featureId: string) {
    this.detailsPopupChange.next({layerId, featureId});
  }

  // for now only used for boundary edits, but would be nice if controllers would be sending triggers here
  public detailsPopupObs(): Observable<{layerId: MapVectorLayerName, featureId: string}>{
    return this.detailsPopupChange.asObservable();
  }

  public triggerClearFocus() {
    return this.clearFocus.next(true);
  }

  public clearFocusObs(): Observable<boolean>{
    return this.clearFocus.asObservable();
  }
}
