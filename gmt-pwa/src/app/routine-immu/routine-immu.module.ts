import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AngularSplitModule } from 'angular-split';
import { AppPrimengModule } from 'src/app/_shared/libs/primeng.module';

import { ChipsModule } from 'primeng/chips';
import { FieldsetModule } from 'primeng/fieldset';
import { SliderModule } from 'primeng/slider';
import { MapControlBaselayerSwitcherComponent } from 'src/app/_shared/map/control/baselayer/map-control-baselayer-switcher.component';
import { MapControlSelectorComponent } from 'src/app/_shared/map/control/feature-selector/map-control-selector.component';
import { BoundarySearchComponent } from 'src/app/components/boundary-search/boundary-search.component';
import { GmtHeaderModule } from 'src/app/components/gmt-header/gmt-header.module';
import { GmtNewModule } from 'src/app/components/gmt-new/gmt-new.module';
import { ClickStopPropagationDirective } from 'src/app/directives/click-stop-propagation.directive';
import { ClickableToolTipDirective } from 'src/app/directives/clickable-tool-tip.directive';
import { MenuPopupDirective } from 'src/app/directives/menu-popup.directive';
import { MatModule } from 'src/app/mat.module';
import { MapControlDistanceSliderComponent } from 'src/app/routine-immu/microplan-boundary-map/map-control-distance-slider/map-control-distance-slider.component';
import { DataDownloadComponent } from './data-download/data-download.component';
import { HfDetailsComponent } from './hf-details/hf-details.component';
import { MicroplanBoundaryMapComponent } from './microplan-boundary-map/microplan-boundary-map.component';
import { MicroplanGisComponent } from './microplan-gis/microplan-gis.component';
import {
  MicroplanLeftWrapperComponent,
  UnderConstructionComponent,
} from './microplan-left-wrapper/microplan-left-wrapper.component';

import { MicroplanViewModule } from 'src/app/components/microplan-view/microplan-view.module';
import { PopupDirective } from 'src/app/directives/popup.directive';
import { PageMicroplanComponent } from './page-microplan-boundary/page-microplan.component';
//import { PrintMicroplanComponent } from './print-microplan/print-microplan.component';

import { UndoRedoComponent } from 'src/app/_shared/map/control/undo-redo/undo-redo.component';
import { SharedModule } from 'src/app/_shared/shared.module';
import { FacilityDetailsContentComponent } from 'src/app/routine-immu/hf-details/facility-details-content/facility-details-content.component';
import { HfSettlementContentComponent } from 'src/app/routine-immu/hf-details/hf-settlement/hf-settlement-content.component';
import { StaffContentComponent } from 'src/app/routine-immu/hf-details/staff/staff-content.component';
import { BoundaryIssuesComponent } from 'src/app/routine-immu/microplan-gis/boundary-issues/boundary-issues.component';
import { StDetailsContentComponent } from 'src/app/routine-immu/st-details/st-details-content/st-details-content.component';
import { StDetailsComponent } from 'src/app/routine-immu/st-details/st-details.component';
import { HfDetailsContentComponent } from 'src/app/routine-immu/st-details/st-health-facilities/hf-details/hf-details-content.component';
import { StHealthFacilitiesComponent } from 'src/app/routine-immu/st-details/st-health-facilities/st-health-facilities.component';
import { DrawPolygonComponent } from '../_shared/map/control/draw-polygon/draw-polygon.component';
import { LocationSelectorComponent } from '../_shared/map/control/location-selector/location-selector.component';
import { OutreachContentComponent } from './hf-details/outreach/outreach-content.component';

import { DragDropModule } from '@angular/cdk/drag-drop';
import { RouterModule } from '@angular/router';
import { LocationEditWizardComponent } from 'src/app/routine-immu/location-edit-wizard/location-edit-wizard.component';
import { BaseDataEditComponent } from 'src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component';
import { HfIssueEditComponent } from 'src/app/routine-immu/microplan-gis/base-data-edit/hf-issue-edit/hf-issue-edit.component';
import { SettlementIssueEditComponent } from 'src/app/routine-immu/microplan-gis/base-data-edit/settlement-issue-edit/settlement-issue-edit.component';
import { GeometryIssuesComponent } from 'src/app/routine-immu/microplan-gis/geometry-issues/geometry-issues.component';
import { HfGeometryEditComponent } from 'src/app/routine-immu/microplan-gis/geometry-issues/hf-geometry-edit/hf-geometry-edit.component';
import { StGeometryEditComponent } from 'src/app/routine-immu/microplan-gis/geometry-issues/st-geometry-edit/st-geometry-edit.component';
import { PopulationDataEditComponent } from 'src/app/routine-immu/microplan-gis/population-data-edit/population-data-edit.component';
import { CatchmentCardModule } from '../components/catchment-card/catchment-card.module';
import { DaysComponent } from './hf-details/days/days.component';
import { HfExcludedSettlementContentComponent } from './hf-details/hf-excluded-settlement/hf-excluded-settlement-content.component';

@NgModule({
  declarations: [
    BoundarySearchComponent,
    BaseDataEditComponent,
    BoundaryIssuesComponent,
    PopulationDataEditComponent,
    ClickStopPropagationDirective,
    ClickableToolTipDirective,
    DataDownloadComponent,
    FacilityDetailsContentComponent,
    GeometryIssuesComponent,
    StDetailsContentComponent,
    StHealthFacilitiesComponent,
    HfDetailsContentComponent,
    HfIssueEditComponent,
    HfDetailsComponent,
    HfGeometryEditComponent,
    StDetailsComponent,
    // HfOutreachDetailsComponent,
    // LocationComponent,
    MapControlBaselayerSwitcherComponent,
    MapControlDistanceSliderComponent,
    MapControlSelectorComponent,
    MenuPopupDirective,
    MicroplanBoundaryMapComponent,
    MicroplanGisComponent,
    MicroplanLeftWrapperComponent,
    UnderConstructionComponent,
    LocationEditWizardComponent,
    LocationSelectorComponent,
    PageMicroplanComponent,
    DrawPolygonComponent,
    PopupDirective,
    // PrintMicroplanComponent,
    SettlementIssueEditComponent,
    // SettlementPromoteComponent,
    StGeometryEditComponent,
    // SortByPipe,
    UndoRedoComponent,
    HfSettlementContentComponent,
    HfExcludedSettlementContentComponent,

    OutreachContentComponent,
  ],
  imports: [
    AngularSplitModule,
    AppPrimengModule,
    CatchmentCardModule,
    ChipsModule,
    CommonModule,
    // DashboardModule,
    FieldsetModule,
    FormsModule,
    GmtHeaderModule,
    GmtNewModule,
    MatModule,
    MicroplanViewModule,
    ReactiveFormsModule,
    SharedModule,
    SliderModule,
    //drag in LocationEditWizardComponent
    DragDropModule,

    StaffContentComponent,
    DaysComponent,
    //Because of microplan-left-wrapper
    RouterModule,
  ],
  exports: [
    // SettlementDemoteComponent,
    BoundarySearchComponent,
    BaseDataEditComponent,
    BoundaryIssuesComponent,
    PopulationDataEditComponent,
    ClickStopPropagationDirective,
    ClickableToolTipDirective,
    MapControlBaselayerSwitcherComponent,
    MapControlSelectorComponent,
    MenuPopupDirective,
    MicroplanBoundaryMapComponent,
    LocationEditWizardComponent,
    FacilityDetailsContentComponent,
    StDetailsContentComponent,
    StHealthFacilitiesComponent,
    HfDetailsContentComponent,
    MicroplanLeftWrapperComponent,
    PageMicroplanComponent,
    PopupDirective,
    //PrintMicroplanComponent,
  ],
})
export class RoutineImmuModule {}
