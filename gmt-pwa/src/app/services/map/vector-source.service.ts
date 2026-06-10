import { Injectable } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { GeoJSON } from 'ol/format';
import { bbox } from 'ol/loadingstrategy';
import VectorSource from 'ol/source/Vector';
import {
  BehaviorSubject,
  combineLatest,
  filter,
  Observable,
  switchMap,
} from 'rxjs';
import {
  FIXED_HEALTH_FACILITY_TYPE,
  GeoJsonBase,
  GeoJsonHealthFacility,
  OUTREACH_HEALTH_FACILITY_TYPE,
} from 'src/app//utils/server-interfaces/GeoJson';
import { indexToLetter } from 'src/app//utils/string-formatting';
import {
  CurrentBoundaryInfo,
  UserContextService,
} from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  ALL_MAP_VECTOR_LAYERS,
  BOUNDARY_EDITED_LAYER,
  MAP_POI_LAYERS,
  MapVectorLayerName,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { BoundaryVectorLayersService } from '../boundary-vector-layers.service';
import { BaselineService } from './BaselineService';

@Injectable({
  providedIn: 'root',
})
/*
Builds vector sources for open layers
 */
export class VectorSourceService {
  //BehaviorSubjects will always emit the latest/current value on new subscribers
  private _dataStreams: Map<MapVectorLayerName, BehaviorSubject<VectorSource>> =
    new Map<MapVectorLayerName, BehaviorSubject<VectorSource>>();

  private currentBoundaryInfo: CurrentBoundaryInfo;
  constructor(
    private crudLayerService: CrudLayerService,
    private userContextService: UserContextService,
    private bvService: BoundaryVectorLayersService,
    private logger: NGXLogger
  ) {
    ALL_MAP_VECTOR_LAYERS.forEach((storeName) => {
      this._dataStreams.set(
        storeName,
        new BehaviorSubject<VectorSource>(
          new VectorSource({
            strategy: bbox,
          })
        )
      );
    });

    //Main data flow is the boundary vector data, which is already filtered for the current boundary
    const boundaryDataObservable = this.userContextService
      .getCurrentBoundaryObservable()
      .pipe(
        filter((boundary) => !!boundary),
        switchMap((boundary) => {
          this.logger.info(
            `Vector source service -- Boundary id ${boundary!.boundaryId}`
          );
          this.currentBoundaryInfo = boundary!;
          return this.bvService.ensureBoundaryLoaded(boundary!.boundaryId);
        })
      );

    // "generic__line",
    // "generic__point"
    //Seed the behavior subjects with indexdb db data

    //The poi layers are stored as generic_point
    // if (MAP_POI_LAYERS.indexOf(storeName) >= 0) {
    //   continue;
    // }

    combineLatest([
      boundaryDataObservable,
      this.crudLayerService.suppressUserInterfaceUpdates.asObservable(),
    ]).subscribe(([_ok, suppressUI]) => {
      if (suppressUI) {
        return;
      }

      this.sendNewOpenLayersVectorSource(
        'boundary__polygon',
        this.bvService.data.bList.filter(
          (g) =>
            g.properties.level === this.currentBoundaryInfo.level &&
            this.currentBoundaryInfo.surroundingBoundaryIds.has(
              g.properties.global_id
            )
        )
      );

      if (this.bvService.data.bEditedList) {
        this.sendNewOpenLayersVectorSource(
          BOUNDARY_EDITED_LAYER,
          this.bvService.data.bEditedList
        );
      }

      // .filter(g => g.properties.level === this.currentBoundaryInfo.level &&
      //   this.currentBoundaryInfo.surroundingBoundaryIds.has(g.properties.global_id) || g.properties.global_id == 'd0a053a0-1838-454b-b514-2a04fbe105a8')

      // // add hf colors and indexes - not used as it creates colors for every HF in the extent and it makes large indexes
      this.sendNewOpenLayersVectorSource(
        'health_facility__point',
        setHfColorAndIndex(
          this.currentBoundaryInfo.boundaryId,
          this.bvService.data.hfList,
          logger
        )
      );

      this.sendNewOpenLayersVectorSource(
        'settlement__part',
        this.bvService.data.spList.filter((sp) => {
          if (!sp.properties.split_type) {
            return true;
          }
          return sp.properties.split_type != 'auto_split_parent';
        })
      );

      this.sendNewOpenLayersVectorSource(
        'settlement__name',
        this.bvService.data.getBoundaryPrimaryNameSettlementListForAllBoundaries()
      );

      //this.bvService.data.
      // if (storeName == "generic__point") {
      //let poiTypes: Array<MapVectorLayerName> = MAP_POI_LAYERS;
      for (const poiType of MAP_POI_LAYERS) {
        const filteredPois = this.bvService.data.pointList.filter(
          (poi) => poi.properties['type'] === poiType
        );
        /*this.logger.debug(
          `Generic point counts for ${poiType} is ${filteredPois.length}`
        );*/
        this.sendNewOpenLayersVectorSource(poiType, filteredPois);
      }
    });
  }

  private sendNewOpenLayersVectorSource(
    storeName: MapVectorLayerName,
    filteredResults: Array<GeoJsonBase>
  ) {
    //Get current vector source
    const vectorSource = this._dataStreams.get(
      storeName as MapVectorLayerName
    )!.value;
    //Do naive implementation, clear everything.  If need arises, can do something clever with the CRUD actions
    vectorSource.clear();
    const geoJSON = new GeoJSON({
      dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
      featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
    });
    const collection = {
      type: 'FeatureCollection',
      features: filteredResults,
    };
    vectorSource.addFeatures(geoJSON.readFeatures(collection));

    //send next value
    this._dataStreams.get(storeName)!.next(vectorSource);
  }

  get_observable(layer: MapVectorLayerName): Observable<VectorSource> {
    let ret = this._dataStreams.get(layer);
    if (!ret) {
      throw new Error(`Unable to find map layer named [${layer}]`);
    }
    return ret;
  }
}

export function setHfColorAndIndex(
  boundaryId: string,
  hfList: Array<GeoJsonHealthFacility>,
  logger: NGXLogger
): Array<GeoJsonHealthFacility> {
  const notPerformingRiHfs: GeoJsonHealthFacility[] = [];
  const performingRiHfs: GeoJsonHealthFacility[] = [];
  const outreachHfs = new Map<string, Array<GeoJsonHealthFacility>>();

  //build
  const filteredHfList = hfList.filter((hf) => {
    //Reset all indexes and color, we want things outside the boundary
    //to be blank
    hf.properties.index = undefined;
    hf.properties.color = undefined;
    hf.properties.numParentChildren = 0;

    if (hf.properties.boundary_polygon != boundaryId) {
      return false;
    }

    return !isEmpty(hf.geometry);
  });

  for (const hf of filteredHfList) {
    if (hf.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
      if (!hf.properties.services.includes('Routine Immunization')) {
        notPerformingRiHfs.push(hf);
      } else {
        performingRiHfs.push(hf);
      }
    } else if (hf.properties.type === OUTREACH_HEALTH_FACILITY_TYPE) {
      const parentId = hf.properties.parent;

      if (!parentId) {
        logger.error('outreach without parent, hf:', hf);
        continue;
      }

      //outreach sites are indexed among the same parent
      if (!outreachHfs.has(parentId)) {
        outreachHfs.set(parentId, []);
      }
      outreachHfs.get(parentId)!.push(hf);
    }
  }

  //Sort by name
  const compareNamesFn = (
    hfA: GeoJsonHealthFacility,
    hfB: GeoJsonHealthFacility
  ) => hfA.properties.name.toLowerCase().localeCompare(hfB.properties.name);
  //Sort creation date
  const compareCreationDateFn = (
    hfA: GeoJsonHealthFacility,
    hfB: GeoJsonHealthFacility
  ) =>
    hfA.properties?.created_date && hfB.properties?.created_date
      ? Number(new Date(hfA.properties?.created_date)?.getTime()) -
        Number(new Date(hfB.properties?.created_date)?.getTime())
      : 0;
  notPerformingRiHfs.sort(compareNamesFn);
  performingRiHfs.sort(compareNamesFn);
  for (const hfs of outreachHfs.values()) {
    hfs.sort(compareCreationDateFn);
  }

  //Attribute
  //
  let index = 1;
  const hfMap = new Map<string, GeoJsonHealthFacility>();
  let setIndexAndColor = (hf: GeoJsonHealthFacility) => {
    hf.properties.color =
      BaselineService.colorWheel[index % BaselineService.colorWheel.length];
    hf.properties.index = index + '';
    hfMap.set(hf.properties.global_id, hf);
    index++;
  };

  performingRiHfs.forEach(setIndexAndColor);
  notPerformingRiHfs.forEach(setIndexAndColor);
  for (const [fpId, outreachList] of outreachHfs.entries()) {
    const parent = hfMap.get(fpId);

    if (!parent) {
      logger.error(`Unable to find parent HF of id ${parent}`);
      for (const outreachHf of outreachList) {
        logger.error(
          `Outreach name ${outreachHf.properties.name} of ward ${outreachHf.properties.boundary_polygon}`
        );
      }
      continue;
    }

    parent.properties.numParentChildren = outreachList.length;

    for (const [outreachIndex, outreachHf] of outreachList.entries()) {
      outreachHf.properties.color = parent.properties.color;
      outreachHf.properties.index =
        parent.properties.index + indexToLetter(outreachIndex + 1, logger);
      outreachHf.properties.childIndex = outreachIndex;
      outreachHf.properties.numParentChildren = outreachList.length;
    }
  }

  //We want to display all health facilities
  return hfList;
}
