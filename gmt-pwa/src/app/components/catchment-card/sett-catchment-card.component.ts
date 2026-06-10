import { Component, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { ActivatedRoute, Router } from '@angular/router';
import {
  getSortedDisplayName,
  SortStateService,
} from '@services/shared/notifications/sortState';
import {
  CoverageSett,
  SingleStProcessingService,
} from '@services/vector_layer/single-st-processing.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import {
  filter,
  map,
  ReplaySubject,
  Subject,
  switchMap,
  take,
  takeUntil,
} from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import {
  GeoJsonSettlementName,
  PropertyValue,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  formatPercentage,
  formatPopulation,
} from 'src/app/utils/string-formatting';
import {
  ACCORDION_TOKEN,
  ID_TOKEN,
} from '../microplan-view/microplan-list/microplan-list.component';

export interface CoverageBoundary {
  pop: number;
  fixedPost: number;
  outreach: number;
  unclaimed: number;
  problematic: number;
}
@Component({
  selector: 'gmt-sett-catchment-card',
  templateUrl: './sett-catchment-card.component.html',
  styleUrls: ['./card.less', './sett-catchment-card.component.less'],
  standalone: false
})
export class SettCatchmentCardComponent implements OnInit, OnDestroy {
  private unsubscribe = new Subject();

  coverageSett: CoverageSett;
  settlement: GeoJsonSettlementName;
  public panelOpenState: boolean = false;

  public displayName: string;

  @ViewChild(MatExpansionPanel)
  set matExpansionPanel(panel: MatExpansionPanel) {
    // hook the panel expansion to the accordion when ready
    if (!panel) {
      return;
    }
    this.accordion$
      .pipe(filter(Boolean), take(1))
      .subscribe((accordion) => (panel.accordion = accordion));
  }

  constructor(
    @Inject(ID_TOKEN) public id: string,
    @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
    public bvService: BoundaryVectorLayersService,
    private activatedRoute: ActivatedRoute,

    private logger: NGXLogger,
    private singleStProcessingService: SingleStProcessingService,
    private riRouterService: RIRouteService,
    private router: Router,
    private sortStateService: SortStateService
  ) {}

  ngOnInit(): void {
    this.activatedRoute
      .parent!.params.pipe(
        map((params) => {
          return params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')];
        }),
        switchMap((boundaryId) => {
          return this.bvService.ensureBoundaryLoaded(boundaryId);
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(() => {
        //Be responsive to settlement data changes
        this.settlement = this.bvService.data.snMap.get(this.id)!;
        if (!this.settlement) {
          this.logger.error(`Settlement of id ${this.id} not found.`);
          //Don't load, let ngif draw nothing in the component
          return;
        }

        //do after settlement is initialized
        this.listenToSort();
        this.loadSettlement();
      });
  }

  ngOnDestroy(): void {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public formatPopulation(pop: PropertyValue) {
    return formatPopulation(pop);
  }

  public formatPercentage(pop: PropertyValue) {
    return formatPercentage(pop, true);
  }

  handleShowSettlementSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    const settlementName = this.bvService.data.snMap.get(this.id)!;
    this.singleStProcessingService.handleShowSettlementSiteOnMap(
      settlementName
    );
  }

  public hasProblems(): boolean {
    if (_.isNil(this.coverageSett)) {
      return false;
    }
    if (!_.isArray(this.coverageSett.problematic)) {
      return false;
    }
    return this.coverageSett.problematic.length > 0;
  }

  public onOpenPanelAction() {
    //This also pans to the settlement
    this.singleStProcessingService.onOpenPanelAction(
      this.panelOpenState,
      this.settlement
    );
  }
  private loadSettlement() {
    //const rand = (max: number) => Math.floor(Math.random() * max);
    //Find the associated settlement part
    const settlementPart = this.bvService.data.spMap.get(
      this.settlement.properties.settlement_part!
    );

    if (!settlementPart) {
      this.logger.error(
        `Cannot find settlement part with id ${this.settlement.properties.settlement_part} for sn ${this.settlement.properties.global_id} `
      );
      return;
    }

    this.coverageSett =
      this.singleStProcessingService.calculateSettCatchmentInfo(
        settlementPart,
        this.settlement,
        true
      );
  }

  public async redirectToDetails() {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        this.riRouterService.getBoundaryIdValue(),
        RoutesChunks.SETTLEMENTS,
        this.coverageSett.global_id,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }

  private listenToSort() {
    this.displayName = this.settlement?.properties.name;

    this.sortStateService.stListSort
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((sortState) => {
        this.displayName = getSortedDisplayName(sortState, this.settlement);
      });
  }
}
