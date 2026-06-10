import {
  Component,
  ElementRef,
  EventEmitter,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { BoundaryMapComponent } from '@components/dashboard/map/boundary-map.component';
import { UserManagementService } from '@services/user/user-management.service';
import { isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { IsOnlineService } from 'src/app/services/is-online.service';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { AuthService } from 'src/app/services/user/auth.service';
import {
  AdminRole,
  EditorRole,
  MicroplanStatusManagerRole,
  ParticipationManagerRole,
  Roles,
  UserAdminRole,
} from 'src/app/utils/server-interfaces/user/UserRoles';
import {
  DefaultUserInfoProperties,
  GeoPermission,
  UserInfo,
} from '../../../utils/server-interfaces/user/User';

@Component({
  selector: 'user-management-component',
  templateUrl: './user-management.component.html',
  styleUrls: ['./user-management.component.less'],
  standalone: false
})
export class UserManagementComponent implements OnInit {
  @ViewChild('mapPanel') progressMapPanel?: BoundaryMapComponent;
  public loaded = true;
  public isOnline: boolean | null = true;
  public userIsUserAdmin: boolean | null = false;
  public userId: string | null = null;
  public userEditorView: boolean = false;
  public totalUsers: number = 0;
  public editableRoles = false;
  public editableGeoPermissions = false;
  public refreshUserList: EventEmitter<boolean> = new EventEmitter();
  public editableRolesObs: EventEmitter<boolean> = new EventEmitter();
  public editableGeoPermissionsObs: EventEmitter<boolean> = new EventEmitter();
  public applyUserEditsObs: EventEmitter<boolean> = new EventEmitter();
  public cancelUserEditsObs: EventEmitter<boolean> = new EventEmitter();
  @ViewChild('usersCsv')
  usersCsvFileRef: ElementRef;

  private unsubscribe = new Subject();

  constructor(
    private isOnlineService: IsOnlineService,
    public loadingService: IsLoadingService,
    private authService: AuthService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService,
    private userManagementService: UserManagementService,
    private router: Router,
    private logger: NGXLogger
  ) {}

  ngOnInit(): void {
    this.isOnlineService
      .isOnlineStream()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((inOnline) => {
        this.isOnline = inOnline;
      });
    this.authService
      .loggedIn()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((loggedIn: boolean | null) => {
        if (loggedIn) {
          this.saveAndUpdatePermissions();
        }
      });
  }
  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public handleGeoPermissionsAssignment() {
    this.editableGeoPermissions = !this.editableGeoPermissions;
    if (this.editableGeoPermissions) {
      this.editableRoles = false;
      this.editableRolesObs.next(this.editableRoles);
    }
    this.editableGeoPermissionsObs.next(this.editableGeoPermissions);
  }

  public handleRoleAssignment() {
    this.editableRoles = !this.editableRoles;
    if (this.editableRoles) {
      this.editableGeoPermissions = false;
      this.editableGeoPermissionsObs.next(this.editableGeoPermissions);
    }
    this.editableRolesObs.next(this.editableRoles);
  }

  public handleTotalUsersChanged(totalUsers: number) {
    this.totalUsers = totalUsers;
  }

  public handleUserChanged(userId: string | null | boolean) {
    if (userId) {
      this.userId = userId as string;
    } else {
      this.userId = null;
    }
    this.handleEditUserOpen(true);
  }

  public handleCancelMultipleUserUpdate() {
    this.logger.debug('handleCancelMultipleUserUpdate');
    this.editableRoles = false;
    this.editableGeoPermissions = false;
    this.editableRolesObs.next(this.editableRoles);
    this.editableGeoPermissionsObs.next(this.editableGeoPermissions);
    this.cancelUserEditsObs.next(true);
  }

  public handleImportUsers(event: Event) {
    this.loadingService.setLoading(true);
    const target = event.target as HTMLInputElement;
    const files = target.files as FileList;
    const file: File = files[0];

    if (file) {
      if (!this.validateCsvFormat(files[0])) {
        this.messageService.add({
          summary: 'Error',
          detail: 'File is not .csv',
          severity: 'error',
        });
      }
      let reader = new FileReader();
      reader.readAsText(files[0]);

      reader.onload = () => {
        let csvData = reader.result;
        let csvRecordsArray = (<string>csvData).split(/\r\n|\n/);
        let users = this.getUsersFromCsv(csvRecordsArray);
        let message = `${
          users.length == 1 ? '1 user' : users.length + ' users'
        } were found in csv. Do you want to create them?`;
        this.confirmationService.confirm({
          message: message,
          header: 'Import Users',
          icon: 'noicon',
          rejectLabel: 'No',
          showRejectButton: true,
          acceptLabel: 'Create',
          accept: async () => {
            this.usersCsvFileRef.nativeElement.value = '';
            this.userManagementService
              .createUsers(users)
              .subscribe((success) => {
                this.logger.debug(success, 'success');
                this.messageService.add({
                  summary: 'Success',
                  detail: 'Users were created',
                  severity: 'info',
                });
              });
          },
        });
        this.logger.debug(users, 'users');
      };

      reader.onerror = function () {
        console.warn('error is occurred while reading file!');
      };
    }
    this.loadingService.setLoading(false);
  }

  getUsersFromCsv(csvRows: any): UserInfo[] {
    let users: UserInfo[] = [];

    for (let i = 1; i < csvRows.length; i++) {
      let row = (<string>csvRows[i]).split(',');
      // at least email and username is needed
      if (row.length < 2) {
        continue;
      }
      this.logger.debug(row, 'row');
      let user: UserInfo = {
        ...DefaultUserInfoProperties,
        username: row[0]?.trim(),
        email: row[1]?.trim(),
        first_name: row[2]?.trim(),
        last_name: row[3]?.trim(),
      };
      let roles: string[] = row[4]?.trim().split(';');
      user.roles = this.convertRolesToRoleIds(roles, user.email);
      let geoPermissions: string[] = row[5]?.trim().split(';');
      user.geo_permissions = this.convertGeoPermissionNamesToGuids(
        geoPermissions,
        user.email
      );

      if (row.length >= 7) {
        user.password = row[6]?.trim();

        //don't set temp password unless there is one
        if (isNil(user.password) || user.password.length == 0) {
          delete user.password;
        }
      }
      // ignore half empty rows where no email is given
      if (user.email != '') {
        users.push(user);
      }
    }

    return users;
  }

  public handleMultipleUsersUpdate() {
    this.applyUserEditsObs.next(true);
  }

  private convertRolesToRoleIds(roles: string[], userEmail: string) {
    let cleanedRoles: string[] = [];
    if (!roles) {
      return cleanedRoles;
    }
    roles.forEach((role) => {
      role = role.trim().toUpperCase();

      if (role == EditorRole.name.toUpperCase()) {
        cleanedRoles.push(EditorRole.id);
      } else if (role == UserAdminRole.name.toUpperCase()) {
        cleanedRoles.push(UserAdminRole.id);
      } else if (role == AdminRole.name.toUpperCase()) {
        cleanedRoles.push(AdminRole.id);
      } else if (role == ParticipationManagerRole.name.toUpperCase()) {
        cleanedRoles.push(ParticipationManagerRole.id);
      } else if (role == MicroplanStatusManagerRole.name.toUpperCase()) {
        cleanedRoles.push(MicroplanStatusManagerRole.id);
      } else if (role.length > 0) {
        const warningMessage = `Cannot find matching role for user ${userEmail} with role '${role}'. It should be one
        of ${Roles.map((r) => r.name.toUpperCase()).join(',')}`;
        this.logger.debug(warningMessage);
        this.messageService.add({
          summary: 'Warning',
          detail: warningMessage,
          severity: 'warning',
        });
      }
    });
    return cleanedRoles;
  }

  private convertGeoPermissionNamesToGuids(
    geoPermissionsNames: string[],
    userEmail: string
  ): Map<string, GeoPermission> {
    let geoPermissions = new Map<string, GeoPermission>();
    geoPermissionsNames.forEach((geoPermissionName: string) => {
      geoPermissionName = geoPermissionName.trim();
      if (geoPermissionName.length > 0) {
        let geoPermissionNameParts = geoPermissionName.split(' -> ');
        if (geoPermissionNameParts.length != 4) {
          this.messageService.add({
            summary: 'Warning',
            detail: `User ${userEmail} have geo permission '${geoPermissionName}' that is not permission for a ward`,
            severity: 'warning',
          });
        }
        let boundaryId = geoPermissionNameParts[3].trim();
        geoPermissions.set(boundaryId, {
          boundary_polygon: boundaryId,
        } as GeoPermission);
      }
    });
    return geoPermissions;
  }

  private validateCsvFormat(file: any) {
    return file.name.endsWith('.csv');
  }

  public handleEditUserOpen(isUserEditorOpen: boolean) {
    this.userEditorView = isUserEditorOpen;
  }

  public handleRefreshUsersList() {
    this.refreshUserList.next(false);
  }

  public handleUpdateUsersGeoPermissions() {}

  public goToRoot() {
    this.router.navigate(['/']).then();
  }

  private saveAndUpdatePermissions(): void {
    let roles = this.authService.getUserRoles();
    this.userIsUserAdmin = roles.includes(UserAdminRole.id);
  }
}
