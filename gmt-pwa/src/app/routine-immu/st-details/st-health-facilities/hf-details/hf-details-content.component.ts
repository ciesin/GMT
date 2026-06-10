import { Component, Inject, Injector, OnInit, ViewChild } from '@angular/core';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { Router } from '@angular/router';
import { callBlockingUiUntilDone } from '@components/wizard/wizard-location-control/helper-methods';
import { IsLoadingService } from '@services/is-loading.service';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import {
  getSortedDisplayName,
  SortStateService,
} from '@services/shared/notifications/sortState';
import { UserContextService } from '@services/user-context.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { SingleHfProcessingService } from '@services/vector_layer/single-hf-processing.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { filter, ReplaySubject, Subject, take, takeUntil } from 'rxjs';
import {
  ACCORDION_TOKEN,
  ID_TOKEN,
} from 'src/app/components/microplan-view/microplan-list/microplan-list.component';
import {
  hfTypesOptions,
  OWNERSHIP_PRIVATE,
  OWNERSHIP_PUBLIC,
} from 'src/app/constants/hf.constants';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { SingleHfService } from 'src/app/services/vector_layer/single-hf.service';
import { SingleStService } from 'src/app/services/vector_layer/single-st.service';
import { GeoJsonHealthFacility } from 'src/app/utils/server-interfaces/GeoJson';
import { formatPopulation, isFloat } from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';

//This component is the health facility related to a settlement
@Component({
    selector: 'hf-details-content',
    templateUrl: './hf-details-content.component.html',
    styleUrls: [
        '../../../../../app/components/catchment-card/card.less',
        './hf-details-content.component.less'
    ],
    standalone: false
})
export class HfDetailsContentComponent implements OnInit {
  public hfId: string; // injected as input this.injector.get(ID_TOKEN);
  public snId: string;
  public hf!: GeoJsonHealthFacility;
  public editing: boolean = false;
  public isOutreach: boolean = false;
  public hfOrganization: string | null = null;
  public hfType: string | null = null;
  // public hfHours: string = null;
  public hfServices: string | null = null;
  public outreachSitesCount: number = 0;
  public staffMembersCount: number = 0;
  public settlementsCount: number = 0;
  public hfSynonyms: string | null = null;
  public hfMaturity: string | null = null;
  public coverageHf = {
    catchmentPopulation: 0,
    percFixedPost: 0,
    percOutreach: 0,
    percProblematic: 0,
    isCatchmentDone: false,
  };
  public formatPopulation = formatPopulation;
  public loaded = false;
  public panelOpenState: boolean = false;
  private hfTypesOptions = hfTypesOptions;

  public displayName: string;

  public isExplicitInclude: boolean = false;

  public userHasEditRights: boolean = false;

  @ViewChild(MatExpansionPanel)
  set matExpansionPanel(panel: MatExpansionPanel) {
    // hook the panel expansion to the accordion when ready
    if (!panel) {
      return;
    }
    this.accordion$
      .pipe(filter(Boolean), take(1))
      .subscribe((accordion) => (panel.accordion = accordion));
  }

  private unsubscribe = new Subject();

  constructor(
    @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
    public bvService: BoundaryVectorLayersService,
    private injector: Injector,

    private singleHfService: SingleHfService,
    private singleStService: SingleStService,

    private router: Router,
    public logger: NGXLogger,
    private singleHfProcessingService: SingleHfProcessingService,
    private sortStateService: SortStateService,
    public crudLayerService: CrudLayerService,
    public isLoadingService: IsLoadingService,
    public microplanMapEvents: MicroplanMapEventsService,
    private userContextService: UserContextService
  ) {}

  ngOnInit() {
    const token = this.injector.get(ID_TOKEN);
    const tokens = token.split(',');
    this.hfId = tokens[1];
    this.snId = tokens[0];
    this.logger.debug(`HF Details content hfId ${this.hfId} snId ${this.snId}`);
    if (!this.hfId) {
      return;
    }
    this.hf = this.bvService.data.hfMap.get(this.hfId)!;
    this.settlementsCount =
      this.singleHfService.getIncludedSettlementsCountByHfId(
        this.hf.properties.global_id
      );
    this.outreachSitesCount = this.singleHfService.getOutreachesCountByHfId(
      this.hf.properties.global_id
    );
    this.staffMembersCount = this.hf.properties.staff_names.length;
    this.initializeUIValues();

    this.loadIsInclude();

    this.subscribeToEditMode();

    this.listenToSort();
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.updateComponentPermissions();
      });
  }

  private updateComponentPermissions() {
    this.logger.debug(
      `settlement perms ${this.editing} ${this.singleStService.userHasPermissionsUpdateSettlement} ${this.bvService.isOffline}`
    );
    this.userHasEditRights =
      this.editing && this.singleStService.userHasPermissionsUpdateSettlement;
  }

  private loadIsInclude() {
    //If this settlement was explicitly included we want to know in order to display an icon
    //and allow them to remove it
    const sp = this.singleStService.settlementPart;
    if (_.isNil(sp)) {
      this.logger.warn('No settlement part?');
      return;
    }

    const fpCiList = this.bvService.data.getIncludeExcludesForAllFp(
      this.hf.properties.global_id
    );

    this.isExplicitInclude = fpCiList.some((ci) => {
      //the hf should match already since we used getIncludeExcludesForAllFp
      return (
        ci.properties.type == 'include' &&
        ci.properties.settlement_part == sp.properties.global_id
      );
    });
  }

  public async deleteExplicitInclude(event: MouseEvent) {
    event.stopPropagation();

    //because we are showing just the fixed post, we will remove all fixed post/outreach links
    const sp = this.singleStService.settlementPart;
    if (_.isNil(sp)) {
      this.logger.warn('No settlement part?');
      return;
    }
    const fpCiList = this.bvService.data.getIncludeExcludesForAllFp(
      this.hf.properties.global_id
    );

    const cisToDelete = fpCiList.filter((ci) => {
      //the hf should match already since we used getIncludeExcludesForAllFp
      return (
        ci.properties.type == 'include' &&
        ci.properties.settlement_part == sp.properties.global_id
      );
    });

    await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();

      await this.crudLayerService.bulkDeleteCatchmentItems(
        cisToDelete,
        true,
        actionId
      );

      await this.bvService.computeAllCatchmentAssignments(
        [sp],
        actionId,
        new Set()
      );

      return true;
    });
  }

  public async redirectToDetails() {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        //Note this HF could be in a different boundary than the current one
        this.hf.properties.boundary_polygon,
        //this.riRouterService.getBoundaryIdValue(),
        RoutesChunks.HEALTH_FACILITIES,
        this.hfId,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }

  handleShowHfSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    this.singleHfProcessingService.handleShowHfSiteOnMap(this.hf);
  }
  public onOpenPanelAction() {
    this.singleHfProcessingService.onOpenPanelAction(
      this.panelOpenState,
      this.hf
    );
  }
  private initializeUIValues() {
    this.hfOrganization = this.hf.properties.private
      ? OWNERSHIP_PRIVATE
      : OWNERSHIP_PUBLIC;
    this.hfType = this.hfTypesOptions.find(
      (opt) => this.hf.properties.level_of_care == opt.value
    )?.label!;
    // this.hfHours = (this.hf.properties.operating_hours_start) ? `${this.hf.properties.operating_hours_start}-${this.hf.properties.operating_hours_stop}` : "";
    this.hfServices = this.hf.properties.services.join(',');
    this.hfSynonyms = this.hf.properties.synonyms.join(',');
    this.hfMaturity = this.hf.properties.maturity_level;
    this.calculateCatchmentForHfs();
  }

  private calculateCatchmentForHfs() {
    if (!this.singleStService.fixedPostEntries.has(this.hfId)) {
      this.logger.error(
        `Fixed post health id ${this.hfId} not found in st service`
      );
      return;
    }
    if (!this.singleStService.settlementPart) {
      this.logger.debug(`The settlement for HF was not found`);
      return;
    }
    const entry = this.singleStService.fixedPostEntries.get(this.hfId)!;

    const catchmentPopulation =
      (this.singleStService.settlementPart!.properties.computed_pop! *
        (entry.percFixedPost + entry.percOutreach)) /
      100.0;

    //For https://github.com/novelt/GMT/issues/1805, we want the fp / outreach breakdowns to always cover
    //the full bar.  Since entry.percFixedPost is the % of the settlement, we normalize the values to always == 100
    const totalPerc = entry.percFixedPost + entry.percOutreach;
    let percFixedPost = (100.0 * entry.percFixedPost) / totalPerc;
    let percOutreach = (100.0 * entry.percOutreach) / totalPerc;

    if (!isFloat(percFixedPost) || !isFloat(percOutreach)) {
      this.logger.error('Catchment calculation error');
      percFixedPost = 100.0;
      percOutreach = 0;
    }

    this.coverageHf = {
      catchmentPopulation,
      percFixedPost,
      percOutreach,
      percProblematic:
        this.singleStService.settlementName.properties.problematic.length > 0
          ? 100
          : 0,
      isCatchmentDone: this.hf.properties.mp_status == 'Complete',
    };

    this.logger.debug(`hf details content ${this.hfId}`, this.coverageHf);
  }

  private listenToSort() {
    this.displayName = this.hf?.properties.name;

    this.sortStateService.hfListInStDetailsSort
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((sortState) => {
        this.displayName = getSortedDisplayName(sortState, this.hf);
      });
  }
}
