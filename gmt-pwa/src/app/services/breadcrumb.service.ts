import { Injectable } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, } from "@angular/router";
import { VectorLayerService } from "./vector_layer/vector-layers.service";
import { BehaviorSubject, Observable } from "rxjs";
import { MenuItem } from "primeng/api";
import { RoutesChunks } from "src/app/constants/routing.enum";
import { HierarchyList, HierarchyListEntryBoundary } from "../utils/server-interfaces/HierarchyList";
import { getRouteChunks, routeFromChunks } from "../utils/route-helper";
import { BoundaryFocusService } from "./map/DashboardBoundaryService";
import { BoundaryLayerService } from "./vector_layer/boundary-layer.service";
import { NGXLogger } from 'ngx-logger';
import { AppConfigService } from "src/app/utils/app-config.service";
import { getSpComputedPop } from "src/app/utils/server-interfaces/utils/indicator.util";
import { FIXED_HEALTH_FACILITY_TYPE, OUTREACH_HEALTH_FACILITY_TYPE } from '../utils/server-interfaces/GeoJson';
import { BoundaryVectorLayersService } from "@services/boundary-vector-layers.service";
import { CoverageBoundary } from '@components/catchment-card/sett-catchment-card.component';

export interface BoundaryNameAndParent {
    name: string,
    boundaryId: string,
    parentBoundaryId: string | null,
    level: number
}

export const EMPTY_BOUNDARY_NAME_AND_PARENT: BoundaryNameAndParent = {

    level: -1,
    boundaryId: "",
    parentBoundaryId: null,
    name: ""
};

@Injectable({
    providedIn: 'root'
})
export class BreadcrumbService {
    //This is the current boundary id from the url
    private boundaryId = new BehaviorSubject<string | null>(null);
    private countryBoundaryId: string | null = null;

    private bIdToBreadCrumbInfo = new Map<string, BoundaryNameAndParent>();

    public $items: BehaviorSubject<MenuItem[]> = new BehaviorSubject<MenuItem[]>([]);


    constructor(
        public activatedRoute: ActivatedRoute,
        private bvService: BoundaryVectorLayersService,
        private vectorLayerService: VectorLayerService,
        private boundaryLayerService: BoundaryLayerService,
        private boundaryFocusService: BoundaryFocusService,
        private router: Router,
        private logger: NGXLogger
    ) {
        this.router.events.subscribe((event) => {
            if (event instanceof NavigationEnd && event.url) {
                if (this.boundaryId.value != null) {
                    this.boundaryId.next(null);
                }
                this.loadBoundaryIdFromActiveRoute();
                this.logger.debug(`BreadcrumbService Navigation End ${event.url}\nBoundaryId: ${this.boundaryId.value} `);
                this.updateBoundaryFocusService();
            }
        });

        this.boundaryLayerService.fetchHierarchyList().then(hierarchyList => {
            this.processHierarchyList(hierarchyList);

            //There isn't a nivigationend on the initial loading, so we attempt to read the activated route here
            this.loadBoundaryIdFromActiveRoute();
            this.updateBoundaryFocusService();
        });
    }

    public getBoundaryIdObs(): Observable<string | null> {
        return this.boundaryId.asObservable();
    }

    public async routeToBoundary(level: number, boundaryId: string, redirectToOfflineBoundary: boolean = true) {
        if (redirectToOfflineBoundary && level == AppConfigService.conf.generic.operational_boundary_level) {
            const offlineBoundaries: Set<string> = await this.boundaryLayerService.getAllOfflineBoundaries();
            if (offlineBoundaries.has(boundaryId)) {
                await this.router.navigate(
                    [routeFromChunks([
                        RoutesChunks.ROUTINE_IMMUNIZATION,
                        boundaryId,
                        RoutesChunks.HEALTH_FACILITIES
                    ], true)]
                );
                return;
            }
        }
        const routeChunks = getRouteChunks(this.router.url);
        if (routeChunks.length >= 2) {
            await this.router.navigate([routeFromChunks([
                routeChunks[0],
                routeChunks[1],
                boundaryId
            ])]);
        } else {
            await this.router.navigate([routeFromChunks([
                RoutesChunks.OVERVIEW,
                RoutesChunks.PROGRESS,
                boundaryId
            ])]);
        }
    }

    public async routeOnTabSwitch(newTabSelection: string[]): Promise<void> {
        const routeChunks = getRouteChunks(this.router.url);
        if (routeChunks.length > 2) { // if user selected the boundary, add it to the route
            newTabSelection = newTabSelection.concat([routeChunks[2]]);
        }
        await this.router.navigate([routeFromChunks(newTabSelection)]);
    }

    // private async getAllParentBoundaryIds(boundaryId: string, boundaryIds: string[]) {
    //   const boundaryMatch = await this.boundaryLayerService.fetchBoundaryById(boundaryId);
    //   if(!boundaryMatch || boundaryMatch.properties.level == 0){
    //     return boundaryIds;
    //   }
    //   boundaryIds.push(boundaryMatch.properties.global_id);
    //   return this.getAllParentBoundaryIds(boundaryMatch.properties.boundary_polygon, boundaryIds);
    // }

    private loadBoundaryIdFromActiveRoute() {
        const rootRoute = getRootRoute(this.activatedRoute);
        if (rootRoute.pathFromRoot.length >= 2) {
            const bId = rootRoute.pathFromRoot[1].snapshot.paramMap.get(RoutesChunks.PARAM_BOUNDARY.replace(':', ''));
            if (bId !== null && this.boundaryId.value != bId) {
                this.boundaryId.next(bId);
            }
        }
        //If it's not a microplan url (HF edit/list Settlement edit/list) then try a
        //progress map
        if (this.boundaryId.value == null) {
            const boundaryId = rootRoute.snapshot.paramMap.get(RoutesChunks.PARAM_BOUNDARY.substring(1));
            if (this.boundaryId.value != boundaryId) {
                this.boundaryId.next(boundaryId);
            }
        }
        this.updateBreadCrumbsFromBoundaryId();
    }

    private updateBoundaryFocusService() {
        if (this.bIdToBreadCrumbInfo.size <= 0) {
            return;
        }

        if (!this.boundaryId.value) {
            return;
        }

        const bInfo = this.bIdToBreadCrumbInfo.get(this.boundaryId.value);
        if (!bInfo) {
            this.logger.error(`Unable to find breadcrumb info for ${this.boundaryId.value}`);
            return;
        }
        this.boundaryFocusService.setFocus(bInfo);
    }

    private updateBreadCrumbsFromBoundaryId() {
        //If we are still fetching the hierachy, then quit.  Once the hierarchy is fetched this method will be called again

        if (this.bIdToBreadCrumbInfo.size <= 0) {
            return;
        }

        const nextBreadCrumbs: Array<MenuItem> = [];

        let cBoundaryId = (this.boundaryId.value) ? this.boundaryId.value : this.countryBoundaryId;
        while (cBoundaryId != null) {

            const bInfo = this.bIdToBreadCrumbInfo.get(cBoundaryId)!;

            const menuItem = {
                label: bInfo.name,
                routerLink: routeFromChunks([RoutesChunks.OVERVIEW, RoutesChunks.PROGRESS, cBoundaryId], true),
            };

            nextBreadCrumbs.push(menuItem);
            cBoundaryId = bInfo.parentBoundaryId;
        }

        nextBreadCrumbs.reverse();

        this.$items.next(nextBreadCrumbs);
    }

    private processHierarchyList(hierarchyList: HierarchyList) {
        this.bIdToBreadCrumbInfo.clear();
        if (hierarchyList.list && hierarchyList.list.length > 0) {
            this.countryBoundaryId = hierarchyList.list[0].global_id;
        }
        this.processHierarchyListHelper(hierarchyList.list, null, 0);

    }

    private processHierarchyListHelper(children: Array<HierarchyListEntryBoundary>, parentId: string | null, level: number) {
        for (const be of children) {
            this.bIdToBreadCrumbInfo.set(be.global_id, {
                name: be.name,
                parentBoundaryId: parentId,
                boundaryId: be.global_id,
                level
            });

            //Don't process health facilities children
            if (be.children.length > 0 && be.children[0].type != "boundary") {
                continue;
            }

            this.processHierarchyListHelper(be.children as Array<HierarchyListEntryBoundary>, be.global_id, 1 + level);
        }
    }

    /*
    Note that while the boundary data is fetched with the indicators
    (see fetchBoundaryById / updateBoundaryById / fetchBoundaryDataIfNeeded)

    This method recomputes it client side
    */
    public getLowestAdminCatchmentInfo(): CoverageBoundary | null {
        let fixedPostPopulation = 0;
        let outreachPopulation = 0;
        let unclaimedPopulation = 0;
        let problematicPopulation = 0;
        let settlementList = this.bvService.data.getBoundaryPrimaryNameSettlementList();

        for (const settlementName of settlementList) {

            //Uninhabited if not yet synced will still have sp.computedPop > 0; so we need to skip these explicitly
            if (settlementName.properties.uninhabited) {
                continue;
            }

            const settlementPart = this.bvService.data.spMap.get(settlementName.properties.settlement_part!);
            if (!settlementPart) {
                continue;
            }

            const settlementPopulation = getSpComputedPop(settlementPart);
            const catchments = this.bvService.data.getCatchmentForSp(settlementPart.properties.global_id, true, true);

            let populationClaimedForOneSettlement = 0;
            for (const catchment of catchments) {
                const healthFacility = this.bvService.data.hfMap.get(catchment.properties.health_facility_point);
                if (!healthFacility) {
                    return null;
                }
                let settlementPop = catchment.properties.population_perc * settlementPopulation / 100;

                if (healthFacility.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
                    fixedPostPopulation += settlementPop;
                    populationClaimedForOneSettlement += settlementPop;
                } else if (healthFacility.properties.type === OUTREACH_HEALTH_FACILITY_TYPE) {
                    outreachPopulation += settlementPop;
                    populationClaimedForOneSettlement += settlementPop;
                }

                if (settlementName.properties.problematic.length > 0) {
                    problematicPopulation += settlementPop;
                }
            }
            unclaimedPopulation += (settlementPopulation - populationClaimedForOneSettlement);
        }

        const totalBoundaryPop = fixedPostPopulation + outreachPopulation + unclaimedPopulation;

        return {
            pop: totalBoundaryPop,
            fixedPost: fixedPostPopulation,
            outreach: outreachPopulation,
            unclaimed: unclaimedPopulation,
            problematic: problematicPopulation,
        };
    }
}

function getRootRoute(route: ActivatedRoute): ActivatedRoute {
    while (route.firstChild) {
        route = route.firstChild;
    }
    return route;
}
