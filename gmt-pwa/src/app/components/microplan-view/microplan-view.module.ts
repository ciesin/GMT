import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { CatchmentCardModule } from 'src/app/components/catchment-card/catchment-card.module';
import { MatModule } from 'src/app/mat.module';

import { MicroplanFilterComponent } from './microplan-filter/microplan-filter.component';
import { MicroplanListComponent } from './microplan-list/microplan-list.component';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { HealthFacilityWizardComponent } from '../wizard/health-facility-wizard/health-facility-wizard.component';
import { SettlementWizardComponent } from '../wizard/settlement-wizard/settlement-wizard.component';

import { WizardPolygonEditComponent } from '@components/wizard/wizard-polygon-edit/wizard-polygon-edit.component';
import { DaysComponent } from 'src/app/routine-immu/hf-details/days/days.component';
import { BoundaryEditComponent } from 'src/app/_shared/components/boundary-edit/boundary-edit.component';
import { MapControlLayersSelectorComponent } from 'src/app/_shared/map/control/layers-selector/map-control-layers-selector.component';
import { GmtNewModule } from '../gmt-new/gmt-new.module';
import { SplitMergeWizardComponent } from '../wizard/split-merge-wizard/split-merge-wizard.component';
import { WizardListControlComponent } from '../wizard/wizard-list-control/wizard-list-control.component';
import { WizardLocationControlComponent } from '../wizard/wizard-location-control/wizard-location-control.component';
import { HealthFacilitiesViewComponent } from './health-facilities-view/health-facilities-view.component';
import { SettlementsViewComponent } from './settlements-view/settlements-view.component';

@NgModule({
  declarations: [
    HealthFacilitiesViewComponent,
    HealthFacilityWizardComponent,
    MicroplanFilterComponent,
    MicroplanListComponent,

    SettlementWizardComponent,
    SplitMergeWizardComponent,
    SettlementsViewComponent,
    WizardListControlComponent,
    WizardLocationControlComponent,

    BoundaryEditComponent,
    MapControlLayersSelectorComponent,
    WizardPolygonEditComponent,
  ],
  imports: [
    CommonModule,
    GmtNewModule,
    MatModule,
    CatchmentCardModule,
    FormsModule,
    ReactiveFormsModule,
    DaysComponent,
    //Have the modal popup be draggable
  ],
  exports: [
    MicroplanListComponent,
    WizardListControlComponent,
    SettlementsViewComponent,
    HealthFacilitiesViewComponent,
    MicroplanFilterComponent,
    WizardLocationControlComponent,
    MapControlLayersSelectorComponent,
    BoundaryEditComponent,
    WizardPolygonEditComponent,
  ],
})
export class MicroplanViewModule {}
