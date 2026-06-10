//This isn't a typical angular service.  It's used by components individually to encapsulate tasks to
//get and filter vector data

import { Injectable } from '@angular/core';
import {
  MapEventsService,
  OverlayLayer,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { centroid, distance, lineString, toMercator } from '@turf/turf';
import _, { isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { filter, switchMap } from 'rxjs/operators';
import {
  BOUNDARY_EDITED_LAYER,
  HF_LAYER,
  NO_MANS_LAND,
  ST_GEOMETRY_LAYER,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { v4 as uuidv4 } from 'uuid';
import { WeightConfig } from '../../environments/WeightConfig';
import { mapStyles } from '../_shared/map/styles/map-design';
import { healthFacilitiesStyleFunction } from '../_shared/map/styles/map-hf-styles';
import { settlementPartStyleForColour } from '../_shared/map/styles/map-settlement-styles';
import {
  colorWithAlpha,
  typeToColor,
} from '../_shared/map/styles/service-api-styles';
import { AppConfigService } from '../utils/app-config.service';
import { getExtentedBoundingBoxForFeatures } from '../utils/coords';
import {
  DefaultGeoJSonHealthFacilityProperties,
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  HealthFacilityType,
  Point,
  Position,
  SettlementType,
} from '../utils/server-interfaces/GeoJson';
import { isEmpty } from '../utils/server-interfaces/utils/geom.util';
import { PartialSettlementNameCatchmentInfo } from '../utils/server-interfaces/utils/indicator.util';
import {
  GENERATED_PREFIX,
  isPopFloatDifferent,
} from '../utils/server-interfaces/utils/string.util';
import { formatCoordinate } from '../utils/string-formatting';
import { BoundaryDataClass } from './geo/BoundaryDataClass';
import { topDownGenerator } from './geo/RasterIterators';
import {
  manuallyPopulateSettlementPartFieldsIfNeeded,
  resetRasterHealthFacilityFields,
} from './geo/Rasterize';
import {
  fromSnapCoords,
  fromSpOrHf,
  RasterStats,
  SettlementPartRasterInfo,
} from './geo/RasterStats';
import { WORKER_CLIENT } from './geo/WorkerClient';
import { UndoRedoEvent } from './interfaces/crud-layer.service.interface';
import { IsLoadingService } from './is-loading.service';
import {
  bboxFilter,
  computeNearestHf,
  getHfListForSp,
} from './map/BaselineService';
import { MicroplanMapEventsService } from './map/MicroplanMapEventsService';
import { RasterDataService } from './raster-data.service';
import { ConfirmationService } from './shared/notifications/confirmation.service';
import { UserContextService } from './user-context.service';
import { BoundaryLayerService } from './vector_layer/boundary-layer.service';
import { CrudLayerService } from './vector_layer/crud-layer.service';
import { OriginResolutionData } from './vector_layer/RasterDatabase';
import {
  BoundaryInfo,
  LayerData,
  VectorLayerService,
} from './vector_layer/vector-layers.service';

export interface DropdownBoundary {
  isOffline: boolean;
  boundaryId: string;
  label: string;
  name: string;
  hierarchy: Array<string>;
}

export interface SettlementNameCatchmentInfo
  extends PartialSettlementNameCatchmentInfo {
  healthFacilities: Array<GeoJsonHealthFacility>;
  // hfCount: number; - do we need this property - was in the conflict
  messageParts: string[];
  message_full: string;
  message_short: string;
  claimedBy: Array<{
    hfName: string;
    boundaryName: string;
    population_perc: number;
    boundaryId: string;
    hfId: string;
  }>;
}

export interface BoundaryVectorLayersServiceInterface {
  // All surrounding boundaries
  boundaryInfo: BoundaryInfo;

  // Boundary hierarchy of parent boundary
  // Country/State/LGA/Ward for NGA, highest level to lowest level boundary parent
  //boundaryParents: Array<GeoJsonBoundary>;

  //Note this is further filtered by the selected microplan

  allCiList: Array<GeoJsonCatchmentItem>;

  data: BoundaryDataClass;
}

const LOG_PREFIX = 'BVLS1 - BoundaryVectorLayersService: ';

@Injectable({
  providedIn: 'root',
})
export class BoundaryVectorLayersService
  implements BoundaryVectorLayersServiceInterface
{
  // All surrounding boundaries
  public boundaryInfo!: BoundaryInfo;

  //Boundary hierarchy of parent boundary
  //Country/State/LGA/Ward for NGA, highest level to lowest level boundary parent
  public boundaryParents!: Array<GeoJsonBoundary>;

  public allCiList!: Array<GeoJsonCatchmentItem>;

  //Used only during apply, the baseline & baseline + user catchment items are not
  //persisted in indexdb, nor the database
  public allBaselineCiList!: Array<GeoJsonCatchmentItem>;

  public data: BoundaryDataClass;

  public hasCrud: Set<string> = new Set();

  //Only used by this to track what boundary it should load
  private currentBoundaryId = new BehaviorSubject<string>('');

  //Note this will send repeated values of true as data changes
  public loaded = new BehaviorSubject<boolean>(false);

  //True if the boundary has been taken offline
  public isOffline: boolean = false;

  private readonly weightConfig: WeightConfig;

  private level_to_label: Array<string>;

  constructor(
    private vectorLayerService: VectorLayerService,
    private crudLayerService: CrudLayerService,
    private boundaryLayerService: BoundaryLayerService,
    private userContextService: UserContextService,
    private rasterDataService: RasterDataService,
    private isLoadingService: IsLoadingService,

    private mapEvents: MapEventsService,
    private microplanMapEvents: MicroplanMapEventsService,
    private logger: NGXLogger,
    private confirmationService: ConfirmationService
  ) {
    this.buildObservable();

    this.data = new BoundaryDataClass();

    this.weightConfig = new WeightConfig(AppConfigService.conf);

    this.level_to_label = AppConfigService.get_level_to_label();
  }

  public loadedObs(): Observable<boolean> {
    return this.loaded.asObservable().pipe(filter((loaded) => loaded));
  }

  /**
   * Returns an observable that fires every time we have new boundary data
   *
   * @param boundaryId
   */
  public ensureBoundaryLoaded(boundaryId: string): Observable<boolean> {
    if (this.currentBoundaryId.value == boundaryId) {
      //this.logger.info(`${LOG_PREFIX} Boundary already loaded for ${boundaryId}.  Loaded? ${this.loaded.value}`);
    } else {
      this.logger.info(
        `${LOG_PREFIX} Boundary load for ${boundaryId}.  Was Loaded? ${this.loaded.value}`
      );
      this.loaded.next(false);

      //This will trigger a reload and eventually a this.loaded.next(true)
      this.currentBoundaryId.next(boundaryId);
    }

    //In both cases, we return the loaded observable.  Note as new vector data related to the boundary
    // is updated, this will send additional values
    return this.loaded.asObservable().pipe(
      //only emit when isLoaded is true
      filter((isLoaded) => isLoaded)
    );
  }

  private buildObservable() {
    let boundaryId = '';

    //break up pipe into chunks otherwise typescript complains
    const obs1 = this.currentBoundaryId.pipe(
      filter((pBoundaryId) => {
        return !!pBoundaryId;
      }),
      switchMap((pBoundaryId) => {
        boundaryId = pBoundaryId;
        return this.vectorLayerService.isInitialized();
      }),
      //wait until vector layer service has loaded initial data
      filter((v) => v),
      switchMap((_) => {
        this.boundaryLayerService
          .isBoundaryOfflineObservable(boundaryId)
          .subscribe((boundaryIsOffline) => {
            this.isOffline = boundaryIsOffline;
          });
        return from(this.boundaryLayerService.isBoundaryOffline(boundaryId));
      }),
      switchMap((isOffline) => {
        this.isOffline = isOffline;

        return this.vectorLayerService.getVectorLayerObservable(
          'boundary__polygon'
        );
      }),
      switchMap((bData) => {
        return from(
          this.boundaryLayerService.fetchBoundaryInfo(
            boundaryId,
            bData.with_crud_applied as Array<GeoJsonBoundary>
          )
        );
      }),
      filter((pBoundaryInfo) => {
        return (
          !!pBoundaryInfo &&
          !!pBoundaryInfo.boundary &&
          !!pBoundaryInfo.boundary.properties
        );
      }),
      switchMap((pBoundaryInfo) => {
        this.boundaryInfo = pBoundaryInfo;

        this.data.boundaryId = this.boundaryInfo.boundary.properties.global_id;

        this.data.setBoundaries(this.boundaryInfo.surroundingBoundaryList);
        this.boundaryParents = this.fetchAllBoundaryParents(
          this.boundaryInfo.boundary.properties.global_id
        );
        return this.vectorLayerService.getVectorLayerObservable(
          'health_facility__point'
        );
      })
    );

    return obs1
      .pipe(
        switchMap((hfData) => {
          this.data.setHfs(
            (hfData.with_crud_applied as Array<GeoJsonHealthFacility>).filter(
              (hf) => {
                return this.boundaryInfo.surroundingBoundaryIds.has(
                  hf.properties.boundary_polygon
                );
              }
            )
          );

          this.hasCrud.clear();
          hfData.crud_actions.forEach((ca) =>
            this.hasCrud.add(ca.geojson_after.properties.global_id)
          );

          //this.logger.info(`${LOG_PREFIX} Boundary vector layer service -- hf list ${this.hfList.length}`);

          return this.vectorLayerService.getVectorLayerObservable(
            'settlement__name'
          );
        }),
        switchMap((snData) => {
          snData.crud_actions.forEach((ca) =>
            this.hasCrud.add(ca.geojson_after.properties.global_id)
          );

          this.data.setSns(
            (snData.with_crud_applied as Array<GeoJsonSettlementName>).filter(
              (sn) => {
                return this.boundaryInfo.surroundingBoundaryIds.has(
                  sn.properties.boundary_polygon
                );
              }
            )
          );
          //this.logger.info(`${LOG_PREFIX} -- snList ${this.snList.length}`);

          //this.snMap = buildMap(this.snList);
          return this.vectorLayerService.getVectorLayerObservable(
            'settlement__part'
          );
        }),
        switchMap((spData) => {
          this.handleSpData(spData);

          return this.vectorLayerService.getVectorLayerObservable(
            'ri__catchment_item'
          );
        }),
        switchMap((ciData) => {
          this.handleCiData(ciData);
          return this.vectorLayerService.getVectorLayerObservable(
            'generic__point'
          );
        }),
        switchMap((pointData) => {
          this.handlePointData(pointData);
          return this.vectorLayerService.getVectorLayerObservable(
            BOUNDARY_EDITED_LAYER
          );
        }),
        switchMap(async (bEditedData) => {
          await this.handleEditedBoundariesData(bEditedData, boundaryId);
          return of(true);
        })
      )
      .subscribe((_) => {
        //this.logger.info(`${LOG_PREFIX} -- boundary vector service is loaded`);
        this.loaded.next(true);
      });
  }

  private handlePointData(pointData: LayerData) {
    this.data.setPoints(
      (pointData.with_crud_applied as Array<GeoJsonBase>).filter((c) => {
        return this.boundaryInfo.surroundingBoundaryIds.has(
          c.properties.boundary_polygon
        );
      })
    );
  }

  private async handleEditedBoundariesData(
    bEditedData: LayerData,
    boundaryId: string
  ) {
    let noMansLandPolygons = (
      bEditedData.with_crud_applied as Array<GeoJsonBoundaryEdited>
    ).filter((c) => {
      return c.properties?.code == NO_MANS_LAND;
    });

    let pEditedBoundaryInfo =
      await this.boundaryLayerService.fetchEditedBoundaryInfo(
        boundaryId,
        bEditedData.with_crud_applied as Array<GeoJsonBoundaryEdited>
      );

    if (
      !!pEditedBoundaryInfo &&
      !!pEditedBoundaryInfo.boundary &&
      !!pEditedBoundaryInfo.boundary.properties
    ) {
      this.data.setEditedBoundaries(
        pEditedBoundaryInfo.surroundingBoundaryList.concat(noMansLandPolygons)
      );
    } else {
      // edited boundary either empty or not correct
    }
  }
  private handleCiData(ciData: LayerData) {
    //this.logger.info(`${LOG_PREFIX} -- catchment item data ${ciData.with_crud_applied.length}`);

    this.allCiList = ciData.with_crud_applied as Array<GeoJsonCatchmentItem>;

    this.data.setCis(
      (ciData.with_crud_applied as Array<GeoJsonCatchmentItem>).filter((c) => {
        if (
          !this.boundaryInfo.surroundingBoundaryIds.has(
            c.properties.boundary_polygon
          )
        ) {
          return false;
        }

        //Note that the ci's could have hf or sp references that are not valid
        //We want to include them to allow pruning them next check in
        //Invalid cis shouldn't impact anything

        return true;
      })
    );

    ciData.crud_actions.forEach((ca) =>
      this.hasCrud.add(ca.geojson_after.properties.global_id)
    );

    //Note page-microplan.component.ts is what tells the user context observable of the current boundary
  }

  private handleSpData(spData: LayerData) {
    this.data.setSps(
      spData.with_crud_applied.filter((sp) => {
        return this.boundaryInfo.surroundingBoundaryIds.has(
          sp.properties.boundary_polygon
        );
      }) as unknown as Array<GeoJsonSettlementPart>
    );

    spData.crud_actions.forEach((ca) =>
      this.hasCrud.add(ca.geojson_after.properties.global_id)
    );

    //this.logger.info(`${LOG_PREFIX} -- Settlement parts ${this.spList.length}`);
  }
  //
  // calculateCatchmentInfo(settlementName: GeoJsonSettlementName): SettlementNameCatchmentInfo {
  //   //Assume that we only need to deal with the name
  //   const ciList = this.data.getCatchmentForSp(settlementName.properties.settlement_part, true, true);
  //
  //   const pInfo = calculatePartialCatchmentInfo(settlementName, ciList);
  //
  //   //Get the names too and boundaries
  //   const assocHF: Array<GeoJsonHealthFacility> = ciList.map(ci => {
  //     return this.data.hfMap.get(ci.properties.health_facility_point as string)!;
  //   });
  //
  //   //TODO check for multiple claims from same health facility?
  //
  //   const assocBoundary = ciList.map(ci => {
  //     return this.data.bMap.get(ci.properties.boundary_polygon)!;
  //   });
  //
  //   const messageParts: string[] = [];
  //   const claimedBy = [];
  //   for (let i = 0; i < ciList.length; i += 1) {
  //     if (!assocHF[i]) {
  //       continue;
  //     }
  //     messageParts.push(`${assocHF[i].properties.name} (${assocBoundary[i].properties.name}) ${formatPercentage(ciList[i].properties.population_perc)}%\n`);
  //     claimedBy.push({
  //       hfName: assocHF[i].properties.name,
  //       boundaryName: assocBoundary[i].properties.name,
  //       population_perc: ciList[i].properties.population_perc,
  //       boundaryId: assocHF[i].properties.boundary_polygon,
  //       hfId: assocHF[i].properties.global_id,
  //     });
  //   }
  //
  //   const message_full = messageParts.join("\n") + `\nTotal Percentage claimed is ${formatPercentage(pInfo.totalPerc)}%`;
  //
  //   return {
  //     healthFacilities: assocHF,
  //     hfCount: pInfo.hfCount,
  //     totalPerc: pInfo.totalPerc,
  //     message_full,
  //     message_short: "Total Percentage claimed is " + formatPercentage(pInfo.totalPerc) + "% from " + assocHF.length + " Health " + (assocHF.length != 1 ? "Facilities" : "Facility"),
  //     messageParts,
  //     claimedBy
  //   };
  // }

  // async handleDemoteName(name: GeoJsonSettlementName) : Promise<string> {
  //   const editName = cloneDeep(name);
  //   editName.properties.is_primary = false;
  //   const actionId = uuidv4();
  //   await this.crudLayerService.updateItem("settlement__name", editName, true, true, actionId);
  //
  //   return actionId;
  //
  // }

  /*
    given a boundaryId, returns the list of parents, so for example in NGA
    this would return 3 values for State, LGA, and Ward
     */
  fetchAllBoundaryParents(boundaryId: string): Array<GeoJsonBoundary> {
    const ret: Array<GeoJsonBoundary> = [];
    const boundary = this.data.bMap.get(boundaryId)!;

    if (boundary) {
      // data not yet loaded
      ret.push(boundary);
    }

    while (true) {
      let lastBoundary = ret[0];
      const parent = this.data.bMap.get(
        lastBoundary.properties.boundary_polygon
      );

      if (!parent) {
        break;
      }
      //this can happen in the highest level, where the parent points to itself
      if (parent.properties.level !== lastBoundary.properties.level - 1) {
        break;
      }
      ret.unshift(parent);
    }

    return ret;
  }

  // buildSurroundingWardDropdownItems() {
  //   return this.boundaryInfo.surroundingBoundaryList
  //     .filter(sb => {
  //       //the dropdown boundaries should be same level as the current one
  //       return sb.properties.level == this.boundaryInfo.boundary.properties.level;
  //     })
  //     .map(sb => {
  //         return {
  //           label: sb.properties.name,
  //           boundaryId: sb.properties.global_id,
  //         };
  //       }
  //     ).sort((a, b) => {
  //       return (a.label).localeCompare(b.label);
  //     });
  // }

  /*
    Returns dropdown list of boundaries we can move things too

    Note see initSurroundingBoundaryGuids

    This will only show boundaries that have been downloaded
    */
  async buildSurroundingBoundaryDropdownItems(
    reverse: boolean
  ): Promise<Array<DropdownBoundary>> {
    const offlineBoundariesSet =
      await this.vectorLayerService.getOfflineBoundaryIdSet(false);

    return this.boundaryInfo.surroundingBoundaryList
      .filter((sb) => {
        // //We only want the user to be able to select boundaries that have been taken offline
        // if (!offlineBoundariesSet.has(sb.properties.global_id)) {
        //   return false;
        // }

        //the dropdown boundaries should be same level as the current one
        return (
          sb.properties.level == this.boundaryInfo.boundary.properties.level
        );
      })
      .map((sb) => {
        const boundaryId = sb.properties.global_id;
        const parents = this.fetchAllBoundaryParents(boundaryId);

        let labelParts = parents.map((p) => p.properties.name);
        // remove first part, which is the country
        labelParts.shift();
        const r: DropdownBoundary = {
          //This means explicitly taken offline, aka, not just a surrounding boundary whose data has been taken offline
          isOffline: offlineBoundariesSet.has(sb.properties.global_id),
          label: reverse
            ? labelParts.reverse().join(' / ')
            : labelParts.join(' / '),
          hierarchy: reverse
            ? labelParts.slice(0, -1).reverse()
            : labelParts.slice(0, -1),
          name: labelParts.at(-1)!,
          boundaryId,
        };
        return r;
      })
      .sort((a, b) => {
        return a.label.localeCompare(b.label);
      });
  }

  /**
   * Note!  Also clears the cached values in the affected health facilities.
   *
   * computeCatchmentAssignments is what clears the server side calculated values
   * for settlement parts
   * @param settlementPartIds
   * @param actionId
   * @private
   */
  private async removeExistingCiForSp(
    settlementPartIds: Array<string>,
    actionId: string
  ) {
    const ciToRemove = this.allCiList.filter((ci) => {
      //only remove generated ones, exclude are created by user
      if (ci.properties.type != 'generated') {
        return false;
      }
      return settlementPartIds.includes(ci.properties.settlement_part);
    });
    await this.crudLayerService.bulkDeleteCatchmentItems(
      ciToRemove,
      true,
      actionId
    );
  }

  async findUncoveredPoint(
    settlementPart: GeoJsonSettlementPart
  ): Promise<Position | null> {
    const { suggestedPoint, points } =
      await this.findSuggestedHfPositionAndPoints(settlementPart);
    if (points.length === 0) {
      return null;
    }
    return suggestedPoint;
  }

  async findSuggestedHfPositionAndPoints(
    settlementPart: GeoJsonSettlementPart
  ): Promise<{ suggestedPoint: Position; points: Array<[Position, number]> }> {
    const settlementPartBoundary = this.data.bMap.get(
      settlementPart.properties.boundary_polygon
    )!;

    const popRaster = await this.rasterDataService.fetchPopRasterIfNeeded(
      settlementPartBoundary
    );
    //Find the weighted average of missing squares
    const spRasterInfo = this.rasterDataService.getSettlementPartRasterInfo(
      settlementPart,
      popRaster
    );

    const uncoveredSquares: Array<boolean> = [];

    const hfList = this.data.getHfsPerformingRI(false);

    //list of points & weight (which is 1 + pop)
    let points: Array<[Position, number]> = [];

    for (const rasterPositionAndIndex of topDownGenerator(spRasterInfo.stats)) {
      uncoveredSquares.push(false);

      const [rasterX, rasterY, rasterIndex] = rasterPositionAndIndex;

      if (settlementPart.properties.raster.charAt(rasterIndex) != '1') {
        continue;
      }
      const popValue = spRasterInfo.popValues[rasterIndex];

      const center = spRasterInfo.stats.centerCoords([rasterX, rasterY]);

      const nearestHf = computeNearestHf(
        hfList,
        center,
        settlementPart,
        this.weightConfig,
        false
      );

      if (nearestHf.hits.length > 0) {
        continue;
      }

      const weight = 1 + popValue;
      uncoveredSquares[rasterIndex] = true;

      points.push([center, weight]);
    }

    let hfPoint: Position;
    if (points.length == 0) {
      this.logger.info('No uncovered points, using centroid!');
      hfPoint = centroid(settlementPart).geometry.coordinates as Position;
    } else {
      hfPoint = findBestHfPosition(
        uncoveredSquares,
        spRasterInfo.popValues,
        spRasterInfo.stats
      );
    }

    return { suggestedPoint: hfPoint, points: points };
  }

  async findSuggestedHfPosition(
    settlementPart: GeoJsonSettlementPart
  ): Promise<Position> {
    return (await this.findSuggestedHfPositionAndPoints(settlementPart))
      .suggestedPoint;
  }

  /**
   * Calculates optimal placement for a new outpost/mobile health facility
   * @param parentHealthFacility
   * @param settlementPart
   */
  async addHealthFacility(
    parentHealthFacility: GeoJsonHealthFacility,
    settlementPart: GeoJsonSettlementPart
  ) {
    const actionId = uuidv4();

    const hfPoint = await this.findSuggestedHfPosition(settlementPart);

    let distanceMeters = distance(
      parentHealthFacility.geometry.coordinates,
      hfPoint
    );

    let strategy: HealthFacilityType;
    if (distanceMeters >= 5000) {
      strategy = 'mobile';
    } else {
      strategy = 'outreach';
    }

    const geojson: GeoJsonHealthFacility = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonHealthFacilityProperties,
        global_id: uuidv4(),
        boundary_polygon: parentHealthFacility.properties.boundary_polygon,
        name: parentHealthFacility.properties.name + ` (${strategy})`,
        services: ['Routine Immunization'],
        color: parentHealthFacility.properties.color,
        parent: parentHealthFacility.properties.global_id,
      },
      geometry: {
        type: 'Point',
        coordinates: hfPoint,
      },
    };

    await this.crudLayerService.createItem(
      'health_facility__point',
      geojson,
      true,
      true,
      actionId
    );

    await this.computeAllCatchmentAssignmentsForHF(geojson, actionId, false);
    this.microplanMapEvents.triggerCatchmentRendering();
  }

  //For set deletions and setting to uninhabited
  async computeCatchmentsForRemovedSp(
    settlementPart: GeoJsonSettlementPart | null,
    actionId: string
  ) {
    if (isNil(settlementPart)) {
      return;
    }
    //Find any hfs involved
    const hfIds = new Set<string>(
      this.data
        .getCatchmentForSp(settlementPart.properties.global_id, false, false)
        .map((ci) => ci.properties.health_facility_point)
    );

    //debugger;

    await this.computeAllCatchmentAssignmentsForHfList(
      Array.from(hfIds),
      actionId,
      true
    );
  }

  /**
   *
   * @param hf Note this can be a deleted / non existent hf
   * @param oldHf if needed, to also include settlement parts in the old location
   * @param actionId
   * @param removeOnlyComputed if true, will not touch the user created ri catchment items, the exclusion=true ones
   * This is false basically if we are deleting a catchment, for example
   */
  async computeAllCatchmentAssignmentsForHF(
    hf: GeoJsonHealthFacility,
    actionId: string,
    removeOnlyComputed: boolean,
    oldHf: GeoJsonHealthFacility | null = null
  ) {
    if (isNil(hf)) {
      return;
    }

    //Even if we are not in auto catchment mode, we still need to remove all catchments if the removeOnlyComputed flag
    //is false, since this means we just deleted an outreach or hf, for example
    if (
      this.userContextService.isAutoCatchmentMode$.value ||
      !removeOnlyComputed
    ) {
      await this.deleteHFCatchments(
        hf.properties.global_id,
        actionId,
        removeOnlyComputed
      );
    }

    const spList = this.getSpListForHfList([hf, oldHf]);

    this.logger.info(
      `computeAllCatchmentAssignmentsForHF hf: ${hf.properties.name} sp list len ${spList.length} removeOnlyComputed ${removeOnlyComputed}`,
      spList.map((sp) => sp.properties.settlement_name).join(', '),
      spList.map((sp) => sp.properties.global_id).join(', ')
    );

    await this.computeAllCatchmentAssignments(
      spList,
      actionId,
      new Set<string>([hf.properties.global_id])
    );
  }

  /*
  See discussion in https://github.com/novelt/GMT/issues/3008
  Basically freq. updates are less critical, and to avoid the UI
  annoyance of blocking the ui while catchments are recalculated
  */
  forceAutoSyncOff(): void {
    if (this.userContextService.isAutoCatchmentMode$.value) {
      const message =
        'Changing frequency can impact the catchment population proportion ' +
        'between health facilities that cover a given settlement. ' +
        'As catchment calculation can take some time, ' +
        'auto-sync catchments has been turned off.\n\n' +
        'Note: You can turn auto-sync catchments back on once your frequency edits are completed.';
      this.confirmationService.confirm({
        message: message,
        header: 'Auto-sync catchment deactivated',
        icon: 'noicon',

        acceptLabel: 'OK',
        showRejectButton: false,
      });
      this.userContextService.isAutoCatchmentMode$.next(false);
    }
  }

  async computeAllCatchmentAssignmentsForHfList(
    hfIdList: string[],
    actionId: string,
    removeOnlyComputed: boolean
  ) {
    let fullSpSet = new Set<GeoJsonSettlementPart>();
    for (let hfId of hfIdList) {
      const hf = this.data.hfMap.get(hfId);
      if (!hf) {
        continue;
      }
      await this.deleteHFCatchments(
        hf.properties.global_id,
        actionId,
        removeOnlyComputed
      );
      fullSpSet = new Set([
        ...fullSpSet,
        ...this.getSpListForHfList([hf, null]),
      ]);
    }
    let fullSpList = [...fullSpSet];
    this.logger.debug(
      `computeAllCatchmentAssignmentsForSpList: sp list len ${fullSpSet.size}`,
      fullSpList.map((sp) => sp.properties.settlement_name).join(', '),
      fullSpList.map((sp) => sp.properties.global_id).join(', ')
    );

    //This will take into consideration all hfs in this ward that are impacted by changing spList
    await this.computeAllCatchmentAssignments(
      fullSpList,
      actionId,
      new Set<string>(hfIdList)
    );
  }

  /**
   * Recomputes cached health facility fields
   *
   * Normally this is computed on the server, though when offline
   * it is used to calculate client side.
   *
   * The idea is that these fields can always be assumed to be populated
   * during catchment rendering
   */
  private async computeHealthFacilityRasterFields(
    hfIdToCoverageCoordinates: Map<string, Map<string, HfSpCoverageInfo>>,
    actionId: string,
    hfIdsToReset: Set<string>
  ): Promise<boolean> {
    //this.logger.info(`computeHealthFacilityRasterFields ${calculateCiItems}`  , healthFacility.properties.name);

    const changedItems: Array<GeoJsonHealthFacility> = [];

    for (const [hfId, spCoordMap] of hfIdToCoverageCoordinates.entries()) {
      const healthFacility = this.data.hfMap.get(hfId)!;

      /*if (hfId == 'e7a7f6e6-14a8-4332-ac73-739436334823') {
        debugger;
      }*/

      if (hfIdsToReset.has(hfId)) {
        resetRasterHealthFacilityFields(healthFacility);
      }

      //First we need to see if we must expand the current hf catchment raster
      //We make the smallest raster possible, so we dont take the entire rasterized area
      //but rather only the part where we have coverage
      const newHfRasterStats = calculateNewHfCatchmentRasterExtent(
        healthFacility,
        spCoordMap,
        this.logger
      );

      this.logger.debug(
        `Calculating HF catchment for ${healthFacility.properties.name} -- [${hfId}]`,
        newHfRasterStats
      );

      if (newHfRasterStats.size[0] <= 0 || newHfRasterStats.size[1] <= 0) {
        healthFacility.properties.catchment_raster = '';
        healthFacility.properties.raster_width = 0;
        healthFacility.properties.raster_height = 0;
        changedItems.push(healthFacility);
        continue;
      }

      //Initialize hf raster from existing data
      const hfRasterArray: Array<string> = transferExistingHfCatchRaster(
        newHfRasterStats,
        healthFacility,
        this.logger
      );

      //Apply sp catchments to it
      applySpToHfCatchRaster(
        newHfRasterStats,
        spCoordMap,
        hfRasterArray,
        this.logger
      );

      this.logger.info(
        `HF stats ${healthFacility.properties.name} catchment raster size ${newHfRasterStats.size}`
      );

      healthFacility.properties.catchment_raster = hfRasterArray.join('');
      healthFacility.properties.origin_x = newHfRasterStats.origin[0];
      healthFacility.properties.origin_y = newHfRasterStats.origin[1];
      healthFacility.properties.raster_width = newHfRasterStats.size[0];
      healthFacility.properties.raster_height = newHfRasterStats.size[1];

      changedItems.push(healthFacility);

      /*
      if (
        healthFacility.properties.global_id ==
        'e7a7f6e6-14a8-4332-ac73-739436334823'
      ) {
        //debugger;
        this.logger.info(
          `EEE raster height @ calc time: ${healthFacility.properties.raster_height}`
        );
      }*/
    }

    this.logger.debug(`Hf bulk update`, changedItems);

    // Remove any crud updates related to catchment calculation from the hf ids we are about to update
    await this.crudLayerService.bulkDeleteGeneratedItems(
      Array.from(hfIdToCoverageCoordinates.keys()),
      HF_LAYER
    );
    await this.crudLayerService.bulkUpdateItem(
      'health_facility__point',
      changedItems,
      true,
      false,
      actionId,
      true
    );

    return true;
  }

  /**
   * Recomputes cached settlement part raster fields
   *
   * Normally this is computed on the server, though when offline
   * it is used to calculate client side.
   *
   * The idea is that these fields can always be assumed to be populated
   * during catchment rendering
   *
   */
  private async computeSettlementPartRasterFields(
    settlementPart: GeoJsonSettlementPart,
    settlementName: GeoJsonSettlementName,

    popRaster: OriginResolutionData | undefined,
    //hfGuid=>spGuid=>cov. info
    hfIdToCoverageCoordinates: Map<string, Map<string, HfSpCoverageInfo>>,
    customCatchmentHealthFacilityIds: Set<string>
  ): Promise<ComputeSettlementPartRasterFieldsReturn> {
    if (isNil(popRaster)) {
      this.logger.warn('popRaster is undefined');
      return { ciToUpdate: [] };
    }
    manuallyPopulateSettlementPartFieldsIfNeeded(settlementPart);

    if (!isNil(settlementName) && settlementName.properties.uninhabited) {
      //we are done, just reset catchment fields to blank
      settlementPart.properties.is_fixed_post =
        settlementPart.properties.raster.replaceAll('1', '0');
      settlementPart.properties.is_outreach =
        settlementPart.properties.raster.replaceAll('1', '0');
      return {
        ciToUpdate: [],
      };
    }

    const spRasterInfo = this.rasterDataService.getSettlementPartRasterInfo(
      settlementPart,
      popRaster
    );

    //if (createCatchmentItems) {
    //to improve speed, all the settlement part catchment items are removed in bulk wiht
    //await this.removeExistingCiForSp(spList.map(sp => sp.properties.global_id), actionId);
    //}

    //explicit includes will override any nearest HF

    const { hfList, containsIncluded } = getHfListForSp(
      settlementPart,
      this.data,
      customCatchmentHealthFacilityIds
    );

    //To make sure we update the HF catchment appropriately when its current catchment intersects
    //the current sp
    addHfsIntersectingCatchment(
      hfIdToCoverageCoordinates,
      spRasterInfo.stats,
      this.data,
      settlementPart
    );

    /*this.logger.info(
      `${LOG_PREFIX} ${settlementPart.properties.global_id} Processing ${hfList.length} health facilities related to the sp`
    );*/

    //loop through all raster squares; finding closest PN and closest HF

    // 2 modes

    const outreachCoordinates: Array<[number, number]> = [];
    const fixedPostCoordinates: Array<[number, number]> = [];

    //Compute weights once before pruning

    const [spPopPerHf, weightsPerSquare] = calculateInitialSpSquareWeights(
      settlementPart,
      spRasterInfo,
      hfList,
      this.weightConfig,
      containsIncluded
    );

    pruneHealthFacilitiesForSp(
      hfList,
      settlementPart,
      this.weightConfig,
      spPopPerHf,
      weightsPerSquare,
      this.logger
    );

    // do pruning
    // call computePopWeightPerHf

    const coords: HfSpCoverageInfo['coords'] = [];

    for (const [sqIdx, s] of weightsPerSquare.entries()) {
      if (!s) {
        continue;
      }

      let isFixedPost = false;
      let isOutreach = false;

      const spRasterIndex = spRasterInfo.stats.to2dIndex(sqIdx);
      const spRasterCoords =
        spRasterInfo.stats.calcTopLeftCoords(spRasterIndex);

      for (const [hfIndex, hfWeight] of s.hfIndexsToWeight.entries()) {
        switch (hfList[hfIndex].properties.type) {
          case 'fixed_post':
            isFixedPost = true;
            break;
          case 'outreach':
            isOutreach = true;
            break;
        }

        const hfId = hfList[hfIndex].properties.global_id;
        const spId = settlementPart.properties.global_id;

        if (!hfIdToCoverageCoordinates.has(hfId)) {
          hfIdToCoverageCoordinates.set(
            hfList[hfIndex].properties.global_id,
            new Map<string, HfSpCoverageInfo>()
          );
        }

        const spCoordMap = hfIdToCoverageCoordinates.get(hfId)!;

        if (!spCoordMap.has(spId)) {
          spCoordMap.set(spId, {
            sp: settlementPart,
            coords: [],
          });
        }
        spCoordMap.get(spId)!.coords.push(spRasterCoords);
      }

      if (isFixedPost) {
        fixedPostCoordinates.push(spRasterCoords);
      } else if (isOutreach) {
        outreachCoordinates.push(spRasterCoords);
      }
    }
    //this.logger.info(`${LOG_PREFIX}Zonal stats == ${totalPop}  # of squares == ${totalSquares}`);

    //Server precalculated values are no longer valid
    //Note the raster fields are calculated, if needed, by manuallyPopulateSettlementPartFieldsIfNeeded
    settlementPart.properties.is_fixed_post =
      spRasterInfo.stats.getRasterStringFromCoords(fixedPostCoordinates);
    settlementPart.properties.is_outreach =
      spRasterInfo.stats.getRasterStringFromCoords(outreachCoordinates);

    //Don't need to trigger an update

    const ret: ComputeSettlementPartRasterFieldsReturn = {
      ciToUpdate: [],
    };

    /*await this.crudLayerService.updateItem(
      'settlement__part',
      settlementPart,
      false,
      false,
      actionId,
      true
    );*/

    //Create the catchment items

    /*
        https://github.com/novelt/GMT/issues/2639

        If the user does explicit includes, we don't actually look at the % in the include ri.catchment_item
        because we need to calculate an even split with all the HFs that have explicitly included the settlement part

        This is to be consistent with the backend
        */
    //if (containsIncluded) {
    //So we don't return in order to create the corresponding 'generated' catchment items
    //return;
    //}

    const weightDenominatorCI = spPopPerHf.totalPop;

    for (const [hfIndex, pop] of spPopPerHf.hfIndexsToPop.entries()) {
      const population_perc = (100 * pop) / weightDenominatorCI;

      const newCiItem: GeoJsonCatchmentItem = {
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          //because exclude is false, we use the sp boundary
          boundary_polygon: settlementPart.properties.boundary_polygon,
          global_id: uuidv4(),
          health_facility_point: hfList[hfIndex].properties.global_id,
          population_perc,
          settlement_part: settlementPart.properties.global_id,
          version_id: null,
          type: 'generated',
        },
        type: 'Feature',
      };

      /*
      await this.crudLayerService.createItem(
        'ri__catchment_item',
        newCiItem,
        false,
        false,
        actionId,
        true
      );*/
      ret.ciToUpdate.push(newCiItem);
    }

    return ret;
  }

  // async debugSquare(coordinate: Coordinate) {
  //
  //
  //
  //   //Find which settlement part
  //   const clickedPoint : Point = {
  //     coordinates: [coordinate[0], coordinate[1]], type: "Point"
  //   };
  //   const clickedSp = this.data.spList.find(sp => {
  //     if (!containsXY(sp.properties.bbox, coordinate[0], coordinate[1])) {
  //       return false;
  //     }
  //
  //     return geometryIntersects(sp, clickedPoint);
  //   });
  //
  //   if (!clickedSp) {
  //     return;
  //   }
  //   this.logger.info("Clicked settlement part", clickedSp);
  //
  //   const boundary = this.data.bMap.get(clickedSp.properties.boundary_polygon);
  //
  //   if (!boundary) {
  //     return;
  //   }
  //
  //   const popRaster = await this.rasterDataService.fetchPopRasterIfNeeded(boundary);
  //   const spRasterInfo = this.rasterDataService.getSettlementPartRasterInfo(clickedSp, popRaster);
  //
  //   const {hfList, containsIncluded} = getHfListForSp(clickedSp, this.data, new Set());
  //
  //   //get the center coords
  //   const rasterIndex = spRasterInfo.stats.toIndexRound( [coordinate[0], coordinate[1]]);
  //   const center = spRasterInfo.stats.centerCoords(rasterIndex);
  //   const nearestHf = computeNearestHf(hfList, center, clickedSp, this.weightConfig, true);
  //
  //   this.logger.info(`Center coords ${center} clicked ${clickedPoint} raster ${rasterIndex}`);
  //
  //   for(const hf of nearestHf.hits) {
  //     const hfJson = hfList[hf.index];
  //     const hfBoundary = this.data.bMap.get(hfJson.properties.boundary_polygon)!;
  //     this.logger.info(`Hf ${hfJson.properties.name} in ${hfBoundary.properties.name} weight ${hf.weight} of ${nearestHf.totalWeight} = ${100.0 * hf.weight / nearestHf.totalWeight}`);
  //   }
  // }

  /**
   * Computes the population % between multiple primary names of a given settlement part.
   * @param settlementPart
   * @param actionId
   * @returns
   */
  async updateSettlementPartPop(
    settlementPart: GeoJsonSettlementPart
  ): Promise<boolean> {
    manuallyPopulateSettlementPartFieldsIfNeeded(settlementPart);

    const boundary = this.data.bMap.get(
      settlementPart.properties.boundary_polygon
    );

    if (!boundary) {
      this.logger.warn(
        `Boundary not found in updateSettlementPartPop ${settlementPart.properties.boundary_polygon} for ${settlementPart.properties.global_id}`
      );
      return false;
    }
    const popRaster = await this.rasterDataService.fetchPopRasterIfNeeded(
      boundary
    );

    const spRasterInfo = this.rasterDataService.getSettlementPartRasterInfo(
      settlementPart,
      popRaster
    );

    this.logger.info(`${LOG_PREFIX}Processing `);

    //loop through all raster squares; finding closest PN and closest HF

    // 2 modes

    let totalPop = 0;

    for (let idx = 0; idx < settlementPart.properties.raster.length; ++idx) {
      if (settlementPart.properties.raster.charAt(idx) != '1') {
        continue;
      }

      const popValue = spRasterInfo.popValues[idx];

      totalPop += popValue;
    }

    this.logger.info(`${LOG_PREFIX}Zonal stats == ${totalPop}`);

    //Set the settlement part pop
    //Precision on server is 3 decimal places
    if (isPopFloatDifferent(settlementPart.properties.computed_pop, totalPop)) {
      settlementPart.properties.computed_pop = totalPop;
    }

    return true;
  }

  private async deleteHFCatchments(
    hfGlobalId: string,
    actionId: string,
    removeOnlyComputed: boolean
  ) {
    let catchmentsToToRemove = this.data.getCatchmentForHf(
      hfGlobalId,
      false,
      false
    );

    if (removeOnlyComputed) {
      catchmentsToToRemove = catchmentsToToRemove.filter(
        (ci) => ci.properties.type == 'generated'
      );
    }

    await this.crudLayerService.bulkDeleteCatchmentItems(
      catchmentsToToRemove,
      true,
      actionId
    );
  }

  /*
    private getExtendedSpList(spList: Array<GeoJsonSettlementPart>): Array<GeoJsonSettlementPart> {
      //Note that when we compute a spList, we also want to update the HF catchments
      //if recalcAllRelatedHfs is true

      //To have a correct catchment, we need to make sure we include sps that are currently associated with that hf

      //The reason is to have the coordinates in hfIdToCoverageCoordinates be exhaustive

      const spIds = new Set<string>();

      const hfIds = new Set<string>();

      //First get all involved hf/outreaches
      for (const sp of spList) {
        spIds.add(sp.properties.global_id);
        const spCatchment = this.data.getCatchmentForSp(sp.properties.global_id, true, false);
        for (const ri of spCatchment) {
          if (ri.properties.type == "exclude") {
            continue;
          }
          hfIds.add(ri.properties.health_facility_point);
        }
      }

      //Now get all sps associated with those hfs
      for(const hfId of hfIds) {
        const hf = this.data.hfMap.get(hfId);
        if (_.isNil(hf)) {
          this.logger.warn(`Cannot find hf for ${hfId}`);
          continue;
        }
        const hfCatchment = this.data.getCatchmentForHf(hfId, true, false);
        for (const ri of hfCatchment) {
          if (ri.properties.type == "exclude") {
            continue;
          }
          spIds.add(ri.properties.settlement_part);
        }
      }

      const extendedSpList: Array<GeoJsonSettlementPart> = [];

      for (const spId of spIds) {
        const sp = this.data.spMap.get(spId);
        if (_.isNil(sp)) {
          this.logger.warn(`Cannot find sp for ${spId}`);
          continue;
        }
        extendedSpList.push(sp);
      }

      return extendedSpList;
    }*/

  /**
   * Currently computes the catchment of the given settlement parts.
   * This includes the catchment items for the settlement parts
   * and the raster visualization fields in settlement part.
   *
   * Note that health facilities also have visual fields, even when
   * Merging / splitting settlement parts this could change that because merging
   * a settlement that was once included
   */
  public async computeAllCatchmentAssignments(
    spList: Array<GeoJsonSettlementPart>,
    pActionId: string | null,
    //If id present, catchment info is reset, this implies all the sps
    //that influence the hf catchment are present
    hfIdsToReset: Set<string>
  ) {
    const actionId = pActionId || uuidv4();

    this.logger.info(
      `computeAllCatchmentAssignments for ${spList.length} settlement parts`
    );

    if (!_.isArray(spList) || spList.length == 0) {
      return;
    }

    if (!this.userContextService.isAutoCatchmentMode$.value) {
      this.logger.info(
        `computeAllCatchmentAssignments skipped, adding ${spList.length} settlement parts to be done later`
      );
      const setSp = this.userContextService.spGuidsToCalc$.value;
      for (const sp of spList) {
        setSp.add(sp.properties.global_id);
      }
      this.userContextService.spGuidsToCalc$.next(setSp);
      return;
    }

    this.isLoadingService.setProgressBarInfo(
      'Removing existing ci...',
      5,
      true
    );

    const spGuidList = spList.map((sp) => sp.properties.global_id);
    await this.removeExistingCiForSp(spGuidList, actionId);

    await this.crudLayerService.bulkDeleteGeneratedItems(
      spGuidList,
      ST_GEOMETRY_LAYER
    );

    let progressPercentage = 20;
    this.isLoadingService.setProgressBarInfo(
      'Calculating coverage stats...',
      progressPercentage,
      true
    );

    const progressStep = (100 - progressPercentage) / spList.length;

    const boundaryRasters = await fetchAllPopRasters(
      spList,
      this.rasterDataService,
      this.data
    );

    //hfGuid=>spGuid=>cov. info
    const hfIdToCoverageCoordinates: Map<
      string,
      Map<string, HfSpCoverageInfo>
    > = new Map();

    const customCatchmentHealthFacilityIds = new Set<string>(
      this.data.ciList
        .filter((ci) => ci.properties.type == 'include')
        .map((ci) => ci.properties.health_facility_point)
    );

    const allSpToUpdate: Array<GeoJsonSettlementPart> = [];
    const allCiToUpdate: Array<GeoJsonCatchmentItem> = [];

    for (const [spIdx, sp] of spList.entries()) {
      this.logger.debug(
        `computeAllCatchmentAssignments spIdx ${spIdx} of ${spList.length}`
      );

      if ((sp.properties.split_type || '') == 'auto_split_parent') {
        this.logger.debug(`Ignoring split parent [${sp.properties.global_id}]`);
        continue;
      }

      const sn = this.data.getPrimaryNamesForSettlementPart(
        sp.properties.global_id,
        false
      )[0];
      const csprfReturn = await this.computeSettlementPartRasterFields(
        sp,
        sn,
        boundaryRasters.get(sp.properties.boundary_polygon),
        hfIdToCoverageCoordinates,
        customCatchmentHealthFacilityIds
      );
      allSpToUpdate.push(sp);
      allCiToUpdate.push(...csprfReturn.ciToUpdate);

      progressPercentage += progressStep;
      this.isLoadingService.setProgressBarInfo(
        `Calculating coverage stats (Finished ${spIdx + 1} of ${
          spList.length
        })...`,
        progressPercentage,
        true
      );
    }

    this.isLoadingService.setProgressBarInfo(null, progressPercentage, false);

    await this.crudLayerService.bulkUpdateItem(
      'settlement__part',
      allSpToUpdate,
      true,
      false,
      actionId,
      true
    );
    await this.crudLayerService.bulkCreateItem(
      'ri__catchment_item',
      allCiToUpdate,
      true,
      false,
      actionId,
      true
    );

    //await this.crudLayerService.updateObservableAfterCrud('settlement__part');
    //await this.crudLayerService.updateObservableAfterCrud('ri__catchment_item');

    //Also recompute any health facilities in this ward that were impacted
    await this.computeHealthFacilityRasterFields(
      hfIdToCoverageCoordinates,
      actionId,
      hfIdsToReset
    );
  }
  /**
   * Filters which sps are within 2km of the given hfs
   */
  public getSpListForHfList(
    hfListFilter: Array<GeoJsonHealthFacility | null>
  ): Array<GeoJsonSettlementPart> {
    const spSet = new Set<string>();
    for (const hfFilter of hfListFilter) {
      //Also skips null
      if (isEmpty(hfFilter)) {
        continue;
      }
      const hfSpListFilter = bboxFilter(hfFilter!.geometry, this.data.spList);
      for (const sp of hfSpListFilter) {
        spSet.add(sp.properties.global_id);
      }

      //Check these because might be beyond the bbox filter
      const includeList = this.data
        .getCatchmentForHf(hfFilter!.properties.global_id, true, false)
        .filter((ci) => ci.properties.type == 'include')
        .map((ci) => ci.properties.settlement_part);

      for (const spId of includeList) {
        spSet.add(spId);
      }
    }

    return this.data.spList.filter((sp) => spSet.has(sp.properties.global_id));
  }

  zoomHfSettlementName(hf: GeoJsonHealthFacility, sn: GeoJsonSettlementName) {
    const sp = this.data.spMap.get(sn.properties.settlement_part!);
    //Add the settlement name
    if (!isEmpty(sn)) {
      this.microplanMapEvents.triggerSettlementHighlightEvent(
        sn.properties.global_id
      );
      // this.mapEvents.addFeature({
      //   geo_json: sn,
      //   layer: OverlayLayer.NORMAL,
      //   style: (feature, resolution) => {
      //     return settlementsStyleFunction(feature, resolution, true, false);
      //   }
      // });
    }
    this.drawLineToHf(hf, sn);
    if (sp) {
      this.mapEvents.addFeature({
        geo_json: sp,
        style: settlementPartStyleForColour(
          colorWithAlpha(typeToColor.get(sp.properties.type)!, 0.8)
        ),
        layer: OverlayLayer.NORMAL,
      });
    }

    const extent = getExtentedBoundingBoxForFeatures(200, sp!, sn, hf);

    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent,
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  zoomHfsSettlementName(
    hfs: GeoJsonHealthFacility[],
    sn: GeoJsonSettlementName
  ) {
    // this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);

    const sp = this.data.spMap.get(sn.properties.settlement_part!);

    //Add the settlement name
    if (!isEmpty(sn)) {
      this.microplanMapEvents.triggerSettlementHighlightEvent(
        sn.properties.global_id
      );
    }

    if (sp) {
      this.mapEvents.addFeature({
        geo_json: sp,
        style: settlementPartStyleForColour(
          colorWithAlpha(typeToColor.get(sp.properties.type)!, 0.8)
        ),
        layer: OverlayLayer.NORMAL,
      });
    }
    hfs.forEach((hf) => {
      this.drawLineToHf(hf, sn);
    });

    const extent = getExtentedBoundingBoxForFeatures(200, sp!, sn, ...hfs);

    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent,
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  /**
   * Draws blue dashed line between HF and settlement or HF and it's outreach
   * @param hf
   * @param feature
   * @private
   */
  public drawLineToHf(
    hf: GeoJsonHealthFacility,
    feature: GeoJsonSettlementName | GeoJsonHealthFacility
  ) {
    //const color = hfColor || hf.properties.color;

    this.mapEvents.addFeature({
      geo_json: hf,
      style: (feature, resolution) => {
        return healthFacilitiesStyleFunction(false, false)(feature, resolution); // color!
      },
      layer: OverlayLayer.NORMAL,
    });

    //Draw a line connecting them
    const line = lineString([
      hf.geometry.coordinates,
      feature.geometry.coordinates,
    ]);

    const lineJson: GeoJsonBase = {
      geometry: {
        type: 'LineString',
        coordinates: line.geometry.coordinates as Position[],
      },
      properties: {
        boundary_polygon: hf.properties.boundary_polygon,
        global_id: uuidv4(),
        version_id: null,
      },
      type: 'Feature',
    };

    const style =
      feature.properties.boundary_polygon == hf.properties.boundary_polygon
        ? mapStyles.HF.connectToPoint
        : mapStyles.HF.connectToPointAlt;
    this.mapEvents.addFeature(
      {
        geo_json: lineJson,
        layer: OverlayLayer.NORMAL,
        style,
      },
      false
    );
    // TODO - it would be nice if this rendering would be called from microplan-boundary-map.component.ts
    // this.baselineService.visualizeSpCoverage(sp!, this.mapEvents, this.data, true).then();
  }
  getInBoundaryAndTooltip(geoJson: GeoJsonBase): {
    inBoundary: boolean;
    inAnotherBoundaryTooltip: string;
  } {
    const inBoundary =
      geoJson.properties.boundary_polygon == this.data.boundaryId;
    let inAnotherBoundaryTooltip = '';

    if (!inBoundary) {
      const otherBoundary = this.data.bMap.get(
        geoJson.properties.boundary_polygon
      )!;
      //LEVEL_TO_LABEL
      const label = this.level_to_label[otherBoundary.properties.level];
      inAnotherBoundaryTooltip = `Inside another ${label}: ${otherBoundary.properties.name}`;
    }

    return { inBoundary, inAnotherBoundaryTooltip };
  }

  public async recalculateCatchmentForUndoRedo(
    undoRedoEvent: UndoRedoEvent
  ): Promise<void> {
    if (!undoRedoEvent) {
      return;
    }
    const actionId = undoRedoEvent.lastActionId
      ? undoRedoEvent.lastActionId
      : uuidv4();

    await this.computeAllCatchmentAssignmentsForHfList(
      undoRedoEvent.updatedHfIds,
      actionId,
      true
    );
  }
}

export function calcTravelTimeImpl(
  calculateTravelTime: boolean,
  fromHF: GeoJsonHealthFacility,
  toName: GeoJsonSettlementName,
  h: { travelTimeWalking: number },
  logger: NGXLogger
) {
  if (!calculateTravelTime) {
    return;
  }

  const boundaryId = fromHF.properties.boundary_polygon;
  const from3857 = toMercator((fromHF.geometry as Point).coordinates);
  const fromPointId = fromHF.properties.global_id;
  const to3857 = toMercator((toName.geometry as Point).coordinates);

  //TODO cancel these promises if the page exits
  WORKER_CLIENT.travelTimeBetweenPoints({
    boundaryId,
    from3857,
    fromPointId,
    to3857,
    is_walking: true,
    // logger: logger
  }).then((time) => {
    //this.logger.info("Time is ", time);
    h.travelTimeWalking = time;
  });
  //
  // WORKER_CLIENT.travelTimeBetweenPoints({
  //   boundaryId,
  //   from3857,
  //   fromPointId,
  //   to3857,
  //   is_walking: false
  // }).then((time) => {
  //   //this.logger.info("Time is ", time);
  //   h.travelTimeCar = time;
  // });
}

export function getBalancedPopPercentage(total: number): number {
  if (!Number.isInteger(total)) {
    //this.logger.error(`Not an integer: ${total}`);
    return 100;
  }
  return Math.round((100 * 100.0) / total) / 100;
}

export function generateSettlementName(
  type: SettlementType,
  lon: number,
  lat: number
): string {
  return `${GENERATED_PREFIX} for ${type.toLocaleUpperCase()} at Longitude ${formatCoordinate(
    lon
  )} and Latitude ${formatCoordinate(lat)}`;
}

function sumArray(a: Array<number>): number {
  let sum = 0;
  for (const n of a) {
    sum += n;
  }
  return sum;
}

// Test function to show raster grid on map
function rasterGridToGeojson(
  stats: RasterStats,
  rasterized: Array<boolean>
): Array<GeoJsonBase> {
  const dataWidth = stats.size[0];
  const dataHeight = stats.size[1];

  const rasterized_features: Array<object> = [];

  for (let x = 0; x < dataWidth; x += 1) {
    for (let y = 0; y < dataHeight; y += 1) {
      let coordinates = stats.polyCoords([x, y]);

      let idx = y * dataWidth + x;

      rasterized_features.push({
        geometry: {
          coordinates: [coordinates],
          type: 'Polygon',
        },
        type: 'Feature',
        properties: {
          value: rasterized[idx] ? 1 : 0,
          //just need a unique number for display purposes
          global_id: uuidv4(),
        },
      });
    }
  }

  return rasterized_features as unknown as Array<GeoJsonBase>;
}

/**
 * This is a test/development function used to test/showcase the rasterization of a settlement part
 */
// export async function rasterizeSettlementPart(
//   settlementPart: GeoJsonSettlementPart,
//   mapEvents: MicroplanMapEventsService,
// ) {
//
//   const rasterStats = new RasterStats({
//     origin: [2.668750004000000,
//       13.892083479000000],
//     xPixelWidth: 0.000833333329980,
//     yPixelHeight: -0.000833333329980,
//     size: [14413,
//       11546]
//   });
//
//   //Calculate the stats of the smallest raster that would cover the settlement part
//   let mp = settlementPart.geometry;
//   // minX, minY, maxX, maxY order
//   let mpExtent = bbox(mp) as BBox2d;
//
//   this.logger.info(`${LOG_PREFIX}Settlement part extent`, mpExtent);
//
//   const subRasterStats = rasterStats.getSubRasterStatsForExtent(mpExtent);
//
//   this.logger.info(`${LOG_PREFIX}Sub raster stats`, subRasterStats);
//   this.logger.info(`${LOG_PREFIX}Sub raster extent`, subRasterStats.getRasterExtent());
//
//
//   const edges = getEdges(subRasterStats, settlementPart);
//
//   //this.logger.info(`${LOG_PREFIX}Edges`, edges);
//
//   const rasterized = rasterize(edges, subRasterStats);
//
//
//   mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
//
//   let rasterGeojsonSquares = rasterGridToGeojson(subRasterStats, rasterized);
//
//   for (const g of rasterGeojsonSquares) {
//
//     //this.logger.info(`${LOG_PREFIX}Adding raster square`, g);
//     mapEvents.addFeature({
//       geo_json: g,
//       style: popRasterStyle,
//       layer: OverlayLayer.NORMAL
//
//     }, false);
//   }
//
//
//   mapEvents.emitOverlayFeatureUpdate();
//
//   //await this.computeCatchmentAssignments(this.settlementPart!);
// }

function floodFill(
  subRasterStats: RasterStats,
  popValues: Array<number>,
  seen: Array<boolean>,
  start: number
): [number, Position] {
  const toProcess: Array<number> = [start];
  const inSet: Array<number> = [];

  while (toProcess.length > 0) {
    const cur = toProcess.shift()!;

    if (seen[cur]) {
      continue;
    }

    seen[cur] = true;
    inSet.push(cur);

    for (const nextPos of subRasterStats.getAdjacent(
      subRasterStats.to2dIndex(cur)
    )) {
      const nextIdx = subRasterStats.to1dIndex(nextPos);
      if (!seen[nextIdx]) {
        toProcess.push(nextIdx);
      }
    }
  }

  let totalWeight = 0;
  let xNum = 0;
  let yNum = 0;

  for (const sq of inSet) {
    const weight = AppConfigService.BASE_POP_PER_SQUARE + popValues[sq];
    const pos = subRasterStats.to2dIndex(sq);
    xNum += pos[0] * weight;
    yNum += pos[1] * weight;
    totalWeight += weight;
  }

  const xAvg = xNum / totalWeight;
  const yAvg = yNum / totalWeight;

  //pop zero should not be uncovered visually
  return [totalWeight, [xAvg, yAvg]];
}

/**
 * Returns the best raster position
 */
function findBestHfPosition(
  uncoveredSquares: Array<boolean>,
  popValues: Array<number>,
  subRasterStats: RasterStats
): Position {
  //all covered squares, initialize as seen
  const seen: Array<boolean> = [];
  for (const isUncovered of uncoveredSquares) {
    seen.push(!isUncovered);
  }

  let maxWeight = -1;
  let maxPosition: Position = [-1, -1];

  for (let i = 0; i < uncoveredSquares.length; ++i) {
    if (seen[i]) {
      continue;
    }

    const [weight, pos] = floodFill(subRasterStats, popValues, seen, i);

    if (weight > maxWeight) {
      maxWeight = weight;
      maxPosition = pos;
    }
  }

  return subRasterStats.centerCoords(maxPosition);
}

// function getHfListForSpList(hfListToFilter: Array<GeoJsonHealthFacility>, spList: Array<GeoJsonSettlementPart>): Array<GeoJsonHealthFacility> {
//
//   //Build a single extent
//   if (!spList || spList.length <= 0) {
//     return hfListToFilter;
//   }
//
//   let spExtent = spList[0].properties.bbox;
//
//   for(let spIdx = 1; spIdx < spList.length; ++spIdx) {
//     spExtent = extend(spExtent, spList[spIdx].properties.bbox);
//   }
//
//   const bufferedExtent = bbox2d_padded(spExtent, METERS_TO_PAD);
//
//
//   return hfListToFilter.filter(hf => {
//     if (isEmpty(hf)) {
//       return false;
//     }
//
//     return containsXY(bufferedExtent, hf.geometry.coordinates[0], hf.geometry.coordinates[1]);
//   });
// }

export async function fetchAllPopRasters(
  spList: Array<GeoJsonSettlementPart | GeoJsonHealthFacility>,
  rasterDataService: RasterDataService,
  boundaryDataClass: BoundaryDataClass
): Promise<Map<string, OriginResolutionData>> {
  const boundaryRasters = new Map<string, OriginResolutionData>();

  for (const settlementPart of spList) {
    const bId = settlementPart.properties.boundary_polygon;
    if (!bId) {
      continue;
    }
    if (boundaryRasters.has(bId)) {
      continue;
    }
    const boundary = boundaryDataClass.bMap.get(bId);

    if (!boundary) {
      continue;
    }
    const popRaster = await rasterDataService.fetchPopRasterIfNeeded(boundary);
    boundaryRasters.set(bId, popRaster);
  }
  return boundaryRasters;
}

interface SpSquareWeightPerHf {
  hfIndexsToWeight: Map<number, number>;

  totalWeight: number;
  //Including pop per square + the pop value for the raster square
  pop: number;
}

interface SpPopPerHf {
  //Including pop per square + the pop value for the raster square
  hfIndexsToPop: Map<number, number>;

  //Including pop per square + the pop value for the raster square
  totalPop: number;
}

//After updating sp raster info,
//store info needed to update the hf catchment raster
interface HfSpCoverageInfo {
  sp: GeoJsonSettlementPart;
  //in 4326 coords
  coords: Array<[number, number]>;
}

/*
For each square, compute how much weight per square (weight is that formula taking into account distance, frequency, etc for each HF)

We also return total pop from weight per settlement part
*/
function calculateInitialSpSquareWeights(
  settlementPart: GeoJsonSettlementPart,
  spRasterInfo: SettlementPartRasterInfo,
  hfListForSp: Array<GeoJsonHealthFacility>,
  weightConfig: WeightConfig,
  containsIncluded: boolean
): [SpPopPerHf, Array<SpSquareWeightPerHf | null>] {
  let ret: Array<SpSquareWeightPerHf | null> = [];

  let spPopPerHf: SpPopPerHf = {
    hfIndexsToPop: new Map(),
    totalPop: 0,
  };

  for (let idx = 0; idx < settlementPart.properties.raster.length; ++idx) {
    if (settlementPart.properties.raster.charAt(idx) != '1') {
      ret.push(null);
      continue;
    }

    const weights: SpSquareWeightPerHf = {
      hfIndexsToWeight: new Map(),
      totalWeight: 0,
      pop: spRasterInfo.popValues[idx] + AppConfigService.BASE_POP_PER_SQUARE,
    };
    ret.push(weights);

    const center = spRasterInfo.stats.centerCoords(
      spRasterInfo.stats.to2dIndex(idx)
    );

    const nearestHf = computeNearestHf(
      hfListForSp,
      center,
      settlementPart,
      weightConfig,
      containsIncluded
    );

    if (!nearestHf) {
      continue;
    }

    for (const nhf of nearestHf.hits) {
      weights.hfIndexsToWeight.set(nhf.index, nhf.weight);
      weights.totalWeight += nhf.weight;
    }

    spPopPerHf.totalPop += weights.pop;
    for (const [hfIdx, hfWeight] of weights.hfIndexsToWeight.entries()) {
      spPopPerHf.hfIndexsToPop.set(
        hfIdx,
        (spPopPerHf.hfIndexsToPop.get(hfIdx) || 0) +
          (hfWeight / weights.totalWeight) * weights.pop
      );
    }
  }

  return [spPopPerHf, ret];
}

// Prunes according to the min %
// Only prunes out of boundary health faciliets
// Modifies weightsPerSquare
function pruneHealthFacilitiesForSp(
  hfListForSp: Array<GeoJsonHealthFacility>,
  settlementPart: GeoJsonSettlementPart,
  weightConfig: WeightConfig,
  spPopPerHf: SpPopPerHf,
  weightsPerSquare: Array<SpSquareWeightPerHf | null>,
  logger: NGXLogger
) {
  //logger.info(`pruneHealthFacilitiesForSp for  ${settlementPart.properties.settlement_name}`);
  let hasBeenPruned = new Set();

  while (true) {
    //Find minimum % that has not already been pruned
    let min_perc = 1e30;
    let min_hf_idx = -1;

    for (const [hf_idx, pop] of spPopPerHf.hfIndexsToPop.entries()) {
      if (hasBeenPruned.has(hf_idx)) {
        continue;
      }

      if (pop >= weightConfig.getMinSettPop()) {
        continue;
      }

      if (
        hfListForSp[hf_idx].properties.boundary_polygon ==
        settlementPart.properties.boundary_polygon
      ) {
        // never prune in boundary HFs
        continue;
      }

      let hf_perc = pop / spPopPerHf.totalPop;

      if (hf_perc < min_perc) {
        min_perc = hf_perc;
        min_hf_idx = hf_idx;
      }
    }

    if (min_hf_idx < 0) {
      break;
    }

    if (min_perc >= weightConfig.getMinSettPerc()) {
      break;
    }

    //logger.info!(`pruneHealthFacilitiesForSp Min % is ${min_perc} of idx ${min_hf_idx} guid ${hfListForSp[min_hf_idx].properties.name}`);

    //Prune min_hf_idx

    for (const s of weightsPerSquare) {
      if (!s) {
        continue;
      }

      if (!s.hfIndexsToWeight.has(min_hf_idx)) {
        continue;
      }

      //Must keep at least 1 hf to prevent pruning until there is no coverage
      if (s.hfIndexsToWeight.size <= 1) {
        continue;
      }

      let removed_weight = s.hfIndexsToWeight.get(min_hf_idx)!;
      s.hfIndexsToWeight.delete(min_hf_idx);

      s.totalWeight -= removed_weight;
    }

    //Recalculate pops
    spPopPerHf.hfIndexsToPop.clear();
    for (const s of weightsPerSquare) {
      if (!s) {
        continue;
      }

      for (const [hfIdx, hfWeight] of s.hfIndexsToWeight.entries()) {
        spPopPerHf.hfIndexsToPop.set(
          hfIdx,
          (spPopPerHf.hfIndexsToPop.get(hfIdx) || 0) +
            (hfWeight / s.totalWeight) * s.pop
        );
      }
    }

    //trace!("After pruning {} = {}",
    //hf_info.hf_list[min_hf_idx].name,
    //sp_hf_info.hf_idx_to_pop.get(&min_hf_idx).unwrap_or(&0.0) / sp_hf_info.total_pop);

    hasBeenPruned.add(min_hf_idx);
  }
}

function calculateNewHfCatchmentRasterExtent(
  healthFacility: GeoJsonHealthFacility,
  spCoordMap: Map<string, HfSpCoverageInfo>,
  logger: NGXLogger
): RasterStats {
  //const curHfRasterStats = fromSpOrHf(healthFacility);
  let newHfRasterStats = fromSpOrHf(healthFacility);
  //[x_min, y_min, x_max, y_max]
  let newHfRasterExtent = newHfRasterStats.getRasterExtent();

  logger.debug(
    `Existing hf catchment size for ${healthFacility.properties.name} = ${newHfRasterStats.size} ; ${healthFacility.properties.global_id}`
  );

  for (const [_spId, covInfo] of spCoordMap.entries()) {
    const coordStats = fromSnapCoords(covInfo.coords);

    //[x_min, y_min, x_max, y_max]
    const spCovExtent = coordStats.getRasterExtent();

    if (newHfRasterStats.size[0] == 0 || newHfRasterStats.size[1] == 0) {
      //expanding an empty current hf raster
      newHfRasterStats = coordStats;
      newHfRasterExtent = newHfRasterStats.getRasterExtent();
      continue;
    }

    newHfRasterExtent[0] = Math.min(newHfRasterExtent[0], spCovExtent[0]);
    newHfRasterExtent[1] = Math.min(newHfRasterExtent[1], spCovExtent[1]);
    newHfRasterExtent[2] = Math.max(newHfRasterExtent[2], spCovExtent[2]);
    newHfRasterExtent[3] = Math.max(newHfRasterExtent[3], spCovExtent[3]);
  }

  newHfRasterStats =
    newHfRasterStats.getSubRasterStatsForExtent(newHfRasterExtent);

  return newHfRasterStats;
}

//We also need to add entries for any sp that happens to intersect the current
//hf catchment extent, in order to handle shrinking / reducing the hf catchment
function addHfsIntersectingCatchment(
  //This will add any hf that is not part of computed/include catchment
  //in order to make sure those settlements are correctly removed
  hfIdToCoverageCoordinates: Map<string, Map<string, HfSpCoverageInfo>>,
  spRasterStats: RasterStats,
  data: BoundaryDataClass,

  sp: GeoJsonSettlementPart
) {
  const spExtent = spRasterStats.getRasterExtent();
  const spId = sp.properties.global_id;
  const [aminx, aminy, amaxx, amaxy] = spExtent;

  const hfList: Array<GeoJsonHealthFacility> = data.hfList;

  //Because we are doing partial updates, we don't want to include a hf
  //that is part of the current catchment.
  //The reason is if we include a settlement, but didn't calculate its catchment
  //it will be incorrectly removed from the hf catchment raster
  const currentCatchmentHfs = new Set(
    data
      .getCatchmentForSp(sp.properties.global_id, true, false)
      .filter((ci) => ci.properties.type != 'exclude')
      .map((ci) => ci.properties.health_facility_point)
  );

  for (const hf of hfList) {
    if (currentCatchmentHfs.has(hf.properties.global_id)) {
      //To not remove sps from hf that are still part of the catchment
      continue;
    }
    const hfRasterStats = fromSpOrHf(hf);
    const hfCatchExtent = hfRasterStats.getRasterExtent();

    const [bminx, bminy, bmaxx, bmaxy] = hfCatchExtent;

    if (aminx <= bmaxx && amaxx >= bminx && aminy <= bmaxy && amaxy >= bminy) {
      const hfId = hf.properties.global_id;

      if (!hfIdToCoverageCoordinates.has(hfId)) {
        hfIdToCoverageCoordinates.set(
          hf.properties.global_id,
          new Map<string, HfSpCoverageInfo>()
        );
      }

      const spCoordMap = hfIdToCoverageCoordinates.get(hfId)!;

      if (!spCoordMap.has(spId)) {
        spCoordMap.set(spId, {
          sp,
          coords: [],
        });
      }
    }
  }
}

function transferExistingHfCatchRaster(
  newHfRasterStats: RasterStats,
  healthFacility: GeoJsonHealthFacility,
  logger: NGXLogger
): Array<string> {
  const hfRasterArray: Array<string> = Array(
    newHfRasterStats.size[0] * newHfRasterStats.size[1]
  );
  hfRasterArray.fill('0');

  const curHfRasterStats = fromSpOrHf(healthFacility);

  if (curHfRasterStats.size[0] <= 0 || curHfRasterStats.size[1] <= 0) {
    //nothing to xfer
    return hfRasterArray;
  }

  //transfer the existing catchment raster
  const [xOffset, yOffset] = newHfRasterStats.toIndexRound([
    healthFacility.properties.origin_x,
    healthFacility.properties.origin_y,
  ]);
  if (xOffset < 0 || yOffset < 0) {
    logger.warn(`Expected offsets to be positive ${xOffset}, ${yOffset}`);
  }
  for (let x = 0; x < curHfRasterStats.size[0]; ++x) {
    for (let y = 0; y < curHfRasterStats.size[1]; ++y) {
      const oldRasterIndex = curHfRasterStats.to1dIndex([x, y]);
      //Because the new raster should be a superset of the old one, the offsets should always be positive
      const newRasterIndex = newHfRasterStats.to1dIndex([
        x + xOffset,
        y + yOffset,
      ]);
      hfRasterArray[newRasterIndex] =
        healthFacility.properties.catchment_raster.charAt(oldRasterIndex);
    }
  }

  return hfRasterArray;
}

function applySpToHfCatchRaster(
  newHfRasterStats: RasterStats,
  spCoordMap: Map<string, HfSpCoverageInfo>,
  //Array of 0 / 1; more efficient to update string this way
  //Array becomes a 01 string representing if the square is part
  //of the HF catchment
  hfRasterArray: Array<string>,
  logger: NGXLogger
) {
  for (const [spId, covInfo] of spCoordMap.entries()) {
    const sp = covInfo.sp; //use this one instead of spMap in case a defensive copy was made
    //this.data.spMap.get(spId);
    if (isNil(sp)) {
      logger.warn(`Null sp for [${spId}]`);
      continue;
    }
    //logger.debug(`Applying sp ${spId}`);
    const spStats = fromSpOrHf(sp);
    //Note that the isFixedPost / isOutreach in sp do not have which hf made it true
    //so we need the coords

    //Process intersection of sp and hf catchment raster
    //initializing any sp/hf catchment intersection to 0
    const topLeft = spStats.toIndexRound(newHfRasterStats.origin);
    //if size is 2, 2 => top left coords becomes right/bottom
    const bottomRight = spStats.toIndexRound(
      newHfRasterStats.calcTopLeftCoords(newHfRasterStats.size)
    );
    const spStartX = Math.max(0, topLeft[0]);
    const spStopX = Math.min(spStats.size[0], bottomRight[0]);
    const spStartY = Math.max(0, topLeft[1]);
    const spStopY = Math.min(spStats.size[1], bottomRight[1]);

    const [xOffset, yOffset] = newHfRasterStats.toIndexRound(spStats.origin);

    for (let x = spStartX; x < spStopX; ++x) {
      for (let y = spStartY; y < spStopY; ++y) {
        const spRasterIndex = spStats.to1dIndex([x, y]);
        //Ignore any squares not in the settlement part
        if (sp.properties.raster.charAt(spRasterIndex) != '1') {
          continue;
        }

        //Initialize hf catchment raster of intersecting sp to 0
        const newIndex = newHfRasterStats.to1dIndex([x + xOffset, y + yOffset]);
        hfRasterArray[newIndex] = '0';
      }
    }

    //Now set the coords
    for (const c of covInfo.coords) {
      const newIndex = newHfRasterStats.to1dIndex(
        newHfRasterStats.toIndexRound(c)
      );
      hfRasterArray[newIndex] = '1';
    }
  }
}

interface ComputeSettlementPartRasterFieldsReturn {
  ciToUpdate: Array<GeoJsonCatchmentItem>;
}
