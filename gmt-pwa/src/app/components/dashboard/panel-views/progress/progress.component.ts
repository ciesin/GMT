import { Component, OnDestroy, OnInit, Type } from '@angular/core';
import { MatAutocompleteActivatedEvent } from '@angular/material/autocomplete';
import { Sort } from '@angular/material/sort';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  ChosenFilters,
  EMPTY_CHOICE,
  MicroplanFilterItem,
  Propositions,
} from '@components/microplan-view/microplan-filter/microplan-filter.component';
import { SortHeader } from '@components/microplan-view/microplan-list/microplan-list.component';
import { BoundaryTreeService } from '@services/boundary-tree.service';
import { TreeNodeCheckable } from '@services/interfaces/boundary-tree.service.interface';
import { BoundarySortingFilteringService } from '@services/shared/lists/boundary-sorting-filtering.service';
import { BoundaryNavigationService } from '@services/shared/route/boundary-navigation.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Subject } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { routeFromChunks } from 'src/app/utils/route-helper';
import { BoundaryCardComponent } from './boundary-card/boundary-card.component';

const FILTERS: Array<MicroplanFilterItem> = [
  {
    label: 'Offline',
    key: 'offline',
    choices: [
      EMPTY_CHOICE,
      {
        label: 'offline',
        value: true,
      },
      { label: 'not offline', value: false },
    ],
  },
  {
    label: 'Microplanning',
    key: 'participating',
    choices: [
      EMPTY_CHOICE,
      { label: 'participating', value: true },
      { label: 'not participating', value: false },
    ],
  },
];

export const DEFAULT_FILTER: ChosenFilters = {
  searchText: '',
  choices: new Map().set('participating', {
    label: 'participating',
    value: true,
  }),
};

const ADM_SORT_HEADERS: Array<SortHeader> = [
  {
    label: 'ADM Boundary Name',
    active: 'name',
    direction: '',
  },
  {
    label: 'Population',
    active: 'population',
    direction: 'asc',
  },
];

@Component({
  selector: 'gmt-progress',
  templateUrl: './progress.component.html',
  styleUrls: ['./progress.component.less'],
  standalone: false,
})
export class ProgressComponent implements OnInit, OnDestroy {
  public itemComponent: Type<any> = BoundaryCardComponent;
  public sortFilterService: BoundarySortingFilteringService;
  public searchFilters = FILTERS;
  public sortHeaders = ADM_SORT_HEADERS;
  private unsubscribe = new Subject();
  public autocompletePropositions: Propositions;

  constructor(
    public boundaryNavigationService: BoundaryNavigationService,
    private boundaryTreeService: BoundaryTreeService,
    private boundaryLayerService: BoundaryLayerService,
    private logger: NGXLogger,
    private activatedRoute: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.boundaryTreeService.buildTree();

    this.activatedRoute.paramMap.subscribe(async (params: ParamMap) => {
      const boundaryId = params.get(
        RoutesChunks.PARAM_BOUNDARY.replace(':', '')
      )!;
      let targetHierarchyList =
        await this.boundaryNavigationService.loadSelectedBoundary(boundaryId);
      this.sortFilterService = new BoundarySortingFilteringService(
        targetHierarchyList,
        await this._offlineIdsWithParents(),
        {
          sortOrder: this.sortHeaders.find((s) => !!s.direction),
          chosenFilters:
            this.sortFilterService?.chosenFilters ?? DEFAULT_FILTER,
        }
      );
      // this.logger.debug("hierarchyList: ", targetHierarchyList);
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public safeSearchText(): string {
    return this.safeChosenFilters().searchText;
  }

  public safeChosenFilters(): ChosenFilters {
    if (_.isNil(this.sortFilterService)) {
      return {
        searchText: '',
        choices: new Map(),
      };
    }

    if (_.isNil(this.sortFilterService.chosenFilters)) {
      return {
        searchText: '',
        choices: new Map(),
      };
    }

    return this.sortFilterService.chosenFilters;
  }

  public redirectOneLevelBack() {
    if (this.boundaryNavigationService.boundariesList.length > 2) {
      // otherwise it is a path without global id
      this.router
        .navigate([
          routeFromChunks([
            RoutesChunks.OVERVIEW,
            RoutesChunks.PROGRESS,
            // this.boundariesList[this.boundariesList.length - 2].properties.global_id
            this.boundaryNavigationService.boundariesList[
              this.boundaryNavigationService.currentLevel - 1
            ].properties.global_id,
          ]),
        ])
        .then();
    } else {
      this.router
        .navigate([
          routeFromChunks([RoutesChunks.OVERVIEW, RoutesChunks.PROGRESS]),
        ])
        .then();
    }
  }

  handleSort(sort: Sort) {
    this.sortFilterService.setSortOrder(sort);
    this.sortFilterService.filterAndSort();
  }

  handleChosenFilters(chosenFilters: ChosenFilters) {
    if (_.isNil(this.sortFilterService)) {
      return;
    }
    this.sortFilterService.chosenFilters = chosenFilters;
    this.sortFilterService.filterAndSort();
  }

  handleSearchText(search: string) {
    this.updateAutocompletePropostions(search);
  }

  handleAutocompleteSelection(event: MatAutocompleteActivatedEvent) {
    const {
      value: { global_id, label },
    } = event.option!;
    console.log('autocomplete', event, global_id, label);
    this.sortFilterService.chosenFilters.searchText = label;
    const node = this.boundaryTreeService.idsToNodes.get(global_id)!;

    if (node.level !== this.boundaryNavigationService.currentLevel + 1) {
      // selected option is on another level, we need to redirect
      this.router
        .navigate([
          routeFromChunks([
            RoutesChunks.OVERVIEW,
            RoutesChunks.PROGRESS,
            global_id,
          ]),
        ])
        .then();
    }
  }

  private updateAutocompletePropostions(search: string) {
    search = search.trim().toLocaleLowerCase();

    const foundNodes = new Array<TreeNodeCheckable>();
    const deepSearchBoundary = (node: TreeNodeCheckable, search: string) => {
      if (node.data.type !== 'boundary') {
        return;
      }

      if (
        node.level > this.boundaryNavigationService.currentLevel &&
        node.label.toLocaleLowerCase().includes(search)
      ) {
        foundNodes.push(node);
      }

      if (
        this.boundaryNavigationService.currentLevel === 0 ||
        node.level === 0 ||
        node.level > this.boundaryNavigationService.currentLevel ||
        (node.level <= this.boundaryNavigationService.currentLevel &&
          this.boundaryNavigationService.hierarchy.includes(node.label))
      ) {
        // considering all childs if:
        //   1. root level
        //   2. we already beneath current level and considering desired branch
        //   3. we are traversing hierarchy to desired current selected node
        for (const child of node.children) {
          deepSearchBoundary(child, search);
        }
      }
    };
    deepSearchBoundary(this.boundaryTreeService.allNodes[0], search);
    this.autocompletePropositions = foundNodes.map((n) => {
      const hierarchy: Array<string> = [];
      let parent = n.parent;
      while (parent) {
        hierarchy.unshift(parent.label);
        parent = parent.parent;
      }
      return {
        name: n.label,
        value: { label: n.label, global_id: n.global_id },
        hierarchy,
      };
    });
  }

  private async _offlineIdsWithParents(): Promise<Set<string>> {
    const offlineIds =
      await this.boundaryLayerService.getAllOfflineBoundaries();
    const offlineIdsWithParents = new Set(offlineIds);
    for (const global_id of offlineIds) {
      const node = this.boundaryTreeService.idsToNodes.get(global_id)!;
      let parent = node.parent;
      while (parent) {
        offlineIdsWithParents.add(parent.global_id);
        parent = parent.parent;
      }
    }
    return offlineIdsWithParents;
  }
}
