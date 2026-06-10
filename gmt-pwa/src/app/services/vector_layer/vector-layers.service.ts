import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { CancelService } from '@services/cancel.service';
import { exportDB, importInto } from 'dexie-export-import';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import cloneDeep from 'lodash/cloneDeep';
import { NGXLogger } from 'ngx-logger';
import { MVT } from 'ol/format';
import VectorTileLayer from 'ol/layer/VectorTile';
import { BehaviorSubject, firstValueFrom, Observable, of, Subject } from 'rxjs';
import { filter, first } from 'rxjs/operators';
import { VectorLayerServiceInterface } from 'src/app/services/interfaces/vector-layer.service.interface';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { IsOnlineService } from 'src/app/services/is-online.service';
import { RasterDataService } from 'src/app/services/raster-data.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UrlRequestCacheService } from 'src/app/services/url-request-cache.service';
import { UserService } from 'src/app/services/user/user.service';
import { ALL_BOUNDARIES_GUID } from 'src/app/services/vector_layer/boundary-layer.service';
import {
  applyCrudOperations,
  LastFetched,
  VectorLayerDatabase,
} from 'src/app/services/vector_layer/VectorLayerDatabase';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { buildMap } from 'src/app/utils/container';
import { saveFileName } from 'src/app/utils/export/pdf';
import { CrudAction } from 'src/app/utils/server-interfaces/CrudAction';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonBoundaryWithIndicators,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonList,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  JobStatusResponse,
  JobStatusState,
} from 'src/app/utils/server-interfaces/JobStatus';
import { PermissionsResponse } from 'src/app/utils/server-interfaces/PermissionsResponse';
import { SurroundingBoundaries } from 'src/app/utils/server-interfaces/SurroundingBoundaries';
import {
  ALL_VECTOR_LAYERS,
  BOUNDARY_EDITED_LAYER,
  UPDATABLE_VECTOR_LAYERS,
  VectorLayerName,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { CachedVectorTile } from 'src/app/_shared/map/layer/CachedVectorTile';



export interface ILayerIdentity {
  schema_name: string;
  table_name: string;
}

export interface LayerData {
  server_version: Array<GeoJsonBase>;
  with_crud_applied: Array<GeoJsonBase>;
  crud_actions: Array<CrudAction>;
}

export interface BoundaryInfo {
  surroundingBoundaryList: Array<GeoJsonBoundary>;
  boundary: GeoJsonBoundary;
  surroundingBoundaryIds: Set<string>;
}

export interface BoundaryEditedInfo {
  surroundingBoundaryList: Array<GeoJsonBoundaryEdited>;
  boundary: GeoJsonBoundaryEdited;
  surroundingBoundaryIds: Set<string>;
}

@Injectable({
  providedIn: 'root',
})
export class VectorLayerService implements VectorLayerServiceInterface {
  //BehaviorSubjects will always emit the latest/current value on new subscribers
  private _dataStreams: Map<VectorLayerName, BehaviorSubject<LayerData>> =
    new Map<VectorLayerName, BehaviorSubject<LayerData>>();
  // DB and other methods are public because they has to be shared with crud-layer.service, boundary-layer.service and
  // permissions-layer.service. While using "extend" I could leave these as protected but then VectorLayerService
  // is not initialized as singleton and cases like checking _needSync when _needSync is updated in child class - fails
  public _db: VectorLayerDatabase;

  //Is this service initialized?  Meaning the initial data has been read from indexdb
  public _isInitialized = new BehaviorSubject<boolean>(false);

  // Do we have any CRUD actions -or- any offline data is out of date?
  public _needSync = new BehaviorSubject<boolean>(false);

  public allBoundaryData: Array<GeoJsonBoundaryWithIndicators> = [];
  public allBoundaryMap = new Map<string, GeoJsonBoundary>();

  public latestVersionLastCall: number = 0;
  public currentVersion: number = 0;

  private _permissions: BehaviorSubject<PermissionsResponse> =
    new BehaviorSubject<PermissionsResponse>({
      permissions: {},
      geo_permissions: [],
    });
  public offlineBoundariesChanged = new Subject<boolean>();

  constructor(
    private http: HttpClient,
    private rasterDataService: RasterDataService,
    private userService: UserService,
    private messageService: MessageService,
    private isOnlineService: IsOnlineService,
    private urlRequestCacheService: UrlRequestCacheService,
    private isLoadingService: IsLoadingService,
    private logger: NGXLogger,
    private cancelService: CancelService
  ) {
    this._db = new VectorLayerDatabase();
    ALL_VECTOR_LAYERS.forEach((storeName) => {
      //Seed the behavior subjects with indexdb db data
      this._dataStreams.set(
        storeName,
        new BehaviorSubject<LayerData>({
          crud_actions: [],
          server_version: [],
          with_crud_applied: [],
        })
      );
    });

    this.setInitialIndexDbValues().then(() => {
      this.logger.info(
        'Finished initializing stream values with current IndexDB data'
      );
      this._isInitialized.next(true);
    });
  }

  isInitialized(): Observable<boolean> {
    return this._isInitialized.asObservable();
  }

  async isVersionOutOfDate(versionToCheck: number): Promise<boolean> {
    if (!this.isOnlineService.isOnline()) {
      return false;
    }

    //handle unexpected input
    if (!Number.isSafeInteger(versionToCheck) || versionToCheck < 0) {
      return false;
    }

    const currentVersion = await this.getCurrentVersion();
    return versionToCheck < currentVersion;
  }

  public async resetDataStreams() {
    for (const storeName of ALL_VECTOR_LAYERS) {
      const initialData: Array<GeoJsonBase> = await this._db[
        storeName
      ].toArray();

      const storeCrudOps = await this._db.crud_actions
        .where({ changed_layer: storeName })
        .toArray();
      this.setDataStream(
        storeName,
        initialData,
        storeCrudOps,
        applyCrudOperations(initialData, storeCrudOps, this.logger)
      );
    }
  }

  private async setInitialIndexDbValues() {
    // we need every small crud for undo redo actions - this will be executed before submitting cruds to the server
    //await this.removeOlderDuplicateCruds();
    await this.resetDataStreams();

    //Handle all boundaries
    this.allBoundaryData = await this._db.all_boundary__polygon.toArray();
    this.allBoundaryMap = buildMap(this.allBoundaryData);
  }

  public async fetchRasters(
    boundaryList: Array<GeoJsonBoundary>
  ): Promise<boolean> {
    this.rasterDataService.clearLruCache();

    const promiseList: Array<Promise<unknown>> = [];

    this.logger.info(`fetchRasters ${boundaryList.length}`);
    for (const boundary of boundaryList) {
      if (AppConfigService.calculateTravelTime) {
        promiseList.push(
          this.rasterDataService.fetchFrictionRasterIfNeeded(boundary, false)
        );
        promiseList.push(
          this.rasterDataService.fetchFrictionRasterIfNeeded(boundary, true)
        );
      }
      promiseList.push(this.rasterDataService.fetchPopRasterIfNeeded(boundary));
    }

    await Promise.all(promiseList);

    return true;
  }

  /*
    Note this is for debugging only.  The values should be fetched from the observables
     */
  getCurrentObsValue(layer: VectorLayerName): LayerData {
    return this._dataStreams.get(layer)!.value;
  }

  public getBasemapVectorTileLayer() {
    return new VectorTileLayer({
      declutter: true,
      // source: new VectorTile({
      source: new CachedVectorTile(
        {
          url: AppConfigService.conf.api_url + '/mbtile/{z}/{x}/{y}',
          maxZoom: 14,
          format: new MVT(),
        },
        this.urlRequestCacheService
      ),
    });
  }

  /*
      For the given boundary code, fetch the layer data.

      This will fetch the data for the surrounding boundaries as well and store it in IndexDB

      If the data is already in IndexDB, no http call is made

      Data is returned via the observables in get_observable
      True means data was fetched via http
       */
  async fetchData(
    layerID: VectorLayerName,
    boundary_global_id: string
  ): Promise<boolean> {
    const surroundingBoundaries = await this.getSurroundingBoundaryGuids(
      boundary_global_id
    );

    return this.fetchDataForBoundaries(
      layerID,
      surroundingBoundaries.surrounding_boundary_guids,
      false
    );
  }

  /**
   * Makes 1 http request per layer with the given boundary ids.
   * @param layerID
   * @param boundaryIdsToFetch boundary ids to fetch, can be any level
   * @param isFullFetch if true, we are fetching for all wards, done during sync
   * @private
   */
  private async fetchDataForBoundaries(
    layerID: VectorLayerName,
    boundaryIdsToFetch: Array<string>,
    isFullFetch: boolean
  ): Promise<boolean> {

    //Make sure we are initialized
    await firstValueFrom(
      this._isInitialized.pipe(
        filter((v) => v),
        first()
      )
    );

    const bs = this._dataStreams.get(layerID)!;

    //Does IndexDB have this store already?
    const storeName: VectorLayerName = layerID;

    //Probably don't need this check, since the store name is checked with types
    const storeNames = this._db.tables.map((t) => t.name);

    if (!storeNames.includes(storeName)) {
      this.logger.error(`Cannot find store "${storeName}"`);
      return false;
    }

    //Was the last fetched from this same boundary_code?
    const lastFetched = await this._db.last_fetched.get(layerID);

    const outofDateBoundaryIds: Array<string> = [];

    for (const boundaryGuid of boundaryIdsToFetch) {
      if (
        lastFetched &&
        boundaryGuid in lastFetched &&
        !(await this.isVersionOutOfDate(lastFetched[boundaryGuid]))
      ) {
        //The observable should already have been seeded with setInitialIndexDbValues
        continue;
      }

      outofDateBoundaryIds.push(boundaryGuid);
    }

    this.logger.info(
      `fetchDataForBoundaries requested update for ${outofDateBoundaryIds.length} boundaries for layer ${layerID} need update for ${outofDateBoundaryIds.length}`
    );

    if (outofDateBoundaryIds.length <= 0) {
      return false;
    }
    //const count = await this._db[storeName].count();

    //this.logger.info(`IndexDB count for ${storeName} is ${count}`);

    let [schema_name, table_name] = layerID.split('__');

    //This happens async
    let params = new HttpParams()
      .set('schema_name', schema_name)
      .set('table_name', table_name);

    this.logger.info(
      `fetchDataForBoundaries http get_latest_version ${outofDateBoundaryIds.length} boundaries for layer ${layerID} `
    );

    //Fetch from http, then store in indexdb, and retrieve from indexdb
    //Fetch all boundary codes at once
    this.logger.info(
      `${AppConfigService.conf.api_url}/get_latest_version`,
      outofDateBoundaryIds
    );
    const httpData = await this.cancelService.doPost<GeoJsonList>(
      `${AppConfigService.conf.api_url}/get_latest_version`,
      outofDateBoundaryIds,
      params
    );

    //error interceptor will catch any 500s
    if (!httpData) {
      throw new Error(`Could not fetch data for ${schema_name}.${table_name}`);
    }

    this.logger.info(
      `fetchDataForBoundaries http get_latest_version ${outofDateBoundaryIds.length} boundaries for layer ${layerID} FINISHED `
    );

    //this.logger.info(`Service got API response for ${schema_name}.${table_name}`, httpData);

    if (isFullFetch) {
      await this._db[storeName].clear();
    } else {
      let indexToUse = this.checkBoundaryIdColumnByLayerName(storeName);
      const toRemoveCollection = await this._db[storeName]
        .where(indexToUse)
        .anyOf(outofDateBoundaryIds)
        .primaryKeys();

      console.log(
        `fetchDataForBoundaries bulk delete ${outofDateBoundaryIds.length} boundaries for layer ${layerID}  `
      );

      //Clear any existing entries, as we may have deletions
      await this._db[storeName].bulkDelete(toRemoveCollection);
    }
    //save it first in indexdb
    //Note that if the data has already been fetched, this will overwrite the item
    //this is based on the fact the key is the global_id

    console.log(
      `fetchDataForBoundaries bulk put ${outofDateBoundaryIds.length} boundaries for layer ${layerID}  `
    );

    //Painful...
    if (storeName == 'boundary__polygon') {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonBoundary>
      );
    } else if (storeName == 'settlement__part') {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonSettlementPart>
      );
    } else if (storeName == 'settlement__name') {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonSettlementName>
      );
    } else if (storeName == 'ri__catchment_item') {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonCatchmentItem>
      );
    } else if (storeName == 'health_facility__point') {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonHealthFacility>
      );
    } else if (storeName == BOUNDARY_EDITED_LAYER) {
      await this._db[storeName].bulkPut(
        httpData.list as Array<GeoJsonBoundaryEdited>
      );
    } else {
      await this._db[storeName].bulkPut(httpData.list as Array<GeoJsonBase>);
    }

    console.log(
      `fetchDataForBoundaries last fetched ${outofDateBoundaryIds.length} boundaries for layer ${layerID}  `
    );

    //And store the last fetched
    const lastFetchedData: LastFetched =
      (await this._db.last_fetched.get(storeName)) || {};

    for (const bId of outofDateBoundaryIds) {
      lastFetchedData[bId] = httpData.version;
    }

    await this._db.last_fetched.put(lastFetchedData, storeName);

    //We also do a check to see if there is any stale data in last fetched
    for (const ver of Object.values(lastFetchedData)) {
      if (ver != httpData.version) {
        console.log(
          `Out of date data detected!  Just fetched ${httpData.version} but have ${ver}`
        );
        this._needSync.next(true);
      }
    }

    console.log(
      `fetchDataForBoundaries update observables ${outofDateBoundaryIds.length} boundaries for layer ${layerID}  `
    );

    const indexDbData: Array<GeoJsonBase> = await this._db[storeName].toArray();

    bs.next({
      crud_actions: bs.value.crud_actions,
      server_version: indexDbData,
      with_crud_applied: applyCrudOperations(
        indexDbData,
        bs.value.crud_actions,
        this.logger
      ),
    });

    console.log(
      `fetchDataForBoundaries done ${outofDateBoundaryIds.length} boundaries for layer ${layerID}  `
    );

    return true;
  }

  async getCurrentVersion(): Promise<number> {
    //Throttle to once every 2 minutes
    const twoMinutesMs = 2 * 60 * 100;
    const curTime = Date.now();

    //console.log(`getCurrentVersion curTime ${curTime} latestVersionLastCall ${this.latestVersionLastCall} curTime - twoMinutesMs ${curTime - twoMinutesMs}`)

    if (curTime - twoMinutesMs < this.latestVersionLastCall) {
      //console.log(`getCurrentVersion returning cached version ${this.currentVersion}`);
      return this.currentVersion;
    }
    this.logger.info(`${AppConfigService.conf.api_url}/get_current_version_id`);
    this.currentVersion = (await firstValueFrom(
      this.http.get<number>(
        `${AppConfigService.conf.api_url}/get_current_version_id`
      )
    ))!;
    this.latestVersionLastCall = Date.now();

    console.log(
      `getCurrentVersion called http version: ${this.currentVersion}`
    );

    return this.currentVersion;
  }

  async getLastFetched(layer: VectorLayerName): Promise<LastFetched> {
    return (await this._db.last_fetched.get(layer)) || {};
  }

  async savePermissionsToIndexDb(): Promise<void> {
    let permissions: PermissionsResponse = (await this.userService
      .getPermissions()
      .toPromise())!;

    //The above http call can fail, leaving this empty
    if (!permissions) {
      return;
    }
    await this._db.permissions?.clear();
    await this._db.permissions.put(permissions, 'permissions');
    this._permissions.next(permissions);
  }

  getPermissionsObservable(): Observable<PermissionsResponse> {
    return this._permissions.asObservable();
  }
  /**
   * Used when checking out a ward to init the surrounding boundary ids
   */
  async initSurroundingBoundaryGuids(
    boundaryId: string,
    updateSurroundingBoudaries: boolean = true
  ): Promise<SurroundingBoundaries> {
    //This happens async
    let params = new HttpParams().set('boundaryId', boundaryId);

    //Fetch from http, then store in indexdb, and retrieve from indexdb
    this.logger.info(
      `${AppConfigService.conf.api_url}/get_surrounding_boundaries`,
      params
    );
    const boundaryData = await this.http
      .get<SurroundingBoundaries>(
        `${AppConfigService.conf.api_url}/get_surrounding_boundaries`,
        { params }
      )
      .toPromise();
    console.log('Service got boundary API response', boundaryData);

    if (!boundaryData || !boundaryId) {
      //http errors are intercepted so this can be null if the http call fails
      throw new Error('Http fetch failed to get surrounding boundaries');
    }
    if (updateSurroundingBoudaries) {
      //We want to have the default surrounding boundaries set for the non offline wards be the same as the offline one
      //Said another way, if i checkout ward A, which is surrounded by ward B, C, D
      //I want the surrounding boundaries of ward B, C, D to default to those of ward A
      //Note that this is an approximation, and of course is wrong for boundary ids of different levels (which aren't
      //used so it's OK).  This is to avoid needing to call get_surrounding_boundaries for all the surrounding_boundaries
      //This is just to have the filters work more or less ok.  And also, we only have this data so it wouldn't help
      //much for this list to be correct
      const offlineKeys = await this._db.is_offline
        .toCollection()
        .primaryKeys();
      const offlineSet = new Set<string>(offlineKeys);

      for (const bId of boundaryData.surrounding_boundary_guids) {
        //Note when this method is called, the boundary we are checking out has not yet
        //been set in _db.is_offline
        if (offlineSet.has(bId)) {
          continue;
        }
        const bData = cloneDeep(boundaryData);
        bData.boundary_guid = bId;
        await this._db.surrounding_boundary.put(bData, bId);
      }
    }
    this.logger.info('Saved in index db', boundaryData);

    return boundaryData;
  }

  /**
     * Returns a list of boundary guids that surround boundary_code
     * This list includes boundaries of all levels and includes the boundary referred to by the code

     * @param boundaryId
     */
  async getSurroundingBoundaryGuids(
    boundaryId: string
  ): Promise<SurroundingBoundaries> {
    // If we have offline data, use it.
    const boundaryData = await this._db.surrounding_boundary.get(boundaryId);

    if (!boundaryData) {
      //this can be normal if called for a boundary that is not offline
      return {
        boundary_guid: boundaryId,
        surrounding_boundary_guids: [boundaryId],
        version: 0,
      };
    }

    return boundaryData;
  }

  /*
    Removes all offline/indexdb data related to the given boundary code
     */
  async removeOfflineBoundary(boundaryId: string): Promise<boolean> {
    //const boundaryIds = await this._db.surrounding_boundary.toCollection().primaryKeys();
    const isOffline = await this._db.is_offline.get(boundaryId);

    //this implies we don't have the offline boundary data for the given id
    if (!isOffline) {
      return false;
    }

    this.isLoadingService.setProgressBarInfo(null, 20, true);

    console.log(`Removing offline surrounding boundaries for ${boundaryId}`);

    this.isLoadingService.setProgressBarInfo(null, 40, true);

    // we don't want to delete from _db.is_offline until it the data has been deleted so we add exclusion for the boundaryId
    const offlineBoundariesSet = await this.getOfflineBoundaryIdSet(
      true,
      boundaryId
    );

    for (const store of ALL_VECTOR_LAYERS) {
      //It's faster to do the filtering manually

      //console.log(`Fetching current data from ${store}`);
      const currentData = await this._db[store].toArray();

      const toDelete: Array<string> = [];

      for (const item of currentData) {
        const id =
          store == 'boundary__polygon'
            ? item.properties.global_id
            : item.properties.boundary_polygon;
        if (!offlineBoundariesSet.has(id)) {
          toDelete.push(item.properties.global_id);
          continue;
        }
      }

      const beforeCount = currentData.length;
      const afterCount = currentData.length - toDelete.length;

      await this._db[store].bulkDelete(toDelete);

      console.log(
        `Removing from ${store} actually deleted ${
          beforeCount - afterCount
        }, ${afterCount} left`
      );

      await this.updateLastFetchedDate(store, offlineBoundariesSet);
    }

    //Remove pop rasters
    await this.rasterDataService.keepOnly(offlineBoundariesSet);

    //Now remove the surrounding boundaries
    const surroundingBoundaryKeys = await this._db.surrounding_boundary
      .toCollection()
      .primaryKeys();
    const surroundingBoundaryKeysToDelete = surroundingBoundaryKeys.filter(
      (boundaryId) => !offlineBoundariesSet.has(boundaryId)
    );
    await this._db.surrounding_boundary.bulkDelete(
      surroundingBoundaryKeysToDelete
    );

    await this._db.is_offline.delete(boundaryId);
    this.offlineBoundariesChanged.next(true);
    return true;
  }

  private async updateLastFetchedDate(
    store: VectorLayerName,
    updatedBoundaryGuids: Set<string>
  ): Promise<void> {
    const lastFetchedData: LastFetched =
      (await this._db.last_fetched.get(store)) || {};

    const newLastFetchedData: LastFetched = {};
    for (const boundaryId in lastFetchedData) {
      if (!updatedBoundaryGuids.has(boundaryId)) {
        continue;
      }
      newLastFetchedData[boundaryId] = lastFetchedData[boundaryId];
    }
    await this._db.last_fetched.put(newLastFetchedData, store);
  }

  async clearAll() {
    for (let t of this._db.tables) {
      await t.clear();
    }
  }

  getSubmitEditsJobStatus(jobId: number): Observable<JobStatusResponse> {
    //Special case, if the jobId is -1, then it is because there are no Crud actions to submit, and we are done
    if (jobId < 0) {
      return of({
        state: JobStatusState.completed,
        progress: 100,
      });
    }
    this.logger.info(
      `${AppConfigService.conf.api_url}/submitEditsJob/${jobId}`
    );
    return this.http.get<JobStatusResponse>(
      `${AppConfigService.conf.api_url}/submitEditsJob/${jobId}`,
      {}
    );
  }

  async getOfflineBoundaryIdSet(
    includeSurroundingBoundaries: boolean,
    excludeBoundaryId: string = ''
  ): Promise<Set<string>> {
    const offlineBoundariesSet = new Set<string>();
    const allOfflineBoundaries = await this._db.is_offline
      .toCollection()
      .primaryKeys();

    for (const boundaryId of allOfflineBoundaries) {
      if (!boundaryId || boundaryId == excludeBoundaryId) {
        continue;
      }

      offlineBoundariesSet.add(boundaryId);

      //We also want to include any surrounding boundaries
      if (includeSurroundingBoundaries) {
        const surroundingBoundaries = await this.getSurroundingBoundaryGuids(
          boundaryId
        );
        surroundingBoundaries.surrounding_boundary_guids.forEach((b) =>
          offlineBoundariesSet.add(b)
        );
      }
    }

    //This is added since ALL_BOUNDARIES_GUID is a special placeholder
    //to indicate the simplified polygons for the progress map / boundary map
    //and we don't want it to be purged
    offlineBoundariesSet.add(ALL_BOUNDARIES_GUID);

    return offlineBoundariesSet;
  }

  /**
   * Called as part of the sync, so the progress % / progress text are assumed to be handled by the caller
   * @param onlyUpdatable
   */
  async refreshOfflineData(onlyUpdatable: boolean): Promise<boolean> {
    //We want to also fetch the current server version
    this.latestVersionLastCall = 0;

    //get all boundaries we have offline
    const offlineBoundariesSet = await this.getOfflineBoundaryIdSet(true);

    let vectorsToUpdate = onlyUpdatable
      ? UPDATABLE_VECTOR_LAYERS
      : ALL_VECTOR_LAYERS;

    for (const [i, layerName] of vectorsToUpdate.entries()) {
      this.logger.debug(
        `Refreshing offline data for layer #${i}: ${layerName}`
      );
      await this.fetchDataForBoundaries(
        layerName,
        Array.from(offlineBoundariesSet),
        true
      );
    }
    //console.log(`Refresh offline data finished`);
    return true;
  }

  getVectorLayerObservable(layer: VectorLayerName): Observable<LayerData> {
    return this._dataStreams.get(layer)!.asObservable();
  }

  /**
   * To keep _dataStreams as private property, just set _dataStreams for specific layer
   * @param layer
   * @param server_version
   * @param crud_actions
   * @param with_crud_applied
   */
  setDataStream(
    layer: VectorLayerName,
    server_version: GeoJsonBase[],
    crud_actions: CrudAction[],
    with_crud_applied: GeoJsonBase[]
  ): void {
    this._dataStreams.get(layer)!.next({
      server_version,
      crud_actions,
      with_crud_applied,
    });
  }

  /**
   * Backup IndexedDB to binary file that could be restored
   */
  async backupIndexedDb(): Promise<Blob> {
    console.log('Backing up vector IndexedDB');
    const zip = new JSZip();
    const timestamp = new Date(Date.now()).toISOString();
    zip.file(
      saveFileName('raster_data.indexeddb'),
      await this.rasterDataService.exportDb()
    );
    // console.log("Starting vector data backup");
    const exportedVectorData = await exportDB(this._db);
    zip.file(saveFileName('vector_data.indexeddb'), exportedVectorData);
    console.log('Starting to create zip');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    console.log('Zip blob is created');
    const zipFilename = saveFileName(`GMT data backup ${timestamp}.zip`);
    saveAs(zipBlob, zipFilename);

    console.log('IndexedDB backup is created');
    // return {filename: zipFilename, blob: zipBlob};
    return exportedVectorData;
  }

  /**
   * Restore vector and raster IndexedDB from zip file.
   * !!! Important - it will delete any existing changes now in the database
   * @param file
   */
  async restoreIndexedDbFromZip(file: Blob): Promise<void> {
    this.isLoadingService.setLoading(true);
    let zip = new JSZip();

    let contents = await zip.loadAsync(file);
    console.log(Object.keys(contents.files), 'Object.keys(contents.files)');
    if (contents.files['vector_data.indexeddb']) {
      let vectorDataFile = zip.file('vector_data.indexeddb');
      if (vectorDataFile) {
        let vectorDataBlob = await Promise.resolve(
          vectorDataFile.async('blob')
        );
        if (vectorDataBlob) {
          console.log(
            'Restoring vector IndexedDB',
            typeof vectorDataBlob,
            vectorDataBlob.size
          );
          await this.clearAll();
          await importInto(this._db, vectorDataBlob);
          console.log('Vector IndexedDB is restored');
        }
      }
      let rasterDataFile = zip.file('raster_data.indexeddb');
      if (rasterDataFile) {
        let rasterDataBlob = await Promise.resolve(
          rasterDataFile.async('blob')
        );
        if (rasterDataBlob) {
          await this.rasterDataService.restoreIndexedDb(rasterDataBlob);
        }
      }
    } else {
      console.log(
        'Vector data file in the zip file was not found so vector data is not restored'
      );
    }

    console.log('IndexedDB is restored');
    this.isLoadingService.setLoading(false);
  }

  async restoreIndexedDb(vectorDataBlob: Blob): Promise<void> {
    this.isLoadingService.setLoading(true);
    if (vectorDataBlob) {
      console.log(
        'Restoring vector IndexedDB',
        typeof vectorDataBlob,
        vectorDataBlob.size
      );
      await this.clearAll();
      await importInto(this._db, vectorDataBlob);
      console.log('Vector IndexedDB is restored');
    } else {
      console.log(
        'Vector data file in the zip file was not found so vector data is not restored'
      );
    }

    console.log('IndexedDB is restored');
    this.isLoadingService.setLoading(false);
  }

  public updatePermissionsLayer(permissions: PermissionsResponse) {
    if (
      JSON.stringify(this._permissions.value) != JSON.stringify(permissions)
    ) {
      this._permissions.next(permissions as PermissionsResponse);
    }
  }

  private checkBoundaryIdColumnByLayerName(
    vectorLayerName: VectorLayerName
  ): string {
    let indexToUse = 'properties.boundary_polygon';
    if (this.shouldUseGlobalIdForBoundaryReference(vectorLayerName)) {
      //In boundary_polygon, boundary_polygon refers to the boundary parent, but we want to remove those boundaries whose
      //ids match, not those of the boundary parents.
      indexToUse = 'properties.global_id';
    }
    return indexToUse;
  }

  public shouldUseGlobalIdForBoundaryReference(
    vectorLayerName: VectorLayerName
  ): boolean {
    // edited boundary is like a child for boundary table so for boundary_edited table boundary__polygon
    // shows boundary.global_id and not reference to the higher level of the boundary
    if (vectorLayerName == 'boundary__polygon') {
      return true;
    }
    return false;
  }
}
