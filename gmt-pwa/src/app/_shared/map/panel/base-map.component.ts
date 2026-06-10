import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { isFinite as lodashIsFinite, isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Feature, getUid, Map, MapBrowserEvent } from 'ol';
import { defaults as controlDefaults, ScaleLine } from 'ol/control';
import { Coordinate } from 'ol/coordinate';
import { equals as equalExtents, extend, getCenter } from 'ol/extent';
import { FeatureLike } from 'ol/Feature';
import { GeoJSON } from 'ol/format';
import {
  Geometry,
  GeometryCollection,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
} from 'ol/geom';
import {
  defaults as interactionDefaults,
  DoubleClickZoom,
  DragPan,
  DragRotate,
  DragRotateAndZoom,
  DragZoom,
  Interaction,
  KeyboardPan,
  KeyboardZoom,
  MouseWheelZoom,
  PinchRotate,
  PinchZoom,
} from 'ol/interaction';
import { Group as LayerGroup } from 'ol/layer';
import BaseLayer from 'ol/layer/Base';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { Size } from 'ol/size';
import VectorSource from 'ol/source/Vector';
import { Style } from 'ol/style';
import { StyleFunction, StyleLike } from 'ol/style/Style';
import View from 'ol/View';
import { Subscription } from 'rxjs';
import { BaseMapName, NO_BASEMAP } from 'src/app/constants/basemap-names';
import {
  PanMapArgs,
  ServiceApiFeature,
  ZoomMode,
} from 'src/app/services/map/base/map-events.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { Extent, Position } from 'src/app/utils/server-interfaces/GeoJson';
import {
  calculateCenter,
  calculateMetersWidthHeight,
  calculateWidthHeight,
  getLargestZoomLevel,
} from '../../../utils/coords';
import { MapControlBaseComponent } from '../control/map-control-base.component';
import { applyStyle, highlighted, selected } from '../styles/map-styles';
import { bufferExtent } from '../util/map-utils';
import { Extent as GeojsonExtent } from 'src/app/utils/server-interfaces/GeoJson';
import _ from "lodash";

export type GeometryObject =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon;

export interface FeatureSelection {
  [key: string]: {
    feature: FeatureLike;
    layer?: string;
  };
}

export interface SelectionMode {
  single: boolean;
  mixed: boolean;
}

export interface ClickEvent {
  coordinates: Position;
  eventKeys: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    pointerType: string;
  };
  pixel: [number, number];
}

export type SelectionModel = {
  (feature: Feature): boolean;
};

/*
 * Base map class:
 * ---------------
 * The base map class provides many common methods for:
 * - Open layer map set up in different modes (interactive, rotatable, restricted, etc.)
 * - Baselayer and overlay layer management
 * - Zooming or panning to extents, features, zoomlevels, etc.
 * - Finding nested map controls and binding them to this map
 * - A highlight and selection model allowing to set selection behavior, styles and selectable layers
 * - Providing many common map events as subscribable outputs
 *
 * Map Projection:
 * ---------------
 * The basemap expects coordinates and outputs them in the WGS84 (EPSG:4326) spatial reference system (SRS) as a common
 * denominator. Independent from that, the map itself can be rendered in a different SRS. The coordinate re-projection
 * happens on-the-fly in this class. If necessary, then use this classes' `project...To...` methods to project WGS84
 * coordinates to the map projection or vice versa with the `project...From...` methods.
 *
 * Map events:
 * -----------
 * The base map class provides many EventEmitter outputs which can be subscribed to. Please do not add component
 * specific services to this class because it is used by several components. Add your specific component logic
 * in derived subclasses and if necessary tie the event outputs of this class to component specific services in a
 * specific component.
 *
 * Base layers:
 * ------------
 * A map can be configured with several base layers of which only one can be shown at a time. The baselayer will always
 * be rendered below all other layers.
 *
 * Overlay layers:
 * ---------------
 * Normal layers that will participate in a z-index ordered stack are called overlay layers. This layers are shown on
 * top if each other following their stack index. The z-index gets automatically set on adding an overlay layer or can
 * be specified when adding an overlay layer together with a numerical index  in `addOverlayLayers`.
 *
 * Map controls:
 * -------------
 * Derived classes of the base map control that are nested items of the map object will be automatically discovered
 * throughout the map's lifecycle and bound to this map panel.
 *
 * Selection model:
 * ----------------
 * The maps selection mode either enables or disables selection and distinguishes if single or multiple or even mixed
 * selections can be done. To style hovered or selected items, the map provides a default highlighted (`_highlightStyle`)
 * and selected (`_selectedStyle`) styles. These styles can be simply changed to custom styles ot set to undefined if
 * no styling is desired. To implement a complete custom logic, the four interceptor methods (`onFeatureSelection`,
 * `onFeatureDeslection`, `onFeatureHighlight`, `onFeatureUnhighlight`) can be overwritten which disables styling.
 * Selected items are found in the subscribable `selectionChange` class output.
 */

@Component({
  selector: 'base-map',
  templateUrl: './base-map.component.html',
  styleUrls: ['./base-map.component.less'],
  standalone: false
})
export abstract class BaseMapComponent
  implements OnInit, OnChanges, AfterViewInit
{
  @Input() srid: number = AppConfigService.map.map_projection;
  @Input() extent: Extent = [-180, -90, 180, 90] as Extent;
  @Output() extentChange = new EventEmitter<Extent>();
  @Input() center: Position = [0, 0];
  @Output() centerChange = new EventEmitter<Position>();
  @Input() zoomlevel: number = 1;
  @Output() zoomlevelChange = new EventEmitter<number>();
  @Input() animated: boolean = true;
  @Input() interactive: boolean = true;
  @Output() interactiveChange = new EventEmitter<boolean>();
  @Input() baselayers: BaseLayer[] = [];
  @Output() baselayersChange = new EventEmitter<BaseLayer[]>();
  @Input() baselayer?: BaseLayer;
  @Output() baselayerChange = new EventEmitter<BaseLayer>();
  @Input() overlays: BaseLayer[] = [];
  @Output() overlaysChange = new EventEmitter<BaseLayer[]>();
  @Input() rotatable: boolean = true;
  @Output() rotatableChange = new EventEmitter<boolean>();
  @Input() rotation: number = 0;
  @Output() rotationChange = new EventEmitter<number>();
  @Input() focus: Extent | undefined = undefined;
  @Output() focusChange = new EventEmitter<Extent | undefined>();
  @Input() selectionMode: SelectionMode = {
    single: true,
    mixed: false,
  };
  @Input() selectable: boolean | null | string[] = null;
  @Output() selectableChange = new EventEmitter<boolean>();
  @Output() selectionChange = new EventEmitter<FeatureSelection>();
  @Output() mapRendered = new EventEmitter<Map>();
  @Output() mapSingleclick = new EventEmitter<ClickEvent>();
  @Output() mapDoubleclick = new EventEmitter<ClickEvent>();

  @ViewChild('ol_map') mapElement?: ElementRef;
  @ViewChildren(MapControlBaseComponent)
  controls!: QueryList<MapControlBaseComponent>;

  public map?: Map;
  private _suppressEvents: boolean = false;
  private _suppressClickEvents: boolean = false;

  //Keys are getUid of a feature
  protected _selectedFeatures: FeatureSelection = {};
  private _highlightedFeatures: { [key: string]: FeatureLike } = {};
  private _highlightStyle: StyleLike | undefined = highlighted;
  private _selectedStyle: StyleLike | undefined = selected;
  protected _featureOverlayLayer!: VectorLayer;
  // protected _selectedFeatureOverlayLayer!: VectorLayer;
  private _selection_model: SelectionModel | undefined;
  private _control_subscription!: Subscription;
  protected zoomEnabled: boolean | undefined = false;
  protected animationDuration: number = 2000;
  protected cursor: string = '';

  /**
   * `BaseMapComponent` constructor, should be called via super() in implementing classes
   */
  constructor(protected logger: NGXLogger) {} // protected zone: NgZone

  ngOnInit(): void {}

  ngOnDestroy() {
    // Unbind any nested control from this map
    this.controls.forEach((c) => {
      c.unbindFromMap();
    });
    // Stop watching for new nested control components
    this._control_subscription.unsubscribe();
  }

  ngAfterViewInit() {
    // Init the OL map after the angular view exists
    this.initMap();
    // Find nested controls and set map the object on them, also listen for controls added later
    this.controls.forEach((c) => {
      c.bindToMap(this);
    });
    // Watch for new control child components and bind them automatically to this map
    this._control_subscription = this.controls.changes.subscribe((ql) => {
      (ql as QueryList<MapControlBaseComponent>).forEach((c) => {
        c.bindToMap(this);
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // React on changes to input in the map
    if (changes.center) {
      this.panToLocation(changes.center.currentValue, this.zoomlevel);
    } else if (changes.extent) {
      this.zoomToExtent(changes.extent.currentValue);
    } else if (changes.zoomlevel) {
      this.zoomToZoomlevel(changes.zoomlevel.currentValue);
    } else if (changes.rotatable) {
      this.enableRotation(changes.rotatable.currentValue);
    } else if (changes.rotation) {
      this.map?.getView().setRotation(changes.rotation.currentValue);
    } else if (changes.focus) {
      this.restrictFocus(changes.focus.currentValue);
    } else if (changes.baselayer) {
      this.toggleBaseLayer(changes.baselayer.currentValue);
    } else if (changes.baselayers) {
      this.addBaseLayers(changes.baselayers.currentValue);
    } else if (changes.selectable) {
      this.enableSelection(changes.selectable.currentValue);
    }
  }

  private handleMapEventMoveEnd() {
    const map = this.map!;
    const newExtent = this.projectFromMap(
      map.getView().calculateExtent(map.getSize())
    ) as Extent;
    const newCenter = this.projectFromMap(
      map.getView().getCenter() as number[]
    ) as Position;
    const newZoomlevel = map.getView().getZoom() as number;

    if (this.center.toString() != newCenter.toString()) {
      this.center = newCenter;
      if (!this._suppressEvents) {
        this.centerChange.emit(newCenter);
      }
    }
    if (!equalExtents(this.extent, newExtent)) {
      this.extent = newExtent;
      if (!this._suppressEvents) {
        this.extentChange.emit(newExtent);
      }
    }
    if (this.zoomlevel != newZoomlevel) {
      this.zoomlevel = newZoomlevel;
      if (!this._suppressEvents) {
        this.zoomlevelChange.emit(newZoomlevel);
      }
    }
    if (this.rotation != (map.getView().getRotation() / Math.PI) * 180) {
      this.rotation = (map.getView().getRotation() / Math.PI) * 180;
      if (!this._suppressEvents) {
        this.rotationChange.emit(this.rotation);
      }
    }
  }

  protected handleMapEventSingleClickGetNewSelection(
    event: MapBrowserEvent | ClickEvent
  ): Array<[Feature, VectorLayer]> {
    const map = this.map!;

    let new_selection: [Feature, VectorLayer][] = [];
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature, layer) => {
        if (
          this.allowFeatureSelection(feature as Feature, layer as VectorLayer)
        ) {
          new_selection.push([feature as Feature, layer as VectorLayer]);
        }
      },
      {
        hitTolerance: 0,
        layerFilter: (l) => {
          if (Array.isArray(this.selectable) && this.selectable.length > 0) {
            return this.selectable.includes(l.get('id'));
          }
          return true;
        },
      }
    );
    return new_selection;
  }

  /**
   * Not using layerId to unselect here because it is only used for ST selection while splitting/merging
   * and it saves somewhere selected feature without layer name
   * @param newSelection
   * @private
   */
  private handleMapEventSingleClickProcessNewSelection(
    newSelection: Array<[Feature, VectorLayer]>
  ) {
    if (newSelection.length <= 0) {
      return;
    }

    newSelection.sort((s1, s2) => {
      const z1Index: number = s1[1].getZIndex()!;
      const z2Index: number = s2[1].getZIndex()!;
      if (z1Index < z2Index) {
        return 1;
      } else if (z1Index > z2Index) {
        return -1;
      } else {
        return 0;
      }
    });

    const previousSelection = Object.keys(this._selectedFeatures);

    // Make sure that we only select of one feature type from one layer and not across layers
    if (!this.selectionMode.mixed && newSelection.length > 1) {
      // Reduce selection to only entries of same layer as first layer
      if (
        new Set(
          newSelection.map((s) => {
            return s[1].get('id');
          })
        ).size > 1
      ) {
        newSelection = newSelection.filter((s) => {
          return s[1].get('id') === newSelection[0][1].get('id');
        });
      }
      // If new selection does not fit already selected, than remove all that do not fit from current selection
      if (Object.keys(this._selectedFeatures).length > 0) {
        Object.keys(this._selectedFeatures).forEach((k) => {
          let layerId = newSelection[0][1].get('id');
          if (this._selectedFeatures[k].layer !== layerId) {
            (this._selectedFeatures[k].feature as Feature).setStyle(undefined);
            delete this._selectedFeatures[k];
          }
        });
      }
    }

    // Ensure we only select one item if single mode is on (Take the first selected feature)
    if (this.selectionMode.single) {
      newSelection = [newSelection[0]];
    }

    // Check selection model if feature can be selected
    if (this._selection_model !== undefined) {
      newSelection = newSelection.filter((f) =>
        (this._selection_model as SelectionModel)(f[0])
      );
    }

    const map = this.map!;

    // Add or remove from current selection if already selected
    newSelection.forEach((s) => {
      let layerId = s[1].get('id');
      if (this._selectedFeatures[getUid(s[0])] !== undefined) {
        // Remove from selection, reset style, etc. but do not yet emit selection changed
        this.unhighlightFeatures(s[0], true); // , [layerId]
      } else {
        // Clear complete previous selection because only one allowed but do not yet emit selection changed
        if (this.selectionMode.single) {
          this.clearSelection(true);
        }
        // Select the new feature, apply style, etc. but do not yet emit selection changed
        this._selectedFeatures[getUid(s[0])] = {
          feature: s[0],
          layer: layerId,
        };
        if (this.onFeatureSelection(s[0])) {
          s[0].setStyle(
            applyStyle(
              this._selectedStyle,
              s[1].getStyle() as StyleLike,
              s[0],
              map.getView().getResolution() as number
            )
          );
        }
      }
    });
    // Now we can check if the selection has changed and emit the event
    if (!this._suppressEvents) {
      if (
        JSON.stringify(Object.keys(this._selectedFeatures).sort()) !==
        JSON.stringify(previousSelection.sort())
      ) {
        this.selectionChange.emit(this._selectedFeatures);
      }
    }
  }

  private handleMapEventSingleClick(event: MapBrowserEvent) {
    const map = this.map!;

    if (this._suppressClickEvents) {
      return;
    }

    // Selection behaviour
    if (this.selectable !== false) {
      // Get previous and current selection in map layer order to ensure we select the topmost
      const newSelection = this.handleMapEventSingleClickGetNewSelection(event);

      this.handleMapEventSingleClickProcessNewSelection(newSelection);
    }

    // Default click behaviour
    if (!this._suppressEvents) {
      this.mapSingleclick.emit({
        coordinates: this.projectFromMap(
          map.getEventCoordinate(event.originalEvent as PointerEvent)
        ) as Position,
        eventKeys: {
          shiftKey: (event.originalEvent as PointerEvent).shiftKey,
          ctrlKey: (event.originalEvent as PointerEvent).ctrlKey,
          altKey: (event.originalEvent as PointerEvent).altKey,
          metaKey: (event.originalEvent as PointerEvent).metaKey,
          pointerType: (event.originalEvent as PointerEvent).pointerType,
        },
        pixel: map.getEventPixel(event.originalEvent) as [number, number],
      });
    }
  }

  private handleMapEventPointerMove(event: MapBrowserEvent) {
    this.trackSelectableLayers(event);
    this.changeMousePointer(event);
  }

  private trackSelectableLayers(event: MapBrowserEvent) {
    const map = this.map!;
    if (this.selectable !== false) {
      const hovered: [FeatureLike, BaseLayer][] = [];
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature, layer) => {
          hovered.push([feature, layer]);
        },
        {
          hitTolerance: 0,
          layerFilter: (l) => {
            if (Array.isArray(this.selectable) && this.selectable.length > 0) {
              return this.selectable.includes(l.get('id'));
            }
            return true;
          },
        }
      );

      // Do nothing when a feature is already selected
      if (
        hovered?.length > 0 &&
        this._selectedFeatures[getUid(hovered[0][0])] !== undefined
      ) {
        return;
      } // When we do not hover a selected feature
      else {
        // this.logger.debug('HOVERED FEATURES?', hovered?.length, hovered?.length > 0 ? hovered.map((h: [FeatureLike, BaseLayer])=>{return getUid(h[0])}) : '')

        // Get all hovered features
        const hovered_ids = hovered.map((h) => {
          return getUid(h[0]);
        });

        // Unhighlight all features which are not longer hovered but also not selected
        Object.keys(this._highlightedFeatures).forEach((k) => {
          if (
            !hovered_ids.includes(k) &&
            this._selectedFeatures[k] === undefined
          ) {
            this.unhighlightFeatures(
              this._highlightedFeatures[k] as Feature,
              true
            );
          }
        });

        // Sort hovered items if more then one are hovered (to make sure we respect zIndex of features)
        if (hovered.length > 1) {
          hovered.sort((h1, h2) => {
            if (h1[1].getZIndex()! < h2[1].getZIndex()!) {
              return 1;
            } else if (h1[1].getZIndex()! > h2[1].getZIndex()!) {
              return -1;
            } else {
              return 0;
            }
          });
        }

        // Add hovered which are not yet in highlighted features (Let's use only one hovered item for now)
        if (hovered.length > 0) {
          [hovered[0]].forEach((h) => {
            if (this._highlightedFeatures[getUid(h[0])] === undefined) {
              if (this._selectedFeatures[getUid(h[0])] === undefined) {
                this.highlightFeatures(
                  h[0] as Feature,
                  this._highlightStyle
                    ? applyStyle(
                        this._highlightStyle,
                        (h[1] as VectorLayer).getStyle() as Style,
                        h[0],
                        map.getView().getResolution() as number
                      )
                    : undefined,
                  false,
                  undefined,
                  undefined,
                  false,
                  false
                );
              }
            }
          });
        }
      }
    }
  }

  private changeMousePointer(event: MapBrowserEvent) {
    if (!this.map) {
      return;
    }
    const pixel = this.map.getEventPixel(event.originalEvent);
    const hovered = this.map.hasFeatureAtPixel(pixel);
    let cursor = this.map.getViewport().style.cursor;
    this.cursor = hovered ? 'pointer' : 'grab';
    if (cursor != this.cursor) {
      this.map.getViewport().style.cursor = this.cursor;
    }
  }
  private handleMapEventDoubleClick(event: MapBrowserEvent) {
    const map = this.map!;

    if (this._suppressEvents || this._suppressClickEvents) {
      return;
    }

    this.mapDoubleclick.emit({
      coordinates: this.projectFromMap(
        map.getEventCoordinate(event.originalEvent as PointerEvent)
      ) as Position,
      eventKeys: {
        shiftKey: (event.originalEvent as PointerEvent).shiftKey,
        ctrlKey: (event.originalEvent as PointerEvent).ctrlKey,
        altKey: (event.originalEvent as PointerEvent).altKey,
        metaKey: (event.originalEvent as PointerEvent).metaKey,
        pointerType: (event.originalEvent as PointerEvent).pointerType,
      },
      pixel: map.getEventPixel(event.originalEvent) as [number, number],
    });
  }

  /**
   * Inits the Openlayers map and all events
   * @private
   */
  private initMap() {
    const me = this;
    if (this.map) {
      return;
    }

    // Create the view
    const view = this.focus
      ? new View({
          extent: this.projectToMap(this.focus) as Extent,
          center: getCenter(
            this.projectToMap(this.focus) as Extent
          ) as Position,
          zoom: this.zoomlevel,
          rotation: this.rotation,
          enableRotation: this.rotatable,
        })
      : new View({
          center: this.center,
          zoom: this.zoomlevel,
          rotation: this.rotation,
          enableRotation: this.rotatable,
        });

    //DEBUG show mouse control
    // const mousePositionControl = new MousePosition({
    //   coordinateFormat: createStringXY(7),
    //   projection: 'EPSG:4326',
    //   // comment the following two lines to have the mouse position
    //   // be placed within the map.
    //   className: 'custom-mouse-position',
    //   target: document.getElementById('mouse-position'),
    // });

    // Create ol map
    // this.zone.runOutsideAngular(() => {
    const map = new Map({
      view: view,
      target: this.mapElement?.nativeElement,
      interactions: interactionDefaults({
        altShiftDragRotate: true,
        pinchRotate: true,
        dragPan: true,
        pinchZoom: true,
        mouseWheelZoom: true,
        doubleClickZoom: false,
        shiftDragZoom: true,
        keyboard: true,
      }),
      controls: controlDefaults({
        attribution: false,
        zoom: this.zoomEnabled ? this.zoomEnabled : false,
      }).extend([
        new ScaleLine({ units: 'metric' }),
        //DEBUG show mouse control
        //mousePositionControl
      ]),
    });
    map.getView().setConstrainResolution(false);

    // Set map
    this.map = map;

    // Apply control interactivity retrospectively on map creation (Only if configured as false)
    if (!this.interactive) {
      try {
        this._suppressEvents = true;
        this.interactive = true;
        this.setInteractive(false);
        this._suppressEvents = false;
      } catch (error) {
        this._suppressEvents = false;
      }
    }

    // Create a feature overlay layer (To which ad hoc features can be rendered)
    this._featureOverlayLayer = new VectorLayer({ source: new VectorSource() });
    this._featureOverlayLayer.set('id', '_featureOverlayLayer');
    this._featureOverlayLayer.set('overlay', true);
    this._featureOverlayLayer.setZIndex(10000);

    // this._selectedFeatureOverlayLayer = new VectorLayer({source: new VectorSource()});
    // this._selectedFeatureOverlayLayer.set('id', '_selectedFeatureOverlayLayer');
    // this._selectedFeatureOverlayLayer.set('overlay', true);
    // this._selectedFeatureOverlayLayer.setZIndex(20000);

    // Add & render configured layers
    this.addBaseLayers(this.baselayers);
    this.addOverlayLayers(this.overlays);
    this.map.addLayer(this._featureOverlayLayer);
    // this.map.addLayer(this._selectedFeatureOverlayLayer);

    // Register view events (Must use getView() as initial view might change)
    map.on('moveend', () => this.handleMapEventMoveEnd());

    // Set selection
    this.enableSelection(this.selectable!);

    // Register double click handler
    map.on('dblclick', (event: MapBrowserEvent) =>
      this.handleMapEventDoubleClick(event)
    );

    // Register single click handler
    map.on('singleclick', (event: MapBrowserEvent) =>
      this.handleMapEventSingleClick(event)
    );

    // Register mouse hover actions
    map.on('pointermove', (event: MapBrowserEvent) =>
      this.handleMapEventPointerMove(event)
    );

    // Implement pointer style & behavior
    map.getViewport().style.cursor = 'grab';
    map.on('pointerdrag', (e) => {
      map.getViewport().style.cursor =
        (e.originalEvent as KeyboardEvent).shiftKey &&
        !(e.originalEvent as KeyboardEvent).altKey
          ? 'zoom-in'
          : 'grabbing';
    });
    // map.on('pointerup', (e) => {
    //   map.getViewport().style.cursor =
    //     (this.selectable !== false ? 'pointer' : 'grab')
    // });

    // Fire event when map has completely rendered
    map.once('postrender', function (event) {
      if (!me._suppressEvents) {
        me.mapRendered.emit(map);
      }
    });
    // });
  }

  /**
   * Returns lat/lon coordinates (point/extent) transformed to the map internal projection.
   * Coordinates should always be in EPSG:4326. This method carries for their transformation to
   * whatever projection the map panel uses internally.
   * @param coordinates
   */
  projectToMap(coordinates: Extent | number[]): Extent | Position {
    if (this.srid != 4326) {
      if (coordinates.length == 2) {
        return fromLonLat(coordinates, `EPSG:${this.srid}`) as Position;
      } else if (coordinates.length == 4) {
        return transformExtent(
          coordinates as Extent,
          `EPSG:4326`,
          `EPSG:${this.srid}`
        ) as Extent;
      }
    }
    return coordinates as Extent;
  }

  /**
   * Returns lat/lon coordinates (point/extent) transformed from the map internal projection.
   * Coordinates should always be in EPSG:4326. This method carries for the transformation to the proper coordinate
   * reference system from whatever projection the map panel uses internally.
   * @param coordinates
   */
  projectFromMap(coordinates: Extent | number[]): Extent | Position {
    if (this.srid != 4326) {
      if (coordinates.length == 2) {
        return toLonLat(coordinates, `EPSG:${this.srid}`) as Position;
      } else if (coordinates.length == 4) {
        return transformExtent(
          coordinates as Extent,
          `EPSG:${this.srid}`,
          `EPSG:4326`
        ) as Extent;
      }
    }
    return coordinates as Extent;
  }

  /**
   * Returns geometries transformed to the map internal projection. This method carries for their transformation to
   * whatever projection the map panel uses internally.
   * @param geometry
   */
  public projectGeometryToMap(geometry: GeometryObject) {
    if (this.srid != 4326) {
      return geometry.transform(
        `EPSG:4326`,
        `EPSG:${this.srid}`
      ) as GeometryObject;
    } else {
      return geometry;
    }
  }

  /**
   * Returns geometries transformed from the map internal projection. This method carries for the transformation to
   * the proper coordinate reference system from whatever projection the map panel uses internally.
   * @param geometry
   */
  public projectGeometryFromMap(geometry: GeometryObject) {
    if (this.srid != 4326) {
      return geometry.transform(`EPSG:${this.srid}`, `EPSG:4326`);
    } else {
      return geometry;
    }
  }

  /**
   * Set a highlighting style for map features. If `undefined` is set, highlighted features will not be styled
   * @param style
   */
  public setHighlightStyle(style: StyleLike | undefined) {
    this._highlightStyle = style;
  }

  /**
   * Set a selection style for map features. If `undefined` is set, selected features will not be styled unless
   * @param style
   */
  public setSelectionStyle(style: StyleLike) {
    this._selectedStyle = style;
  }

  /**
   * Enable or disable selection mode in the map. If selection is enabled without further restrictions,
   * then all feature layers are being respected by hover and selection tools.
   * Instead of generally enabling selection, a layer ID or a list of layer IDs can
   * be provided, which restricts the functionality to only features of these layers.
   * @param selection
   * @param mode
   */
  public enableSelection(
    selection: boolean | string | string[],
    mode?: SelectionMode
  ) {
    const previous_state = this.selectable !== false;
    if (selection !== false) {
      if (this.map) {
        this.map.getViewport().style.cursor = 'pointer';
      }
      if (selection === true) {
        this.selectable = [];
      } else if (Array.isArray(selection)) {
        this.selectable = selection;
      } else {
        this.selectable = [selection];
      }
    } else {
      if (this.map) {
        this.map.getViewport().style.cursor = 'grab';
      }
      this.selectable = false;
    }

    if (mode) {
      this.selectionMode = mode;
    }
    if ((this.selectable !== false) !== previous_state) {
      // Clear when selectable selection changes
      this.clearSelection();
      // Emit selectable change
      if (!this._suppressEvents) {
        this.selectableChange.emit(this.selectable !== false);
      }
    } else if (this.selectable === false) {
      // Always clear when we set to false
      this.clearSelection();
    }
  }

  /**
   * Clears all selected features
   * @param suppress
   */
  public clearSelection(suppress: boolean = false) {
    // Clear all selected features and reset selected & highlighted features
    this.unhighlightFeatures(
      // Object.values(this._selectedFeatures).map((selection) => selection.feature as Feature),
      [],
      true,
      [],
      true
    );
    this._selectedFeatures = {};
    this._highlightedFeatures = {};

    // Let others know the selection changed
    if (this._suppressEvents === false && suppress === false) {
      this.selectionChange.emit(this._selectedFeatures);
    }
  }

  /**
   * Returns currently selected map features
   */
  public getSelection(): FeatureLike[] {
    return Object.values(this._selectedFeatures).map((selection) => {
      return selection.feature as Feature;
    }) as FeatureLike[];
  }

  /**
   * This is a template method that intercepts a feature selection and can be used to implement
   * own logic before the map's selection style is applied to the feature. If this method returns `false`,
   * we stop here and do not apply `this._selectedStyle`. If you just want to apply a different selection
   * style, it is better to to just overwrite the `_selectedStyle` of this class.
   * @param feature
   * @param layer
   * @protected
   */
  protected onFeatureSelection(feature: Feature): boolean {
    return true;
  }

  protected allowFeatureSelection(
    feature: Feature,
    layer: VectorLayer
  ): boolean {
    return true;
  }

  /**
   * This is a template method that intercepts a feature deselection and can be used to implement
   * own logic before the map's selection style is removed from the feature. If this method returns `false`,
   * we stop here and do not remove the `_selectedStyle` style.
   * @param feature
   * @protected
   */
  protected onFeatureDeselection(feature: Feature): boolean {
    return true;
  }

  /**
   * This is a template method that intercepts the highlighting of a feature and can be used to implement
   * own logic before the map's highlighting style is applied to the feature. If this method returns `false`,
   * we stop here and do not apply `this._highlightedStyle`. If you just want to apply a different highlighting
   * style, it is better to to just overwrite the `_highlightedStyle` of this class.
   * @param feature
   * @protected
   */
  protected onFeatureHighlight(feature: Feature): boolean {
    return true;
  }

  /**
   * This is a template method that intercepts the unhighlighting of a feature and can be used to implement
   * own logic before the map's highlighting style is removed from the feature. If this method returns `false`,
   * we stop here and do not remove the `_highlightedStyle` style.
   * @param feature
   * @protected
   */
  protected onFeatureUnhighlight(feature: Feature): boolean {
    return true;
  }

  /**
   * Highlight one or more features in a map. You can either provide a custom style or leave it undefined to use the
   * default highlighted & selected styles set for the map. Highlighted features can optionally be added to the map's
   * selection (overwriting or adding to an existing selection) and the map view get be optionally focused on the
   * features(s) if you provide either a zoomlevel or an adjustment factor (Use 0 for the adjustment if you want to
   * focus exactly on the feature extent). Attention: Be aware that this method might perform a layer lookup per feature
   * to find the associated layer of a feature. This can cost performance and will happen only if you set `select=true`
   * or when no style is provided.
   * @param features
   * @param style
   * @param select
   * @param zoomlevel
   * @param adjustment
   * @param animated
   * @param suppress
   * @param layerId
   */
  public highlightFeatures(
    features: Feature | Feature[],
    style?: Style | StyleFunction,
    select: boolean = false,
    zoomlevel?: number,
    adjustment?: number,
    animated?: boolean,
    suppress?: boolean,
    layerId?: string
  ): Promise<boolean> {
    const highlight_features = Array.isArray(features) ? features : [features];
    let selection_changed = false;

    // Highlight each feature
    highlight_features.forEach((f) => {
      // Execute the interceptor only once, because we might execute additional logic in derrived classes
      // (we save its result r in this constant)!
      const onInterceptorResult = select
        ? this.onFeatureSelection(f)
        : this.onFeatureHighlight(f);

      // Find layer(s) which contain the feature to get layer style and layer id only if we need to select or have no
      // style. Otherwise we don't need to look the layer up because it has an impact on performance!
      let feature_layers =
        select === true || !style
          ? this.getMapFeatureLayers(f, layerId)
          : undefined;
      // Style feature only if the interceptor result was `true`
      if (onInterceptorResult) {
        // Apply user provided style
        if (style) {
          f.setStyle(style);
        }
        // Apply style highlighted/selected style applied to layer style
        else if (
          feature_layers &&
          feature_layers.length > 0 &&
          (feature_layers[0] as VectorLayer).getStyle()
        ) {
          if (
            select ? this._selectedStyle : this._highlightStyle !== undefined
          ) {
            f.setStyle(
              applyStyle(
                select ? this._selectedStyle : this._highlightStyle,
                (feature_layers[0] as VectorLayer).getStyle() as Style,
                f,
                this.map?.getView().getResolution() as number
              )
            );
          }
        }
        // Apply default highlight or selection styles
        else {
          if (select && this._selectedStyle) {
            f.setStyle(this._selectedStyle);
          } else if (!select && this._highlightStyle) {
            f.setStyle(this._highlightStyle);
          }
        }
      }

      // Let's try to set a very high ZIndex to make sure it is rendered above neighbour features
      try {
        (f.getStyle() as Style).setZIndex(10000000);
      } catch (error) {}

      // Add feature to highlighted features array if we highlight
      if (!select) {
        this._highlightedFeatures[`${getUid(f)}${layerId ? layerId : ''}`] = f;
      }

      // Add feature to selection if we select (and respect the map's selection mode)
      if (select && feature_layers) {
        // Clear a previous selection if we only allow a single selection at a time

        if (this.selectionMode.single) {
          this.clearSelection(true);
          selection_changed = true;
        }
        // If a mixed selection is not allowed, check if any existing selection matches the current, otherwise clear previous)
        if (
          !this.selectionMode.mixed &&
          Object.keys(this._selectedFeatures).length > 0 &&
          feature_layers.length > 0
        ) {
          if (
            feature_layers[0].get('id') !==
            Object.values(this._selectedFeatures).map((s) => {
              return s.layer;
            })[0]
          ) {
            this.clearSelection(true);
          }
        }
        // Add current feature to selection
        this._selectedFeatures[`${getUid(f)}${layerId ? layerId : ''}`] = {
          feature: f,
          layer: layerId ? layerId : feature_layers[0].get('id'), // for HFs and STs we have repeated feature ids in different layers
        };
        // Make sure it is not in highlighted features at the same time
        delete this._highlightedFeatures[
          `${getUid(f)}${layerId ? layerId : ''}`
        ];
        selection_changed = true;
      }
    });

    // Let others know the selection changed
    if (
      selection_changed &&
      this._suppressEvents === false &&
      suppress !== true
    ) {
      this.selectionChange.emit(this._selectedFeatures);
    }

    // Focus to the highlighted features
    if (zoomlevel !== undefined || adjustment !== undefined) {
      return this.zoomToFeatures(
        highlight_features,
        zoomlevel,
        adjustment,
        animated
      );
    } else {
      return new Promise((resolve, reject) => {
        resolve(true);
      });
    }
  }

  /**
   * Unhighlights highlighted or selected features. Use this method if you want to
   * deselect or unhighlight specific features instead of clearing for instance a
   * complete selection.
   * @param features
   * @param suppress
   * @param layerIds
   * @param clearAll
   */
  public unhighlightFeatures(
    features: Feature | Feature[],
    suppress: boolean = false,
    layerIds?: string[],
    clearAll: boolean = false
  ) {
    const unhighlight_features = Array.isArray(features)
      ? features
      : [features];
    let deselected: number = 0;
    // we need this option when we don't have alyer id
    if (clearAll) {
      Object.values(this._selectedFeatures).forEach((value) => {
        deselected++;
        let f = value.feature as Feature<Geometry>;
        delete this._selectedFeatures[getUid(f)];
        if (this.onFeatureDeselection(f)) {
          f.setStyle(undefined);
        }
      });
      Object.values(this._highlightedFeatures).forEach((value) => {
        deselected++;
        let f = value as Feature<Geometry>;
        delete this._highlightedFeatures[getUid(f)];
        if (this.onFeatureUnhighlight(f)) {
          f.setStyle(undefined);
        }
      });
    } else {
      unhighlight_features.forEach((f) => {
        if (layerIds) {
          layerIds.forEach((layerId) => {
            if (
              this._selectedFeatures[`${getUid(f)}${layerId ? layerId : ''}`]
            ) {
              deselected++;
              delete this._selectedFeatures[
                `${getUid(f)}${layerId ? layerId : ''}`
              ];
              if (this.onFeatureDeselection(f)) {
                f.setStyle(undefined);
              }
            }
            if (this._highlightedFeatures[getUid(f)] + layerId ? layerId : '') {
              delete this._highlightedFeatures[
                `${getUid(f)}${layerId ? layerId : ''}`
              ];
              if (this.onFeatureUnhighlight(f)) {
                f.setStyle(undefined);
              }
            }
          });
        } else {
          if (this._selectedFeatures[getUid(f)]) {
            deselected++;
            delete this._selectedFeatures[getUid(f)];
            if (this.onFeatureDeselection(f)) {
              f.setStyle(undefined);
            }
          }
          if (this._highlightedFeatures[getUid(f)]) {
            delete this._highlightedFeatures[getUid(f)];
            if (this.onFeatureUnhighlight(f)) {
              f.setStyle(undefined);
            }
          }
        }
      });
    }

    if (
      deselected > 0 &&
      this._suppressEvents === false &&
      suppress === false
    ) {
      this.selectionChange.emit(this._selectedFeatures);
    }
  }

  /**
   * Should be called on map if the outer div element changes
   */
  public updateMapSize() {
    this.map?.updateSize();
  }

  /**
   * If you want to avoid that the map emits any change events, then suppress events
   * This might be helpful in rare cases, when you want to change a map state without alerting any
   * of its state subscribers.
   * @param suppress
   */
  public suppressEvents(suppress: boolean) {
    this._suppressEvents = suppress;
  }

  /**
   * If you want to only mute map events related to user click interaction, then suppress click events.
   * All other map events will still be emitted.
   * @param suppress
   */
  public suppressClickEvents(suppress: boolean) {
    this._suppressClickEvents = suppress;
  }

  /**
   * Set a custom selection model that is used to check if a feature in the map can be selected. Be aware that
   * the the list of selectable layers is actually set by the enableSelection method. This means, that the general list
   * of selectable layers is set when you enable the selection, but this selection model is a more precise
   * configuration to distinguish on a per feature level if selection is possible.
   * @param model
   */
  setSelectionModel = (model: SelectionModel): void => {
    this._selection_model = model;
  };

  /**
   * Reset a custom selection model that is used to check if a feature in the map can be selected. Be aware that
   * the the list of selectable layers is actually set by the enableSelection method.
   */
  resetSelectionModel = (): void => {
    this._selection_model = undefined;
  };

  /**
   * Get a custom selection model that is used to check if a feature in the map can be selected. Be aware that
   * the the list of selectable layers is actually set by the enableSelection method.
   */
  getSelectionModel = (): SelectionModel | undefined => {
    return this._selection_model;
  };

  /**
   * Enables or disables map interaction. In disabled state, a user cannot drag, zoom or rotate the map.
   * @param state
   */
  public setInteractive(state: boolean) {
    if (state !== this.interactive) {
      this.interactive = state;
      this.map?.getInteractions().forEach((i: Interaction) => {
        if (
          i instanceof DragRotate ||
          i instanceof PinchRotate ||
          i instanceof DragRotateAndZoom
        ) {
          i.setActive(state && this.rotatable);
        } else if (
          i instanceof DoubleClickZoom ||
          i instanceof DragZoom ||
          i instanceof PinchZoom ||
          i instanceof KeyboardZoom ||
          i instanceof MouseWheelZoom ||
          i instanceof DragPan ||
          i instanceof KeyboardPan
        ) {
          i.setActive(state);
        }
      });
      if (!this._suppressEvents) {
        this.interactiveChange.emit(state);
      }
    }
  }

  /**
   * Fits the map view to the provided extent. With an adjustment factor (percentage),
   * the extent can be enlarged or shrunken.
   * @param extent
   * @param adjustment
   * @param animated
   */
  public zoomToExtent(
    extent: Extent | number[],
    adjustment?: number,
    animated?: boolean
  ): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    const panel = this;
    let zoom_extent = panel.projectToMap(extent) as Extent;
    if (adjustment && adjustment > 0) {
      zoom_extent = bufferExtent(zoom_extent, adjustment);
    }
    return new Promise((resolve, reject) => {
      panel.map?.getView().fit(zoom_extent, {
        size: panel.map.getSize(),
        nearest: false,
        duration: animate ? this.animationDuration : 0,
        callback: (success) => {
          resolve(true); // not sure why but "animation makes success to return false..."
          // success ? resolve(true) : reject(false);
        },
      });
    });
  }

  /**
   * Fits the map view to the maximum extent of a vector layer
   * @param layer
   * @param adjustment
   * @param animated
   */
  public zoomToLayer(
    layer: VectorLayer,
    adjustment?: number,
    animated?: boolean
  ): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    return this.zoomToExtent(
      this.projectFromMap(layer.getSource()!.getExtent()),
      adjustment,
      animate
    );
  }

  /**
   * Zooms to the maximum extent of the map
   * @param adjustment
   * @param animated
   */
  public zoomToMaxExtent(
    adjustment?: number,
    animated?: boolean
  ): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    return this.zoomToExtent(
      this.focus || ([-180, -90, 180, 90] as Extent),
      adjustment,
      animate
    );
  }

  /**
   * Zooms to the specified zoomlevel
   * @param zoomlevel
   * @param animated
   */
  public zoomToZoomlevel(
    zoomlevel: number,
    animated?: boolean
  ): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    const panel = this;
    return new Promise((resolve, reject) => {
      panel.map?.getView().animate(
        {
          zoom: zoomlevel,
          duration: animate ? this.animationDuration : 0,
        },
        (success) => {
          success ? resolve(true) : reject(false);
        }
      );
    });
  }

  /**
   * Zooms into map by one zoomlevel/resolution
   * @param animated
   */
  public zoomIn(animated?: boolean): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    const zoomlevel = this.map?.getView().getZoom();
    const maxZoom = this.map?.getView().getMaxZoom();
    const panel = this;
    return new Promise((resolve, reject) => {
      if (zoomlevel && maxZoom) {
        panel.map?.getView().animate(
          {
            zoom: zoomlevel < maxZoom ? zoomlevel + 1 : maxZoom,
            duration: animate ? this.animationDuration : 0,
          },
          (success) => {
            success ? resolve(true) : reject(false);
          }
        );
      } else {
        resolve(true);
      }
    });
  }

  /**
   * Zooms map out by one zoomlevel/resolution
   * @param animated
   */
  public zoomOut(animated?: boolean): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    const zoomlevel = this.map?.getView().getZoom();
    return new Promise((resolve, reject) => {
      if (zoomlevel) {
        this.map?.getView().animate(
          {
            zoom: zoomlevel === 0 ? 0 : zoomlevel - 1,
            duration: animate ? this.animationDuration : 0,
          },
          (success) => {
            success ? resolve(true) : reject(false);
          }
        );
      } else {
        resolve(true);
      }
    });
  }

  /**
   * Set the views rotation angle
   * @param angle
   */
  public rotateView(angle: number) {
    this.map?.getView().setRotation((angle * Math.PI) / 180);
  }

  /**
   * Pan to the given coordinate (at same or specified zoomlevel)
   * @param location
   * @param zoomlevel
   * @param animated
   */
  public panToLocation(
    location: Position | Coordinate | number[],
    zoomlevel?: number,
    animated?: boolean
  ): Promise<boolean> {
    const animate = animated === undefined ? this.animated : animated;
    return new Promise((resolve, reject) => {
      this.map?.getView().animate(
        {
          zoom: zoomlevel ? zoomlevel : this.zoomlevel,
          center: this.projectToMap(location),
          duration: animate ? this.animationDuration : 0,
        },
        (success) => {
          resolve(true); // If we intercept the zooming, we don't want the error to be thrown success ? resolve(true) : reject(false);
        }
      );
    });
  }

  /**
   * Zoom to the extent of the given features or center to features at a given zoomlevel.
   * Be aware, that a zoomlevel and an adjustment factor do not have an affect at the same time.
   * (The zoomlevel wins over the adjustment, so use either one or the other).
   * @param features
   * @param zoomlevel
   * @param adjustment
   * @param animated
   */
  public zoomToFeatures(
    features: FeatureLike[] | Feature[] | Geometry[] | GeometryCollection,
    zoomlevel?: number,
    adjustment?: number,
    animated?: boolean
  ): Promise<boolean> {
    let extent: Extent | undefined = undefined;
    const animate = animated === undefined ? this.animated : animated;
    if (features instanceof GeometryCollection) {
      // Get extent from geometry collection
      extent = features.getExtent() as GeojsonExtent;
    } else {
      // Pan to it if we have only one point feature (Extent does not work here)
      if (
        features.length === 1 &&
        features[0] !== undefined &&
        (features[0] instanceof Feature
          ? (features[0] as Feature).getGeometry()
          : features[0]
        )?.getType() === 'Point'
      ) {
        return this.panToLocation(
          this.projectFromMap(
            ((features[0] as Feature).getGeometry() as Point).getCoordinates()
          ),
          zoomlevel,
          animate
        );
      }

      // Calculate extent from all features/geometries (Make sure we do not change the extent of a feature, therefore recreate extent)
      features.forEach((f: FeatureLike | Feature | Geometry, i: number) => {
        if (!extent) {
          extent =
            f instanceof Feature
              ? f.getGeometry()?.getExtent() as GeojsonExtent
              : (f.getExtent() as GeojsonExtent);
        } else {
          const f_extent =
            f instanceof Feature ? f.getGeometry()?.getExtent() : f.getExtent();
          if (f_extent) {
            extent = extend([...extent], f_extent) as GeojsonExtent;
          }
        }
      });
    }

    if (extent) {
      if (zoomlevel) {
        return this.panToLocation(
          this.projectFromMap(getCenter(extent)),
          zoomlevel,
          animate
        );
      } else {
        return this.zoomToExtent(
          this.projectFromMap(extent),
          adjustment,
          animate
        );
      }
    } else {
      return new Promise((resolve, reject) => {
        resolve(true);
      });
    }
  }

  /**
   * Returns the first map layer with matching layer name.
   * If baselayer is `true`then also search in the list of baselayers.
   * @param name
   * @param baselayers
   */
  public getLayerByName(
    name: string,
    baselayers?: boolean
  ): BaseLayer | undefined {
    let matching_layer: BaseLayer | undefined = undefined;
    for (const l of (baselayers === true
      ? this.map?.getLayers()?.getArray().concat(this.baselayers)
      : this.map?.getLayers()?.getArray()) || []) {
      if (l.get('name') === name) {
        matching_layer = l;
        break;
      }
    }
    return matching_layer;
  }

  /**
   * Returns the first map layer with matching layer id.
   * If baselayer is `true`then also search in the list of baselayers.
   * @param id
   * @param baselayers
   */
  public getMapLayerById(
    id: string,
    baselayers?: boolean
  ): BaseLayer | undefined {
    let matching_layer: BaseLayer | undefined = undefined;
    for (const l of (baselayers === true
      ? this.map?.getLayers()?.getArray().concat(this.baselayers)
      : this.map?.getLayers()?.getArray()) || []) {
      if (l.get('id') === id) {
        matching_layer = l;
        break;
      }
    }
    return matching_layer;
  }
  public triggerLayerUpdate(id: string) {
    for (const l of this.map?.getLayers()?.getArray() || []) {
      if (l.get('id') === id) {
        (l as VectorLayer).getSource()!.changed();
        break;
      }
    }
  }
  /**
   * Searches for features of map vector layers by an id (and optionally for a specific field)
   * @param id
   * @param layer
   * @param field
   */
  public getMapFeaturesById(
    id: string,
    layer?: BaseLayer | string,
    field?: string
  ): Feature[] {
    let matching_features: Feature[] = [];
    const search_layers =
      layer instanceof BaseLayer
        ? [layer]
        : layer
        ? [this.getMapLayerById(layer)]
        : this.getMapOverlayLayers().filter((l) => {
            return l instanceof VectorLayer;
          });
    search_layers.forEach((l) => {
      if (l instanceof VectorLayer) {
        matching_features = matching_features.concat(
          l
            .getSource()!
            .getFeatures()
            .filter((f) => {
              return f.get(field || 'id') === id;
            })
        );
      }
    });
    return matching_features;
  }

  /**
   * Finds all the vector layers which contain the provided feature. This method is not optimised and
   * searches through all layers, and then through all features. Only returns features, if the map is already rendered.
   * @param feature
   * @param layerId
   */
  public getMapFeatureLayers(
    feature: Feature,
    layerId?: string
  ): VectorLayer[] {
    // Find layer(s) to which the feature might belong to get layer style info and layer id
    return this.getMapLayers()
      .filter((l) => {
        return l instanceof VectorLayer;
      })
      .filter((vl) => {
        return (
          (vl as VectorLayer)
            .getSource()!
            .getFeatures()
            .filter((vf) => {
              return (
                getUid(vf) === getUid(feature) &&
                (layerId ? vl.get('id') === layerId : true)
              );
            }).length > 0
        );
      }) as VectorLayer[];
  }

  /**
   * Returns all map baselayers rendered to the map. (Attention: If the map is not rendered, it will return no layers)
   */
  public getMapBaseLayers(): BaseLayer[] {
    return this.getMapLayers().filter((l) => {
      return (
        !this.overlays.includes(l) &&
        l.get('overlay') !== true &&
        l !== this._featureOverlayLayer
      );
    });
  }

  /**
   * Returns all overlay layers rendered to the map. (Attention: If the map is not rendered, it will return no layers)
   */
  public getMapOverlayLayers(): BaseLayer[] {
    return this.getMapLayers().filter((l) => {
      return (
        !this.baselayers.includes(l) &&
        l.get('overlay') !== true &&
        l !== this._featureOverlayLayer
      );
    });
  }

  /**
   * Returns all map layers rendered to the map. (Attention: If the map is not rendered, it will return no layers)
   */
  public getMapLayers(): BaseLayer[] {
    if (this.map) {
      return this.map
        ?.getLayers()
        .getArray()
        .filter((l) => {
          return !(l instanceof LayerGroup);
        }) as BaseLayer[];
    }
    return [] as BaseLayer[];
  }

  public printMapLayers() {
    this.map
      ?.getLayers()
      .getArray()
      .forEach((l, index) => {
        this.logger.debug(
          `${index} | zIndex ${
            l.getZIndex()! !== undefined ? l.getZIndex()! : '?'
          } | ${l instanceof LayerGroup ? 'Laygroup' : 'Layer'} (${l.get(
            'name'
          )})`
        );
      });
  }

  /**
   * Returns the index of an overlay layer (which can be used to insert a layer)
   * @param layer
   */
  public getOverlayLayerIndex(layer: string): number | undefined {
    if (this.map) {
      const l = this.getMapLayerById(layer);
      return l ? l.getZIndex()! - 1 : undefined;
    }
    return undefined;
  }

  /**
   * Adds overlay layers to the map. Overlay layers are stackable layers, where the layer with the highest index is
   * the uppermost shown on the map. If you do not provide a layer index, the overlay layers are added on top of
   * the existing ones.
   * @param layers
   * @param index
   */
  addOverlayLayers(layers: BaseLayer | BaseLayer[], index?: number) {
    const ol_count = this.overlays.length;
    layers = layers instanceof BaseLayer ? [layers] : layers;
    if (layers.length > 0) {
      // Make sure added layers have a layer_id set
      layers.forEach((o) => {
        if (o.get('id') === undefined) {
          o.set('id', `layer_${getUid(o)}`);
        }
      });

      // Make sure we do not add the same layer more than once
      const unique_overlay_ids = Array.from(
        new Set(
          this.overlays.map((o) => {
            return o.get('id');
          })
        )
      );
      const overlays_to_add = layers.filter((o) => {
        return !unique_overlay_ids.includes(o.get('id'));
      });

      // Add overlays
      if (overlays_to_add.length > 0) {
        if (index !== undefined && index >= 0) {
          const overlay_insert_start_index = index + 1;
          const overlay_insert_end_index =
            overlay_insert_start_index + overlays_to_add.length - 1;

          // Check if the insert operation interferes with existing overlays
          const overlays_to_shift = this.overlays.filter((l) => {
            return (
              overlay_insert_start_index <= l.getZIndex()! &&
              l.getZIndex()! <= overlay_insert_end_index
            );
          });

          if (overlays_to_shift.length > 0) {
            this.shiftAllLayersByOneZIndex(overlays_to_shift);
          }

          // Set correct map index for new layer(s) when inserting at a specific index
          overlays_to_add.forEach((o, i) => {
            o.setZIndex(overlay_insert_start_index + i);
          });
        } else {
          this.setIncrementalZIndexToNewLayersStartingFromMaxIndex(
            overlays_to_add
          );
        }
        this.overlays = this.overlays.concat(overlays_to_add);
      }

      if (this.map) {
        // Make sure we shift the reserved feature overlay layer if we added overlays above it
        const new_max_index = this.getOverlaysMaxZIndex();
        if (new_max_index >= this._featureOverlayLayer.getZIndex()!) {
          this._featureOverlayLayer.setZIndex(new_max_index + 1);
        }
        // const max_index_before_adding_selected_layers = this.getOverlaysMaxZIndex();
        // if (max_index_before_adding_selected_layers >= this._selectedFeatureOverlayLayer.getZIndex()!) {
        //   this._selectedFeatureOverlayLayer.setZIndex(max_index_before_adding_selected_layers + 2);
        // }
        // Make sure that layers get added to the map groups and the map itself
        const map_layers = this.getMapLayers();
        this.overlays.forEach((o, i) => {
          if (!map_layers.includes(o)) {
            this.map?.addLayer(o);
          }
        });
      }

      // If the number of baselayers changed, emit change event
      if (this.overlays.length != ol_count) {
        if (!this._suppressEvents) {
          this.overlaysChange.emit(this.overlays);
        }
      }
      // this.logger.debug('symbology: end of stuff');
    }
  }

  /**
   * Shift all layers above the one(s) we're going to insert
   * @param overlays_to_shift
   * @protected
   */
  protected shiftAllLayersByOneZIndex(overlays_to_shift) {
    const overlays_shift_start_index = overlays_to_shift[0].getZIndex()!;
    const overlays_shift_steps = overlays_to_shift.length;
    this.overlays.forEach((o, i) => {
      if (o.getZIndex()! >= overlays_shift_start_index) {
        o.setZIndex(o.getZIndex()! + overlays_shift_steps);
      }
    });
  }

  protected setIncrementalZIndexToNewLayersStartingFromMaxIndex(
    overlays_to_add
  ) {
    // Set correct map index for new layers when adding after existing overlays
    const max_index = Math.max(
      ...this.overlays.map((l) => {
        return l.getZIndex()!;
      })
    );
    overlays_to_add.forEach((oa, i) => {
      oa.setZIndex((max_index < 0 ? 0 : max_index) + i + 1);
    });
  }

  protected getOverlaysMaxZIndex(): number {
    return Math.max(
      ...this.overlays.map((l) => {
        return l.getZIndex()!;
      })
    );
  }
  /**
   * Adds baselayers to the map. If more than one layers are provided, the last one will be selected as visible
   * baselayer. Beware: Only one of the baselayers can be visible at a time. Use `toggleBaseLayer` to change
   * the active baselayer
   * @param layers
   */
  addBaseLayers(layers: BaseLayer | BaseLayer[]) {
    const bl_count = this.baselayers.length;
    layers = layers instanceof BaseLayer ? [layers] : layers;

    if (layers.length > 0) {
      // Make sure added layers have a layer_id set
      layers.forEach((l) => {
        if (l.get('id') === undefined) {
          l.set('id', `layer_${getUid(l)}`);
        }
      });

      // Make sure we do not add the same layer more than once
      const unique_baselayers_ids = Array.from(
        new Set(
          this.baselayers.map((l) => {
            return l.get('id');
          })
        )
      );
      layers.forEach((l) => {
        if (!unique_baselayers_ids.includes(l.get('id'))) {
          this.baselayers.push(l);
        }
      });

      // If the number of baselayers changed, emit change event
      if (this.baselayers.length != bl_count) {
        this.baselayer = this.baselayers[this.baselayers.length - 1];
        if (!this._suppressEvents) {
          this.baselayersChange.emit(this.baselayers);
        }
      }

      // Check if last baselayer is also set as current base layer (if not toggle baselayer)
      if (
        !this.baselayer ||
        !this.getMapBaseLayers().includes(this.baselayer)
      ) {
        this.toggleBaseLayer(this.baselayers[this.baselayers.length - 1]);
      }
    }
  }

  /*
    Gets the currently selected basemap
    */
  getBaseLayerName(): BaseMapName {
    const bmLayers = this.getMapBaseLayers();

    if (!Array.isArray(bmLayers) || bmLayers.length <= 0) {
      return NO_BASEMAP;
    }

    return bmLayers[0].get('name');
  }

  /**
   * Changes the current map's baselayer to the provided layer. A baselayer must exist prior in the map's baselayers.
   * Use `addBaseLayers` to add new baselayers to a map
   * @param layer
   */
  toggleBaseLayer(layer: BaseLayer) {
    //this.logger.debug(`EEE base layer ${layer.get('name')}`, layer.get('id'));

    // Only toggle when layer in baselayers
    if (!this.baselayers.includes(layer as BaseLayer)) {
      return;
    }

    const currentMapBaselayer =
      this.getMapBaseLayers().length > 0
        ? this.getMapBaseLayers()[0]
        : undefined;

    // Only toggle if different
    if (!currentMapBaselayer || currentMapBaselayer !== layer) {
      // Set current base layer
      this.baselayer = layer;

      // Remove older map base layer
      if (currentMapBaselayer) {
        this.map?.removeLayer(currentMapBaselayer);
      }
      // Set new map baselayer
      this.map?.addLayer(this.baselayer);
      this.baselayer.setZIndex(0);

      // Emit event
      if (!this._suppressEvents) {
        this.baselayerChange.emit(this.baselayer);
      }
    }
  }

  removeBaseLayer() {
    const currentMapBaselayer =
      this.getMapBaseLayers().length > 0
        ? this.getMapBaseLayers()[0]
        : undefined;

    this.baselayer = undefined;
    if (currentMapBaselayer) {
      this.map?.removeLayer(currentMapBaselayer);
    }

    // Emit event
    if (!this._suppressEvents) {
      this.baselayerChange.emit(this.baselayer);
    }
  }

  /**
   * Enable or disable map rotation
   * @param rotation
   */
  public enableRotation(rotation: boolean) {
    if (rotation != this.rotatable) {
      this.rotatable = rotation;
      this.map?.getInteractions().forEach((i: Interaction) => {
        if (i instanceof DragRotate || i instanceof PinchRotate) {
          i.setActive(rotation && this.interactive);
        }
        if (rotation === false) {
          this.rotateView(0);
        }
      });
      if (!this._suppressEvents) {
        this.rotatableChange.emit(rotation);
      }
    }
  }

  /**
   * Restrict the map extent to a specified focus extent or removes an existing focus restriction by providing false
   * instead of an extent. A restricted focus means a map can not be shown outside of the restricted extent by zooming,
   * panning, etc. In case of `zoom==true` setting a restriction, the new focus will be set, and the map will zoom to it.
   * @param focus
   * @param zoom
   */
  public restrictFocus(
    focus: Extent | false,
    zoom: boolean = true
  ): Promise<boolean> {
    // If no map is yet rendered, just set the focus and return here
    if (this.map === undefined) {
      this.focus = focus ? focus : undefined;
      return new Promise((resolve, reject) => {
        resolve(true);
      });
    }

    // Update the focus of this map
    this.focus = focus || undefined;

    // Create a new view based on restriction
    const current_view = this.map?.getView();
    const new_view =
      focus === false
        ? new View({
            center: (current_view?.getCenter() as Position) || this.center,
            zoom: current_view?.getZoom(),
            rotation: this.rotation,
            enableRotation: this.rotatable,
          })
        : new View({
            extent: this.projectToMap(focus) as Extent,
            center: getCenter(this.projectToMap(focus) as Extent),
            zoom: current_view?.getZoom(),
            rotation: 0,
            enableRotation: this.rotatable,
          });

    // Set the new restricted view
    return new Promise((resolve, reject) => {
      if (zoom === true) {
        this.zoomToExtent(focus ? focus : this.extent).then(() => {
          this.map?.setView(new_view);
          this.map?.getView().setConstrainResolution(false);
          resolve(true);
        });
      } else if (zoom === false) {
        this.map?.setView(new_view);
        this.map?.getView().setConstrainResolution(false);
        resolve(true);
      } else {
        resolve(true);
      }
    });
  }

  /**
   * A method to display styled ad-hoc features into an overlay vector layer. By default features are added to the
   * reserved default map overlay layer, which is rendered above all other overlay layers. Optionally a vector layer
   * can be specified instead of the default overlay layer (for instance if the overlays should appear at a certain
   * z-index in the mp and not cover other vector layers)
   * @param overlayFeatures
   * @param overlay
   * @param clear
   * @protected
   */
  public addOverlayFeatures(
    overlayFeatures: ServiceApiFeature[] | FeatureLike[],
    overlay?: VectorLayer,
    clear: boolean = true
  ) {
    // Clear previous features by default
    if (clear === true) {
      this.clearOverlayFeatures(overlay || this._featureOverlayLayer);
    }

    // Stop here when no features are provided
    if (overlayFeatures.length <= 0) {
      return;
    }

    // Otherwise add new features
    if (overlayFeatures[0] instanceof Feature) {
      (overlay || this._featureOverlayLayer)
        .getSource()!
        .addFeatures(overlayFeatures as Feature[]);
    } else {
      const features = new GeoJSON({
        dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
        featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
      }).readFeatures({
        type: 'FeatureCollection',
        features: (overlayFeatures as ServiceApiFeature[]).map(
          (f) => f.geo_json
        ),
      });
      for (const [index, sFeature] of (
        overlayFeatures as ServiceApiFeature[]
      ).entries()) {
        features[index].setStyle(sFeature.style);
      }
      (overlay || this._featureOverlayLayer)?.getSource()!.addFeatures(features);
    }
  }

  // public addSelectedOverlayFeatures(overlayFeatures: ServiceApiFeature[] | FeatureLike[], overlay?: VectorLayer,
  //                           clear: boolean = true) {
  //   // Clear previous features by default
  //   if (clear === true) {
  //     this.clearOverlayFeatures(overlay || this._selectedFeatureOverlayLayer);
  //   }
  //
  //   // Stop here when no features are provided
  //   if (overlayFeatures.length <= 0) {
  //     return;
  //   }
  //
  //   // Otherwise add new features
  //   if (overlayFeatures[0] instanceof Feature) {
  //     (overlay || this._selectedFeatureOverlayLayer).getZIndex()!.addFeatures(overlayFeatures as Feature[]);
  //   } else {
  //     const features = new GeoJSON({
  //          dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
  //          featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
  //        })
  //       .readFeatures({"type": "FeatureCollection",
  //                      "features": (overlayFeatures as ServiceApiFeature[]).map(f => f.geo_json)
  //                      });
  //     for (const [index, sFeature] of (overlayFeatures as ServiceApiFeature[]).entries()) {
  //       features[index].setStyle(sFeature.style);
  //     }
  //     (overlay || this._selectedFeatureOverlayLayer)?.getZIndex()!.addFeatures(features);
  //   }
  // }
  /**
   * Clears any overlay feature from an overlay layer. By default features get added to the reserved default map
   * overlay layer, which is rendered above all other overlay layers. Optionally another vector layer can be specified
   * instead of the default overlay layer (for instance if the overlays should appear at a certain z-index in the map
   * and not cover other vector layers)
   * @param overlay
   */
  public clearOverlayFeatures(overlay?: VectorLayer) {
    (overlay || this._featureOverlayLayer)?.getSource()!.clear();
  }

  /**
   * Add a feature overlay (vector layer) at a specified zIndex to the map which serves as a feature overlay
   * @param index
   * @param id
   * @protected
   */
  public createTopLayerOverlay(index: number, id: string): VectorLayer {
    const overlay = new VectorLayer({ source: new VectorSource() });
    overlay.set('overlay', true);
    overlay.set('id', id);
    overlay.setZIndex(
      index > 0 ? index : this._featureOverlayLayer.getZIndex()! + 1
    );
    return overlay;
  }

  protected handlePan(panMapArgs: PanMapArgs) {
    const projectedExtent = this.projectToMap(panMapArgs.extent) as Extent;
    const map = this.map;

    if (_.isNil(map)) {
      this.logger.warn("map is null, ignoring handlePan");
      return;
    }

    //pixel width & height
    //const dims = (document.getElementById('ol_map') as HTMLElement).getBoundingClientRect();
    const dims = (
      this.mapElement!.nativeElement as HTMLElement
    ).getBoundingClientRect();
    //this.logger.debug("Map dims", dims);

    //width / height
    const size = map.getSize()!;

    //These actually don't agree, so lets take the smallest of both

    const pixelWidthHeight: Size = [
      Math.min(dims.width, size[0]),
      Math.min(dims.height, size[1]),
    ];

    //find first zoom level that is good enough
    const largestZoomLevel = getLargestZoomLevel(
      projectedExtent,
      pixelWidthHeight
    );

    //let's check if we need to ease the map restricted extent a little bit
    //note we need to do this before setting the zoom, otherwise OL will restrict the zoom level
    if (this.focus) {
      this.handlePan_adjustPanExtentForFocus(
        projectedExtent,
        pixelWidthHeight,
        largestZoomLevel
      );
    }

    this.handlePan_zoom(map, panMapArgs, projectedExtent, largestZoomLevel);

    //getZoom doesn't return the value I just set it at...
    const currentZoomLevel = map.getView().getZoom()!;
    //this.logger.debug("Current zoom level", currentZoomLevel, map.getView().getMaxZoom(), map.getView().getMinZoom());
    //ensure component zoom level is set
    this.zoomlevel = currentZoomLevel;

    //minX, minY, maxX, maxY
    //We don't use this, but in theory it should be the same
    //I believe it differs only when we have adjusted downward the size
    //const calcExtent = map.getView().calculateExtent(map.getSize());
    //this.logger.debug(`Calc extent ${calcExtent}`);

    const newCenter = this.handlePan_calculateNewCenter(
      pixelWidthHeight,
      projectedExtent,
      map
    );

    //this.logger.debug(`Moving center from ${map.getView().getCenter()} to ${newCenter}`);
    if (this.animated) {
      map
        .getView()
        .animate({ center: newCenter, duration: this.animationDuration });
    } else {
      map.getView().setCenter(newCenter);
    }
  }
  protected findFeaturesById(layerIds, featureIds) {
    let selectedFeatures: Feature[] = [];
    layerIds
      .map((l) =>
        (this.getMapLayerById(l) as VectorLayer)?.getSource()!.getFeatures()
      )
      ?.forEach((features) => {
        if (features) {
          selectedFeatures = selectedFeatures.concat(
            ...features.filter((feature) =>
              featureIds.includes(feature.get('global_id'))
            )
          );
        }
      });
    return selectedFeatures;
  }

  private handlePan_centerOnly(map: Map, projectedExtent: Extent) {
    //Only set the map center to our desired extent

    const newCenter = calculateCenter(projectedExtent);
    this.logger.log(
      `Current map extent is too small, centering to ${newCenter}`
    );
    if (this.animated) {
      map
        .getView()
        .animate({ center: newCenter, duration: this.animationDuration });
    } else {
      map.getView().setCenter(newCenter);
    }
  }

  private handlePan_calculateNewCenter(
    //Pixel width, height of map
    pixelWidthHeightReal: Size,
    //The extent we want to pan too without zooming in or out, in 3857 meters
    projectedExtent: Extent,
    map: Map
  ): Coordinate {
    //We want to adjust the pixel width / height to remove the details section
    //This is to make sure all of the extent is visible on the map that the user can see

    //toolbars; estimates
    const leftAdjustmentPixels = 50;
    const topAdjustmeantPixels = 49;
    const bottomAdjustmentPixels = 24;
    const rightAdjustmentPixels = 320 * 1.1;

    //Convert to 3857 meters
    //Note order o left v right ; top v bottom does not matter
    const [leftAdjustmentMeters, topAdjustmentMeters] =
      calculateMetersWidthHeight(
        [leftAdjustmentPixels, topAdjustmeantPixels],
        this.zoomlevel
      );
    const [rightAdjustmentMeters, bottomAdjustmentMeters] =
      calculateMetersWidthHeight(
        [rightAdjustmentPixels, bottomAdjustmentPixels],
        this.zoomlevel
      );

    //At least 10, a small number
    //Note if the effective extent is too small, we'll end up just centering
    const pixelWidthHeightAdjusted: Size = [
      Math.max(
        10,
        pixelWidthHeightReal[0] - rightAdjustmentPixels - leftAdjustmentPixels
      ),
      Math.max(
        10,
        pixelWidthHeightReal[1] - bottomAdjustmentPixels - topAdjustmeantPixels
      ),
    ];

    const extentMetersWidthHeight = calculateWidthHeight(projectedExtent);

    //This finds out how many meters per pixel from 3857 and the pixel height of the map to caluclaet the extent
    //3857 meters of map extent
    const mapMetersWidthHeightAdjusted = calculateMetersWidthHeight(
      pixelWidthHeightAdjusted,
      this.zoomlevel
    );

    this.logger.debug(
      `eee mapMetersWidthHeightAdjusted`,
      mapMetersWidthHeightAdjusted
    );
    this.logger.debug(`eee pixelWidthHeightAdjusted`, pixelWidthHeightAdjusted);

    const mapMetersWidthHeight = calculateMetersWidthHeight(
      pixelWidthHeightReal,
      this.zoomlevel
    );

    //If our current map extent is too small, then we just set the map center to the center of the projected extent
    if (
      mapMetersWidthHeightAdjusted[1] < extentMetersWidthHeight[1] ||
      mapMetersWidthHeightAdjusted[0] < extentMetersWidthHeight[0]
    ) {
      this.logger.debug(
        `Map meters width/height ${mapMetersWidthHeightAdjusted} need ${extentMetersWidthHeight} for zoom level ${this.zoomlevel}`
      );
      const newCenter = calculateCenter(projectedExtent);
      this.logger.log(
        `Current map extent is too small, centering to ${newCenter}`
      );
      return newCenter;
    } else {
      //here our projected extent is <= the map extent
      //Also adjust by half the feature dialog, to center the extent in the visible non obstructed portion

      //We move the smallest needed to make the desired extent visible
      let newCenter = map.getView().getCenter()!;

      //Calculate the extent of what is actually currently visible
      const adjustedRight =
        newCenter[0] + mapMetersWidthHeight[0] / 2 - rightAdjustmentMeters;
      const adjustedLeft =
        newCenter[0] - mapMetersWidthHeight[0] / 2 + leftAdjustmentMeters;
      const adjustedTop =
        newCenter[1] + mapMetersWidthHeight[1] / 2 - topAdjustmentMeters;
      const adjustedBottom =
        newCenter[1] - mapMetersWidthHeight[1] / 2 + bottomAdjustmentMeters;

      //projected extent minX, minY, maxX, maxY

      //we are missing the top
      if (adjustedTop < projectedExtent[3]) {
        //Set center such that max y will be == projected extent
        newCenter[1] = projectedExtent[3] - mapMetersWidthHeightAdjusted[1] / 2;
      }
      //or missing the bottom
      else if (adjustedBottom > projectedExtent[1]) {
        newCenter[1] = projectedExtent[1] + mapMetersWidthHeightAdjusted[1] / 2;
      }

      //we are missing the right
      if (adjustedRight < projectedExtent[2]) {
        newCenter[0] = projectedExtent[2] - mapMetersWidthHeightAdjusted[0] / 2;
      }
      //or missing the left
      else if (adjustedLeft > projectedExtent[0]) {
        //move right smallest amount possible
        newCenter[0] = projectedExtent[0] + mapMetersWidthHeightAdjusted[0] / 2;
      }

      return newCenter;
    }
  }

  private handlePan_zoom(
    map: Map,
    panMapArgs: PanMapArgs,
    projectedExtent: Extent,
    largestZoomLevel: number
  ) {
    /*
    Handles zoom in / zoom out
    */
    const currentZoomLevel = map.getView().getZoom()!;
    if (panMapArgs.zoomMode == ZoomMode.ZOOM_IN_MAX) {
      //this is the most zoomed in we can go, while having the extent be visible
      //Note this could be zooming out
      //this.logger.debug(`Setting zoom level from ${currentZoomLevel} to ${largestZoomLevel} for ZOOM_IN_MAX`);
      //map.getView().setZoom(largestZoomLevel);

      //This will zoom in more since it supports fractional zoom levels
      map.getView().fit(projectedExtent, {
        duration: this.animated ? this.animationDuration : 0,
      });
      //this.zoomlevel = largestZoomLevel;
    } else if (panMapArgs.zoomMode == ZoomMode.ZOOM_OUT_MIN) {
      //only zoom out if we need to
      if (
        !lodashIsFinite(currentZoomLevel) ||
        currentZoomLevel > largestZoomLevel
      ) {
        //this.logger.debug(`Setting zoom level from ${currentZoomLevel} to ${largestZoomLevel} for ZoomMode.ZOOM_OUT_MIN`);
        if (this.animated) {
          map.getView().animate({
            zoom: largestZoomLevel,
            duration: this.animationDuration,
          });
        } else {
          map.getView().setZoom(largestZoomLevel);
        }
        //this.zoomlevel = largestZoomLevel;
      } else {
        this.logger.debug(
          `Not changing zoom level from ${currentZoomLevel} to ${largestZoomLevel} for ZOOM_OUT_MIN`
        );
      }
    }
  }

  private handlePan_adjustPanExtentForFocus(
    projectedExtent: Extent,
    pixelWidthHeight: Size,
    largestZoomLevel: number
  ) {
    /*
    When panning to an extent, take into account
    the this.focus extent

    A no-op but keeping it in the code as it does no harm either
    See comment at the end
     */
    //focus should be an extent
    if (isNil(this.focus)) {
      return;
    }

    const metersWidthHeight = calculateMetersWidthHeight(
      pixelWidthHeight,
      largestZoomLevel
    );

    let extentChanged = false;
    const newExtent: Extent = this.projectToMap(this.focus) as Extent;
    const desiredExtent: Extent = [...projectedExtent];
    //new extent restriction should be larger than the extent at the largestZoomLevel
    const marginMeters = 10;

    //Extent needs to be at least as wide / high as the current zoom level
    const desiredExtentWidthHeight = calculateWidthHeight(desiredExtent);
    desiredExtentWidthHeight[0] += marginMeters;
    desiredExtentWidthHeight[1] += marginMeters;

    const widthCorrection = metersWidthHeight[0] - desiredExtentWidthHeight[0];
    if (widthCorrection > 0) {
      desiredExtent[0] -= widthCorrection / 2;
      desiredExtent[2] += widthCorrection / 2;
    }
    const heightCorrection = metersWidthHeight[1] - desiredExtentWidthHeight[1];
    if (heightCorrection > 0) {
      desiredExtent[1] -= heightCorrection / 2;
      desiredExtent[3] += heightCorrection / 2;
    }

    if (desiredExtent[0] < newExtent[0]) {
      newExtent[0] = desiredExtent[0];
      extentChanged = true;
    }
    if (desiredExtent[1] < newExtent[1]) {
      newExtent[1] = desiredExtent[1];
      extentChanged = true;
    }
    if (desiredExtent[2] > newExtent[2]) {
      newExtent[2] = desiredExtent[2];
      extentChanged = true;
    }
    if (desiredExtent[3] > newExtent[3]) {
      newExtent[3] = desiredExtent[3];
      extentChanged = true;
    }

    if (extentChanged) {
      // this.logger.debug("Restricting extent in handle pan.  Current restriction, new extent, minimum desired extent");
      // this.logger.debug(this.projectToMap(this.focus));
      // this.logger.debug(newExtent);
      // this.logger.debug(desiredExtent);
      // @eg: I needed to deactivate this for now, as it breaks the map sync. I made the extent bigger so we won't need this
      // this.restrictFocus(this.projectFromMap(newExtent) as Extent, true).then(() => {
      // });
    }
  }
}
