import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrudComponent } from './crud/crud.component';
import { MatModule } from 'src/app/mat.module';
import { MaterialOverridesComponent } from './material-overrides/material-overrides.component';
import { ConfirmationPinComponent } from "@components/dev-tools/confirmation-pin/confirmation-pin.component";
import { FormsModule } from '@angular/forms';



@NgModule({
  declarations: [
    CrudComponent,
    MaterialOverridesComponent,
    ConfirmationPinComponent
  ],
  imports: [
    CommonModule,
    MatModule,
    FormsModule
  ],
  exports: [
    ConfirmationPinComponent
  ]
})
export class DevToolsModule { }
