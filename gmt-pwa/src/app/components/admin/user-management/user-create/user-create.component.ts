import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Errors } from 'src/app/constants/errors.enum';
import {
  editorRoleExplanation,
  microPlaningStatusManagerRoleExplanation,
  participationManagerRoleExplanation,
  userAdminRoleExplanation,
  userRoleExplanation,
} from 'src/app/constants/userManagement.constants';
import { BoundaryTreeService } from 'src/app/services/boundary-tree.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { BoundaryFocusService } from 'src/app/services/map/DashboardBoundaryService';
import { VectorSourceService } from 'src/app/services/map/vector-source.service';
import { UserManagementService } from 'src/app/services/user/user-management.service';
import { BoundaryLayerService } from 'src/app/services/vector_layer/boundary-layer.service';
import { VectorLayerService } from 'src/app/services/vector_layer/vector-layers.service';
import {
  DefaultUserInfoProperties,
  GeoPermission,
  UserInfo,
  UserInfoField,
  UserInfoSchema,
} from 'src/app/utils/server-interfaces/user/User';
import { Role, Roles } from 'src/app/utils/server-interfaces/user/UserRoles';

import { MatCheckboxChange } from '@angular/material/checkbox';
import { NGXLogger } from 'ngx-logger';

interface GeoPermissionLabel {
  label: string[];
  relatedLabels: Array<string[]>;
}

interface UserErrors {
  username: string[];
  email: string[];
  first_name: string[];
  last_name: string[];
  password: string[];
  password_confirmation: string[];
}

@Component({
    selector: 'user-create',
    templateUrl: './user-create.component.html',
    styleUrls: ['./user-create.component.less'],
    standalone: false
})
export class UserCreateComponent implements OnInit {
  @Input() userId: string | null;
  @Output() userEditorClosed: EventEmitter<boolean> = new EventEmitter();
  @Output() userIsUpdated: EventEmitter<void> = new EventEmitter();

  public user: UserInfo = {
    roles: [] as string[],
    geo_permissions: new Map<string, GeoPermission>(),
    password: '',
  } as UserInfo;
  public roles: Role[] = Roles.sort();
  public geoPermissionLabels: Map<string, GeoPermissionLabel> = new Map<
    string,
    GeoPermissionLabel
  >();
  public geoPermissionOptions: { [id: string]: string } = {};
  public geoPermissionsBoundaryIds: string[] = [];
  public geoPermissionsBoundaryIdsEvent: BehaviorSubject<string[]> =
    new BehaviorSubject<string[]>([]);
  public finishedFilteringBoundaries: Subject<boolean> = new Subject();
  public passwordConfirmation: string = '';
  public resetPassword: boolean = false;
  public showRolesExplanations: boolean = false;
  public userAdminRoleExplanation: string = userAdminRoleExplanation;
  public editorRoleExplanation: string = editorRoleExplanation;
  public userRoleExplanation: string = userRoleExplanation;
  public participationManagerRoleExplanation =
    participationManagerRoleExplanation;
  public microPlaningStatusManagerRoleExplanation =
    microPlaningStatusManagerRoleExplanation;
  public showGeoPermissionExplanations: boolean = false;
  public showGeoPermissionSelections: boolean = false;
  public saveChangesDisabled: boolean = false;
  public errors: UserErrors = {
    username: [],
    email: [],
    first_name: [],
    last_name: [],
    password: [],
    password_confirmation: [],
  };
  public filterInputText: string = '';

  private unsubscribe = new Subject();
  private clearTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private userManagementService: UserManagementService,
    private boundaryTreeService: BoundaryTreeService,
    public loadingService: IsLoadingService,
    private vectorSourceService: VectorSourceService,
    private vectorLayerService: VectorLayerService,
    private boundaryLayerService: BoundaryLayerService,
    private boundaryFocusService: BoundaryFocusService,
    private isLoadingService: IsLoadingService,
    private logger: NGXLogger
  ) {}

  async ngOnInit() {
    await this.boundaryTreeService.buildTree();
    this.refreshData();
    this.isLoadingService.setMapLoading(false);
    this.isLoadingService.loading
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isLoading) => {
        // when http request returns error - error is thrown and we don't get feedback when button could be enabled again
        if (!isLoading) {
          this.saveChangesDisabled = false;
        }
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  ngOnChanges() {
    this.refreshData();
  }

  private refreshData() {
    if (!this.userId) {
      this.resetUser();
    } else {
      this.getUserInfo();
    }
    // set geo permissions selection "Nigeria" by default
    let matchedBoundaries =
      this.boundaryTreeService.getRelatedBoundaryLabelsBySearchText('Nigeria');
    this.geoPermissionOptions = {};
    matchedBoundaries.forEach((labels: string[], boundaryId: string) => {
      this.geoPermissionOptions[boundaryId] = this.formatGeoPermissionsPath(
        matchedBoundaries.get(boundaryId)
      );
    });
  }

  async resetUser() {
    this.passwordConfirmation = '';
    this.user = { ...DefaultUserInfoProperties } as UserInfo;
  }

  /*
  Executing when a boundary is selected in the geo permissions combo box
  */
  public handleGeoPermissionAdd(boundaryIds: string[]) {
    if (!this.user || !this.user.geo_permissions) {
      this.logger.warn('user or geo_perms is falsy!');
      return;
    }
    for (const boundaryId of boundaryIds) {
      if (this.user.geo_permissions.has(boundaryId)) {
        continue;
      }

      this.logger.info(`adding boundaryId ${boundaryId} to geo permissions`);
      this.user.geo_permissions.set(boundaryId, {
        boundary_polygon: boundaryId,
      } as GeoPermission);

      // calculate boundary label again as we cannot get it from multi select component
      let boundaryLabel =
        this.boundaryTreeService.getRelatedBoundaryLabelsById(boundaryId);
      if (!boundaryLabel.has(boundaryId)) {
        this.logger.warn(`Unable to find labels for ${boundaryId}`);
        continue;
      }
      this.geoPermissionLabels.set(boundaryId, {
        label: boundaryLabel.get(boundaryId) as string[],
        relatedLabels: [],
      });
    }
    this.geoPermissionsBoundaryIds = boundaryIds;
    this.geoPermissionsBoundaryIdsEvent.next(this.geoPermissionsBoundaryIds);
  }

  public handleGeoPermissionRemove(boundaryId: string) {
    console.log('remove geo permission boundaryId', boundaryId);
    if (this.user!.geo_permissions) {
      this.user!.geo_permissions.delete(boundaryId);
    }
    if (this.geoPermissionsBoundaryIds) {
      this.geoPermissionsBoundaryIds = this.geoPermissionsBoundaryIds.filter(
        (permissionBoundaryId) => boundaryId !== permissionBoundaryId
      );
      this.geoPermissionsBoundaryIdsEvent.next(this.geoPermissionsBoundaryIds);
    }

    this.geoPermissionLabels.delete(boundaryId);
  }

  public handleRoleRemove(roleId: string) {
    if (this.user!.roles) {
      console.log('remove role: ', roleId);
      this.user!.roles = this.user!.roles.filter((role) => role !== roleId);
    }
  }

  public formatTime(timestamp: number | undefined) {
    if (!timestamp) {
      return '';
    }
    let date = new Date(timestamp);
    return date.toLocaleDateString('en-US');
  }

  public async handleValidation(fieldName: UserInfoField) {
    try {
      if (fieldName == 'password_confirmation') {
        this.checkPasswordMatch();
      } else {
        // empty string would fails so delete password if string is empty
        if (fieldName == 'password' && this.user.password === '') {
          delete this.user.password;
        }
        await UserInfoSchema.validateAt(fieldName, this.user!);
      }
      this.errors[fieldName] = [];
    } catch (error) {
      console.log('ERROR', error);
      if (this.errors[fieldName] && error?.errors) {
        this.errors[fieldName] = error.errors;
      }
    }
  }

  public handleShowRoleExplanations() {
    this.showRolesExplanations = !this.showRolesExplanations;
  }

  public handleShowGeoPermissionExplanations() {
    this.showGeoPermissionExplanations = !this.showGeoPermissionExplanations;
  }

  public handleUserRolesChange(evt: MatCheckboxChange, r: Role) {
    if (evt.checked) {
      this.user!.roles.push(r.id);
    } else {
      this.user!.roles = this.user!.roles.filter((role) => r.id !== role);
    }
  }

  public handleEmailVerifiedChange(emailVerified: boolean) {
    this.user!.email_verified = emailVerified;
  }

  public handlePasswordChange(password: string) {
    this.user!.password = password;
  }

  public disableUser(userIsActivated: boolean) {
    if (!this.userId) {
      return;
    }
    console.log('disableUser', userIsActivated);
    this.userManagementService.disableUserById(this.userId);
    this.user.enabled = userIsActivated;
  }

  public handleClose() {
    this.userId = null;
    this.userEditorClosed.emit(false);
  }

  handleOpenGeoPermissionsSelection(open: boolean) {
    // notify multiselect component to open
    this.showGeoPermissionSelections = !this.showGeoPermissionSelections;
    this.finishedFilteringBoundaries.next(open);
  }

  // handleFilterInputChange(newValue: KeyType) {
  public handleFilterInputChange(newValue: any) {
    //Handle the fast cases first
    this.filterInputText = newValue;
    //To save processing time, only if the filter is at least 3 characters do we start searching
    //we don't reset the search, but just not do another one.  This allows any 3 character search they
    //may have just done to remain.  If they remove the entire filter, it'll reset like above
    if (newValue.length < 3) {
      return;
    }

    //Cancel the delayed search if there is one
    if (this.clearTimeout) {
      clearTimeout(this.clearTimeout);
    }

    //Wait a second before executing
    this.clearTimeout = setTimeout(() => {
      let matchedBoundaries =
        this.boundaryTreeService.getRelatedBoundaryLabelsBySearchText(newValue);
      this.geoPermissionOptions = {};
      matchedBoundaries.forEach((labels: string[], boundaryId: string) => {
        // do not display country name
        this.geoPermissionOptions[boundaryId] = this.formatGeoPermissionsPath(
          matchedBoundaries.get(boundaryId)
        );
      });
      // notify multiselect component to open
      this.handleOpenGeoPermissionsSelection(true);
      this.clearTimeout = null;
    }, 1000);
  }

  /**
   * To make boundary path shorter - display only ward/lga/state (except when geo permission is
   * given for full Nigeria)
   * @param boundaryLabels
   */
  public formatGeoPermissionsPath(
    boundaryLabels: string[] | undefined
  ): string {
    if (!boundaryLabels) {
      return '';
    }
    let boundariesLevel = boundaryLabels.length;
    return boundariesLevel > 1
      ? boundaryLabels.slice(0, boundariesLevel - 1).join('/')
      : boundaryLabels.join('/');
  }

  public async handleCreateUser(): Promise<void> {
    this.saveChangesDisabled = true;
    // if password is empty - skip validation
    // TODO - do we want ability to set user password while creating the user?
    // if(this.user!.password == ""){
    delete this.user!.password;
    // } else{
    //   // This method would throw an error if there is any predefined issue
    //   this.checkPasswordMatch();
    // }
    await this.handleValidation('email');
    await this.handleValidation('username');
    await this.handleValidation('first_name');
    await this.handleValidation('last_name');
    // there must be a nicer way to validate data... (alternative is this expression:
    // UserInfoSchema.validate(this.user!, { abortEarly: false }).then((_: any) => {}).catch((error: any) => {console.log("ERROR", error.errors);});
    // but with it we don't know exactly which field failed)
    if (
      this.errors.email.length == 0 &&
      this.errors.username.length == 0 &&
      this.errors.first_name.length == 0 &&
      this.errors.last_name.length == 0
    ) {
      this.userManagementService.createUser(this.user!).subscribe((_) => {
        this.user!.password = '';
        this.handleClose();
        this.userIsUpdated.next();
        this.saveChangesDisabled = false;
      });
    } else {
      this.saveChangesDisabled = false;
    }
  }

  public formRelatedBoundariesPermissions(
    relatedLabels: Array<string[]>
  ): string {
    let relatedBoundariesString =
      'Additional permissions for the boundaries:\n';
    relatedLabels.forEach((label) => {
      relatedBoundariesString += label.join('/') + ';\n';
    });
    return relatedBoundariesString;
  }

  public async handleResetUserPasswordDialog(open: boolean): Promise<void> {
    this.resetPassword = open;
    this.user.password = '';
  }

  public async handleResetUserPassword(): Promise<void> {
    console.log('Reset user password');
    if (!this.user || !this.userId || this.user.password === undefined) {
      return;
    }
    await this.handleValidation('password');
    await this.handleValidation('password_confirmation');
    console.log(
      'before sending request',
      this.errors.password.length,
      this.errors.password_confirmation.length
    );
    if (
      this.errors.password.length == 0 &&
      this.errors.password_confirmation.length == 0
    ) {
      console.log('sending request');
      this.userManagementService
        .resetUserPassword(this.userId, this.user.password)
        .subscribe((_) => {
          this.passwordConfirmation = '';
          this.user.password = '';
          this.resetPassword = false;
        });
    }
  }

  public async handleEditUser(): Promise<void> {
    console.log('Editing the user');
    if (!this.user || !this.userId) {
      return;
    }
    this.saveChangesDisabled = true;
    if (this.user!.password == '') {
      delete this.user!.password;
    }

    this.saveChangesDisabled = false;
    await this.handleValidation('email');
    await this.handleValidation('username');
    await this.handleValidation('first_name');
    await this.handleValidation('last_name');
    // there must be a nicer way to validate data...
    if (
      this.errors.email.length == 0 &&
      this.errors.username.length == 0 &&
      this.errors.first_name.length == 0 &&
      this.errors.last_name.length == 0
    ) {
      this.userManagementService
        .updateUserById(this.userId!, this.user)
        .subscribe((success) => {
          console.log(success, 'success updating user');
          this.handleClose();
          this.saveChangesDisabled = false;
          this.userIsUpdated.next();
        });
    } else {
      this.saveChangesDisabled = false;
    }
  }

  public roleIdToName(role: string): string {
    const roleName = Roles.find((r) => r.id == role)?.name;
    return roleName ? roleName : '';
  }

  private async getUserInfo() {
    if (!this.userId) {
      return;
    }
    this.userManagementService
      .getUserById(this.userId)
      .subscribe(async (user) => {
        if (user) {
          this.user = user;
          this.formatUserGeoPermissionsData();
        }
      });
  }

  private formatUserGeoPermissionsData() {
    if (!this.user) {
      return;
    }
    // Form geo permission labels
    if (this.user.geo_permissions) {
      this.user.geo_permissions = new Map(
        Object.entries(this.user.geo_permissions)
      );
      this.user.geo_permissions.forEach(
        (geoPermission: GeoPermission, boundaryId: string) => {
          if (this.geoPermissionsBoundaryIds.indexOf(boundaryId) === -1) {
            this.geoPermissionsBoundaryIds.push(boundaryId);
          }
          let boundaryLabel =
            this.boundaryTreeService.getRelatedBoundaryLabelsById(boundaryId);
          if (!boundaryLabel.has(boundaryId)) {
            return;
          }

          // find all related boundaries labels to display additional information
          let relatedLabels: string[][] = [];
          geoPermission.related_boundary_polygon.forEach(
            (relatedBoundaryId: string) => {
              const relatedBoundaries =
                this.boundaryTreeService.getRelatedBoundaryLabelsById(
                  relatedBoundaryId
                );
              if (relatedBoundaries.has(relatedBoundaryId)) {
                relatedLabels.push(
                  relatedBoundaries.get(relatedBoundaryId) as string[]
                );
              }
            }
          );
          // for chips display
          this.geoPermissionLabels.set(boundaryId, {
            label: boundaryLabel.get(boundaryId) as string[],
            relatedLabels: relatedLabels,
          });
        }
      );
      this.geoPermissionsBoundaryIdsEvent.next(this.geoPermissionsBoundaryIds);
    }
  }

  /**
   * Until we have validation per field - throwing the error as it would be caught
   * by global error interceptor
   * @private
   */
  private checkPasswordMatch(): void {
    console.log(
      this.user?.password != this.passwordConfirmation,
      'this.user?.password != this.passwordConfirmation',
      !this.user.password,
      this.passwordConfirmation.length > 0
    );
    if (
      (this.user &&
        this.user?.password != this.passwordConfirmation &&
        this.user.password) ||
      (!this.user.password && this.passwordConfirmation.length > 0)
    ) {
      throw { errors: [Errors.PASSWORD_DO_NOT_MATCH] };
    }
  }
}
