import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ConfirmationPinComponent } from '@components/dev-tools/confirmation-pin/confirmation-pin.component';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { RIRouteService } from '@services/shared/route/ri-route.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { LogsDatabase } from 'src/app/services/shared/logs/logs-database';
import { LogsService } from 'src/app/services/shared/logs/logs.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { AuthService } from 'src/app/services/user/auth.service';
import { MicroplanEditService } from 'src/app/services/vector_layer/edit/microplan-edit.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import { VectorLayerService } from 'src/app/services/vector_layer/vector-layers.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  ParticipationManagerRole,
  UserAdminRole,
} from 'src/app/utils/server-interfaces/user/UserRoles';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.less'],
  standalone: false
})
export class MenuComponent implements OnInit {
  @Input() isOnline: boolean = true;
  @Input() loggedIn: boolean | null = null;
  public open: boolean = false;
  public developer_mode?: boolean = AppConfigService.conf.developer_mode;
  public userEmail: string = '';
  public userIsUserAdmin: boolean = false;
  public userHasParticipationManagerRole: boolean = false;

  @ViewChild('helpRef', { static: false }) helpComponent!: ElementRef;

  private unsubscribe = new Subject();

  constructor(
    private authService: AuthService,
    private microplanEditService: MicroplanEditService,
    private permissionsLayerService: PermissionsLayerService,
    private userContextService: UserContextService,
    private vectorLayerService: VectorLayerService,
    private loadingService: IsLoadingService,
    private messageService: MessageService,
    private riRouteService: RIRouteService,
    private logsDatabase: LogsDatabase,
    private logsService: LogsService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
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

  navigateToUserMgmt() {
    this.router.navigateByUrl(RoutesChunks.USER_MANAGEMENT);
  }

  triggerHelpClick(event: MouseEvent) {
    // Prevent double triggering when clicking on the mat-icon
    event.stopPropagation();

    const nativeEl = this.helpComponent?.nativeElement;
    if (nativeEl) {
      nativeEl.click();
    }
  }

  private saveAndUpdatePermissions(): void {
    this.userEmail = this.authService.getUserEmail();
    let roles = this.authService.getUserRoles();
    this.userIsUserAdmin = roles.includes(UserAdminRole.id);
    this.userHasParticipationManagerRole = roles.includes(
      ParticipationManagerRole.id
    );
  }

  toggleDevButtons() {
    this.userContextService.showDevMenu = !this.userContextService.showDevMenu;
    this.open = false;
  }

  logOut() {
    this.open = false;
    //delete permissions from the innodb
    this.permissionsLayerService.deletePermissions();
    this.authService.logout();
  }

  toggleOpen() {
    this.open = !this.open;
  }

  async sendLogs() {
    /*
    const crudActions = await this.crudLayerService.getCrudActions();

    const counts = new Map<string, number>();
    for (const ca of crudActions) {
      const key = ca.changed_layer;
      if (!counts.has(key)) {
        counts.set(key, 0);
      }

      counts.set(key, counts.get(key) + 1);
    }

    console.log(" Counts " , counts);

    counts.clear();

    let i = 0;
    for (const ca of crudActions) {
      if (ca.actionId == '31c10848-9931-483c-a7d6-1e3b29c5474f') {
        console.log(`Ca part of action ${ca.actionId}`, ca);
      }
      if (ca.changed_layer != "settlement__part" ) {
        continue;
      }

      if (ca.geojson_after.properties.global_id == '8e00b6ae-fac6-4583-9a33-feb1a6f6194d') {
        console.log(`SP Ca part of action ${ca.actionId}`, ca);
      }

      if (ca.isCatchmentCalculation) {
        continue;
      }

      const sp = ca.geojson_after as GeoJsonSettlementPart;

      //console.log(`Ca part of action ${ca.actionId}`, ca);

      //console.log(`sp #${i}: ${sp.properties.settlement_name} ${sp.properties.boundary_polygon} st. ${sp.properties.split_type} ${sp.properties.split_parent}` );
      i++;
      if (sp.properties.boundary_polygon == '8d74395d-59e7-452e-9d0a-dfc5d73d8f42') {
        ca.geojson_after.properties.version_id = null;
        ca.geojson_before.properties.version_id = null;
        let same = _.isEqual(ca.geojson_before.geometry, ca.geojson_after.geometry);
        console.log(`sp #${i}: ${sp.properties.settlement_name} Geom same? ${same}`, ca );
        for(const k of Object.keys(ca.geojson_before.properties as unknown as object)) {
          let vSame = _.isEqual(ca.geojson_before.properties[k], ca.geojson_after.properties[k]);
          if (vSame) {
            continue;
          }
          console.log(`[${k}] same ? ${vSame}`);
        }
      }


      const key = sp.properties.boundary_polygon;
      if (!counts.has(key)) {
        counts.set(key, 0);
      }

      counts.set(key, counts.get(key) + 1);
    }

    for(const [bp,tally] of counts.entries()) {
      const boundary = this.bvService.data.bMap.get(bp);
      console.log(`Boundary ${boundary.properties.name} ${bp} has ${tally} sp` );
    }

    return;
    */
    this.loadingService.setLoading(true);

    const { filename, blob } = await this.logsDatabase.backupIndexedDb();
    this.messageService.add({
      summary: 'Done',
      detail: 'Logs were saved',
      severity: 'info',
    });
    await this.logsService.uploadLogs(filename, blob);

    const vectorDataBlob = await this.vectorLayerService.backupIndexedDb();
    await this.logsService.uploadLogs(filename + '.indexeddb', vectorDataBlob);
    this.messageService.add({
      summary: 'Done',
      detail: 'Database backup is created',
      severity: 'info',
    });

    this.loadingService.setLoading(false);
  }

  async enableParticipation() {
    const boundaryIds = [this.riRouteService.getBoundaryIdValue()];
    await this.microplanEditService.enableParticipation(boundaryIds);
  }

  public openDevTools() {
    this.dialog.open(ConfirmationPinComponent, DEFAULT_WIZARD_DIALOG_OPTIONS);
  }
}
