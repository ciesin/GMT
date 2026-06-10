import { GeoJsonBoundaryWithIndicatorsProperties } from "src/app/utils/server-interfaces/GeoJson";

type HierarchyListType = "boundary" | "health_facility";

export interface HierarchyListEntryBase {
  global_id: string,
  name: string,
  type: HierarchyListType,
}

interface Extent {
  x_min: number,
  x_max: number,
  y_min: number,
  y_max: number
};

export interface HierarchyListEntryBoundary extends HierarchyListEntryBase {
  type: "boundary",
  //is_offline: boolean,
  extent: Extent,
  children: Array<HierarchyListEntryBoundary | HierarchyListEntryHF>,
  indicators?: GeoJsonBoundaryWithIndicatorsProperties,
  participating: boolean
}


export interface HierarchyListEntryHF extends HierarchyListEntryBase {
  type: "health_facility",
}

export type HierarchyListEntry = HierarchyListEntryHF | HierarchyListEntryBoundary

export interface HierarchyList {
  version: number,
  list: Array<HierarchyListEntryBoundary>
}
