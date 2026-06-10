import {VectorLayerName} from "../../utils/server-interfaces/VectorLayerName";
import {Observable} from "rxjs";
import {LayerData} from "../vector_layer/vector-layers.service";
import {LastFetched} from "../vector_layer/VectorLayerDatabase";
import {JobStatusResponse} from "src/app/utils/server-interfaces/JobStatus";
import VectorTileLayer from "ol/layer/VectorTile";
import {GeoJsonBase} from "../../utils/server-interfaces/GeoJson";
import {CrudAction} from "../../utils/server-interfaces/CrudAction";
import {SurroundingBoundaries} from "../../utils/server-interfaces/SurroundingBoundaries";


export interface VectorLayerServiceInterface {

  isInitialized(): Observable<boolean>;

  isVersionOutOfDate(versionToCheck: number): Promise<boolean>;

  /*
  Note this is for debugging only.  The values should be fetched from the observables
   */
  getCurrentObsValue(layer: VectorLayerName): LayerData;

  getBasemapVectorTileLayer(): VectorTileLayer;
  /*
    For the given boundary code, fetch the layer data.

    This will fetch the data for the surrounding boundaries as well and store it in IndexDB

    If the data is already in IndexDB, no http call is made

    Data is returned via the observables in get_observable
    True means data was fetched via http
     */
  fetchData(layerID: VectorLayerName, boundary_global_id: string): Promise<boolean>;

  getCurrentVersion(): Promise<number>;

  getLastFetched(layer: VectorLayerName): Promise<LastFetched>;

  savePermissionsToIndexDb(): Promise<void>;

  //Returns a list of boundary guids that surround boundary_code
  //This list includes boundaries of all levels and includes the boundary referred to by the code
  //The code is assumed to be the configured level (so for nigeria, 3 for wards)
  getSurroundingBoundaryGuids(boundaryId: string): Promise<SurroundingBoundaries>;

  /*
  Removes all offline/indexdb data related to the given boundary code
   */
  removeOfflineBoundary(boundaryId: string): Promise<boolean>;

  clearAll(): void;

  // TODO - maybe could be somewhere else as this one is not directly related to vector layer
  getSubmitEditsJobStatus(jobId: number): Observable<JobStatusResponse>;

  // TODO IEVA- recheck 4 methods below
  getBasemapVectorTileLayer(): VectorTileLayer;

  getVectorLayerObservable(layer: VectorLayerName): Observable<LayerData>;

  /**
   * To keep _dataStreams as private property, just set _dataStreams for specific layer
   * @param layer
   * @param server_version
   * @param crud_actions
   * @param with_crud_applied
   */
  setDataStream(layer: VectorLayerName,
                server_version: GeoJsonBase[],
                crud_actions: CrudAction[],
                with_crud_applied: GeoJsonBase[]): void;

  refreshOfflineData(onlyUpdatable: boolean): Promise<boolean>;

  /**
   * Backup IndexedDB to binary file that could be restored
   */
  backupIndexedDb(): Promise<Blob>;

  /**
   * Restore IndexedDB from file.
   * !!! Important - it will delete any existing changes now in the database
   * @param file
   */
  restoreIndexedDb(file: Blob): Promise<void>;
}
