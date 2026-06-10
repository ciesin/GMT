import { ComponentType } from '@angular/cdk/portal';
import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BoundaryVectorLayersService } from '@services/boundary-vector-layers.service';
import { GmtNewStateService } from '@services/gmt-new-state/gmt-new-state.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { NGXLogger } from 'ngx-logger';
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { VectorLayerForPermissions } from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  DEFAULT_WIZARD_DIALOG_OPTIONS,
  HealthFacilityWizardComponent,
  HealthFacilityWizardDialogData,
} from '../wizard/health-facility-wizard/health-facility-wizard.component';
import {
  SettlementWizardComponent,
  SettlementWizardDialogData,
} from '../wizard/settlement-wizard/settlement-wizard.component';

export type GmtNewMode = 'compact' | 'extanded' | 'expanded';

const DEFAULT_PERMISSIONS_TOOLTIP_MESSAGE =
  'You do not have permission to create a new settlement or health facility.';

@Component({
  selector: 'gmt-new',
  templateUrl: './gmt-new.component.html',
  styleUrls: ['./gmt-new.component.less'],
  standalone: false
})
export class GmtNewComponent implements OnInit {
  @Input() extanded: boolean = false;

  public hide: boolean = false;
  public mode: GmtNewMode = 'compact';

  public buttonTooltip: string = DEFAULT_PERMISSIONS_TOOLTIP_MESSAGE;
  public inHealthFacilityPage = true;
  public userCanCreateHf: boolean = false;
  public userCanCreateSt: boolean = false;
  private editing: boolean = false;
  private atLeastOneBoundaryOffline = true;
  private userHasPermissionCreateSettlement = false;
  private userHasPermissionToCreateHf: boolean = false;
  private holdMode = false;
  private unsubscribe = new Subject();

  constructor(
    public bvService: BoundaryVectorLayersService,
    private dialog: MatDialog,
    private logger: NGXLogger,
    private riRouteService: RIRouteService,

    private userContextService: UserContextService,

    private gmtNewStateService: GmtNewStateService,
    private vectorLayersService: VectorLayerService,
    private boundaryLayerService: BoundaryLayerService,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit(): void {
    this.listenToGmtNewStateService();

    this.listenToRouteService();

    this.listenForComponentPermissions();

    this.listenToOfflineBoundaries();

    this.dialog.afterAllClosed
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((x) => {
        // show FAB button
        this.gmtNewStateService.setHide(false);
      });

    if (AppConfigService.ENABLE_WIZARD_DEBUG) {
      setTimeout(() => {
        //this.handleNewSettlement();
        //this.handleNewOutreach();
      }, 500);
    }
  }

  private listenToGmtNewStateService() {
    this.gmtNewStateService
      .getExpanded$()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((expanded) => (this.mode = expanded ? 'expanded' : 'compact'));

    this.gmtNewStateService
      .getHide$()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hide) => {
        if (this.hide != hide) {
          this.hide = hide;
        }
      });
  }

  private listenToRouteService() {
    this.riRouteService.activePage$
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((activePageContext) => {
        this.inHealthFacilityPage =
          activePageContext.page != RoutesChunks.SETTLEMENTS;
      });
  }

  private listenForComponentPermissions() {
    this.bvService.loaded
      .pipe(
        filter(Boolean),
        switchMap((_) => {
          this.setComponentPermissions();
          return this.userContextService.getIsEditingObservable();
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.logger.info(`Is editing observable set to ${isEditing}`);
        this.updateComponentPermissions();
      });
  }

  private listenToOfflineBoundaries() {
    this.vectorLayersService.offlineBoundariesChanged
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async () => {
        const offlineSet =
          await this.boundaryLayerService.getAllOfflineBoundaries();
        this.logger.info(`offline boundaries size ${offlineSet.size}`);
        this.atLeastOneBoundaryOffline = offlineSet.size > 0;
        this.updateComponentPermissions();
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleClick() {
    switch (this.mode) {
      case 'compact':
      case 'extanded':
        this.holdMode = true;
        this.gmtNewStateService.setExpanded(true);
        break;
      case 'expanded':
        this.holdMode = false;
        this.mode = 'compact';
        this.gmtNewStateService.setExpanded(false);
        break;
    }
  }

  handleNewSettlement() {
    this.handleClick();
    this.userActionLogService.addUserActionDescription(
      'Adding new settlement, opening settlement wizard'
    );
    this.openWizard(SettlementWizardComponent, {
      editSettlementNameId: null,
    });
  }

  handleNewHealthFacility() {
    this.handleClick();
    this.userActionLogService.addUserActionDescription(
      'Adding new health facility fixed post, opening HF wizard'
    );
    this.openWizard(HealthFacilityWizardComponent, {
      isOutreach: false,
      outreachParentHealthFacilityId: null,
    });
  }

  handleNewOutreach() {
    this.handleClick();
    this.userActionLogService.addUserActionDescription(
      'Adding new health facility outreach, opening HF wizard'
    );
    //If we are currently viewing a health facility, preselect it as the parent
    let opts: HealthFacilityWizardDialogData = {
      isOutreach: true,
      outreachParentHealthFacilityId: null,
    };
    //Note for https://github.com/novelt/GMT/issues/2182 we in all cases don't preselect the parent
    /*if (this.riRouteService.getHfIdValue() && this.singleHfService.hf.value && this.riRouteService.activePage$.value && this.riRouteService.activePage$.value.page == RoutesChunks.HEALTH_FACILITIES ) {
      const fixedPostHfId = this.singleHfService.hf.value.properties.global_id;
      this.logger.info(`Preselecting parent, navigated to ${this.riRouteService.getHfIdValue()} fixed post hf id is ${fixedPostHfId}`);
      opts.outreachParentHealthFacilityId = fixedPostHfId;
    }*/
    this.openWizard(HealthFacilityWizardComponent, opts);
  }

  private openWizard(
    component: ComponentType<HealthFacilityWizardComponent>,
    data: HealthFacilityWizardDialogData
  ): void;
  private openWizard(
    component: ComponentType<SettlementWizardComponent>,
    data: SettlementWizardDialogData
  ): void;
  private openWizard(
    component: ComponentType<
      HealthFacilityWizardComponent | SettlementWizardComponent
    >,
    data: HealthFacilityWizardDialogData | SettlementWizardDialogData
  ) {
    if (this.dialog.openDialogs.length > 0) {
      this.logger.info('Not opening additional dialog');
      return;
    }
    this.gmtNewStateService.setHide(true);

    this.dialog.open(component, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data,
    });
  }

  mouseEnter(event: MouseEvent) {
    const btn = event.target as Element;
    btn.classList.add('extanded');
  }

  mouseLeave(event: MouseEvent) {
    if (this.holdMode) {
      // button has been clicked on to hold extanded/expanded view
      return;
    }
    const btn = event.target as Element;
    btn.classList.remove('extanded');
  }

  private setComponentPermissions(): void {
    this.userHasPermissionCreateSettlement =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlement,
        'create',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.userHasPermissionToCreateHf =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.healthFacility,
        'create',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.updateComponentPermissions();
  }

  private updateComponentPermissions() {
    this.userCanCreateHf =
      this.editing &&
      this.userHasPermissionCreateSettlement &&
      this.atLeastOneBoundaryOffline;
    this.userCanCreateSt =
      this.editing &&
      this.userHasPermissionToCreateHf &&
      this.atLeastOneBoundaryOffline;
    if (!this.userCanCreateHf && !this.userCanCreateSt) {
      this.buttonTooltip = DEFAULT_PERMISSIONS_TOOLTIP_MESSAGE;
    } else {
      this.buttonTooltip = '';
    }
  }
}
