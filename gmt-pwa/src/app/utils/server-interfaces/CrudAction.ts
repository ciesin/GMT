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

  //True if this crud action is purely the result of a catchment recalc
  //This means fields listed in CALCULATED_FIELDS, see crud-layer.service.ts
  // and https://github.com/novelt/GMT/issues/2656
  isCatchmentCalculation: boolean
}

export interface DefaultResponse {
  success?: boolean
}

export interface DefaultQueueResponse extends DefaultResponse{
  jobId: number
}


