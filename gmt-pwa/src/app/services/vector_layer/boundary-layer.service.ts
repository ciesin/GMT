import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { CancelService } from '@services/cancel.service';
import { IsOnlineService } from '@services/is-online.service';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import {
  MessageService,
  MessageType,
} from '@services/shared/notifications/message.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { bbox, toMercator } from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import { Extent } from 'ol/extent';
import VectorTileLayer from 'ol/layer/VectorTile';
import { firstValueFrom, from, Observable } from 'rxjs';
import { filter, first, switchMap } from 'rxjs/operators';
import { AppConfigService } from '../../utils/app-config.service';
import { buildMap } from '../../utils/container';
import {
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonBoundaryWithIndicators,
  GeoJsonList,
} from '../../utils/server-interfaces/GeoJson';
import { HierarchyList } from '../../utils/server-interfaces/HierarchyList';
import { ALL_VECTOR_LAYERS } from '../../utils/server-interfaces/VectorLayerName';
import { IndicatorService } from '../indicator.service';
import { BoundaryLayerServiceInterface } from '../interfaces/boundary-layer.service.interface';
import { IsLoadingService } from '../is-loading.service';
import { UrlRequestCacheService } from '../url-request-cache.service';
import {
  BoundaryEditedInfo,
  BoundaryInfo,
  VectorLayerService,
} from '../vector_layer/vector-layers.service';
import { HIERARCHY_STORAGE_KEY, LastFetched } from './VectorLayerDatabase';

//Special guid to store in boundary_polygons indicating if we have fetched the simplified polygons or not
export const ALL_BOUNDARIES_GUID = '47c1866e-515b-4d27-9f04-57109d666772';
/**
 *
 */
@Injectable({
  providedIn: 'root',
})
export class BoundaryLayerService implements BoundaryLayerServiceInterface {
  constructor(
    protected vectorLayerService: VectorLayerService,
    protected isLoadingService: IsLoadingService,
    protected http: HttpClient,
    private confirmationService: ConfirmationService,
    private urlRequestCacheService: UrlRequestCacheService,
    private indicatorService: IndicatorService,
    private logger: NGXLogger,
    private isOnlineService: IsOnlineService,
    private messageService: MessageService,
    private userContextService: UserContextService,
    private cancelService: CancelService,
    private userActionLogService: UserActionLogService
  ) {}

  /**
   * Returns all boundary data (geospatial
   * Will fetch the data if it is out of date
   *
   * These are the simplified polygons
   */
  async getBoundaryData(): Promise<Array<GeoJsonBoundaryWithIndicators>> {
    await this.fetchBoundaryDataIfNeeded();
    return this.vectorLayerService.allBoundaryData;
  }

  /**
   * Note this doesn't take into account surrounding boundaries!
   *
   * These are only explicitly downloaded wards/boundaries
   */
  async getAllOfflineBoundaries(): Promise<Set<string>> {
    const list = await this.vectorLayerService._db.is_offline
      .toCollection()
      .primaryKeys();

    return new Set<string>(list);
  }

  async isBoundaryOffline(boundaryId: string): Promise<boolean> {
    const sb = await this.vectorLayerService._db.is_offline.get(boundaryId);
    return !!sb;
  }

  isBoundaryOfflineObservable(boundaryId: string): Observable<boolean> {
    return this.vectorLayerService.offlineBoundariesChanged.pipe(
      switchMap((_) => {
        return from(this.isBoundaryOffline(boundaryId));
      })
    );
  }

  //Note this method doesn't use observables, this is for HF and Settlement pages
  //where we should never have boundary changes coming in or being feteched
  async fetchBoundaryInfo(
    boundaryId: string,
    boundaryList: Array<GeoJsonBoundary>
  ): Promise<BoundaryInfo> {
    // make sure we have boundary data
    const sbg = await this.vectorLayerService.getSurroundingBoundaryGuids(
      boundaryId
    );
    const surroundingBoundaryList = boundaryList.filter((bd) =>
      sbg.surrounding_boundary_guids.includes(bd.properties.global_id)
    );
    const boundary = surroundingBoundaryList.find(
      (bd) => bd.properties.global_id === boundaryId
    )!;

    const surroundingBoundaryIds = new Set<string>(
      surroundingBoundaryList.map((b) => b.properties.global_id)
    );
    return { surroundingBoundaryList, boundary, surroundingBoundaryIds };
  }

  async fetchEditedBoundaryInfo(
    boundaryId: string,
    boundaryList: Array<GeoJsonBoundaryEdited>
  ): Promise<BoundaryEditedInfo> {
    // make sure we have boundary data
    const sbg = await this.vectorLayerService.getSurroundingBoundaryGuids(
      boundaryId
    );
    const surroundingBoundaryList = boundaryList.filter((bd) =>
      sbg.surrounding_boundary_guids.includes(bd.properties.boundary_polygon)
    );
    const boundary = surroundingBoundaryList.find(
      (bd) => bd.properties.boundary_polygon === boundaryId
    )!;

    const surroundingBoundaryIds = new Set<string>(
      surroundingBoundaryList.map((b) => b.properties.global_id)
    );
    return { surroundingBoundaryList, boundary, surroundingBoundaryIds };
  }

  /*
    This is the dashboard data, including indicators
    */
  async fetchHierarchyList(): Promise<HierarchyList> {
    let hierarchyList = (await this.vectorLayerService._db.key_value.get(
      HIERARCHY_STORAGE_KEY
    )) as HierarchyList | null;

    if (
      hierarchyList &&
      !(await this.vectorLayerService.isVersionOutOfDate(hierarchyList.version))
    ) {
      return hierarchyList;
    }

    //Now we need to fetch it
    this.logger.info(`${AppConfigService.conf.api_url}/get_hierarchy_list`);
    hierarchyList = await firstValueFrom(
      this.http.get<HierarchyList>(
        `${AppConfigService.conf.api_url}/get_hierarchy_list`
      )
    );

    await this.vectorLayerService._db.key_value.put(
      hierarchyList,
      HIERARCHY_STORAGE_KEY
    );
    return hierarchyList;
  }

  async fetchBoundaryById(
    globalId: string
  ): Promise<GeoJsonBoundaryWithIndicators> {
    const ret: GeoJsonBoundaryWithIndicators =
      (await this.vectorLayerService._db.all_boundary__polygon.get(globalId))!;
    return ret;
  }

  /*
    This is meant if there is a change (such as changing inhabited which alters computed population,
    and we need to update the boundary data.

    Once the user sync's, boundary indicators will be re-computed server side, and the version out of date
    logic in fetchBoundaryDataIfNeeded should fetch a fresh copy of this data
    */
  async updateBoundaryById(
    globalId: string,
    updatedBoundaryData: GeoJsonBoundaryWithIndicators
  ): Promise<string> {
    return this.vectorLayerService._db.all_boundary__polygon.put(
      updatedBoundaryData,
      globalId
    );
  }

  /**
   * This is the method to take a boundary (NGA a ward) offline
   * @param boundaryGlobalId
   */
  async handleTakeBoundaryOffline(boundaryId: string): Promise<void> {
    const offlineBoundaries = await this.getAllOfflineBoundaries();
    const currentOfflineCount = offlineBoundaries.size;

    if (currentOfflineCount >= 2) {
      this.confirmationService.confirm({
        message: `There are currently ${currentOfflineCount} boundaries checked out.  Please note that performance can degrade if too many boundaries are checked out.  It is also encouraged to limit the number of boundaries being edited.  Do you still wish to continue?  Note you can also remove offline data for boundaries that are no longer being used.`,
        showRejectButton: true,
        accept: async () => {
          await this.handleTakeBoundaryOfflineConfirmed(boundaryId);
        },
      });
    } else {
      await this.handleTakeBoundaryOfflineConfirmed(boundaryId);
    }
  }

  private async handleTakeBoundaryOfflineConfirmed(
    boundaryId: string
  ): Promise<void> {
    this.cancelService.resetCancel();

    this.isLoadingService.setLoading(true);

    try {
      if (!this.isOnlineService.isOnline()) {
        throw new Error('You are offline');
      }

      await this.cancelService.retry(async () => {
        await this.userContextService.addServerLogMessage(
          'Take Offline Start',
          {
            boundaryId: boundaryId,
          }
        );

        //The last version id could be retrieved from the server, but in the case of many commits it may not be accurate
        //Better would be to include this in the reply, and make checkout / checkin atomic operations
        this.userActionLogService.addUserActionDescription(
          `Take Offline Start for [${boundaryId}]`
        );
      });

      this.isLoadingService.setProgressBarInfo(
        'Taking boundary offline...',
        1,
        true
      );

      // refresh token is unnecessary refresh token on each browser reload to make sure that user is not logged off when being long time offline
      // await this.authService.refreshToken(false);
      const success = await this.takeBoundaryOffline(boundaryId);

      //this.isOffline[he3.global_id] = success;
      this.logger.info(
        `Taking boundary offline success: ${success}`,
        boundaryId
      );

      await this.cancelService.retry(async () => {
        await this.userContextService.addServerLogMessage(
          'Take Offline Success',
          {
            boundaryId: boundaryId,
          }
        );

        this.userActionLogService.addUserActionDescription(
          `Take Offline Success for [${boundaryId}]`
        );
      });
    } catch (error) {
      this.logger.error(error);

      const messageServiceArg: MessageType = {
        summary: 'Error downloading this data',
        detail: error.error,
        severity: 'error',
      };
      this.messageService.add(messageServiceArg);

      this.cancelService.retry(async () => {
        await this.userContextService.addServerLogMessage(
          'Take Offline Failure',
          {
            boundaryId: boundaryId,
            messageServiceArg,
          }
        );
      });
    } finally {
      this.isLoadingService.setLoading(false);
    }
  }

  private async takeBoundaryOffline(
    boundaryGlobalId: string
  ): Promise<boolean> {
    //Important to call before initSurroundingBoundaryGuids since it is assumed _db.is_offline has not yet been set
    await this.vectorLayerService.initSurroundingBoundaryGuids(
      boundaryGlobalId
    );

    const sb = await this.vectorLayerService.getSurroundingBoundaryGuids(
      boundaryGlobalId
    );

    let progressPercentage = 5;
    const progressEndVectorData = 70;

    this.isLoadingService.setProgressBarInfo(
      'Refreshing catchment data...',
      progressPercentage,
      true
    );

    await this.indicatorService.refreshCatchments(
      sb.surrounding_boundary_guids
    );

    this.isLoadingService.setProgressBarInfo(
      'Saving permissions to db...',
      10,
      true
    );
    await this.vectorLayerService.savePermissionsToIndexDb();

    progressPercentage = 15;

    this.isLoadingService.setProgressBarInfo(
      'Fetching vector data...',
      progressPercentage,
      true
    );
    const promiseList: Array<Promise<unknown>> = [];

    const progressStepFetchData =
      (progressEndVectorData - progressPercentage) / ALL_VECTOR_LAYERS.length;

    for (const lyr of ALL_VECTOR_LAYERS) {
      promiseList.push(
        this.vectorLayerService.fetchData(lyr, boundaryGlobalId)
      );

      progressPercentage += progressStepFetchData;

      this.isLoadingService.setProgressBarInfo(null, progressPercentage, true);
    }

    await Promise.all(promiseList);
    this.isLoadingService.setProgressBarInfo(
      'Fetch boundary info...',
      progressEndVectorData,
      true
    );

    //Wait until fetch data is done since we need boundaries
    const boundaryInfo = await this.fetchBoundaryInfo(
      boundaryGlobalId,
      this.vectorLayerService.getCurrentObsValue('boundary__polygon')
        .with_crud_applied as Array<GeoJsonBoundary>
    );

    this.logger.info('Boundary info before fetchRasters', boundaryInfo);

    this.isLoadingService.setProgressBarInfo('Fetching rasters...', 80, true);

    //Fetch rasters as well, only the same level as the requested one
    await this.vectorLayerService.fetchRasters(
      boundaryInfo.surroundingBoundaryList.filter(
        (b) => b.properties.level == boundaryInfo.boundary.properties.level
      )
    );

    await this.vectorLayerService._db.is_offline.put(true, boundaryGlobalId);
    this.isLoadingService.setProgressBarInfo(
      'Caching vector tiles...',
      90,
      true
    );

    await this.cacheVectorTileForBoundary(
      boundaryInfo.boundary,
      this.vectorLayerService.getBasemapVectorTileLayer()
    );

    this.isLoadingService.setProgressBarInfo(null, 100, true);
    this.vectorLayerService.offlineBoundariesChanged.next(true);

    return true;
  }

  private async cacheVectorTileForBoundary(
    boundary: GeoJsonBoundary,
    osm_layer: VectorTileLayer
  ) {
    // if ( (boundary.properties as unknown as object)["is_gva"] ) {
    //     console.log(`Not caching mb tiles`);
    //     return;
    // }

    const extent3857 = bbox(toMercator(boundary));

    const urls: string[] = [];
    for (let zoomlevel of [10, 11, 12, 13, 14].values()) {
      // const osm_zoomlevel = osm_resolutions.indexOf(all_resolutions[zoomlevel]);
      osm_layer!
        .getSource()!
        .getTileGrid()!
        .forEachTileCoord(extent3857 as Extent, zoomlevel, (coordinates) => {
          const [z, x, y] = coordinates;
          // console.log("[z,x,y] :",[z,x,y]);
          urls.push(
            AppConfigService.conf.api_url + '/mbtile/' + z + '/' + x + '/' + y
          );
        });
      console.log(
        `caching ${urls.length} map tiles for zoom level ${zoomlevel}`
      );
    }
    // console.log("urls :", urls);
    const start = Date.now();
    const fetchs: Promise<ArrayBuffer | undefined>[] = [];
    urls.forEach((url) => {
      fetchs.push(this.urlRequestCacheService.getOrFetch(url));
    });
    try {
      await Promise.all(fetchs);
    } catch (err) {
      this.logger.error(`Unable to fetch mbtiles: ${err}`);
    }
    console.log('urlRequestCacheService duration: ', Date.now() - start);
  }

  /**
   * Get the simplified polygons boundary data for the entire country
   * Is cached in local db
   *
   * Note this is not the data in the boundary selection, that is fetchHierarchyList
   * @param levels
   * @param boundary_id
   * @private
   */
  private async fetchBoundaryDataIfNeeded(): Promise<boolean> {
    // Make sure we are initialized
    await firstValueFrom(
      this.vectorLayerService._isInitialized.pipe(
        filter((v) => v),
        first()
      )
    );

    // Use the last fetched data for boundaries with a special guid
    const lastFetched = await this.vectorLayerService._db.last_fetched.get(
      'boundary__polygon'
    );

    if (
      lastFetched &&
      ALL_BOUNDARIES_GUID in lastFetched &&
      !(await this.vectorLayerService.isVersionOutOfDate(
        lastFetched[ALL_BOUNDARIES_GUID]
      ))
    ) {
      console.log(
        `fetchBoundaryDataIfNeeded: Already fetched All boundaries and not out of date`,
        lastFetched
      );
      //The observable should already have been seeded with setInitialIndexDbValues
      return false;
    }

    if (lastFetched) {
      if (ALL_BOUNDARIES_GUID in lastFetched) {
        if (
          !(await this.vectorLayerService.isVersionOutOfDate(
            lastFetched[ALL_BOUNDARIES_GUID]
          ))
        ) {
          console.log(
            `Already fetched All boundaries and not out of date`,
            lastFetched
          );
          //The observable should already have been seeded with setInitialIndexDbValues
          return false;
        } else {
          console.log('fetchBoundaryDataIfNeeded: version is out of date');
        }
      } else {
        console.log(
          'fetchBoundaryDataIfNeeded: allBoundariesGuid not in lastFetched'
        );
      }
    } else {
      console.log('fetchBoundaryDataIfNeeded: lastFetched is false');
    }
    this.logger.info(`${AppConfigService.conf.api_url}/get_boundaries`);
    const httpData = await firstValueFrom(
      this.http.get<GeoJsonList>(
        `${AppConfigService.conf.api_url}/get_boundaries`
      )
    );

    if (!httpData) {
      //http errors are intercepted so this can be null if the http call fails
      throw new Error('Http fetch failed to get boundaries');
    }
    //console.log(`Service got API response for ${schema_name}.${table_name}`, httpData);

    //save it first in indexdb
    //Note that if the data has already been fetched, this will overwrite the item
    //this is based on the fact the key is the global_id
    await this.vectorLayerService._db.all_boundary__polygon.clear();
    const httpList = httpData.list as Array<GeoJsonBoundaryWithIndicators>;

    //This can silently fail
    if (!httpList) {
      throw new Error('Boundary fetch failed');
    }

    await this.vectorLayerService._db.all_boundary__polygon.bulkPut(httpList);

    // And store the last fetched per level
    const lastFetchedData: LastFetched =
      (await this.vectorLayerService._db.last_fetched.get(
        'boundary__polygon'
      )) || {};
    lastFetchedData[ALL_BOUNDARIES_GUID] = httpData.version;

    await this.vectorLayerService._db.last_fetched.put(
      lastFetchedData,
      'boundary__polygon'
    );

    this.vectorLayerService.allBoundaryData = httpList;

    this.vectorLayerService.allBoundaryMap = buildMap(
      this.vectorLayerService.allBoundaryData
    );

    return true;
  }
}
