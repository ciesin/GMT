import Dexie from 'dexie';
import { NGXLogger } from 'ngx-logger';
import { CrudAction } from 'src/app/utils/server-interfaces/CrudAction';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonBoundaryWithIndicators,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
} from 'src/app/utils/server-interfaces/GeoJson';
import { PermissionsResponse } from 'src/app/utils/server-interfaces/PermissionsResponse';
import { SurroundingBoundaries } from 'src/app/utils/server-interfaces/SurroundingBoundaries';
import {
  ALL_VECTOR_LAYERS,
  BOUNDARY_EDITED_LAYER,
  VectorLayerName,
} from 'src/app/utils/server-interfaces/VectorLayerName';

//Key for key_value table
export const HIERARCHY_STORAGE_KEY = 'hierarchy_list';
export const AUTO_SYNC_ENABLED = 'auto_sync_enabled';
export const SP_TO_SYNC_LIST = 'sp_to_sync_list';
export const ACTION_LIST = 'action_list';

//map of boundary to last version number fetched
export interface LastFetched {
  [boundary_guid: string]: number;
}

export class VectorLayerDatabase extends Dexie {
  //Definite Assignment Assertion, these are initalized in a loop of ALL_VECTOR_LAYERS
  boundary__polygon!: Dexie.Table<GeoJsonBoundary, string>;
  boundary__polygon_edited!: Dexie.Table<GeoJsonBoundaryEdited, string>;
  //settlement__polygon!: Dexie.Table<GeoJsonBase, string>;
  settlement__part!: Dexie.Table<GeoJsonSettlementPart, string>;
  settlement__name!: Dexie.Table<GeoJsonSettlementName, string>;
  health_facility__point!: Dexie.Table<GeoJsonHealthFacility, string>;

  generic__point!: Dexie.Table<GeoJsonBase, string>;
  generic__line!: Dexie.Table<GeoJsonBase, string>;
  generic__polygon!: Dexie.Table<GeoJsonBase, string>;

  ri__catchment_item!: Dexie.Table<GeoJsonCatchmentItem, string>;

  crud_actions!: Dexie.Table<CrudAction, string>;

  // the same structure as crud_actions just contains all crud_actions that could be "re-done"
  crud_actions_redo!: Dexie.Table<CrudAction, string>;
  // key is just incremental number from 0 and value is actionId that is stored in every crud (related cruds have the same actionId)
  crud_actions_history!: Dexie.Table<string, number>;
  // key is not relevant and value is the key of crud_actions_history (position at which we are in the crud_actions_history)
  crud_actions_history_position!: Dexie.Table<number, number>;

  //key is boundary guid, data is the list of adjacent guids (including the boundary)
  surrounding_boundary: Dexie.Table<SurroundingBoundaries, string>;

  //Used for the State/LGA/ward maps.  Contains all boundary data, potentially simplified polygons
  all_boundary__polygon!: Dexie.Table<GeoJsonBoundaryWithIndicators, string>;

  //key is VectorLayerName, data is LastFetched, which is a map between the boundary guid, and the version fetched for that boundary guid
  //This includes surrounding boundaries, not just the ones in is_offline / taken offline explicitly
  last_fetched: Dexie.Table<LastFetched, VectorLayerName>;

  //Because checking if a boundary is offline needs to be fast, we store a simple boolean.
  //to check this thouroughly, one must verify in last_fetched that all layers are present
  //key is boundary id, value boolean true
  is_offline: Dexie.Table<boolean, string>;

  permissions: Dexie.Table<PermissionsResponse, string>;

  key_value: Dexie.Table<unknown, string>;

  constructor() {
    super('VectorLayerDatabase');

    console.log('Constructing VectorLayerDatabase');

    const store_schema = ALL_VECTOR_LAYERS.reduce(
      (schema_def: any, store_name) => {
        //Primary key is global_id,
        // Also index boundary_polygon is first, so we can search on it
        schema_def[store_name] =
          'properties.global_id, properties.boundary_polygon';
        return schema_def;
      },
      {}
    );

    store_schema['all_boundary__polygon'] =
      'properties.global_id, properties.boundary_polygon';

    //Hidden auto increment key, not in the object
    store_schema['crud_actions'] =
      '++,geojson_after.properties.global_id,actionId,action,changed_layer';
    // actionId is indexed as we use it for better filtering when searching which cruds should be moved to crud_actions
    // table when clicked redo this.vectorLayerService._db.crud_actions_redo.where({actionId: actionId});
    store_schema['crud_actions_redo'] = '++,actionId';
    store_schema['crud_actions_history'] = '++';
    store_schema['crud_actions_history_position'] = '';
    store_schema['surrounding_boundary'] = '';
    store_schema['last_fetched'] = '';
    store_schema['key_value'] = '';
    store_schema['permissions'] = '';
    store_schema['is_offline'] = '';
    //
    // Define tables and indexes
    //
    this.version(12).stores(store_schema);

    this.boundary__polygon = this.table('boundary__polygon');
    this.boundary__polygon_edited = this.table(BOUNDARY_EDITED_LAYER);
    //this.settlement__polygon = this.table("settlement__polygon");
    this.settlement__part = this.table('settlement__part');
    this.settlement__name = this.table('settlement__name');
    this.health_facility__point = this.table('health_facility__point');
    this.generic__point = this.table('generic__point');
    this.generic__line = this.table('generic__line');
    this.generic__polygon = this.table('generic__polygon');

    this.ri__catchment_item = this.table('ri__catchment_item');

    this.surrounding_boundary = this.table('surrounding_boundary');
    this.all_boundary__polygon = this.table('all_boundary__polygon');
    this.last_fetched = this.table('last_fetched');
    this.crud_actions = this.table('crud_actions');
    this.crud_actions_redo = this.table('crud_actions_redo');
    this.crud_actions_history = this.table('crud_actions_history');
    this.crud_actions_history_position = this.table(
      'crud_actions_history_position'
    );
    this.key_value = this.table('key_value');
    this.permissions = this.table('permissions');
    this.is_offline = this.table('is_offline');
    console.log('Finished Constructing VectorLayerDatabase');
  }
}

//
/**
 *
 * @param data list coming from indexdb
 * @param crudOps crudOps should already be filtered by layer, NOTE it is assumed these are in ascending order of CrudAction creation
 * @param logger
 */
export function applyCrudOperations<T extends GeoJsonBase>(
  data: Array<T>,
  crudOps: Array<CrudAction>,
  logger: NGXLogger
): Array<T> {
  const appliedArray: Array<T> = [];

  //we only care about the last crud action for a particular globalid
  const guidToCrud = new Map<string, CrudAction>();

  for (const ca of crudOps) {
    guidToCrud.set(ca.geojson_after.properties.global_id, ca);
  }

  for (const jsonItem of data) {
    const crudItem = guidToCrud.get(jsonItem.properties.global_id);

    if (!crudItem) {
      appliedArray.push(jsonItem);
      continue;
    }

    if (crudItem.action == 'update') {
      //console.log("Applied CRUD update clientside", crudItem.geojson_before);
      appliedArray.push(crudItem.geojson_after as T);
    } else if (crudItem.action == 'delete') {
      continue;
    } else {
      logger.warn('Item to apply', jsonItem, 'conflicting create', crudItem);
      //Note this can happen if the edits are submitted, but the CRUD actions are not cleared, so it is still an error
      //we'll try to manage by using the local one instead of the server one
      logger.warn(
        `Create action ${crudItem.action} with same guid ${jsonItem.properties.global_id}`
      );

      //we'll apply the creation crud in the next part
    }
  }

  //Add creates at the end if it has no deletion crud_action (skipping scenarios create->delete and create->update->delete)

  //Since we only take the last crud item, if the last one is a create we add it
  for (const creationCrud of guidToCrud.values()) {
    if (creationCrud.action != 'create') {
      continue;
    }
    appliedArray.push(creationCrud.geojson_after as T);
  }
  return appliedArray;
}
