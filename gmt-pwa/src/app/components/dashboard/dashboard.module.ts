import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { LayoutComponent } from './layout/layout.component';
import { HealthFacilitiesComponent } from './panel-views/health-facilities/health-facilities.component';
import { ProgressComponent } from './panel-views/progress/progress.component';

import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BoundaryMapComponent } from '@components/dashboard/map/boundary-map.component';
import { BoundaryMapLegendComponent } from '@components/dashboard/map/control/legend/legend.component';
import { ToggleIndicatorsComponent } from '@components/dashboard/map/control/toggle-indicators/toggle-indicators.component';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { MatModule } from 'src/app/mat.module';
import { SharedModule } from 'src/app/_shared/shared.module';
import { CatchmentCardModule } from '../catchment-card/catchment-card.module';
import { GmtHeaderModule } from '../gmt-header/gmt-header.module';
import { MicroplanViewModule } from '../microplan-view/microplan-view.module';
import { BoundaryCardComponent } from './panel-views/progress/boundary-card/boundary-card.component';
import { BoundaryIndicatorsComponent } from './panel-views/progress/boundary-card/boundary-indicators.component';
import { ExportBoundaryCardComponent } from './panel-views/technical/export-boundary-card/export-boundary-card.component';
import { TechnicalComponent } from './panel-views/technical/technical.component';
import { WardDownloadCardComponent } from './panel-views/technical/ward-download-card/ward-download-card.component';

import { SyncPopupComponent } from '@components/dashboard/panel-views/technical/sync-popup/sync-popup.component';
import { ExportDialogComponent } from '@components/export-dialog/export-dialog.component';

@NgModule({
  declarations: [
    LayoutComponent,
    ProgressComponent,
    HealthFacilitiesComponent,

    TechnicalComponent,
    BoundaryCardComponent,
    BoundaryIndicatorsComponent,
    WardDownloadCardComponent,
    ExportBoundaryCardComponent,
    ToggleIndicatorsComponent,
    BoundaryMapComponent,
    BoundaryMapLegendComponent,
    SyncPopupComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    GmtHeaderModule,
    MatModule,
    MicroplanViewModule,
    NgxChartsModule,
    RouterModule,
    SharedModule,
    CatchmentCardModule,
    ExportDialogComponent,
  ],
  exports: [
    BoundaryMapComponent,
    ToggleIndicatorsComponent,
    // LayoutComponent,
  ],
})
export class DashboardModule {}
