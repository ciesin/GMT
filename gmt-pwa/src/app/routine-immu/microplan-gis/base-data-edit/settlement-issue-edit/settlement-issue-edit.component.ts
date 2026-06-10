import { Component, EventEmitter, Inject, Injector, Output, ViewChild } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { CoverageSett, SingleStProcessingService } from "src/app/services/vector_layer/single-st-processing.service";
import {
    ACCORDION_TOKEN,
    ADDITIONAL_DATA,
    EDIT_PERMISSIONS
} from "src/app/components/microplan-view/microplan-list/microplan-list.component";
import { SettlementIssueItem } from "src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component";
import { formatPercentage, formatPopulation } from 'src/app/utils/string-formatting';
import { PropertyValue } from "src/app/utils/server-interfaces/GeoJson";
import { BoundaryVectorLayersService } from "@services/boundary-vector-layers.service";
import { filter, ReplaySubject, take } from 'rxjs';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import _ from "lodash";

@Component({
    selector: 'settlement-issue-edit',
    templateUrl: './settlement-issue-edit.component.html',
    styleUrls: [
        '../../../../components/catchment-card/card.less',
        './settlement-issue-edit.component.less',
    ],
    standalone: false
})
export class SettlementIssueEditComponent {
    public settlementIssueItem: SettlementIssueItem | null = null; //injected property
    @Output() removeItem = new EventEmitter();
    public userCanEdit: boolean = false;
    public editing: boolean = false;
    public coverage: CoverageSett;
    public FORM_KEY_NAME = 'name';
    basicInformationFormGroup = this.formBuilder.group({
        [this.FORM_KEY_NAME]: new FormControl<string | null>(null),
    });
    public panelOpenState: boolean = false;

    @ViewChild(MatExpansionPanel)
    set matExpansionPanel(panel: MatExpansionPanel) {
        // hook the panel expansion to the accordion when ready
        if (!panel) { return; }
        this.accordion$.pipe(
            filter(Boolean),
            take(1)
        ).subscribe(accordion => panel.accordion = accordion);
    }

    constructor(
        @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
        private bvService: BoundaryVectorLayersService,
        private injector: Injector,
        private formBuilder: FormBuilder,
        private singleStProcessingService: SingleStProcessingService
    ) {
        this.settlementIssueItem = (this.injector.get(ADDITIONAL_DATA) as unknown) as SettlementIssueItem;
        this.userCanEdit = this.injector.get(EDIT_PERMISSIONS);
        this.setSettlementData();
    }

    public async nameChange() {
        let newName = this.basicInformationFormGroup.get(this.FORM_KEY_NAME)!.value;
        await this.singleStProcessingService.nameChange(this.settlementIssueItem!.settlementName, newName);
    }

    public handleShowSettlementSiteOnMap(event: MouseEvent) {
        event.stopPropagation();
        this.singleStProcessingService.handleShowSettlementSiteOnMap(this.settlementIssueItem!.settlementName);
    }

    public async redirectToDetails() {
        await this.singleStProcessingService.redirectToDetails(this.settlementIssueItem!.settlementName);
    }

    public formatPopulation(pop: number | null) {
        return formatPopulation(pop);
    }

    public formatPercentage(pop: PropertyValue) {
        return formatPercentage(pop, true);
    }
    public onOpenPanelAction() {
        this.singleStProcessingService.onOpenPanelAction(this.panelOpenState, this.settlementIssueItem!.settlementName);
    }

    private setSettlementData() {
        if (!this.settlementIssueItem || !this.settlementIssueItem.settlementPart || !this.settlementIssueItem.settlementName) {
            return
        }
        this.basicInformationFormGroup.get(this.FORM_KEY_NAME)!.setValue(this.settlementIssueItem.settlementName.properties.name);
        this.calculateCatchmentInfo();
    }

    private calculateCatchmentInfo() {
        const catchmentObj = this.singleStProcessingService.calculateCatchment(
            this.settlementIssueItem!.settlementPart!,
            this.settlementIssueItem!.settlementName)!;
        this.coverage = catchmentObj.catchment;
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
