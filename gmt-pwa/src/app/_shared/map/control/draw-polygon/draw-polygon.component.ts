import { Component } from '@angular/core';
import { Collection, Feature } from 'ol';
import { Geometry, Polygon, } from 'ol/geom';
import {  Type as GeometryType } from 'ol/geom/Geometry';
import { Draw, Modify, Select } from 'ol/interaction';
import { DrawEvent } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
// import { ModifyFeature } from 'ol/control';
import { Position, toWgs84, Polygon as TurfPolygon } from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import { ModifyEvent } from 'ol/interaction/Modify';
import { Subject, takeUntil } from 'rxjs';
import { DRAW_STYLE } from 'src/app/_shared/map/styles/draw-polygon-styles';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { convertToTurf } from 'src/app/utils/features';
import {
  MultiPolygon,
  Polygon as PolygonGeoJson,
} from 'src/app/utils/server-interfaces/GeoJson';
import { MapControlBaseComponent } from '../map-control-base.component';

// const draw_icon = new Style({
//   image: new Icon({
//     anchor: [0.5, 0.5],
//     //src: 'assets/icons/cut.png'
//     src: 'assets/icons/add.svg'
//   })
// });

const DRAW_LAYER_ID = '_drawOverlayLayer';

@Component({
  selector: 'draw-polygon',
  templateUrl: './draw-polygon.component.html',
  styleUrls: ['./draw-polygon.component.less'],
  providers: [
    { provide: MapControlBaseComponent, useExisting: DrawPolygonComponent },
  ],
  standalone: false,
})
export class DrawPolygonComponent extends MapControlBaseComponent {
  visible = false;

  private unsubscribe = new Subject();

  // Features that are a drawn with the draw tool
  private _drawOverlayLayer!: VectorLayer;
  private drawTool!: Draw;
  private modifyTool!: Modify;
  private selectTool!: Select;

  constructor(
    private microplanMapEvents: MicroplanMapEventsService,
    private logger: NGXLogger
  ) {
    super();
  }

  override ngOnInit() {
    super.ngOnInit();
    this.subscribeToDrawConfig();
    this.subscribeToEditConfig();
    this.subscribeToMapControlsUpdate();
    this.subscribeToUndoRequest();
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private createDrawTool() {
    const drawLayer = this._mapPanel?.getMapLayerById(
      DRAW_LAYER_ID
    ) as VectorLayer;

    this.drawTool = new Draw({
      source: drawLayer.getSource()!,
      type: 'Polygon',
      stopClick: true, // stops click event propagation
      freehand: false,
      // freehandCondition: singleClick,
      features: new Collection<Feature<Geometry>>(),
      style: DRAW_STYLE,
    });
    this.selectTool = new Select({
      layers: function (layer) {
        //This returns true for the draw layer and maybe the layer used by this.mapEvents.addFeature(..., OverlayLayer.NORMAL)
        return layer.get('overlay');
      },
      // filter: function(feature, layer) {
      //   // something that is specific for boundary edit, not sure how to make it for the all features in _featureOverlayLayer
      //   return (feature.get('drawn_geometry'))? true: false;
      // },
    });
    this.modifyTool = new Modify({
      features: this.selectTool.getFeatures(),
    });
    // this.selectTool.on('select', (event) => {
    //   console.log('select event', event, this.selectTool.getFeatures());
    // });
    this.modifyTool.on('modifyend', (event) => this.handleModifyEnd(event));
    this.drawTool.on('drawend', (event) => this.handleDrawEnd(event));
    this.logger.debug('Creating draw tool', this.drawTool, drawLayer);
  }

  private handleDrawEnd(event: DrawEvent) {
    this.logger.debug('handle draw end', event);
    const drawnFeature = convertToTurf(event.feature)!;
    const drawnPolygon: TurfPolygon = drawnFeature.geometry as TurfPolygon;
    const drawnPolygon4326 = toWgs84(drawnPolygon);
    this.microplanMapEvents.drawPolygonResult.next({
      polygon: drawnPolygon4326 as PolygonGeoJson,
    });
  }

  private subscribeToUndoRequest() {
    this.microplanMapEvents
      .undoForPolygonDrawingObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((config) => {
        this.drawTool.removeLastPoint();
      });
  }

  private handleModifyEnd(event: ModifyEvent) {
    this.logger.debug('handle modify end', event);
    let features = event.features.getArray();
    for (let i = 0; i < features.length; i++) {
      const drawnFeature = convertToTurf(features[i])!;
      let drawnPolygon: TurfPolygon;
      if (drawnFeature.geometry.type === 'MultiPolygon') {
        drawnPolygon = {
          type: 'Polygon',
          coordinates: (drawnFeature.geometry as MultiPolygon)
            .coordinates[0] as Position[][],
        } as TurfPolygon;
      } else {
        drawnPolygon = drawnFeature.geometry as TurfPolygon;
      }
      const drawnPolygon4326 = toWgs84(drawnPolygon);
      this.microplanMapEvents.editPolygonResult.next({
        polygon: drawnPolygon4326 as PolygonGeoJson,
      });
    }
  }
  private subscribeToDrawConfig() {
    //The flow here is the wizard wants to know the current location or it wants
    //to set the visibility of the location selector (the centered location icon on the map, part of this component)
    this.microplanMapEvents.drawPolygonConfig
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((config) => {
        if (config.active) {
          this._mapPanel?.suppressClickEvents(true);
          this._mapPanel?.map?.addInteraction(this.drawTool);
          this.logger.debug('Draw tool add interaction', this.drawTool);
        } else {
          this._mapPanel?.suppressClickEvents(false);
          this._mapPanel?.map?.removeInteraction(this.drawTool);
          this.logger.debug('Draw tool remove interaction', this.drawTool);
        }

        //We need to wait until the drawn polygon is added to the source
        //Clear on any config change
        setTimeout(() => this._drawOverlayLayer.getSource()!.clear(), 1);
      });
  }

  private subscribeToEditConfig() {
    //The flow here is the wizard wants to know the current location or it wants
    //to set the visibility of the location selector (the centered location icon on the map, part of this component)
    this.microplanMapEvents.editPolygonConfig
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((config) => {
        if (config.active) {
          // if (this.modifyTool) {
          //   this.removeModifyToolInteraction();
          // }
          // this.modifyTool = new Modify({
          //   features: new Collection(config.features),
          //   // standalone: true
          // });
          // this.modifyTool = new ModifyFeature(vector_layer);
          // map.addControl(modify_control);
          //  this.modifyTool.selectFeature(config.features[0]);
          // this.modifyTool.on('modifyend', (event) => this.handleModifyEnd(event));
          this._mapPanel?.suppressClickEvents(true);
          this._mapPanel?.map?.addInteraction(this.modifyTool);
          this._mapPanel?.map?.addInteraction(this.selectTool);
          this.logger.debug('Edit tool add interaction', this.modifyTool);

          if (config.selectCurrentFeatures) {
            this.logger.debug('Edit tool attempting to select current feature');
            let overlayLayer: VectorLayer | null = null;
            this._mapPanel!.map?.getLayers().forEach((layer) => {
              if (
                layer instanceof VectorLayer &&
                layer.get('id') == '_featureOverlayLayer'
              ) {
                overlayLayer = layer as VectorLayer;
                return false;
              }
              return true;
            });
            if (overlayLayer) {
              this.logger.debug(
                'Edit tool attempting to select current feature, layer found'
              );
              //These will contain catchment lines and what we added, see this.mapEvents.getOverlayFeaturesObservable
              //in microplan-boundary-map
              const overlayFeatures = (overlayLayer as VectorLayer)
                .getSource()!
                .getFeatures();
              const polygonFeatures = overlayFeatures.filter(
                (feature) => feature.getGeometry() instanceof Polygon
              );

              if (polygonFeatures.length == 1) {
                this.logger.debug(
                  'Edit tool attempting to select current feature -- Selected feature'
                );
                this.selectTool.getFeatures().push(polygonFeatures[0]);
              } else {
                this.logger.debug(
                  'Edit tool attempting to select current feature -- Exactly 1 not found'
                );
              }
            }
          }
        } else {
          this.removeModifyToolInteraction();
        }
      });
  }

  removeModifyToolInteraction() {
    this._mapPanel?.suppressClickEvents(false);
    if (this.modifyTool) {
      this._mapPanel?.map?.removeInteraction(this.modifyTool);
      this._mapPanel?.map?.removeInteraction(this.selectTool);
      this.logger.debug('Draw tool remove interaction', this.modifyTool);
    }
  }

  private subscribeToMapControlsUpdate() {
    // When control gets bound to map
    this.bindControl.pipe(takeUntil(this.unsubscribe)).subscribe((map) => {
      this.logger.debug('bind draw polygon');
      this._drawOverlayLayer = this._mapPanel!.createTopLayerOverlay(
        -1,
        DRAW_LAYER_ID
      );

      this._mapPanel!.map!.addLayer(this._drawOverlayLayer);

      this.createDrawTool();
    });

    // When control gets unbound from map
    this.unbindControl
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((mapBase) => {
        this.logger.debug('unbind draw polygon');
        mapBase!.map!.removeLayer(this._drawOverlayLayer);
      });
  }
}
