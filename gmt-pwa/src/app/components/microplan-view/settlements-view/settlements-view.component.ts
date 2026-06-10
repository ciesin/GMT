import { Component, OnInit } from '@angular/core';
import { Sort } from '@angular/material/sort';
import { ActivatedRoute } from '@angular/router';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import {
  EMPTY_SORT_STATE,
  SortStateService,
} from '@services/shared/notifications/sortState';
import { SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import { NGXLogger } from 'ngx-logger';
import { filter, map, Subject, switchMap, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { SettlementSortingFilteringService } from 'src/app/services/shared/lists/st-sorting-filtering.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  ALL_PROBLEMATIC_OPTIONS,
  SettlementListItem,
} from 'src/app/utils/server-interfaces/GeoJson';
import { SettCatchmentCardComponent } from '../../catchment-card/sett-catchment-card.component';
import {
  ANY_PROBLEM_CHOICE,
  ChosenFilters,
  EMPTY_CHOICE,
  MicroplanFilterItem,
} from '../microplan-filter/microplan-filter.component';
import { SortHeader } from '../microplan-list/microplan-list.component';

export const SETTLEMENTS_FILTERS: Array<MicroplanFilterItem> = [
  {
    label: 'Inhabited/Uninhabited',
    key: 'uninhabited',
    choices: [
      EMPTY_CHOICE,
      {
        label: 'inhabited',
        value: false,
      },
      {
        label: 'uninhabited',
        value: true,
      },
    ],
  },
  {
    label: 'Problematic',
    key: 'problematic',
    choices: [
      EMPTY_CHOICE,
      ...ALL_PROBLEMATIC_OPTIONS.map((pb) => {
        return {
          label: pb,
          value: pb,
        };
      }),
      ANY_PROBLEM_CHOICE,
    ],
  },
];
export const SETTLEMENTS_SORT_HEADERS: Array<SortHeader | SortHeader[]> = [
  {
    label: 'Settlement name',
    active: 'name',
    direction: '',
  },
  [
    {
      label: 'Population',
      active: 'population',
      direction: '',
    },
    {
      label: 'Unclaimed',
      active: 'unclaimed',
      direction: 'asc',
    },
  ],
];

//most unclaimed first
const DEFAULT_SETTLEMENT_SORT_ORDER: Sort = {
  active: 'unclaimed',
  direction: 'desc',
};

@Component({
  selector: 'gmt-settlements-view',
  templateUrl: './settlements-view.component.html',
  styleUrls: [
    '../health-facilities-view/health-facilities-view.component.less',
  ],
  standalone: false
})
export class SettlementsViewComponent implements OnInit {
  public settFilters = SETTLEMENTS_FILTERS;
  public sortHeaders = SETTLEMENTS_SORT_HEADERS;
  public defaultSetSort = DEFAULT_SETTLEMENT_SORT_ORDER;

  public itemComponent = SettCatchmentCardComponent;
  public sortFilterService: SettlementSortingFilteringService;
  public newButtonExtanded = false;
  private firstFiltersChosen: boolean = false;
  private unsubscribe = new Subject();
  private newButtonTimeout: NodeJS.Timeout;

  constructor(
    private activatedRoute: ActivatedRoute,
    public bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService,
    private logger: NGXLogger,
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,

    private singleStProcessingService: SingleStProcessingService,
    private sortStateService: SortStateService
  ) {}

  ngOnDestroy() {
    this.microplanMapEvents.setSelectedSettlementParts([]);
    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);

    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
    this.microplanMapEvents.setSelectedSettlementParts([]);
  }

  async ngOnInit() {
    this.activatedRoute
      .parent!.params.pipe(
        map((params) => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
        switchMap((boundaryId) => {
          //this.logger.info("EEE settlements view Boundary id", boundaryId);
          return this.bvService.ensureBoundaryLoaded(boundaryId);
        }),
        switchMap((_ok) => {
          return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
        }),
        filter((suppressUi) => !suppressUi),
        switchMap((_ok) => {
          return this.mapEvents.getIsMapInitialized();
        }),
        filter((mapInit) => {
          return mapInit;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe({
        next: (_ok) => {
          let settlementList = this.createSettlementLists();

          this.sortStateService.stListSort.next(EMPTY_SORT_STATE);

          if (this.sortFilterService) {
            this.sortFilterService.sortOrder = DEFAULT_SETTLEMENT_SORT_ORDER;
            this.sortFilterService.updateList(settlementList);
          } else {
            this.sortFilterService = new SettlementSortingFilteringService(
              this.singleStProcessingService,
              settlementList,

              { sortOrder: DEFAULT_SETTLEMENT_SORT_ORDER }
            );
          }
          this.logger.info('settlements view subscribe');
        },
        error: (e) => {
          this.logger.error('Error in subscribe', e);
        },
        complete: () => {
          this.logger.info(`Completed main subscribe`);
        },
      });
  }

  private createSettlementLists() {
    const settlementList: Array<SettlementListItem> = [];
    for (const settlementName of this.bvService.data.getBoundaryPrimaryNameSettlementList()) {
      const settlementPart = this.bvService.data.spMap.get(
        settlementName.properties.settlement_part!
      );
      if (!settlementPart) {
        continue;
      }

      //There is a search filter for uninhabited so we don't want to check that here
      //if (!settlementName.properties.uninhabited) {
      settlementList.push({
        settlementName,
        settlementPart: settlementPart!,
      });
    }

    return settlementList;
  }

  handleChosenFilters(chosenFilters: ChosenFilters) {
    const firstFiltersChosen = this.sortFilterService.chosenFilters == null;
    this.sortFilterService.chosenFilters = chosenFilters;

    //this is when user searches (not just typing)
    this.sortStateService.stListSort.next(chosenFilters);

    this.filterAndSort().then();

    if (this.firstFiltersChosen == false) {
      this.firstFiltersChosen = firstFiltersChosen;
    }
  }

  handleSearchText(search: string) {
    //this is as the user types
    this.sortFilterService.handleSearchText(search);
  }

  handleSort(sort: Sort) {
    this.sortFilterService.sortOrder = sort;
    this.filterAndSort().then();
  }

  handleScroll(evt) {
    // extant new button
    if (this.newButtonTimeout) {
      clearTimeout(this.newButtonTimeout);
    }
    this.newButtonExtanded = true;
    this.newButtonTimeout = setTimeout(
      () => (this.newButtonExtanded = false),
      500
    );
  }

  private async filterAndSort() {
    await this.sortFilterService.filterAndSort();
    // C. focus
    // it is easier to separate filtering and clearing filter stage
    if (
      !!this.sortFilterService.getSearchedText() &&
      this.sortFilterService.chosenFilters!.choices.size == 0
    ) {
      this.microplanMapEvents.triggerRemoveSettlementFocus();
    } else {
      if (this.firstFiltersChosen) {
        this.microplanMapEvents.triggerFocusSettlement(
          this.sortFilterService.idDisplayList
        );
      }
    }
  }
}
