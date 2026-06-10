import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import { faDrawPolygon, faExclamationTriangle, faHouseMedical, faSliders, faTruckMedical } from '@fortawesome/free-solid-svg-icons';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { NGXLogger } from "ngx-logger";
import { BreadcrumbService } from "@services/breadcrumb.service";
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { matTabsAnimations } from '@angular/material/tabs';
import { filter, tap } from 'rxjs';
import { isNavigationEnd } from 'src/app/utils/route-helper';
import {IconDefinition} from "@fortawesome/angular-fontawesome";

export interface TabItem {
    name: TabName;
    label: string;
    faIcon: IconProp | IconDefinition;
    route: any[];
}

export type TabName = 'progress' | 'mobile' | 'attention' | 'technical';


const Tabs: Array<TabItem> = [
    {
        name: 'progress',
        label: 'Boundaries',
        faIcon: faDrawPolygon,
        route: [
            RoutesChunks.OVERVIEW,
            RoutesChunks.PROGRESS,
        ]
    },
    // {
    //   name: 'mobile',
    //   label: '(0)',
    //   faIcon: faTruckMedical,
    //   route: [
    //     RoutesChunks.OVERVIEW,
    //     RoutesChunks.HEALTH_FACILITIES,
    //   ]
    // },
    // {
    //   name: 'attention',
    //   label: '',
    //   faIcon: faExclamationTriangle,
    //   route: [
    //     RoutesChunks.OVERVIEW,
    //     RoutesChunks.ATTENTION,
    //   ]
    // },
    {
        name: 'technical',
        label: 'Manage',
        faIcon: faSliders,
        route: [
            RoutesChunks.OVERVIEW,
            RoutesChunks.TECHNICAL,
        ]
    }
]

@Component({
    selector: 'gmt-layout',
    templateUrl: './layout.component.html',
    styleUrls: [
        '../../../../less/header-drawer-page.less',
        './layout.component.less'
    ],
    standalone: false
})
export class LayoutComponent implements OnInit {
    public tabs = Tabs;
    public selectedIndex: number;

    constructor(
        private activatedRoute: ActivatedRoute,
        private breadcrumbService: BreadcrumbService,
        private router: Router,
        private crudLayerService: CrudLayerService,
        private logger: NGXLogger,
        public loadingService: IsLoadingService,
    ) {
        this.router.events.pipe(
            filter(isNavigationEnd),
            // tap(console.log),
        ).subscribe(event => {
            // subscribe to route change and update the selected tab accordingly
            const overviewRoutes = router.config.find(config => config.path === RoutesChunks.OVERVIEW);
            const routeConfig = overviewRoutes?.children!.find(config => config.path && event.urlAfterRedirects.includes(config.path));
            if (routeConfig) {
                this._updateSelectedIndex(routeConfig.data!.overviewSelectedTab);
            }
        });
    }

    async ngOnInit() {
        // this.updateTechnicalTabCount();
    }


    private _updateSelectedIndex(tabName: TabName) {
        this.selectedIndex = Tabs.findIndex(t => t.name === tabName);
    }

    // private async fetchInitialHierarchyData() : Promise<boolean> {
    //   const offlineBoundaries = await this.boundaryLayerService.getAllOfflineBoundaries();
    //   //const hierarchyList = await this.boundaryLayerService.fetchHierarchyList();
    //   this.logger.info("offlineBoundaries: ", offlineBoundaries);
    //
    //   const hierarchyList = await this.boundaryLayerService.fetchHierarchyList();
    //   this.logger.info("hierarchyList: ", hierarchyList);
    //
    //   this.loadingService.setLoading(false);
    //
    //   return true;
    // }

    private async updateTechnicalTabCount() {
        const crudActions = await this.crudLayerService.getSimplifiedCruds();
        const editedBoundaryIds = new Set(crudActions.map(x => x.changed_layer === 'boundary__polygon' ? x.geojson_after.properties.global_id : x.geojson_after.properties.boundary_polygon));
        Tabs.find(t => t.name === 'technical')!.label = `(${editedBoundaryIds.size})`;
    }

    trackByFn(index: number, tab: TabItem) {
        return tab.name;
    }

    async onChangeTab($event: { index: number }) {
        const selectedTab = this.tabs[$event.index];
        await this.breadcrumbService.routeOnTabSwitch(selectedTab.route);
    }
}
