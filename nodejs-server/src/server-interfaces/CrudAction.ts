import {VectorLayerName} from "./VectorLayerName";
import {GeoJsonBase} from "./GeoJson";

export type CrudActions = "create" | "delete" | "update";
export type AffectedFields = Array<string>;

export interface CrudAction {
  action: CrudActions,
  //To group together logical actions.  When undo is called, all crudactions with same actionId will be removed
  actionId: string,
  changed_layer: VectorLayerName,
  changed_fields: Array<string>,
  geojson_before: GeoJsonBase,
  //After change is applied
  geojson_after: GeoJsonBase
}


export interface SubmitEditsResponse {
  jobId: number
}

