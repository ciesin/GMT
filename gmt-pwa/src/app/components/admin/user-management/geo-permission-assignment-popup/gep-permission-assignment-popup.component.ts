import {
  Component,
  Output,
  EventEmitter,
  Input, OnInit,
} from '@angular/core';
import { Role, Roles} from 'src/app/utils/server-interfaces/user/UserRoles';
import {Subject} from "rxjs";
import {IsLoadingService} from "src/app/services/is-loading.service";
import {UserManagementService} from "src/app/services/user/user-management.service";
import {BoundaryTreeService} from "src/app/services/boundary-tree.service";
import {TreeNodeCheckable} from "src/app/services/interfaces/boundary-tree.service.interface";

interface SelectedBoundary {
  global_id: string
  label: string
  children: SelectedBoundary[]
}

@Component({
    selector: 'gep-permission-assignment-popup',
    templateUrl: './gep-permission-assignment-popup.component.html',
    styleUrls: ['./geo-permission-assignment-popup.component.less'],
    standalone: false
})
export class GeoPermissionAssignmentPopupComponent implements OnInit{
  @Input() selectedUsers: string[];
  @Output() close: EventEmitter<boolean> = new EventEmitter();
  @Output() updated: EventEmitter<boolean> = new EventEmitter();

  public selectedBoundaryGlobalIds: Set<string> = new Set<string>();
  public displayAdminBoundaryList: {[key: number]: TreeNodeCheckable[]} = {0: [], 1: [], 2: [], 3:[]};
  public expandedBoundary: {[key: number]: string} = {1: "", 2: ""};
  public roles: Role[] = Roles;
  public finishedFilteringBoundaries: Subject<boolean> = new Subject();
  public saveChangesDisabled: boolean = false;

  constructor(private loadingService: IsLoadingService,
              private userManagementService: UserManagementService,
              private boundaryTreeService: BoundaryTreeService,
  ) { }

  async ngOnInit() {
    await this.boundaryTreeService.buildTree();
    this.displayAdminBoundaryList[0] = this.boundaryTreeService.allNodes;
    this.displayAdminBoundaryList[1] = this.boundaryTreeService.allNodes[0].children;
  }

  public handleExpandTree(boundary: TreeNodeCheckable, level: number){
    this.displayAdminBoundaryList[level + 1] = boundary.children;
    this.expandedBoundary[level] = boundary.global_id;
    for(let i = level + 2; i <= this.boundaryTreeService.maxBoundariesLevel; i++){
      this.displayAdminBoundaryList[i] = [];
    }
  }

  public handleGeoPermissionCheck(eventTarget: any, boundaryId: string, level: number){
    if(!eventTarget) {
      return;
    }
    console.log('boundaryId', boundaryId ,level);
    if(eventTarget?.checked){
      this.selectedBoundaryGlobalIds.add(boundaryId);
    } else{
      this.selectedBoundaryGlobalIds.delete(boundaryId);
    }
  }

  public handleSaveGeoPermissions(){
    console.log(this.selectedBoundaryGlobalIds,'selectedBoundaryGlobalIds');
    this.userManagementService
      .updateMultipleUsersGeoPermissions(this.selectedUsers, this.selectedBoundaryGlobalIds)
      .subscribe(success => {
        console.log(success, 'success updating users permissions');
        this.selectedBoundaryGlobalIds = new Set<string>();
        this.updated.emit(false);
      });
  }

  public handleClose() {
    this.selectedBoundaryGlobalIds = new Set<string>();
    this.close.emit(false);
  }
}
