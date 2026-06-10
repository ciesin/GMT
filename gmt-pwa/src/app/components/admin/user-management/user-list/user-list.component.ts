import { SelectionModel } from '@angular/cdk/collections';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { ActivatedRoute } from '@angular/router';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Observable } from 'rxjs';
import { BoundaryTreeService } from 'src/app/services/boundary-tree.service';
import { IsOnlineService } from 'src/app/services/is-online.service';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { UserManagementService } from 'src/app/services/user/user-management.service';
import {
  UserInfo,
  UserInfoForList,
} from 'src/app/utils/server-interfaces/user/User';
import {
  AdminRole,
  Role,
  Roles,
} from 'src/app/utils/server-interfaces/user/UserRoles';

@Component({
  selector: 'user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.less'],
  standalone: false
})
export class UserListComponent implements OnInit {
  @Input() refreshUserList: Observable<boolean>;
  @Input() editableRolesObs: Observable<boolean>;
  @Input() editableGeoPermissionsObs: Observable<boolean>;
  @Input() applyUserEditsObs: Observable<boolean>;
  @Input() cancelUserEditsObs: Observable<boolean>;
  @Output() userSelected: EventEmitter<string> = new EventEmitter();
  @Output() totalUsers: EventEmitter<number> = new EventEmitter();
  @Output() calcelEdits: EventEmitter<boolean> = new EventEmitter();

  public loaded = true;
  public userList: UserInfoForList[] = [];
  public editedUsers: Map<string, UserInfoForList> = new Map<
    string,
    UserInfoForList
  >();
  public userId: string | null = null;
  public totalRecords: number = 0;
  public roles: Role[] = Roles;
  public editableRoles: boolean = false;
  public editableGeoPermissions: boolean = false;

  public dataSource: MatTableDataSource<UserInfoForList> | null = null;
  //If user searches before datasource initialized
  private filterToSet: string | null = null;
  public selection = new SelectionModel<UserInfoForList>(true, []);

  public headers = [
    'select',
    'id',
    'username',
    'email',
    'first_name',
    'last_name',
    'geoPermissionLabels',
    'roles',
    'edit',
  ];

  private paginator: MatPaginator;

  @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
    this.paginator = mp;
    if (this.dataSource) {
      this.dataSource.paginator = this.paginator;
    }
  }

  private sort: MatSort;

  @ViewChild(MatSort) set matSort(ms: MatSort) {
    this.sort = ms;
    if (this.dataSource) {
      this.dataSource.sort = this.sort;
    }
  }

  constructor(
    private route: ActivatedRoute,
    private isOnlineService: IsOnlineService,
    private userManagementService: UserManagementService,
    private boundaryTreeService: BoundaryTreeService,
    private confirmationService: ConfirmationService,
    private logger: NGXLogger
  ) {}

  async ngOnInit() {
    await this.boundaryTreeService.buildTree();
    // initial user list is retrieved when p-table triggers it
    // refresh user list once user editor or creation window is closed
    this.refreshUserList.subscribe((userEditorWindowIsOpen: boolean) => {
      if (!userEditorWindowIsOpen) {
        // 0 is first index
        this.getUsersData();
      }
    });
    this.editableRolesObs.subscribe((editableRoles: boolean) => {
      this.editableRoles = editableRoles;
    });
    this.editableGeoPermissionsObs.subscribe(
      (editableGeoPermissions: boolean) => {
        this.editableGeoPermissions = editableGeoPermissions;
      }
    );
    this.applyUserEditsObs.subscribe((_: boolean) => {
      this.handleMultipleUsersUpdate();
    });
    this.cancelUserEditsObs.subscribe((_: boolean) => {
      this.handleCancelUserEdits();
    });
    this.getUsersData();
    //cancelUserEditsObs
  }

  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource!.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  toggleAllRows() {
    if (this.isAllSelected()) {
      this.selection.clear();
      return;
    }

    this.selection.select(...this.dataSource!.data);
  }

  /** The label for the checkbox on the passed row */
  checkboxLabel(row?: UserInfoForList): string {
    if (!row) {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selection.isSelected(row) ? 'deselect' : 'select'} row ${
      row.username
    }`;
  }

  public truncateText(text: string) {
    if (text.length <= 8) {
      return text;
    }
    return text.slice(0, 8) + '...';
  }

  private getUsersData() {
    this.userManagementService.getUsers(0, 1000, null).subscribe((users) => {
      //this.logger.debug(`EEE Users fetched`, users);
      this.userList = users.data.filter((u) => {
        //Temp
        //return true;
        return (
          !u.roles.find((r) => r === AdminRole.id) && // Exclude admin roles from user manageable list
          u.username !== 'queue_admin'
        );
      });
      this.totalRecords = this.userList.length;
      this.totalUsers.emit(this.userList.length);
      this.formatUserGeoPermissionsData();
      this.dataSource = new MatTableDataSource<UserInfoForList>(this.userList);
      this.dataSource.filterPredicate = this.filterPredicate;
      if (!_.isNil(this.filterToSet)) {
        this.dataSource.filter = this.filterToSet;
        this.filterToSet = null;
      }
    });
  }

  filterPredicate(record: UserInfoForList, filter: string) {
    return (
      record.email.toLowerCase().includes(filter.toLowerCase()) ||
      record.first_name.toLowerCase().includes(filter.toLowerCase()) ||
      record.last_name.toLowerCase().includes(filter.toLowerCase()) ||
      record.username.toLowerCase().includes(filter.toLowerCase())
    );
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value
      .trim()
      .toLowerCase();

    if (_.isNil(this.dataSource)) {
      this.filterToSet = filterValue;
    } else {
      this.dataSource!.filter = filterValue;

      if (this.dataSource!.paginator) {
        this.dataSource!.paginator.firstPage();
      }
    }
  }

  public handleEditUser(userId: string) {
    this.userSelected.emit(userId);
  }

  public async handleDisableUsers() {
    const usersCount = this.selection.selected.length;
    const message = `Are you sure you want to deactivate selected user${
      usersCount > 1 ? 's' : ''
    }?
        ${
          usersCount > 1 ? 'They' : 'It'
        } will still be shown in the user list as non-active.
        Admin may re-activate their account later.`;
    this.confirmationService.confirm({
      message: message,
      header: `Delete ${usersCount} user${usersCount > 1 ? 's' : ''}`,
      icon: 'noicon',
      rejectLabel: 'Cancel',
      acceptLabel: 'Deactivate',
      showRejectButton: true,
      accept: async () => {
        for (let user of this.selection.selected) {
          this.userManagementService
            .disableUserById(user.id!)
            .subscribe((_) => {
              // 0 is first index
              this.getUsersData();
            });
        }
      },
    });
  }

  private formatUserGeoPermissionsData() {
    if (!this.userList) {
      return;
    }
    for (let user of this.userList) {
      // Form geo permission labels
      if (user.geo_permissions) {
        user.geoPermissionLabels = [];
        for (const [boundaryId, _] of Object.entries(user.geo_permissions)) {
          let boundaryLabel =
            this.boundaryTreeService.getRelatedBoundaryLabelsById(boundaryId);
          if (!boundaryLabel.has(boundaryId)) {
            continue;
          }
          let boundariesLevel = boundaryLabel.get(boundaryId)?.length as number;
          let boundaryPath =
            boundariesLevel > 1
              ? boundaryLabel
                  .get(boundaryId)
                  ?.slice(0, boundariesLevel - 1)
                  .join('/')
              : boundaryLabel.get(boundaryId)?.join('/');
          user.geoPermissionLabels.push(boundaryPath as string);
        }
      }
    }
  }

  private handleMultipleUsersUpdate() {
    console.log('handleMultipleUsersUpdate', this.editedUsers);
    let userEditRequests: Array<Promise<UserInfo | undefined>> = [];
    for (let [userId, user] of this.editedUsers) {
      userEditRequests.push(
        this.userManagementService
          .updateUserByIdWithFormedGeoPermissions(userId!, user as UserInfo)
          .toPromise()
      );
    }

    Promise.all(userEditRequests).then((values) => {
      console.log(values, 'values');
      this.editedUsers = new Map<string, UserInfoForList>();
      this.getUsersData();
    });
  }

  private handleCancelUserEdits() {
    this.editedUsers = new Map<string, UserInfoForList>();
    this.editableGeoPermissions = false;
    this.editableRoles = false;
    this.getUsersData();
  }
}
