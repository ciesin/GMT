import {HierarchyListEntry, HierarchyListEntryBoundary} from "../../utils/server-interfaces/HierarchyList";
import {TreeNode} from "primeng/api";

export interface TreeNodeCheckable extends TreeNode<HierarchyListEntry> {
  label: string,
  global_id: string,
  data: HierarchyListEntry,
  children: Array<TreeNodeCheckable> ,
  parent: TreeNodeCheckable | undefined,
  indeterminated?: boolean,
  checked?: boolean,
  level: number
}

// Boundary that contains other boundaries, e.g. country/state/lga
export const TREENODE_TYPE_BOUNDARY_WITH_BOUNDARIES = "parent_boundary";
// Boundary that contains health facilities, e.g. ward
export const TREENODE_TYPE_BOUNDARY_WITH_HF = "boundary_with_hf";
export const TREENODE_TYPE_HEALTH_FACILITY = "health_facility";
export const EXPAND_LIMIT = 100;

export interface BoundaryTreeServiceInterface {
  /**
   * Build boundaries tree with children and parent info on each node
   */
  buildTree(): Promise<void>;

  /**
   * Get all names of related boundaries -
   * for example if the admin3 is given, the function would return
   * {
   *   global_id_1: [admin3abc name, admin2abc name, admin1 name, admin0 name],
   *   global_id_2: [admin2abc name, admin1 name, admin0 name],
   * }
   * @param boundaryId
   */
  getRelatedBoundaryLabelsById(boundaryId: string): Map<string, string[]>;

  /**
   * Get all names of related boundaries -
   * for example if the searchText is abc it would return
   * {
   *   global_id_1: [admin3abc name, admin2abc name, admin1 name, admin0 name],
   *   global_id_2: [admin2abc name, admin1 name, admin0 name],
   * }
   * @param searchText
   */
  getRelatedBoundaryLabelsBySearchText(searchText: string): Map<string, string[]>

  buildNode(
    hierarchyEntry: HierarchyListEntry,
    level: number,
    boundaryLevelCallback: (he: HierarchyListEntryBoundary) => void,
  ): TreeNodeCheckable;
}
