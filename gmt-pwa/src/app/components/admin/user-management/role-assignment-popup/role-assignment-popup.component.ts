import {
  Component,
  Output,
  EventEmitter,
  Input,
} from '@angular/core';
import {
  EditorRole, MicroplanStatusManagerRole,
  ParticipationManagerRole,
  Role,
  Roles,
  UserAdminRole
} from 'src/app/utils/server-interfaces/user/UserRoles';
import {Subject} from "rxjs";
import {IsLoadingService} from "src/app/services/is-loading.service";
import {
  editorRoleExplanation,
  microPlaningStatusManagerRoleExplanation,
  participationManagerRoleExplanation,
  userAdminRoleExplanation,
} from "src/app/constants/userManagement.constants";
import {UserManagementService} from "src/app/services/user/user-management.service";


@Component({
    selector: 'role-assignment-popup',
    templateUrl: './role-assignment-popup.component.html',
    styleUrls: ['./role-assignment-popup.component.less'],
    standalone: false
})
export class RoleAssignmentPopupComponent {
  @Input() selectedUsers: string[];
  @Output() close: EventEmitter<boolean> = new EventEmitter();
  @Output() updated: EventEmitter<boolean> = new EventEmitter();
  public userAdminRoleExplanation: string = userAdminRoleExplanation;
  public editorRoleExplanation: string = editorRoleExplanation;
  public participationManagerRoleExplanation = participationManagerRoleExplanation;
  public microPlaningStatusManagerRoleExplanation = microPlaningStatusManagerRoleExplanation;

  public userAdminRole: Role = UserAdminRole;
  public editorRole: Role = EditorRole;
  public participationManagerRole: Role = ParticipationManagerRole;
  public microplanStatusManagerRole: Role = MicroplanStatusManagerRole;
  public selectedRoles: Set<string> = new Set<string>();
  public roles: Role[] = Roles;
  public finishedFilteringBoundaries: Subject<boolean> = new Subject();
  public saveChangesDisabled: boolean = false;

  constructor(private loadingService: IsLoadingService,
              private userManagementService: UserManagementService
  ) { }

  public handleRoleCheck(eventTarget: any, role: Role){//any because pycharm does not detect checked property in EventTarget
    if(!eventTarget) {
      return;
    }
    if(eventTarget?.checked){
      this.selectedRoles.add(role.id);
    } else{
      this.selectedRoles.delete(role.id);
    }
  }

  public handleSaveRoles(){
    console.log(this.selectedRoles,'this.selectedRoles');
    this.userManagementService.updateMultipleUsersRoles(this.selectedUsers, this.selectedRoles).subscribe(success => {
      console.log(success, 'success updating users roles');
      this.selectedRoles = new Set<string>();
      this.updated.emit(false);
    });
  }

  public handleClose() {
    this.selectedRoles = new Set<string>();
    this.close.emit(false);
  }

}
