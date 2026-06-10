import {Component, Input, OnInit, Type} from '@angular/core';
import {ActivatedRoute, QueryParamsHandling, Router} from '@angular/router';
import {IconProp} from '@fortawesome/fontawesome-svg-core';
import {faHouseMedical, faListCheck, faSliders, faUsers} from '@fortawesome/free-solid-svg-icons';
import {MapEventsService, OverlayLayer} from "@services/map/base/map-events.service";
import {Subject} from 'rxjs';
import {filter, switchMap, takeUntil} from "rxjs/operators";
import {
  HealthFacilitiesViewComponent
} from 'src/app/components/microplan-view/health-facilities-view/health-facilities-view.component';
import {SettlementsViewComponent} from 'src/app/components/microplan-view/settlements-view/settlements-view.component';
import {RoutesChunks} from 'src/app/constants/routing.enum';
import {ProblemsService} from "src/app/services/attention/problems.service";
import {ActivePageContext, RIRouteService} from "src/app/services/shared/route/ri-route.service";
import {VectorLayerService} from "src/app/services/vector_layer/vector-layers.service";
import {BOUNDARY_EDITED_LAYER} from "src/app/utils/server-interfaces/VectorLayerName";
import {BoundaryVectorLayersService} from "@services/boundary-vector-layers.service";
import {UserContextService} from "@services/user-context.service";
import {CrudLayerService} from "@services/vector_layer/crud-layer.service";
import {GeoJsonBoundary, PropertyValue} from "../../utils/server-interfaces/GeoJson";
import {formatPopulation} from "../../utils/string-formatting";
import {NGXLogger} from 'ngx-logger';
import {IconDefinition} from "@fortawesome/angular-fontawesome";


export interface MenuItem {
    name: string;
    label: string;
    // svgIcon?: string;
    faIcon?: IconProp | IconDefinition;
    routerLink?: any;
    queryParamsHandling?: QueryParamsHandling;
    component?: Type<any>;
}


@Component({
    selector: 'gmt-under-construction',
    template: `
    <div>
      <fa-icon icon="person-digging"></fa-icon>
      Under construction...
    </div>`,
    styles: [':host { font-size: 2em; padding: 1em; text-align: center; color: var(--base-medium); }'],
    standalone: false
})
export class UnderConstructionComponent {
}

@Component({
    selector: 'gmt-microplan-left-wrapper',
    templateUrl: './microplan-left-wrapper.component.html',
    styleUrls: ['./microplan-left-wrapper.component.less'],
    standalone: false
})
export class MicroplanLeftWrapperComponent implements OnInit {
    RoutesChunks = RoutesChunks;
    private boundaryId: string;
    private activePage: ActivePageContext;

    @Input() boundary: GeoJsonBoundary | undefined;

    selectedIndex: number | null = null;
    tabs: MenuItem[] = [
        {
            name: "hf",
            label: "(0)",
            faIcon: faHouseMedical,
            routerLink: RoutesChunks.HEALTH_FACILITIES,
            queryParamsHandling: "preserve",
            component: HealthFacilitiesViewComponent,
        },
        {
            name: "settlements",
            label: "(0)",
            faIcon: faUsers,
            routerLink: RoutesChunks.SETTLEMENTS,
            queryParamsHandling: "preserve",
            component: SettlementsViewComponent,
        },
        {
            name: "problematic",
            label: "",
            faIcon: faListCheck,
            routerLink: RoutesChunks.FIELD_DATA_COLLECTION,
            queryParamsHandling: "preserve",
        },
        {
            name: "technical",
            label: "",
            faIcon: faSliders,
            //OVERVIEW
            routerLink: RoutesChunks.TECHNICAL,
            queryParamsHandling: "preserve",
        },
    ];
    private unsubscribe = new Subject();

    constructor(
        private activatedRoute: ActivatedRoute,
        private userContextService: UserContextService,
        private router: Router,
        public bvService: BoundaryVectorLayersService,
        private crudLayerService: CrudLayerService,
        private mapEvents: MapEventsService,
        private riRouteService: RIRouteService,
        private problemsService: ProblemsService,
        private vectorLayerService: VectorLayerService,
        private logger: NGXLogger,

    ) {
    }

    ngOnInit(): void {
        this.riRouteService.activePage$.pipe(
            switchMap(activePage => {
                this.activePage = activePage;
                this.boundaryId = this.riRouteService.getBoundaryIdValue();
                this.selectedIndex = this.tabs.findIndex(tab => tab.routerLink === activePage.page);
                this.logger.debug(`route service changed selected page to ${activePage.page} boundary id ${this.boundaryId} and selected index ${this.selectedIndex}`);

                return this.bvService.ensureBoundaryLoaded(this.boundaryId);
            }),
            switchMap(_ok => {
                return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
            }),
            filter(suppressUi => !suppressUi),
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            this.handleSubscribe();
        });
        this.subscribeToDataChanges();
    }

    ngOnDestroy(): void {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    private async handleSubscribe() {
        if (!this.bvService.boundaryInfo) {
            return;
        }
        // TODO - counting done not in the smart way - on page update instead of data update
        const hfCount = this.bvService.data.getHfFixedPost().length;
        const settlementList = this.bvService.data.getBoundaryPrimaryNameSettlementList();
        const settlementsCount = settlementList.filter(
            sn => !sn.properties.uninhabited
        ).length;

        this.tabs[0].label = `(${hfCount})`;
        this.tabs[1].label = `(${settlementsCount})`;
    }

    public formatPopulation(pop: PropertyValue) {
        return formatPopulation(pop);
    }

    onChangeTab($event: { index: number }) {
        const selectedTab = this.tabs[$event.index];
        if (selectedTab.routerLink === this.activePage.page) {
            return;
        }
        if (selectedTab.routerLink === RoutesChunks.HEALTH_FACILITIES) {
            this.hideEditedBoundaryLayer();
            if (this.riRouteService.getHfIdValue()) {
                this.router.navigate([
                    RoutesChunks.ROUTINE_IMMUNIZATION,
                    this.boundaryId,
                    RoutesChunks.HEALTH_FACILITIES,
                    this.riRouteService.getHfIdValue(),
                    RoutesChunks.EDIT], {
                    queryParamsHandling: selectedTab.queryParamsHandling
                });
                //We are done
                return;
            }
            //Routing occurs below
        } else if (selectedTab.routerLink === RoutesChunks.SETTLEMENTS) {
            this.hideEditedBoundaryLayer();
            if (this.riRouteService.getStIdValue()) {
                this.router.navigate([
                    RoutesChunks.ROUTINE_IMMUNIZATION,
                    this.boundaryId,
                    RoutesChunks.SETTLEMENTS,
                    this.riRouteService.getStIdValue(),
                    RoutesChunks.EDIT], {
                    queryParamsHandling: selectedTab.queryParamsHandling
                });
                return;
            }
            //Routing occurs below
        }
        // else if (selectedTab.routerLink === RoutesChunks.TECHNICAL) {
        //   this.router.navigate([
        //     RoutesChunks.ROUTINE_IMMUNIZATION,
        //     this.boundaryId,
        //     RoutesChunks.TECHNICAL,
        //     ], {
        //     queryParamsHandling: selectedTab.queryParamsHandling
        //   });
        // }

        //Because the technical (settings tab) is in top level overview, we can't
        //use relative navigation
        this.router.navigate([
            RoutesChunks.ROUTINE_IMMUNIZATION,
            this.boundaryId,
            selectedTab.routerLink], {
            //relativeTo: this.activatedRoute,
            queryParamsHandling: selectedTab.queryParamsHandling
        });

    }

    private subscribeToDataChanges() {
        // Note we no longer show an icon when there are problems, so no need to calculate this
        /*
        this.vectorLayerService.getVectorLayerObservable(ST_NAME_LAYER).pipe(
          switchMap(_ => {
            return this.bvService.ensureBoundaryLoaded(this.boundaryId);
          }),
          takeUntil(this.unsubscribe))
          .subscribe(_ => this.updateProblemsIndicator());
        this.vectorLayerService.getVectorLayerObservable(ST_GEOMETRY_LAYER).pipe(
          skip(1), //skipping on load event
          switchMap(_ => {
            return this.bvService.ensureBoundaryLoaded(this.boundaryId);
          }),
          takeUntil(this.unsubscribe))
          .subscribe(_ => this.updateProblemsIndicator());
        this.vectorLayerService.getVectorLayerObservable(HF_LAYER).pipe(
          skip(1), //skipping on load event
          switchMap(boundaryId => {
            return this.bvService.ensureBoundaryLoaded(this.boundaryId);
          }),
          takeUntil(this.unsubscribe))
          .subscribe(_ => this.updateProblemsIndicator());
        this.vectorLayerService.getVectorLayerObservable(BOUNDARY_EDITED_LAYER).pipe(
          skip(1), //skipping on load event
          switchMap(boundaryId => {
            return this.bvService.ensureBoundaryLoaded(this.boundaryId);
          }),
          takeUntil(this.unsubscribe))
          .subscribe(_ => this.updateProblemsIndicator());
          */
    }

    private hideEditedBoundaryLayer() {
        // we highlight settlements and hfs in the same layer so it is too risky to remove all features
        if (this.activePage.page == RoutesChunks.FIELD_DATA_COLLECTION) {
            this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, false);
            this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        }
    }

    // Note we no longer show an icon when there are problems, so no need to calculate this
    //   private updateProblemsIndicator() {
    //     this.problemsService.hasAnyProblems();
    //     this.problemsService.hasAnyIssue.subscribe(hasAnyIssue => {
    //       this.tabs[2].label = hasAnyIssue ? "true" : "";
    //     });
    //   }
}
