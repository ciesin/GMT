import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IsOnlineService } from '@services/is-online.service';
import { AuthService } from '@services/user/auth.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Graticule } from 'ol';
import { stylefunction } from 'ol-mapbox-style';
import { Extent as OLExtent } from 'ol/extent';
import BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { XYZ } from 'ol/source';
import VectorSource from 'ol/source/Vector';
import { boundariesScoped } from 'src/app/_shared/map/styles/map-boundary-styles';
import { mapStyles } from 'src/app/_shared/map/styles/map-design';
import {
  pdfHealthfacilities,
  pdfSettlements,
  pdfSettlementsNoLabel,
} from 'src/app/_shared/map/styles/map-pdf-styles';
import { bufferExtent } from 'src/app/_shared/map/util/map-utils';
import { Unsubscribe } from 'src/app/_shared/mixins/unsubscribe';
import { MatModule } from 'src/app/mat.module';
import { osmStyles } from 'src/app/routine-immu/page-microplan-boundary/osmStyles';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { BoundaryData, BoundaryMapArgs } from 'src/app/utils/export/pdf';
import {
  GeoJsonBoundary,
  Extent as GeojsonExtent,
} from 'src/app/utils/server-interfaces/GeoJson';
import { PdfDataService } from '../pdf-data-service';

import { transformExtent } from 'ol/proj';
import {
  LAYER_BOUNDARY_ID,
  LAYER_HEALTH_FACILITIES_ID,
  LAYER_SETTLEMENTS_NAMES_ID,
  LAYER_SETTLEMENTS_PARTS_ID,
} from '../pdf-constants';
import { PdfMapBaseComponent } from '../pdf-map-basecomponent';
import { PdfMapComponent } from '../pdf-map-component-mixin';

//Mixin base component which is mostly the same between the 2 maps
class BaseMapComponent extends PdfMapBaseComponent {
  mapHtmlIdPrefix = 'pdf-hf-map';
}

const MixedComponent = PdfMapComponent(Unsubscribe(BaseMapComponent));

@Component({
  selector: 'gmt-pdf-hf-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, MatModule, CommonModule],
})
export class HfMapComponent
  extends MixedComponent
  implements OnInit, OnChanges
{
  @Input() boundaryGuid: string;
  @Input() hfGuid: string | null = null;

  //Must be online as well
  @Input() includeImagery: boolean = false;

  constructor(
    private pdfDataService: PdfDataService,
    private authService: AuthService,
    private isOnlineService: IsOnlineService,
    private vectorLayerService: VectorLayerService,
    private logger: NGXLogger
  ) {
    super();
  }

  override getLogger(): NGXLogger {
    return this.logger;
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.logger.info('HF map changes', _changes);
    this.loadBoundary();
  }
  ngOnInit(): void {
    this.logger.info('HF map ngOninit');
    this.loadBoundary();
  }

  private async loadBoundary() {
    //We should only load the boundary once
    if (this.boundaryLoaded) {
      return;
    }

    if (!_.isString(this.boundaryGuid)) {
      return;
    }

    this.boundaryLoaded = true;
    this.logger.info(`Loading PDF Boundary map for ${this.boundaryGuid}`);

    const boundaryDataClass = await this.pdfDataService.getBoundaryData(
      this.boundaryGuid,
      false
    );

    if (this.boundaryGuid != boundaryDataClass.boundaryId) {
      throw new Error(
        `Boundary id in boundaryData ${boundaryDataClass.boundaryId} != ${this.boundaryGuid}`
      );
    }

    const boundaryData = await this.pdfDataService.calculateMicroplanData(
      boundaryDataClass,
      this.hfGuid
    );

    const visualizeCatchmentVectorSource =
      this.pdfDataService.buildVisualizeCatchmentVectorSource(boundaryData);

    this.logger.info(`# of boundaries ${boundaryData.data.bList.length}`);
    this.logger.info(
      `In vector source: ` +
        boundaryData.vectorSources.get(LAYER_BOUNDARY_ID)?.getFeatures().length
    );

    const isOnline = await this.isOnlineService.checkIsOnline();
    const mapArgs: BoundaryMapArgs = {
      drawSettlementNames: !_.isNil(this.hfGuid),
      mgrsGrid: false,
      mapImagery: isOnline ? this.includeImagery : false,
    };

    const mapLayers = this.getLayers(
      mapArgs,
      boundaryData,
      visualizeCatchmentVectorSource
    );
    this.buildMap(
      this.getExtent(visualizeCatchmentVectorSource, boundaryData),
      mapLayers
    );
  }

  private getExtent(
    visualizeCatchmentVectorSource: VectorSource,
    boundaryData: BoundaryData
  ): GeojsonExtent {
    const boundary: GeoJsonBoundary = boundaryData.data.getCurrentBoundary();
    const boundaryExtent = this.pdfDataService.calculateBoundaryExtent(
      boundary,
      visualizeCatchmentVectorSource
    );
    this.logger.info(`PDF Boundary map extent ${boundaryExtent}`);
    if (_.isNil(this.hfGuid)) {
      const bufferedExtent = bufferExtent(boundaryExtent, 1.1);
      return bufferedExtent;
    } else {
      const hf = boundaryData.data.hfMap.get(this.hfGuid);
      if (_.isNil(hf)) {
        throw new Error(`Cannot find hf id ${this.hfGuid}`);
      }
      const hfExtent4326: OLExtent = [
        hf.geometry.coordinates[0],
        hf.geometry.coordinates[1],
        hf.geometry.coordinates[0],
        hf.geometry.coordinates[1],
      ];
      const hfExtent3857 = transformExtent(
        hfExtent4326,
        `EPSG:4326`,
        `EPSG:3857`
      );
      const catchmentExtent = this.pdfDataService.calculateCatchmentExtent(
        boundaryExtent,
        visualizeCatchmentVectorSource,
        hfExtent3857
      );
      const bufferedExtent = bufferExtent(catchmentExtent, 1.1);
      return bufferedExtent;
    }
  }

  private getLayers(
    mapArgs: BoundaryMapArgs,
    boundaryData: BoundaryData,
    visualizeCatchmentVectorSource: VectorSource
  ): Array<BaseLayer | TileLayer> {
    const isHfDetailPage: boolean = !_.isNil(this.hfGuid);

    const defaultSettlementNamesSource = boundaryData.vectorSources.get(
      LAYER_SETTLEMENTS_NAMES_ID
    );

    if (_.isNil(defaultSettlementNamesSource)) {
      this.logger.error(
        `Unabled to load settlement source ${LAYER_SETTLEMENTS_NAMES_ID}`
      );
      return [];
    }

    let settlementNamesSource;
    if (!isHfDetailPage) {
      //get only primary
      settlementNamesSource = new VectorSource({
        features: defaultSettlementNamesSource
          .getFeatures()
          .filter((f) => f.get('is_primary')),
      });
    } else {
      settlementNamesSource = defaultSettlementNamesSource;
    }

    const mapLayers: Array<BaseLayer | TileLayer> = [
      // TODO: Not rendered in a canvas layer it seems (Use html2canvas?)
      // https://gis.stackexchange.com/questions/216628/is-there-an-algorithm-to-calculate-mgrs-grid-lines
      // https://github.com/proj4js/mgrs
      new Graticule({
        visible: mapArgs.mgrsGrid,
        showLabels: true,
        wrapX: true,
      }),
      new VectorLayer({
        zIndex: 2,
        style: (feature, resolution) => {
          return boundariesScoped(boundaryData.data.boundaryId)(
            feature,
            resolution
          );
        },
        source: boundaryData.vectorSources.get(LAYER_BOUNDARY_ID),
      }),
      new VectorLayer({
        zIndex: 3,
        style: mapStyles.STL.polygon,
        source: boundaryData.vectorSources.get(LAYER_SETTLEMENTS_PARTS_ID),
      }),
      new VectorLayer({
        zIndex: 4,
        source: visualizeCatchmentVectorSource,
      }),
      new VectorLayer({
        zIndex: 5,
        style: mapArgs.drawSettlementNames
          ? pdfSettlements
          : pdfSettlementsNoLabel,
        source: settlementNamesSource,
      }),
      new VectorLayer({
        zIndex: 6,
        style: pdfHealthfacilities,
        source: boundaryData.vectorSources.get(LAYER_HEALTH_FACILITIES_ID),
      }),
    ];

    // Add baselayer to load tiles only now when we zoomed to extent to avoid unecessary loading of tiles
    const osmBasemap = this.vectorLayerService.getBasemapVectorTileLayer();
    osmStyles.sources.openmaptiles.tiles = [
      AppConfigService.conf.api_url + '/mbtile/{z}/{x}/{y}',
    ];
    stylefunction(osmBasemap, osmStyles, 'openmaptiles');

    if (mapArgs.mapImagery) {
      const imageryLayer = new TileLayer({
        zIndex: 1,
        source: new XYZ({
          url: 'http://mt0.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
          crossOrigin: 'Anonymous',
        }),
      });
      mapLayers.push(imageryLayer);
    } else {
      mapLayers.push(osmBasemap);
    }

    return mapLayers;
  }
}
