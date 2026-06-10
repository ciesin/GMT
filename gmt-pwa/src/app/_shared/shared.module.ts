import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from 'src/app/components/multi-select/multi-select.component';
import { MatModule } from 'src/app/mat.module';
import { GmtAccordionComponent } from 'src/app/_shared/components/accordion/accordion.component';
import { ConfirmationMessageComponent } from 'src/app/_shared/components/confirmation-message/confirmation-message.component';
import { FeatureDetailsComponent } from 'src/app/_shared/map/control/feature-details/feature-details.component';
import { MapControlZoomComponent } from 'src/app/_shared/map/control/zoom/map-control-zoom.component';
import { SnackbarMessageComponent } from './components/snackbar-message/snackbar-message.component';
import { DropdownComponent } from './dropdown/dropdown.component';
import { DropdownSwitchComponent } from './dropdownSwitch/dropdown-switch.component';
import { HelpComponent } from './help/help.component';
import { SortableHeadersComponent } from './sortable-headers.component';

import { CatchmentCardModule } from '@components/catchment-card/catchment-card.module';
import { InstallPwaComponent } from 'src/app/_shared/components/install-pwa/install-pwa.component';
import { LayersSelectorIconComponent } from 'src/app/_shared/map/control/layers-selector/layers-selector-icon/layers-selector-icon.component';
import { LocationComponent } from 'src/app/_shared/map/control/location/location.component';

@NgModule({
  declarations: [
    ConfirmationMessageComponent,
    DropdownComponent,
    DropdownSwitchComponent,
    FeatureDetailsComponent,
    GmtAccordionComponent,
    HelpComponent,
    InstallPwaComponent,
    LayersSelectorIconComponent,
    MultiSelectComponent,
    LocationComponent,
    SortableHeadersComponent,
    SnackbarMessageComponent,
    MapControlZoomComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    MatModule,
    ReactiveFormsModule,
    CatchmentCardModule, // I had to add this for feature details catchment component only
  ],
  exports: [
    DropdownComponent,
    DropdownSwitchComponent,
    FeatureDetailsComponent,
    GmtAccordionComponent,
    HelpComponent,
    InstallPwaComponent,
    LayersSelectorIconComponent,
    MultiSelectComponent,
    LocationComponent,
    SortableHeadersComponent,
    MapControlZoomComponent,
  ],
})
export class SharedModule {}
