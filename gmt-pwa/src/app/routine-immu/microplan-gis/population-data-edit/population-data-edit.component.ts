import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject, take, takeUntil } from 'rxjs';
import { uninhabitedReasonsOptions } from 'src/app/constants/st.constants';
import { ProblemsService } from 'src/app/services/attention/problems.service';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import {
  CoverageSett,
  SingleStProcessingService,
} from 'src/app/services/vector_layer/single-st-processing.service';
import {
  PropertyValue,
  SettlementListItem,
  UninhabitedOption,
} from 'src/app/utils/server-interfaces/GeoJson';
import { VectorLayerForPermissions } from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  formatPercentage,
  formatPopulation,
} from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';
import { UninhabitedPopupComponent } from '../../st-details/st-details-content/uninhabited-popup/uninhabited-popup.component';

export const populationDiscrepanciesTab = 'populationDiscrepanciesTab';

@Component({
  selector: 'population-data-edit',
  templateUrl: './population-data-edit.component.html',
  styleUrls: [
    '../../../components/catchment-card/card.less',
    './population-data-edit.component.less',
  ],
  standalone: false
})
export class PopulationDataEditComponent implements OnInit, OnDestroy {
  @Input() activeTab: string | null = null;
  @Output() tabIsOpen = new EventEmitter<boolean>();
  public populationDiscrepanciesTab = populationDiscrepanciesTab;
  public mainPanelOpenState: boolean = true;
  public panelOpenState: boolean = false;
  public userCanEdit: boolean = false;
  public editing: boolean = false;
  public populationIssues: SettlementListItem[] = [];
  public uninhabitedReasonsOptions: Array<SelectOption> =
    uninhabitedReasonsOptions;
  public catchmentMap = new Map<string, CoverageSett>();
  private userHasPermissionsUpdateSt: boolean = false;
  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    private crudLayerService: CrudLayerService,
    private permissionsLayerService: PermissionsLayerService,
    private problemsService: ProblemsService,
    private singleStProcessingService: SingleStProcessingService,
    private userContextService: UserContextService,
    private matDialog: MatDialog
  ) {}

  ngOnInit() {
    this.bvService
      .loadedObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.populationIssues = this.problemsService.getPopulationProblems();
        this.calculateCatchmentInfo();
      });
    this.subscribeToUndoRedo();
    this.permissionsLayerService
      .getPermissionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.setComponentPermissions();
      });
    this.subscribeToEditMode();
  }

  ngOnDestroy(): void {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public panelStateChange() {
    this.tabIsOpen.emit(this.mainPanelOpenState);
  }

  public async markForReview(issueData: SettlementListItem) {
    this.singleStProcessingService.markForReview(issueData.settlementName);
  }

  public async handleEstimatedPopChange(
    settlementItem: SettlementListItem,
    inputEl: HTMLInputElement
  ) {
    const newPop = inputEl.value;
    let newPopNum = parseInt(newPop);

    if (newPopNum <= 0) {
      const ok = await this.showUninhabitedDialog(null, settlementItem);
      if (!ok) {
        //revert
        inputEl.value =
          settlementItem.settlementName.properties.estimated_pop?.toString() ||
          '';
        return;
      }
    }

    await this.singleStProcessingService.handleEstimatedPopChange(
      settlementItem.settlementName,
      settlementItem.settlementPart,
      newPopNum
    );
    this.removeItemIfNeeded(settlementItem);
  }

  private showUninhabitedDialog(
    actionId: string | null,
    settlementItem: SettlementListItem
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const dialogRef = this.matDialog.open(UninhabitedPopupComponent, {
        autoFocus: false,
        width: '430px',
        data: {},
      });

      dialogRef
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => {
          if (result) {
            this.singleStProcessingService.uninhabitedChange(
              settlementItem.settlementName,
              settlementItem.settlementPart,
              result,
              actionId
            );
            resolve(true);
          } else {
            resolve(false);
          }
        });
    });
  }

  public handleShowSettlementSiteOnMap(
    event: MouseEvent,
    settlementItem: SettlementListItem
  ) {
    event.stopPropagation();
    this.singleStProcessingService.handleShowSettlementSiteOnMap(
      settlementItem.settlementName
    );
  }

  public formatPopulation(pop: number | null, minify: boolean = true) {
    return formatPopulation(pop, undefined, minify);
  }

  public async uninhabitedReasonChange(
    newReason: UninhabitedOption,
    settlementItem: SettlementListItem
  ) {
    await this.singleStProcessingService.uninhabitedReasonChange(
      settlementItem.settlementName,
      newReason
    );
    this.removeItemIfNeeded(settlementItem);
  }

  public formatPercentage(pop: PropertyValue) {
    return formatPercentage(pop, true);
  }
  public onOpenPanelAction(settlementItem: SettlementListItem) {
    this.singleStProcessingService.onOpenPanelAction(
      this.panelOpenState,
      settlementItem.settlementName
    );
  }

  private setComponentPermissions(): void {
    if (!this.bvService.boundaryInfo?.boundary) {
      return;
    }
    this.userHasPermissionsUpdateSt =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlementPart,
        'update',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.updateCanUserDoAction();
  }

  private subscribeToUndoRedo() {
    this.crudLayerService
      .getUndoEventObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (_) => {
        this.populationIssues = this.problemsService.getPopulationProblems();
      });
    this.crudLayerService
      .getRedoEventObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (_) => {
        this.populationIssues = this.problemsService.getPopulationProblems();
      });
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.updateCanUserDoAction();
      });
  }

  private updateCanUserDoAction(): void {
    this.userCanEdit = this.userHasPermissionsUpdateSt && this.editing;
  }

  private getStItemFromId(globalId: string) {
    const settlementName = this.bvService.data.snMap.get(globalId);
    if (!settlementName) {
      return null;
    }
    const settlementPart =
      this.bvService.data.spMap.get(
        settlementName.properties.settlement_part!
      ) || null;
    return {
      settlementName: settlementName,
      settlementPart,
    } as SettlementListItem;
  }

  private calculateCatchmentInfo() {
    this.populationIssues.forEach((issue) => {
      const catchmentObj = this.singleStProcessingService.calculateCatchment(
        issue.settlementPart,
        issue.settlementName
      )!;
      this.catchmentMap.set(
        issue.settlementName.properties.global_id,
        catchmentObj.catchment
      );
    });
  }

  private removeItemIfNeeded(settlementItem: SettlementListItem) {
    if (
      !this.problemsService.settlementHasPopulationIssue(
        this.getStItemFromId(
          settlementItem.settlementName.properties.global_id
        )!
      )
    ) {
      this.populationIssues = this.populationIssues.filter(
        (item) => item !== settlementItem
      );
    }
  }
}
