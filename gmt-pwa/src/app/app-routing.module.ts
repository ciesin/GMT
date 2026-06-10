import { Component, NgModule } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  Route,
  RouteReuseStrategy,
  RouterModule,
  UrlSegment,
} from '@angular/router';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { HfDetailsComponent } from './routine-immu/hf-details/hf-details.component';
// import { MicroplanSettlementEditComponent } from './routine-immu/microplan-settlement-edit/microplan-settlement-edit.component';
import { DataDownloadComponent } from 'src/app/routine-immu/data-download/data-download.component';
import { UnsupportedBrowserComponent } from 'src/app/unsupported-browser/unsupported-browser.component';
import { UserManagementComponent } from './components/admin/user-management/user-management.component';
import { iBreadcrumbDisplay } from './components/gmt-header/gmt-header.component';
import { HealthFacilitiesViewComponent } from './components/microplan-view/health-facilities-view/health-facilities-view.component';
import { SettlementsViewComponent } from './components/microplan-view/settlements-view/settlements-view.component';
import { LandingPageComponent } from './landing-page/landing-page.component';
import { MicroplanGisComponent } from './routine-immu/microplan-gis/microplan-gis.component';

import { PageMicroplanComponent } from './routine-immu/page-microplan-boundary/page-microplan.component';
import { routeFromChunks } from './utils/route-helper';
import { LoggedInGuard } from 'src/app/guards/loggedin.guard';
import { StDetailsComponent } from 'src/app/routine-immu/st-details/st-details.component';
import {
  LayoutComponent,
  TabName,
} from './components/dashboard/layout/layout.component';
import { ProgressComponent } from './components/dashboard/panel-views/progress/progress.component';
import { UnderConstructionComponent } from './routine-immu/microplan-left-wrapper/microplan-left-wrapper.component';
import { TechnicalComponent } from './components/dashboard/panel-views/technical/technical.component';

import { HfMapLoaderComponent } from '@components/export-dialog/pdf-maps/hf-map-loader/hf-map-loader.component';
import { CatchmentTechViewComponent } from '@components/catchment-tech-view/catchment-tech-view.component';

interface RouteData {
  pageTitle: string;
  breadcrumb?: iBreadcrumbDisplay;
  boundaryCached?: boolean; // should the route be cached among the same boundary
  overviewSelectedTab?: TabName;
  [key: string]: any;
}

interface RouteWithData extends Route {
  data?: RouteData;
  children?: RouteWithData[];
}

const routes: RouteWithData[] = [
  {
    path: RoutesChunks.EMPTY,
    pathMatch: 'full',
    redirectTo: RoutesChunks.OVERVIEW,
  },
  {
    canActivate: [LoggedInGuard],
    path: routeFromChunks(
      [RoutesChunks.CATCHMENT_TECH_VIEW, RoutesChunks.PARAM_BOUNDARY],
      false
    ),
    component: CatchmentTechViewComponent,
    data: {
      pageTitle: 'Catchment Tech View',
    },
  },
  {
    path: RoutesChunks.ROUTINE_IMMUNIZATION,
    redirectTo: RoutesChunks.OVERVIEW,
    pathMatch: 'full',
  },
  {
    // dashboard
    canActivate: [LoggedInGuard],
    path: RoutesChunks.OVERVIEW,
    component: LayoutComponent,
    data: {
      pageTitle: 'Overview',
    },
    children: [
      {
        path: RoutesChunks.EMPTY,
        pathMatch: 'full',
        redirectTo: RoutesChunks.TECHNICAL,
      },
      {
        path: RoutesChunks.PROGRESS,
        pathMatch: 'full',
        component: ProgressComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'progress',
          boundaryCached: false, //YM: Changed this to false so that onInit is called on ProgressComponent to solve: https://github.com/novelt/GMT/issues/2380
        },
      },
      {
        path: routeFromChunks(
          [RoutesChunks.PROGRESS, RoutesChunks.PARAM_BOUNDARY],
          false
        ),
        pathMatch: 'full',
        component: ProgressComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'progress',
          boundaryCached: true,
        },
      },
      {
        path: RoutesChunks.HEALTH_FACILITIES,
        pathMatch: 'full',
        component: UnderConstructionComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'mobile',
          boundaryCached: true,
        },
      },
      // {
      //   path:routeFromChunks([RoutesChunks.PROGRESS, RoutesChunks.PARAM_BOUNDARY2], false),
      //   pathMatch: 'full',
      //   component: ProgressComponent,
      // },
      {
        path: routeFromChunks(
          [RoutesChunks.HEALTH_FACILITIES, RoutesChunks.PARAM_BOUNDARY],
          false
        ),
        pathMatch: 'full',
        component: UnderConstructionComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'mobile',
          boundaryCached: true,
        },
      },

      {
        path: RoutesChunks.TECHNICAL,
        pathMatch: 'full',
        component: TechnicalComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'technical',
          //Attempt to fix https://github.com/novelt/GMT/issues/2385
          boundaryCached: false,
        },
      },
      {
        path: routeFromChunks(
          [RoutesChunks.TECHNICAL, RoutesChunks.PARAM_BOUNDARY],
          false
        ),
        pathMatch: 'full',
        component: TechnicalComponent,
        data: {
          pageTitle: '', //TODO find a good title
          overviewSelectedTab: 'technical',
          boundaryCached: true,
        },
      },
    ],
  },
  {
    canActivate: [LoggedInGuard],
    path: routeFromChunks(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        RoutesChunks.DATA_DOWNLOAD,
        RoutesChunks.PARAM_JOB_ID,
      ],
      false
    ),
    component: DataDownloadComponent,
    data: {
      pageTitle: 'Data download',
    },
  },
  {
    canActivate: [LoggedInGuard],
    path: routeFromChunks(
      [RoutesChunks.ROUTINE_IMMUNIZATION, RoutesChunks.PARAM_BOUNDARY],
      false
    ),
    component: PageMicroplanComponent,
    data: {
      pageTitle: 'Routine Immunization',
      //breadcrumb: 'boundary', // dynamically guessed from current route.PARAM_
    },
    children: [
      {
        path: RoutesChunks.EMPTY,
        pathMatch: 'full',
        redirectTo: RoutesChunks.HEALTH_FACILITIES,
      },
      {
        path: RoutesChunks.HEALTH_FACILITIES,
        pathMatch: 'full',
        // component: MicroplanHfListComponent,
        component: HealthFacilitiesViewComponent,
        data: {
          pageTitle: 'Routine Immunization',
          boundaryCached: true,
        },
      },
      {
        path: routeFromChunks(
          [
            RoutesChunks.HEALTH_FACILITIES,
            RoutesChunks.PARAM_HF,
            RoutesChunks.EDIT,
          ],
          false
        ),
        component: HfDetailsComponent,
        data: {
          pageTitle: 'Routine Immunization',
          //breadcrumb: 'hf',
          boundaryCached: true,
        },
      },
      {
        path: RoutesChunks.SETTLEMENTS,
        component: SettlementsViewComponent,
        data: {
          pageTitle: 'Routine Immunization',
          boundaryCached: true,
        },
      },
      {
        path: routeFromChunks(
          [
            RoutesChunks.SETTLEMENTS,
            RoutesChunks.PARAM_SETTLEMENT,
            RoutesChunks.EDIT,
          ],
          false
        ),
        component: StDetailsComponent,
        data: {
          pageTitle: 'Routine Immunization',
          //breadcrumb: 'settlement',
          boundaryCached: true,
        },
      },
      {
        path: RoutesChunks.FIELD_DATA_COLLECTION,
        component: MicroplanGisComponent,
        // component: UnderConstructionComponent,
        data: {
          pageTitle: 'Routine Immunization',
          boundaryCached: true,
        },
      },
      {
        path: RoutesChunks.TECHNICAL,
        component: TechnicalComponent,
        data: {
          pageTitle: 'Routine Immunization',
          boundaryCached: false,
        },
      },
    ],
  },
  {
    canActivate: [LoggedInGuard],
    path: RoutesChunks.USER_MANAGEMENT,
    pathMatch: 'full',
    component: UserManagementComponent,
    data: {
      pageTitle: 'User management',
    },
  },
  // {
  //   path: RoutesChunks.MATERIAL,
  //   pathMatch: 'full',
  //   component: MaterialOverridesComponent,
  //   data: {
  //     pageTitle: 'Overrided material components'
  //   }
  // },
  {
    path: RoutesChunks.UNSUPPORTED_BROWSER,
    pathMatch: 'full',
    component: UnsupportedBrowserComponent,
    data: {
      pageTitle: 'Unsupported Browser',
    },
  },
  {
    canActivate: [LoggedInGuard],
    path: 'hf_map',
    pathMatch: 'full',
    component: HfMapLoaderComponent,
  },
];

class CacheRouteReuseStrategy implements RouteReuseStrategy {
  private storedRouteHandles = new Map<string, DetachedRouteHandle>();

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    // Should the component be saved ?

    // cached routes are the ones that has data.boundaryCached set to true
    return !!route.data?.boundaryCached;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
    // Store route handle
    this.storedRouteHandles.set(this._routeHash(route), handle);
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    // Should a new component be retrived or created from scratch
    // Retrieved if returns true, newly created if false.

    // FIXME find a way to force refresh cached routes
    const isStored = this.storedRouteHandles.has(this._routeHash(route));
    return isStored;
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle {
    // retrieve stored route
    const handle = this.storedRouteHandles.get(this._routeHash(route))!;
    return handle;
  }

  shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    curr: ActivatedRouteSnapshot
  ): boolean {
    // Should the routing be re-used (i.e., skip routing) ?

    // same route
    return future.routeConfig === curr.routeConfig;
  }

  private _routeHash(route: ActivatedRouteSnapshot): string {
    return route.routeConfig!.path!;
  }
}

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: CacheRouteReuseStrategy,
    },
  ],
})
export class AppRoutingModule {}
