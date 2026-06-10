import { Injectable } from "@angular/core";
import { ActivatedRoute, NavigationEnd, Params, Router, Scroll } from "@angular/router";
import { NGXLogger } from "ngx-logger";
import { BehaviorSubject, Observable } from "rxjs";
import { RoutesChunks } from "src/app/constants/routing.enum";

export interface ActivePageContext {
    page: RoutesChunks,
    hfId: string | null,
    snId: string | null
}

@Injectable({
    providedIn: 'root'
})
export class RIRouteService {
    private boundaryId = new BehaviorSubject<string | null>(null);
    private settlementId = new BehaviorSubject<string | null>(null);
    private hfId = new BehaviorSubject<string | null>(null);

    public activePage$ = new BehaviorSubject<ActivePageContext>({
        page: RoutesChunks.EMPTY,
        hfId: null,
        snId: null,
    });

    // only for internal use to minimize repeated events
    private params: null | Map<any, any> = null;
    private activePath: RoutesChunks | null = null;
    constructor(
        private activatedRoute: ActivatedRoute,
        private router: Router,
        private logger: NGXLogger,
    ) {

        // this.boundaryId.subscribe(b => {
        //   this.logger.debug(`EEE Debug boundary id `, b);
        // });
        // this.settlementId.subscribe(b => {
        //   this.logger.debug(`EEE Debug settlementId id `, b);
        // });
        // this.hfId.subscribe(b => {
        //   this.logger.debug(`EEE Debug hfId id `, b);
        // });
        // this.activePage$.subscribe(b => {
        //   this.logger.debug(`EEE Debug activePage id ${b.page} hfId: ${b.hfId} snId: ${b.snId}`);
        // });

        this.router.events.subscribe(e => {
            if (e instanceof NavigationEnd) {
                this.logger.debug(`route events`, e);
                this.handleRouterEvent();
            }
        });
    }

    private handleRouterEvent() {
        if (!this.activatedRoute.snapshot) {
            return;
        }

        //wait until params are set
        let activePage: RoutesChunks = RoutesChunks.EMPTY;

        const rootRoute = getRootRoute(this.activatedRoute);
        //this.logger.info(`EEE rootRoute`, rootRoute.snapshot);
        for (const pathFromRootChunk of rootRoute.pathFromRoot) {
            if (!pathFromRootChunk.snapshot) {
                continue;
            }

            for (const urlSeg of pathFromRootChunk.snapshot.url) {
                if (urlSeg.path == RoutesChunks.SETTLEMENTS || urlSeg.path == RoutesChunks.HEALTH_FACILITIES || urlSeg.path == RoutesChunks.FIELD_DATA_COLLECTION || urlSeg.path == RoutesChunks.TECHNICAL) {
                    activePage = urlSeg.path;
                }
            }
        }
        let mergedParams = new Map();
        for (const pathFromRootChunk of rootRoute.pathFromRoot) {
            if (!pathFromRootChunk.snapshot) {
                continue;
            }
            mergedParams = { ...mergedParams, ...pathFromRootChunk.snapshot.params };
        }
        if (JSON.stringify(this.params) == JSON.stringify(mergedParams) && this.activePath == activePage) {
            return;
        }
        this.params = mergedParams;
        this.activePath = activePage;
        this.setParams(mergedParams, activePage);
    }

    public getHfIdObs(): Observable<string | null> {
        return this.hfId;
    }

    //Note !  This can also be an outreach to support navigating to one
    public getHfIdValue(): string {
        return this.hfId.value!;
    }

    public getStIdObs(): Observable<string | null> {
        return this.settlementId;
    }

    public getStIdValue(): string {
        return this.settlementId.value!;
    }

    public getBoundaryIdObs(): Observable<string | null> {
        return this.boundaryId;
    }

    public getBoundaryIdValue(): string {
        return this.boundaryId.value!;
    }

    private setParams(params: Params, activePage: RoutesChunks) {
        if (params.boundary) {
            if (this.boundaryId.value != params.boundary) {
                this.settlementId.next(null);
                this.hfId.next(null);
                this.boundaryId.next(params.boundary);
            }
        }
        if (params.settlement) {
            if (this.settlementId.value != params.settlement) {
                this.settlementId.next(params.settlement);
            }
        } else if (params.hf) {
            if (this.hfId.value != params.hf) {
                this.hfId.next(params.hf);
            }
        } else if (activePage == RoutesChunks.SETTLEMENTS) {
            // if user goes to the st list, reset only stId (not HF id), but update active page
            if (this.settlementId.value != null) {
                this.settlementId.next(null);
            }
        } else if (activePage == RoutesChunks.HEALTH_FACILITIES) {
            // if user goes to the HF list, reset only hfId (not ST id), but update active page
            if (this.hfId.value != null) {
                this.hfId.next(null);
            }
        }
        this.updateActivePageParams(params, activePage);
    }

    /**
     * Updated separatelly from the hfId and stId, because it
     * is updated each time and not only when it is changed
     * @private
     */
    private updateActivePageParams(params: Params, activePage: RoutesChunks) {
        if (params.settlement && this.activePage$.value.snId != params.settlement) {
            this.activePage$.next({
                page: RoutesChunks.SETTLEMENTS,
                hfId: null,
                snId: params.settlement
            });
        } else if (params.hf && this.activePage$.value.hfId != params.hf) {
            this.activePage$.next({
                page: RoutesChunks.HEALTH_FACILITIES,
                hfId: params.hf,
                snId: null
            });
        } else if (activePage == RoutesChunks.SETTLEMENTS) {
            this.activePage$.next({
                page: RoutesChunks.SETTLEMENTS,
                hfId: null,
                snId: null
            });
        } else if (activePage == RoutesChunks.HEALTH_FACILITIES) {
            this.activePage$.next({
                page: RoutesChunks.HEALTH_FACILITIES,
                hfId: null,
                snId: null
            });
        } else if (activePage == RoutesChunks.FIELD_DATA_COLLECTION) {
            this.activePage$.next({
                page: RoutesChunks.FIELD_DATA_COLLECTION,
                hfId: null,
                snId: null
            });
        } else if (activePage == RoutesChunks.TECHNICAL) {
            //This is the settings page, displayable in both the progress dashboard (components/dashboard/layout/layout.component.ts)
            //and microplan map (microplan-left-wrapper)
            this.activePage$.next({
                page: RoutesChunks.TECHNICAL,
                hfId: null,
                snId: null
            });
        } else {
            this.activePage$.next({
                page: RoutesChunks.DASHBOARD,
                hfId: null,
                snId: null
            });
        }
    }
}


function getRootRoute(route: ActivatedRoute): ActivatedRoute {
    while (route.firstChild) {
        route = route.firstChild;
    }
    return route;
}
