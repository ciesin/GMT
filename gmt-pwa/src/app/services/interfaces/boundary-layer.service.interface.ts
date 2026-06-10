import {GeoJsonBoundary} from "src/app/utils/server-interfaces/GeoJson";
import {BoundaryInfo} from "src/app/services/vector_layer/vector-layers.service";
import {HierarchyList} from "src/app/utils/server-interfaces/HierarchyList";

export interface BoundaryLayerServiceInterface {
  /**
   * Returns all boundary data or only for specified levels
   * Will fetch the data if it is out of date
   * @param levels
   */
  getBoundaryData(): Promise<Array<GeoJsonBoundary>>;

  /**
   * Note this doesn't take into account surrounding boundaries!
   */
  getAllOfflineBoundaries(): Promise<Set<string>>;

  isBoundaryOffline(boundaryId: string): Promise<boolean>;

  //Note this method doesn't use observables, this is for HF and Settlement pages
  //where we should never have boundary changes coming in or being feteched
  //TODO actually routing changes could in theory touch this, so this should be changed
  //maybe use boundary service instead
  fetchBoundaryInfo(boundaryId: string, boundaryList: Array<GeoJsonBoundary>): Promise<BoundaryInfo>;

  fetchHierarchyList(): Promise<HierarchyList>;

  /**
   * This is the method to take a boundary (NGA a ward) offline
   * @param boundaryGlobalId
   */
  handleTakeBoundaryOffline(boundaryGlobalId: string): Promise<void>;
}
