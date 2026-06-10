import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from 'src/app/_shared/shared.module';
import { MatModule } from 'src/app/mat.module';

import { BreadcrumbComponent } from './breadcrumb/breadcrumb.component';
import { GmtHeaderComponent } from './gmt-header.component';
import { MenuComponent } from './menu/menu.component';
import { PopComponent } from './pop/pop.component';
import { CatchmentCardModule } from "@components/catchment-card/catchment-card.module";
import { DevToolsModule } from "@components/dev-tools/dev-tools.module";



@NgModule({
  declarations: [
    BreadcrumbComponent,
    GmtHeaderComponent,
    MenuComponent,
    PopComponent,
  ],
    imports: [
        CatchmentCardModule,// I had to add this for feature details catchment component only
        CommonModule,
        RouterModule,
        SharedModule,
        MatModule,
        DevToolsModule,
    ],
  exports: [
    GmtHeaderComponent,
  ]
})
export class GmtHeaderModule { }
