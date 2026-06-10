import {
  Component,
  EventEmitter,
  Inject,
  Injector,
  Output,
  ViewChild,
} from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import _ from 'lodash';
import { filter, ReplaySubject, take } from 'rxjs';
import {
  ACCORDION_TOKEN,
  ADDITIONAL_DATA,
  EDIT_PERMISSIONS,
} from 'src/app/components/microplan-view/microplan-list/microplan-list.component';
import { SettlementIssueItem } from 'src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component';
import {
  CoverageSett,
  SingleStProcessingService,
} from 'src/app/services/vector_layer/single-st-processing.service';
import { PropertyValue } from 'src/app/utils/server-interfaces/GeoJson';
import {
  formatPercentage,
  formatPopulation,
} from 'src/app/utils/string-formatting';

@Component({
  selector: 'st-geometry-edit',
  templateUrl: './st-geometry-edit.component.html',
  styleUrls: [
    '../../../../components/catchment-card/card.less',
    './st-geometry-edit.component.less',
  ],
  standalone: false
})
export class StGeometryEditComponent {
  public settlementIssueItem: SettlementIssueItem | null = null; //injected property
  @Output() removeItem = new EventEmitter();
  public userCanEdit: boolean = false;
  public editing: boolean = false;
  public messages = '';
  public coverage: CoverageSett;
  public panelOpenState: boolean = false;

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

  constructor(
    @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
    private injector: Injector,
    private formBuilder: FormBuilder,
    private singleStProcessingService: SingleStProcessingService
  ) {
    this.settlementIssueItem = this.injector.get(
      ADDITIONAL_DATA
    ) as unknown as SettlementIssueItem;
    this.calculateCatchmentInfo();
    this.userCanEdit = this.injector.get(EDIT_PERMISSIONS);
    this.setSettlementData();
  }

  public handleShowSettlementSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    if (!this.settlementIssueItem) {
      return;
    }
    this.singleStProcessingService.handleShowSettlementSiteOnMap(
      this.settlementIssueItem.settlementName
    );
  }

  public async enableLocationWizard() {
    if (!this.settlementIssueItem) {
      return;
    }
    this.singleStProcessingService.enableLocationWizard(
      this.settlementIssueItem.settlementName,
      this.settlementIssueItem.settlementPart!
    );
  }

  public async redirectToDetails() {
    if (!this.settlementIssueItem) {
      return;
    }
    await this.singleStProcessingService.redirectToDetails(
      this.settlementIssueItem.settlementName
    );
  }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public formatPercentage(pop: PropertyValue) {
    return formatPercentage(pop, true);
  }

  public onOpenPanelAction() {
    this.singleStProcessingService.onOpenPanelAction(
      this.panelOpenState,
      this.settlementIssueItem!.settlementName
    );
  }

  private setSettlementData() {
    if (!this.settlementIssueItem) {
      return;
    }
    this.messages = this.settlementIssueItem.problems!.messages.join('.\n ');
  }

  private calculateCatchmentInfo() {
    const catchmentObj = this.singleStProcessingService.calculateCatchment(
      this.settlementIssueItem!.settlementPart!,
      this.settlementIssueItem!.settlementName
    );
    this.coverage = catchmentObj!.catchment;
  }

  public hasProblems(): boolean {
    if (_.isNil(this.coverage)) {
      return false;
    }
    if (!_.isArray(this.coverage.problematic)) {
      return false;
    }
    return this.coverage.problematic.length > 0;
  }
}
