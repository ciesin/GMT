import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatModule } from 'src/app/mat.module';

import { HFCatchmentCardComponent } from './hf-catchment-card.component'
import { SettCatchmentCardComponent } from './sett-catchment-card.component';
import { CatchmentComponent } from './catchment/catchment.component';
import { CatchmentChipComponent } from './catchment/catchment-chip.component';

@NgModule({
  declarations: [
    HFCatchmentCardComponent,
    SettCatchmentCardComponent,
    CatchmentComponent,
  ],
  imports: [
    CommonModule,
    MatModule,
    RouterModule,
    CatchmentChipComponent,
  ],
  exports: [
    HFCatchmentCardComponent,
    SettCatchmentCardComponent,
    CatchmentComponent,
    CatchmentChipComponent,
  ]
})
export class CatchmentCardModule { }
