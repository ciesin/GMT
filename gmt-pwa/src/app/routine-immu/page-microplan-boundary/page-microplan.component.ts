import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import { MapStateService } from '@services/map/MapState';
import { UserContextService } from '@services/user-context.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { stylefunction } from 'ol-mapbox-style';
import { extend } from 'ol/extent';
import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';
import { StyleLike } from 'ol/style/Style';
import { combineLatest, Subject } from 'rxjs';
import { filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { bufferExtent } from '../../_shared/map/util/map-utils';
import { Extent, GeoJsonBoundary } from '../../utils/server-interfaces/GeoJson';
import { MapVectorLayerName } from '../../utils/server-interfaces/VectorLayerName';
import { MicroplanBoundaryMapComponent } from '../microplan-boundary-map/microplan-boundary-map.component';

import { HistoryService } from '@services/history.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { AppConfigService } from '../../utils/app-config.service';
import { osmStyles } from './osmStyles';

import { MatDrawer } from '@angular/material/sidenav';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import { NGXLogger } from 'ngx-logger';
import { transformExtent } from 'ol/proj';
import {
  OSM_CACHED,
  OSM_ONLINE,
  SATELLITE_MAP,
} from 'src/app/constants/basemap-names';
import {
  bufferExtentAdditive,
  METERS_TO_PAD,
} from '../../utils/server-interfaces/utils/geom.util';

export interface MapLayer {
  id: MapVectorLayerName;

  mapLayerId: string; // it is almost identical to "id", but decouples dataStream Vector Layer name from the one use in the map layers
  name?: string;
  legendGroup?: string;
  index?: number;
  style?: StyleLike;
  icon?: string;
  visible?: boolean;
}

@Component({
  selector: 'app-page-microplan',
  templateUrl: './page-microplan.component.html',
  styleUrls: [
    '../../../less/header-drawer-page.less',
    './page-microplan.component.less',
  ],
  standalone: false,
})
export class PageMicroplanComponent implements OnInit, OnDestroy {
  currentBoundaryData: GeoJsonBoundary | undefined;

  @ViewChild('microplanMap') microplanMapPanel: MicroplanBoundaryMapComponent;
  @ViewChild(MatDrawer) leftPanel: MatDrawer;
  //@ViewChild('split') splitComponent: SplitComponent;

  leftWrapperHidden = false;

  private unsubscribe = new Subject();

  constructor(
    private router: Router,
    public activatedRoute: ActivatedRoute,
    private vectorLayerService: VectorLayerService,
    private crudLayerService: CrudLayerService,
    private mapState: MapStateService,
    private mapEvents: MicroplanMapEventsService,
    private userContextService: UserContextService,
    private bvService: BoundaryVectorLayersService,
    private historyService: HistoryService,
    private logger: NGXLogger
  ) {}

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  ngAfterViewInit() {
    //Make sure map knows how much space it has (map drawer space not accounted for)
    this.logger.debug('Setting left panel size');

    //1 ms didn't work, also the call to updateSize in ngAfterViewInitAfterRestrictFocus of boundary map also isn't enough
    setTimeout(() => this.handleLeftPanelMoved(), 2500);
  }

  handleLeftPanelMoved() {
    this.microplanMapPanel.map?.updateSize();

    if (
      this.userContextService.leftPanelIsOpened.value != this.leftPanel.opened
    ) {
      this.userContextService.leftPanelIsOpened.next(this.leftPanel.opened);
    }
  }

  ngOnInit(): void {
    this.initializeBasemapLayers();

    this.listenBoundaryData();

    this.listenRouteChanges();

    this.handleUrlStacking();

    this.listenToLeftPanelToggle();
  }

  private setMapExtent() {
    if (this.currentBoundaryData) {
      //this.logger.info('Setting boundary extent to:', bbox(this.currentBoundaryData.geometry) as Extent);
      this.mapState.setExtent(this.currentBoundaryData.properties.bbox);
    }
  }

  private setMapFocus() {
    if (!this.mapState) {
      return;
    }

    // The boundary extent
    // Build an extent from all adjacent boundaries, starting from the boundary extent
    let adjacentExtent: Extent =
      this.bvService.boundaryInfo.boundary.properties.bbox;
    this.bvService.boundaryInfo.surroundingBoundaryList
      .filter(
        (b) =>
          b.properties.level ===
          this.bvService.boundaryInfo.boundary.properties.level
      )
      .forEach((b) => {
        adjacentExtent = extend(
          [...adjacentExtent],
          b.properties.bbox
        ) as Extent;
      });

    // Buffer the extent
    const buffered_adjacent_extent = bufferExtent(adjacentExtent, 1.2);

    // Make sure the extent is even and not odd shaped (like a very thin as this creates problems)
    // Do a relationally enlargement of the extent to fit the map view x/y size ratio
    const x = this.microplanMapPanel?.mapElement?.nativeElement.clientWidth;
    const y = this.microplanMapPanel?.mapElement?.nativeElement.clientHeight;
    if (x && y) {
      const width = Math.abs(
        buffered_adjacent_extent[0] - buffered_adjacent_extent[2]
      );
      const height = Math.abs(
        buffered_adjacent_extent[1] - buffered_adjacent_extent[3]
      );
      const new_width = width < height ? (height * x) / y : width;
      const new_height = height < width ? (width * y) / x : height;
      buffered_adjacent_extent[0] -= (new_width - width) / 2;
      buffered_adjacent_extent[1] -= (new_height - height) / 2;
      buffered_adjacent_extent[2] += (new_width - width) / 2;
      buffered_adjacent_extent[3] += (new_height - height) / 2;
    }

    // We should set the boundary only when it is different to the current (To avoid setting it too often)
    if (
      this.mapState.getState().focus?.toString() !==
      buffered_adjacent_extent.toString()
    ) {
      this.logger.info('Setting map focus to:', buffered_adjacent_extent);
      this.mapState.setFocus(buffered_adjacent_extent);
    }
  }

  private initializeBasemapLayers() {
    // Re-enable online map here
    // const osm = new TileLayer({
    //   source: new OSM(),
    // });
    const osm = this.vectorLayerService.getBasemapVectorTileLayer();
    osm.set('name', OSM_CACHED);
    osm.set('icon', 'icon-layer-street.svg');
    osmStyles.sources.openmaptiles.tiles = [
      AppConfigService.conf.api_url + '/mbtile/{z}/{x}/{y}',
    ];
    stylefunction(osm, osmStyles, 'openmaptiles');

    const sat = new TileLayer({
      source: new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      }),
    });
    sat.set('name', SATELLITE_MAP);
    sat.set('icon', 'icon-layer-satellite.svg');

    const osmOnline = new TileLayer({
      source: new OSM(),
    });
    osmOnline.set('name', OSM_ONLINE);
    osmOnline.set('icon', 'icon-layer-satellite.svg');

    this.mapState.setBaselayers([sat, osm, osmOnline]);
  }

  private listenBoundaryData() {
    // We need to have the boundary data much earlier @eg to avoid later zooming to boundary extent
    combineLatest([
      this.activatedRoute.params.pipe(
        map((params) => params.boundary as string)
      ),
      this.vectorLayerService.getVectorLayerObservable('boundary__polygon'),
      this.crudLayerService.suppressUserInterfaceUpdates.asObservable(),
    ])
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(([boundary_code, boundaryData, suppressUI]) => {
        if (suppressUI) {
          return;
        }

        if (
          boundary_code &&
          boundary_code !== this.currentBoundaryData?.properties.global_id
        ) {
          this.currentBoundaryData = (
            boundaryData.with_crud_applied as Array<GeoJsonBoundary>
          ).find((bd) => bd.properties.global_id == boundary_code);
          // Set the extent already now, so the map can show the proper extent before we do all the layer source loading
          this.setMapExtent();
        }
      });
  }

  private listenRouteChanges() {
    // React to changes in router and selected boundary and react accordingly
    this.activatedRoute.params
      .pipe(
        map((params) => params.boundary as string),
        switchMap((boundaryId) => {
          return this.bvService.ensureBoundaryLoaded(boundaryId);
        }),
        switchMap((_ok) => {
          return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
        }),
        filter((suppressUi) => !suppressUi),
        takeUntil(this.unsubscribe)
      )
      .subscribe((_ok) => {
        const boundingBox =
          this.bvService.boundaryInfo.boundary.properties.bbox;
        const boundingBox3857 = transformExtent(
          boundingBox,
          'EPSG:4326',
          'EPSG:3857'
        );
        const expandingBoundingBox3857 = bufferExtentAdditive(
          boundingBox3857 as Extent,
          METERS_TO_PAD
        );
        const surroundingBoundingBox = transformExtent(
          expandingBoundingBox3857,
          'EPSG:3857',
          'EPSG:4326'
        ) as Extent;

        const boundaryInfo = this.bvService.boundaryInfo;

        // Make sure the current boundary is set properly
        const changedCurrentBoundary =
          this.userContextService.setCurrentBoundary({
            boundaryId: boundaryInfo.boundary.properties.global_id,
            level: boundaryInfo.boundary.properties.level as number,
            surroundingBoundaryIds: boundaryInfo.surroundingBoundaryIds,
            boundingBox,
            surroundingBoundingBox,
          });

        // Set boundary data for selected boundary
        this.currentBoundaryData = this.bvService.boundaryInfo.boundary;

        //only do this once per boundary change, to prevent map from zooming out unexpectedly
        if (changedCurrentBoundary) {
          // Set selected "boundary extent" (Zoom to in microplan, baseline will follow - Do not set at the same time)
          this.setMapFocus();
        }
      });
  }

  private handleUrlStacking() {
    const handleNewUrl = (currentUrl: string) => {
      if (currentUrl.includes(RoutesChunks.EDIT)) {
        this.historyService.stack(currentUrl);
      } else {
        this.historyService.clearStack();
      }
    };

    //stack history url
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd && event.url) {
        let currentUrl = event.url;
        handleNewUrl(currentUrl);
      }
    });
    handleNewUrl(this.router.url);
  }

  private listenToLeftPanelToggle() {
    this.userContextService.leftPanelIsOpened
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((requestedState) => {
        //Not initialized yet
        if (!this.leftPanel) {
          return;
        }

        if (this.leftPanel.opened != requestedState) {
          this.leftPanel.toggle(requestedState);
        }
      });
  }
}
