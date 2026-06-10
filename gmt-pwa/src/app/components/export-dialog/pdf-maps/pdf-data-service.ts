import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BoundaryDataClass } from '@services/geo/BoundaryDataClass';
import { setHfColorAndIndex } from '@services/map/vector-source.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { NGXLogger } from 'ngx-logger';
import { GeoJSON } from 'ol/format';
import VectorSource from 'ol/source/Vector';
import { firstValueFrom } from 'rxjs';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { BoundaryData } from 'src/app/utils/export/pdf';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonCatchmentItem,
  Extent as GeojsonExtent,
  GeoJsonHealthFacility,
  GeoJsonList,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
} from 'src/app/utils/server-interfaces/GeoJson';
import { SurroundingBoundaries } from 'src/app/utils/server-interfaces/SurroundingBoundaries';
import { VectorLayerName } from 'src/app/utils/server-interfaces/VectorLayerName';

import {
  MapFeaturePublisher,
  OverlayLayer,
  ServiceApiFeature,
} from '@services/map/base/map-events.service';
import { BaselineService } from '@services/map/BaselineService';
import { BBox2d } from '@turf/helpers/dist/js/lib/geojson';
import { bbox } from '@turf/turf';
import _ from 'lodash';
import { Feature as OLFeature } from 'ol';
import { extend, Extent } from 'ol/extent';
import { Geometry as OLGeometry } from 'ol/geom';
import { transformExtent } from 'ol/proj';
import { createPolygonMask } from 'src/app/_shared/map/util/map-utils';
import {
  LAYER_BOUNDARY_ID,
  LAYER_CATCHMENT_ITEM_ID,
  LAYER_CATCHMENT_VISUAL,
  LAYER_HEALTH_FACILITIES_ID,
  LAYER_SETTLEMENTS_NAMES_ID,
  LAYER_SETTLEMENTS_PARTS_ID,
} from './pdf-constants';

/*
For the PDF data export, we need to either use the local data on the users browser
or fetch it from the server.

Perhaps later can add indexdb part; for now just store in the service

This needs to support printing the pdf or loading one of the map pages individually
*/

const DATA_SCHEMAS: Array<VectorLayerName> = [
  LAYER_SETTLEMENTS_NAMES_ID,
  LAYER_SETTLEMENTS_PARTS_ID,
  LAYER_HEALTH_FACILITIES_ID,
  LAYER_BOUNDARY_ID,
  LAYER_CATCHMENT_ITEM_ID,
];

@Injectable({
  providedIn: 'root',
})
export class PdfDataService {
  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private logger: NGXLogger,
    private crudLayerService: CrudLayerService,
    private vectorLayerService: VectorLayerService,
    private http: HttpClient,
    private baselineService: BaselineService
  ) {}

  //Maps operating level boundary guid => boundary data
  private allBoundaryData = new Map<string, BoundaryDataClass>();

  //While its loading its stored here
  private allBoundaryDataBeingInitialized = new Map<
    string,
    BoundaryDataClass
  >();

  private jsonReader: GeoJSON = new GeoJSON({
    dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
    featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
  });

  public async getBoundaryData(
    boundaryGuid: string,
    clean: boolean
  ): Promise<BoundaryDataClass> {
    if (!clean && this.allBoundaryData.has(boundaryGuid)) {
      return this.allBoundaryData.get(boundaryGuid)!;
    }

    //First we need to see if the user has this boundary checked out or not
    const isOffline = await this.boundaryLayerService.isBoundaryOffline(
      boundaryGuid
    );
    let bd: BoundaryDataClass;

    //These need to handle if data fetch failed
    if (isOffline) {
      bd = await this.fetchBoundaryDataFromCache(boundaryGuid);
    } else {
      bd = await this.fetchBoundaryDataFromApi(boundaryGuid);
    }

    this.allBoundaryData.set(boundaryGuid, bd);
    return bd;
  }

  private getInitBoundaryData(adminBoundaryGuid: string): BoundaryDataClass {
    if (!this.allBoundaryDataBeingInitialized.has(adminBoundaryGuid)) {
      const bd = new BoundaryDataClass();
      bd.boundaryId = adminBoundaryGuid;
      this.allBoundaryDataBeingInitialized.set(adminBoundaryGuid, bd);
    }
    return this.allBoundaryDataBeingInitialized.get(adminBoundaryGuid)!;
  }

  private setBoundaryDataVectorSources(boundaryData: BoundaryData) {
    //Once all data is loaded, do some additional setup
    //Make sure our cis only concern either an hf or a sp in the boundary

    const snList = boundaryData.data.getBoundaryPrimaryNameSettlementList();
    const spSet = new Set<string>(
      snList.map((sn) => sn.properties.settlement_part!)
    );

    const hfList = boundaryData.data.getHfsPerformingRI(true);
    setHfColorAndIndex(
      boundaryData.data.boundaryId,
      boundaryData.data.hfList,
      this.logger
    );

    const hfIdList = hfList.map((hf) => hf.properties.global_id);
    const hfSet = new Set<string>(hfIdList);
    boundaryData.data.setCis(
      boundaryData.data.ciList.filter(
        (ci) =>
          hfSet.has(ci.properties.health_facility_point) ||
          spSet.has(ci.properties.settlement_part)
      )
    );

    //Build the vector sources
    for (const schema of [
      LAYER_BOUNDARY_ID,
      LAYER_SETTLEMENTS_PARTS_ID,
      LAYER_HEALTH_FACILITIES_ID,
      LAYER_SETTLEMENTS_NAMES_ID,
    ]) {
      const vectorSourceFeatures = getVectorSourceFeatureList(
        schema,
        boundaryData
      );

      if (schema == LAYER_HEALTH_FACILITIES_ID) {
        //sort by the outline labels
        vectorSourceFeatures.sort((b1, b2) => {
          const hf1 = b1 as GeoJsonHealthFacility;
          const hf2 = b2 as GeoJsonHealthFacility;

          return compareHfIndex(hf1.properties.index!, hf2.properties.index!);
        });

        //this.logger.info("Sorted ABCABC", vectorSourceFeatures);
      }

      // Other data like settlemens, hf, boundary polygon
      // For the vector sources, we want to limit to the boundary itself
      try {
        boundaryData.vectorSources.set(
          schema,
          new VectorSource({
            features: this.jsonReader.readFeatures({
              type: 'FeatureCollection',
              features: vectorSourceFeatures,
            }),
          })
        );
      } catch (error) {
        this.logger.warn(error);
        boundaryData.vectorSources.set(schema, new VectorSource());
      }
    }
  }

  /*
    When an hf is passed, we just have the catchment for that single hf
    */
  async calculateMicroplanData(
    boundaryData: BoundaryDataClass,
    hfId: string | null
  ): Promise<BoundaryData> {
    const boundaryDataRet: BoundaryData = {
      catchment_visual: [],
      data: boundaryData,
      vectorSources: new Map<VectorLayerName, VectorSource>(),
    };
    //If we return, at least initialize it to something
    boundaryDataRet[LAYER_CATCHMENT_VISUAL] = [];

    this.logger.info(
      `calculateMicroplanData boundary [${boundaryDataRet.data.boundaryId}] hfId [${hfId}]`
    );

    const visualCollection: Array<ServiceApiFeature> = [];

    const visualizer: MapFeaturePublisher = {
      addFeature(feature: ServiceApiFeature, _emit: boolean): void {
        visualCollection.push(feature);
      },
      emitOverlayFeatureUpdate(): void {
        //do nothing
      },
      removeAllFeatures(_layer: OverlayLayer): void {
        //do nothing
      },
    };
    let hf: GeoJsonHealthFacility | null = null;

    if (!_.isNil(hfId)) {
      //Drawing a HF detail page
      hf = boundaryDataRet.data.hfMap.get(hfId)!;

      this.logger.info(` calculateMicroplanData for hf ${hfId}`);

      // The squares are not visible, and this makes the catchment extent wrong since
      //this is all hfs
      // await firstValueFrom(this.baselineService.visualizeBoundaryRasterSquares(
      //     visualizer, boundaryData.data, false,
      // ));
      await firstValueFrom(
        this.baselineService.refreshCatchmentLineVisualization(
          visualizer,
          boundaryDataRet.data,
          hf ? new Set<string>([hf.properties.global_id]) : null
        )
      );
    } else {
      this.logger.info(` calculateMicroplanData for all hfs`);
      //Drawing the main boundary page with all HFs, we only need catchment lines
      await this.baselineService.visualizeCatchmentLineHelper(
        visualizer,
        boundaryDataRet.data,
        { isSubscribed: true },
        null
      );
    }

    this.logger.info(
      `calculateMicroplanData: Added catchment rendered items boundary [${boundaryData.boundaryId}] hfId [${hfId}] number of items ${visualCollection.length}`
    );
    boundaryDataRet[LAYER_CATCHMENT_VISUAL] = visualCollection;

    this.setBoundaryDataVectorSources(boundaryDataRet);

    if (_.isNil(hfId)) {
      //The boundary layer only contains the 1 we are showing on the map
      createPolygonMask(boundaryDataRet.vectorSources.get(LAYER_BOUNDARY_ID)!);
    }

    return boundaryDataRet;
  }

  /*
    When ward/boundary has already been checked out and put in indexdb
    This may contain the non committed edits
    */
  private async fetchBoundaryDataFromCache(
    boundaryGuid: string
  ): Promise<BoundaryDataClass> {
    const boundaryData = this.getInitBoundaryData(boundaryGuid);

    for (const dataSchema of DATA_SCHEMAS) {
      const indexDbDataForLayer: Array<GeoJsonBase> =
        await this.crudLayerService.getIndexDBStore(dataSchema, true);
      const surroundingBoundaries =
        await this.vectorLayerService.getSurroundingBoundaryGuids(boundaryGuid);
      const surroundingBoundariesSet = new Set<string>(
        surroundingBoundaries.surrounding_boundary_guids
      );

      // Microplan and catchment data
      this.updateBoundaryData(
        dataSchema,
        indexDbDataForLayer,
        surroundingBoundariesSet,
        boundaryData
      );
    }

    return boundaryData;
  }

  private updateBoundaryData(
    schema: VectorLayerName,
    dataForLayer: Array<GeoJsonBase>,
    //null to skip filter
    surroundingBoundariesSet: Set<string> | null,
    boundaryData: BoundaryDataClass
  ) {
    const filteredDataForLayer = dataForLayer.filter((g) => {
      const boundaryIdG =
        schema == LAYER_BOUNDARY_ID
          ? g.properties.global_id
          : g.properties.boundary_polygon;
      if (!surroundingBoundariesSet) {
        return true;
      }
      return surroundingBoundariesSet.has(boundaryIdG);
    });

    setGeojsonBase(schema, boundaryData, filteredDataForLayer);
  }

  private async fetchBoundaryDataFromApi(
    boundaryGuid: string
  ): Promise<BoundaryDataClass> {
    // Add jobs for loading from API

    const boundaryData = this.getInitBoundaryData(boundaryGuid);

    //Could also do this in || if needed
    for (const dataSchema of DATA_SCHEMAS) {
      let params = new HttpParams()
        .set('schema_name', dataSchema.split('__')[0])
        .set('table_name', dataSchema.split('__')[1]);

      //For each one get the surrounding boundaries

      const sbParams = new HttpParams().set('boundaryId', boundaryGuid);
      const surroundingBoundaries = await firstValueFrom(
        this.http.get<SurroundingBoundaries>(
          `${AppConfigService.conf.api_url}/get_surrounding_boundaries`,
          { params: sbParams }
        )
      );

      const response = await firstValueFrom(
        this.http.post<GeoJsonList>(
          `${AppConfigService.conf.api_url}/get_latest_version`,
          surroundingBoundaries!.surrounding_boundary_guids,
          { params }
        )
      );

      const features = response && response.list ? response.list : [];

      this.updateBoundaryData(dataSchema, features, null, boundaryData);
    }

    return boundaryData;
  }

  public buildVisualizeCatchmentVectorSource(
    boundaryData: BoundaryData
  ): VectorSource {
    const gJsonReader = new GeoJSON({
      dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
      featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
    });
    const visualizeCatchmentVectorSource = new VectorSource();

    for (const serviceFeature of boundaryData[LAYER_CATCHMENT_VISUAL]) {
      const olFeature: OLFeature<OLGeometry> = gJsonReader.readFeature(
        serviceFeature.geo_json
      ) as OLFeature<OLGeometry>;
      olFeature.setStyle(serviceFeature.style);

      visualizeCatchmentVectorSource.addFeature(olFeature);
    }

    return visualizeCatchmentVectorSource;
  }

  public calculateBoundaryExtent(
    boundary: GeoJsonBoundary,
    visualizeCatchmentVectorSource: VectorSource
  ): GeojsonExtent {
    const boundingBox = bbox(boundary) as BBox2d;

    const boundaryExtent = transformExtent(
      boundingBox,
      `EPSG:${AppConfigService.map.data_projection}`,
      `EPSG:${AppConfigService.map.map_projection}`
    );

    const catchmentExtent = visualizeCatchmentVectorSource.getExtent();

    return extend(boundaryExtent, catchmentExtent) as GeojsonExtent;
  }
  public calculateCatchmentExtent(
    boundaryExtent: Extent,
    visualizeCatchmentVectorSource: VectorSource,
    //hf: GeoJsonHealthFacility
    hfExtent: Extent
  ): Extent {
    const origCatchmentExtent = visualizeCatchmentVectorSource.getExtent();
    //prettyPrintExtent(origCatchmentExtent, "origCatchmentExtent");
    //prettyPrintExtent(hfExtent, "hfExtent");
    //prettyPrintExtent(boundaryExtent, "boundaryExtent");

    //the catchmentExtent if the HF has no catchment will only be the HF point, so we make sure it's big enough to see a rectangle
    //in the overview map
    //const hfExtent = hf.getGeometry()!.getExtent();
    //2km distance, because that is the fixed post distance

    //We already will have the catchment polygon in the orig catchment extent, so no need to expand it much further
    const minDist = 500;
    //We still clamp it to the boundary extent since anything beyond that isn't really applicable to the HF
    const catchmentExtent = extend(origCatchmentExtent, [
      Math.max(boundaryExtent[0], hfExtent[0] - minDist),
      Math.max(boundaryExtent[1], hfExtent[1] - minDist),
      Math.min(boundaryExtent[2], hfExtent[2] + minDist),
      Math.min(boundaryExtent[3], hfExtent[3] + minDist),
    ]);

    //prettyPrintExtent(catchmentExtent, "catchmentExtent");

    return catchmentExtent;
  }
}

/**
 * Sets feature list in boundaryData
 *
 * @param schema
 * @param boundaryData
 * @param features
 * @private
 */
function setGeojsonBase(
  schema: VectorLayerName,
  boundaryData: BoundaryDataClass,
  features: Array<GeoJsonBase>
) {
  if (schema == LAYER_BOUNDARY_ID) {
    boundaryData.setBoundaries(features as Array<GeoJsonBoundary>);
  } else if (schema == LAYER_SETTLEMENTS_PARTS_ID) {
    boundaryData.setSps(features as Array<GeoJsonSettlementPart>);
  } else if (schema == LAYER_HEALTH_FACILITIES_ID) {
    boundaryData.setHfs(features as Array<GeoJsonHealthFacility>);
  } else if (schema == LAYER_SETTLEMENTS_NAMES_ID) {
    boundaryData.setSns(features as Array<GeoJsonSettlementName>);
  } else if (schema == LAYER_CATCHMENT_ITEM_ID) {
    // We need any catchment item that belongs to HF in the boundary we are interested in
    // Don't filter at all since we don't have the hf data yet
    boundaryData.setCis(features as Array<GeoJsonCatchmentItem>);
  }
}

/**
 * Returns what will be added to the map data.
 *
 * Note that the map data might be filtered differently !
 *
 * For example, hfMap and LAYER_HEALTH_FACILITIES_ID contain all
 * hfs for surrounding region, but the map HF layer is only for the given
 * boundary
 *
 * @param schema
 * @param boundaryData
 * @private
 */
function getVectorSourceFeatureList(
  schema: VectorLayerName,
  boundaryData: BoundaryData
): Array<GeoJsonBase> {
  if (schema == LAYER_BOUNDARY_ID) {
    return boundaryData.data.bList.filter(
      (b) => b.properties.global_id == boundaryData.data.boundaryId
    );
  } else if (schema == LAYER_SETTLEMENTS_PARTS_ID) {
    //We want either settlement parts in the ward, or in a catchment in this hf

    const catchmentSps = new Set<string>();
    const hfs = new Set<string>(
      boundaryData.data
        .getHfsPerformingRI(true)
        .map((hf) => hf.properties.global_id)
    );

    for (const ciItem of boundaryData.data.ciList) {
      if (!hfs.has(ciItem.properties.health_facility_point)) {
        continue;
      }

      if (ciItem.properties.type == 'exclude') {
        continue;
      }

      catchmentSps.add(ciItem.properties.settlement_part);
    }

    return boundaryData.data.spList.filter((sp) => {
      if (sp.properties.boundary_polygon == boundaryData.data.boundaryId) {
        return true;
      }

      return catchmentSps.has(sp.properties.global_id);
    });
  } else if (schema == LAYER_HEALTH_FACILITIES_ID) {
    return boundaryData.data.getHfsPerformingRI(true);
  } else if (schema == LAYER_SETTLEMENTS_NAMES_ID) {
    return boundaryData.data.snList.filter(
      (sn) =>
        sn.properties.boundary_polygon == boundaryData.data.boundaryId &&
        !sn.properties.uninhabited
    );
  } else {
    return [];
  }
}

export function prettyPrintExtent(extent: Extent, label: string) {
  const width: string = (extent[2] - extent[0]).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  console.info(
    `\n${label}\nExtent ${label}\nmin x${extent[0]}\nmin y${extent[1]}\nWidth: ${width}`
  );
}

const HF_INDEX_SORT_REGEX = /^(\d*)(\D*)$/;

export function compareHfIndex(
  index1: string | undefined,
  index2: string | undefined
): number {
  if (_.isNil(index1) && _.isNil(index2)) {
    return 0;
  }
  if (_.isNil(index1)) {
    return -1;
  }
  if (_.isNil(index2)) {
    return 1;
  }

  //this.logger.info(`Sorting [${hf1.properties.index}] and [${hf2.properties.index}]`);
  const [, numStr1, outreachStr1] = Array.from(
    HF_INDEX_SORT_REGEX.exec(index1)!
  );
  const [, numStr2, outreachStr2] = Array.from(
    HF_INDEX_SORT_REGEX.exec(index2)!
  );

  const num1 = parseInt(numStr1);
  const num2 = parseInt(numStr2);

  //Sort 1st by Fixed post number
  if (num1 != num2) {
    return num1 - num2;
  }

  const lenOs1 = outreachStr1.length;
  const lenOs2 = outreachStr2.length;

  //aa is after a, bac as after any 2 letters
  if (lenOs1 != lenOs2) {
    return lenOs1 - lenOs2;
  }

  return outreachStr1.localeCompare(outreachStr2);
}
