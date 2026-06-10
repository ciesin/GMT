import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatModule } from 'src/app/mat.module';

import { GmtNewComponent } from './gmt-new.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import {MatTooltipModule} from '@angular/material/tooltip';


@NgModule({
  declarations: [GmtNewComponent],
  imports: [
    BrowserAnimationsModule,
    CommonModule,
    MatModule,
    MatTooltipModule
  ],
  exports: [GmtNewComponent]
})
export class GmtNewModule { }
