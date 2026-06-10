import { Injectable } from '@angular/core';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { AppConfigService } from '../utils/app-config.service';
import {
  HierarchyListEntry,
  HierarchyListEntryBoundary,
} from '../utils/server-interfaces/HierarchyList';
import {
  BoundaryTreeServiceInterface,
  EXPAND_LIMIT,
  TREENODE_TYPE_BOUNDARY_WITH_BOUNDARIES,
  TREENODE_TYPE_BOUNDARY_WITH_HF,
  TREENODE_TYPE_HEALTH_FACILITY,
  TreeNodeCheckable,
} from './interfaces/boundary-tree.service.interface';
import { BoundaryLayerService } from './vector_layer/boundary-layer.service';

@Injectable({
  providedIn: 'root',
})
export class BoundaryTreeService implements BoundaryTreeServiceInterface {
  // just to remove hardcoding
  public maxBoundariesLevel: number =
    AppConfigService.conf.generic.operational_boundary_level;

  public allNodes: TreeNodeCheckable[] = [];
  public idsToNodes = new Map<string, TreeNodeCheckable>();

  private _builtTree = false;

  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private logger: NGXLogger
  ) {}

  /**
   * Build boundaries tree with children and parent info on each node
   */
  public async buildTree(force?: boolean): Promise<void> {
    if (this._builtTree && !force) {
      // tree has already been built
      return;
    }

    let hierarchyList = await this.boundaryLayerService.fetchHierarchyList();
    if (!hierarchyList) {
      return;
    }
    this.logger.info('Received Hierarchy list');
    this.logger.debug('hierarchyList: ', hierarchyList);
    this.allNodes = hierarchyList.list.map((he0) => {
      return this.buildNode(he0, 0, (lowestLevelEntry) => {});
    });
    this._builtTree = true;
    this.logger.debug('Boundary tree service: ', this.allNodes);
  }

  /**
   * Get all names of related boundaries -
   * for example if the admin3 is given, the function would return
   * {
   *   global_id_1: [admin3abc name, admin2abc name, admin1 name, admin0 name],
   *   global_id_2: [admin2abc name, admin1 name, admin0 name],
   * }
   * @param boundaryId
   */
  public getRelatedBoundaryLabelsById(
    boundaryId: string
  ): Map<string, string[]> {
    let labels = new Map<string, string[]>();
    this.logger.debug(
      `getRelatedBoundaryLabelsById for ${this.allNodes.length} nodes`
    );
    for (const nodeLevel0 of this.allNodes) {
      let labelsTemp = BoundaryTreeService.buildLocationLabels(
        nodeLevel0,
        true,
        (node: TreeNodeCheckable) => node.global_id == boundaryId
      );
      //this.logger.debug(`Building labels map with with node0 ${nodeLevel0.label} and boundary ${boundaryId}`, labelsTemp);
      labels = new Map([...labels, ...labelsTemp]);
    }
    return labels;
  }

  /**
   * Get all names of related boundaries -
   * for example if the searchText is abc it would return
   * {
   *   global_id_1: [admin3abc name, admin2abc name, admin1 name, admin0 name],
   *   global_id_2: [admin2abc name, admin1 name, admin0 name],
   * }
   * @param searchText
   */
  public getRelatedBoundaryLabelsBySearchText(
    searchText: string
  ): Map<string, string[]> {
    let searchTextLower = searchText.toLowerCase();
    let labels = new Map<string, string[]>();
    // loop in case like PAK that has multiple admin 0 polygons
    for (const nodeLevel0 of this.allNodes) {
      let labelsTemp = BoundaryTreeService.buildLocationLabels(
        nodeLevel0,
        false,
        (node: TreeNodeCheckable) =>
          node.label.toLowerCase().includes(searchTextLower)
      );
      labels = new Map([...labels, ...labelsTemp]);
    }
    return labels;
  }

  /**
   * Purpose is to convert the hierarchy from the API into a primeNG TreeNode's
   * @param hierarchyEntry
   * @param level
   * @param boundaryLevelCallback called on the lowest level, the one containing health facilities
   */
  buildNode(
    hierarchyEntry: HierarchyListEntry,
    level: number,
    boundaryLevelCallback: (he: HierarchyListEntryBoundary) => void
  ): TreeNodeCheckable {
    let node: TreeNodeCheckable;

    //recursive case
    if (hierarchyEntry.type == 'health_facility') {
      node = {
        children: [],
        parent: undefined,
        label: hierarchyEntry.name,
        global_id: hierarchyEntry.global_id,
        data: hierarchyEntry,
        selectable: false,
        type: TREENODE_TYPE_HEALTH_FACILITY,
        level,
        checked: false,
        indeterminated: false,
      };
    } else if (
      level == AppConfigService.conf.generic.operational_boundary_level
    ) {
      //lowest level boundary
      node = {
        children: [],
        data: hierarchyEntry,
        label: hierarchyEntry.name,
        parent: undefined,
        global_id: hierarchyEntry.global_id,
        selectable: true,
        expanded: false,
        type: TREENODE_TYPE_BOUNDARY_WITH_HF,
        level,
        checked: false,
        indeterminated: false,
      };

      boundaryLevelCallback(hierarchyEntry);
    } else {
      node = {
        children: [],
        data: hierarchyEntry,
        label: hierarchyEntry.name,
        parent: undefined,
        global_id: hierarchyEntry.global_id,
        expandedIcon: 'pi pi-folder-open',
        collapsedIcon: 'pi pi-folder',
        selectable: true,
        expanded: false,
        type: TREENODE_TYPE_BOUNDARY_WITH_BOUNDARIES,
        level,
        checked: false,
        indeterminated: false,
      };
    }

    if (node.data.type === 'boundary') {
      this.idsToNodes.set(hierarchyEntry.global_id, node);
    }

    if (
      node.type != TREENODE_TYPE_HEALTH_FACILITY &&
      hierarchyEntry.type != 'health_facility'
    ) {
      for (const heChild of hierarchyEntry.children) {
        const childNode = this.buildNode(
          heChild,
          level + 1,
          boundaryLevelCallback
        );
        childNode.parent = node;
        node.children.push(childNode);
      }
    }

    return node;
  }

  searchByText(filterText: string) {
    const lowerCaseFilterText = filterText.toLowerCase();
    let expandLimit = EXPAND_LIMIT;
    let nodes: Array<TreeNodeCheckable> = [];
    for (const p0 of this.allNodes) {
      const [newExpandLimit, node] = BoundaryTreeService.searchNodes(
        p0,
        (tn, matchingChildren) => {
          if (
            //don't search top level nodes
            tn.level > 0 &&
            //only search levels containing health facilities or their parents
            // (tn.type == TREENODE_TYPE_BOUNDARY_WITH_HF || tn.type == TREENODE_TYPE_BOUNDARY_WITH_BOUNDARIES) &&
            tn.label.toLowerCase().includes(lowerCaseFilterText)
          ) {
            return true;
          }

          return matchingChildren.length > 0;
        },
        (_tn) => true,
        expandLimit
      );
      expandLimit = newExpandLimit;
      if (node) {
        node.expanded = true;
        nodes.push(node);
        //top level nodes always expanded
      }
    }
    return nodes;
  }

  findNodeById(
    global_id: string,
    node?: TreeNodeCheckable
  ): TreeNodeCheckable | undefined {
    if (!node) {
      node = this.allNodes[0];
    }

    function deepSearch(node: TreeNodeCheckable) {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (node.global_id === global_id) {
        return node;
      }
      for (const child of node.children) {
        const result = deepSearch(child);
        if (result) {
          return result;
        }
      }
    }
    return deepSearch(node);
  }

  /**
   * any node that passes the search, or has a child that passes the search, is returned
   */
  static searchNodes(
    node: TreeNodeCheckable,
    searchFunc: (
      tn: TreeNodeCheckable,
      matchingChildren: Array<TreeNodeCheckable>
    ) => boolean,
    shouldExpand: (tn: TreeNodeCheckable) => boolean,
    expandLimit: number
  ): [number, TreeNodeCheckable | null] {
    if (node.type === TREENODE_TYPE_HEALTH_FACILITY) {
      if (searchFunc(node, [])) {
        return [expandLimit, node];
      } else {
        return [expandLimit, null];
      }
    }

    //here we are a boundary node
    const newChildren: Array<TreeNodeCheckable> = [];

    let currentExpandLimit = expandLimit;

    //Would this node match by itself
    const thisNodeInSearchWithoutChildren = searchFunc(node, []);

    if (thisNodeInSearchWithoutChildren) {
      //No need to copy the node, we include it as is with all children intact
      if (node.children && currentExpandLimit > 0 && shouldExpand(node)) {
        node.expanded = true;
        currentExpandLimit -= 1;
      } else {
        node.expanded = false;
      }

      return [currentExpandLimit, node];
    }

    for (const child of node.children || []) {
      const [childExpandLimit, transformedChild] = this.searchNodes(
        child,
        searchFunc,
        shouldExpand,
        currentExpandLimit
      );
      currentExpandLimit = childExpandLimit;

      if (!transformedChild) {
        continue;
      }

      newChildren.push(transformedChild);
    }

    const thisNodeInSearch = searchFunc(node, newChildren);

    if (!thisNodeInSearch) {
      return [currentExpandLimit, null];
    }

    const newNode = { ...node };
    newNode.children = newChildren;
    if (
      newChildren.length > 0 &&
      currentExpandLimit > 0 &&
      shouldExpand(newNode)
    ) {
      newNode.expanded = true;
      currentExpandLimit -= 1;
    } else {
      newNode.expanded = false;
    }

    return [currentExpandLimit, newNode];
  }

  //Used only by buildLocationLabels
  private static searchTreeRecursive(
    node: TreeNodeCheckable,
    earlyStop: boolean,
    matchingNodes: TreeNodeCheckable[],
    searchRule: (node: TreeNodeCheckable) => boolean
  ): TreeNodeCheckable[] {
    if (_.isNil(node)) {
      return matchingNodes;
    }

    if (searchRule(node)) {
      matchingNodes.push(node);
      //Even if we matched, if not early stop we want to search any potential children
      if (earlyStop) {
        return matchingNodes;
      }
    }

    if (_.isEmpty(node.children)) {
      return matchingNodes;
    }

    // Don't search in HF list
    if (node.children[0].type == TREENODE_TYPE_HEALTH_FACILITY) {
      return matchingNodes;
    }

    for (let i = 0; i < node.children.length; i++) {
      BoundaryTreeService.searchTreeRecursive(
        node.children[i],
        earlyStop,
        matchingNodes,
        searchRule
      );
      if (earlyStop && !_.isEmpty(matchingNodes)) {
        break;
      }
    }

    return matchingNodes;
  }

  private static buildLocationLabels(
    node: TreeNodeCheckable,
    earlyStop: boolean,
    searchRule: (node: TreeNodeCheckable) => boolean
  ): Map<string, string[]> {
    let labels = new Map<string, string[]>();
    let matchingNodes = BoundaryTreeService.searchTreeRecursive(
      node,
      earlyStop,
      [],
      searchRule
    );
    let matchingNodeTemp: TreeNodeCheckable | null | undefined = null;
    if (!matchingNodes) {
      return labels;
    }

    // form labels from each tree that was found
    for (let matchingNode of matchingNodes) {
      matchingNodeTemp = matchingNode;
      let labelsTemp: string[] = [];
      while (matchingNodeTemp) {
        if (matchingNodeTemp.label) {
          labelsTemp.push(matchingNodeTemp.label);
        }
        if (matchingNodeTemp.parent) {
          matchingNodeTemp = matchingNodeTemp.parent;
        } else {
          matchingNodeTemp = null;
        }
      }
      labels.set(matchingNode.global_id, labelsTemp);
    }

    return labels;
  }
}
