import { Component, Input, OnInit } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { BoundaryLayerService } from 'src/app/services/vector_layer/boundary-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { GeoJsonBoundary } from 'src/app/utils/server-interfaces/GeoJson';
import { BaseMapComponent } from 'src/app/_shared/map/panel/base-map.component';
import { getBoundaryWithHighlightsStyle } from 'src/app/_shared/map/styles/map-dashboard-styles';

const INITIAL_BOUNDARY_FEATURE_ID = 'Admin1';
const HIGHLIGHTED_BOUNDARY_FEATURE_ID = 'highlighted_boundaries';

/*
Note this is the map in the user management page
*/

@Component({
  selector: 'boundary-map',
  templateUrl: './boundary-map.component.html',
  styleUrls: ['./boundary-map.component.less'],
  standalone: false
})
export class BoundaryMapComponent extends BaseMapComponent implements OnInit {
  @Input() highlightedBoundaries: Observable<string[]> = new Observable<
    string[]
  >();
  private highlightedBoundariesLayer: VectorLayer | undefined = undefined;
  private allBoundaryData: GeoJsonBoundary[] = [];

  // Map zoom and style
  private zoomAdjustment = 1.1;
  private defaultThickness: number = 1;
  private defaultColor: string = '#000000';
  //This color is not visible on gray
  //private defaultColor: string = '#bebebe';
  private highlightThickness: number = 6;
  private highlightColor: string = 'black';
  protected override zoomEnabled = false;

  // GeoJSON reader with reprojecion
  private geojsonReader = new GeoJSON({
    dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
    featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
  });
  private unsubscribe = new Subject();

  constructor(
    private boundaryLayerService: BoundaryLayerService,

    private isLoadingService: IsLoadingService,
    logger: NGXLogger
  ) {
    super(logger);
    this.isLoadingService.setLoading(true);
    this.isLoadingService.setMapLoading(true);
  }

  override async ngOnInit() {
    super.ngOnInit();
    (window as any).pm = this;
    // this.setHighlightStyle(boundaryHighlightStyle as StyleLike);

    console.log(
      'fetchBoundaryDataIfNeeded: calling getBoundaryData from boundaryMap'
    );
    this.allBoundaryData = await this.boundaryLayerService.getBoundaryData();

    // Visualize country and admin1 boundaries with thin line
    this.drawAdmin0AndAdmin1Boundaries();

    this.subscribeForHighlightedBoundaries();

    this.isLoadingService.setMapLoading(false);
    this.isLoadingService.setLoading(false);
  }

  override ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private subscribeForHighlightedBoundaries() {
    this.highlightedBoundaries
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((highlightedBoundaries) => {
        this.updateHighlightedFeatures(highlightedBoundaries);
      });
  }

  private drawAdmin0AndAdmin1Boundaries(): void {
    let initialBoundaryFeatures: GeoJsonBoundary[] = [];
    this.allBoundaryData.forEach((boundary) => {
      if ([0, 1].includes(boundary.properties.level)) {
        initialBoundaryFeatures.push(boundary);
      }
    });
    const layer = new VectorLayer({
      source: new VectorSource({
        features: this.geojsonReader.readFeatures({
          type: 'FeatureCollection',
          features: initialBoundaryFeatures,
        }),
      }),
      style: getBoundaryWithHighlightsStyle(
        this.defaultColor,
        this.defaultThickness
      ),
    });
    layer.set('id', INITIAL_BOUNDARY_FEATURE_ID);
    layer.set('name', INITIAL_BOUNDARY_FEATURE_ID);
    this.addOverlayLayers(layer);
    console.log('┕━▶ Found', initialBoundaryFeatures.length, 'features');
    this.zoomToLayer(
      this.getLayerByName(INITIAL_BOUNDARY_FEATURE_ID) as VectorLayer,
      this.zoomAdjustment
    );
  }

  private updateHighlightedFeatures(highlightedBoundaries: string[]): void {
    this.map?.getLayers().forEach(async (layer) => {
      if (layer.get('id') == HIGHLIGHTED_BOUNDARY_FEATURE_ID) {
        //If this is a vector layer, add it to our extent
        if (layer instanceof VectorLayer) {
          await layer?.getSource()?.clear();
          this.highlightedBoundariesLayer = layer;

          // update highlighted features (or to be more exact - source as it was just cleared)
          let featuresToVisualize: GeoJsonBoundary[] = [];
          this.allBoundaryData.forEach((boundary) => {
            if (highlightedBoundaries.includes(boundary.properties.global_id)) {
              featuresToVisualize.push(boundary);
            }
          });
          layer.getSource().addFeatures(
            this.geojsonReader.readFeatures({
              type: 'FeatureCollection',
              features: featuresToVisualize,
            })
          );
        }
      }
    });
    // first vector layer initialization
    if (!this.highlightedBoundariesLayer) {
      this.addHighlightedBoundaryVectorLayer(highlightedBoundaries);
    }
  }

  /**
   * Add vector layer + features with boundaries that has to be highlighted
   * @param highlightedBoundaries
   * @private
   */
  private addHighlightedBoundaryVectorLayer(highlightedBoundaries: string[]) {
    let featuresToVisualize: GeoJsonBoundary[] = [];
    this.allBoundaryData.forEach((boundary) => {
      if (highlightedBoundaries.includes(boundary.properties.global_id)) {
        featuresToVisualize.push(boundary);
      }
    });
    this.highlightedBoundariesLayer = new VectorLayer({
      source: new VectorSource({
        features: this.geojsonReader.readFeatures({
          type: 'FeatureCollection',
          features: featuresToVisualize,
        }),
      }),
      style: getBoundaryWithHighlightsStyle(
        this.highlightColor,
        this.highlightThickness
      ),
    });
    this.highlightedBoundariesLayer.set('id', HIGHLIGHTED_BOUNDARY_FEATURE_ID);
    this.addOverlayLayers(this.highlightedBoundariesLayer);
  }
}
