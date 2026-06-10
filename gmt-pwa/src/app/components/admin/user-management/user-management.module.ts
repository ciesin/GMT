import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AngularSplitModule } from 'angular-split';
import { AppPrimengModule } from 'src/app/_shared/libs/primeng.module';
import {InputTextModule} from 'primeng/inputtext';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from "@angular/forms";
import {SharedModule} from 'src/app/_shared/shared.module';
import {FieldsetModule} from 'primeng/fieldset';
import {ChipsModule} from "primeng/chips";
import {UserListComponent} from "./user-list/user-list.component";
import {UserManagementComponent} from "./user-management.component";
import {RoutineImmuModule} from "src/app/routine-immu/routine-immu.module";
import {UserCreateComponent} from "./user-create/user-create.component";
import { PasswordModule } from "primeng/password";
import {BoundaryMapComponent} from "./user-create/boundary-map/boundary-map.component";
import {RoleAssignmentPopupComponent} from "./role-assignment-popup/role-assignment-popup.component";
import {
  GeoPermissionAssignmentPopupComponent
} from "./geo-permission-assignment-popup/gep-permission-assignment-popup.component";
import { GmtHeaderModule } from "@components/gmt-header/gmt-header.module";
import { MatModule } from "src/app/mat.module";


@NgModule({
  declarations: [
    UserListComponent,
    UserCreateComponent,
    RoleAssignmentPopupComponent,
    GeoPermissionAssignmentPopupComponent,
    UserManagementComponent,
    BoundaryMapComponent
  ],
    imports: [
        AngularSplitModule,
        AppPrimengModule,
        BrowserAnimationsModule,
        ChipsModule,
        CommonModule,
        FieldsetModule,
        FormsModule,
        GmtHeaderModule,
        InputTextModule,
        MatModule,
        PasswordModule,
        RoutineImmuModule,
        SharedModule,
    ],
  exports: [
    UserListComponent,
    UserCreateComponent,
    RoleAssignmentPopupComponent,
    GeoPermissionAssignmentPopupComponent,
    UserManagementComponent,
    BoundaryMapComponent
  ]
})
export class UserManagementModule { }
