import { Component, Inject, Injector, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { filter, ReplaySubject, Subject, take } from 'rxjs';
import { NGXLogger } from 'ngx-logger';
import {
    ACCORDION_TOKEN,
    ADDITIONAL_DATA,
    EDIT_PERMISSIONS
} from "src/app/components/microplan-view/microplan-list/microplan-list.component";
import {
    hfTypesOptions,
    OWNERSHIP_PRIVATE,
    OWNERSHIP_PUBLIC,
    ownershipOptions,
    servicesOptions
} from 'src/app/constants/hf.constants';
import { HealthFacilityItem } from "src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component";
import {
    CoverageHf,
    loadHealthFacility,
    SingleHfProcessingService
} from 'src/app/services/vector_layer/single-hf-processing.service';
import {
    HealthFacilityCatchmentStatus,
    HealthFacilityLevelOfCare,
    HealthFacilityServices
} from "src/app/utils/server-interfaces/GeoJson";
import { HFProblemTypes } from "src/app/routine-immu/microplan-gis/microplan-gis.component";
import { formatPopulation } from 'src/app/utils/string-formatting';
import { BoundaryVectorLayersService } from "@services/boundary-vector-layers.service";
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import _ from "lodash";

@Component({
    selector: 'hf-issue-edit',
    templateUrl: './hf-issue-edit.component.html',
    styleUrls: [
        '../../../../components/catchment-card/card.less',
        './hf-issue-edit.component.less',
    ],
    standalone: false
})
export class HfIssueEditComponent implements OnInit, OnDestroy {
    public hf: HealthFacilityItem | null = null; //injected property
    public userCanEdit: boolean = false;
    public messages: string = "";
    public FORM_KEY_NAME = 'name';
    public FORM_KEY_SERVICES = 'services';
    public FORM_KEY_LEVEL_OF_CARE = 'type';
    public FORM_KEY_OWNERSHIP = 'ownership';
    public hfTypesOptions = hfTypesOptions;
    public ownershipOptions = ownershipOptions;
    public servicesOptions = servicesOptions;
    public problems = {
        [this.FORM_KEY_NAME]: false,
        [this.FORM_KEY_SERVICES]: false,
        [this.FORM_KEY_LEVEL_OF_CARE]: false,
        [this.FORM_KEY_OWNERSHIP]: false,
    };
    public coverage: CoverageHf;
    basicInformationFormGroup = this.formBuilder.group({
        [this.FORM_KEY_NAME]: new FormControl<string | null>(null),
        [this.FORM_KEY_OWNERSHIP]: new FormControl<string | null>(null),
        [this.FORM_KEY_LEVEL_OF_CARE]: new FormControl<HealthFacilityLevelOfCare>("Primary"),
        [this.FORM_KEY_SERVICES]: new FormControl<Array<HealthFacilityServices>>(['Routine Immunization'], Validators.required),
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

    private unsubscribe = new Subject();

    constructor(
        @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
        private bvService: BoundaryVectorLayersService,
        private formBuilder: FormBuilder,
        private injector: Injector,
        private logger: NGXLogger,
        private singleHfProcessingService: SingleHfProcessingService
    ) {
        this.userCanEdit = this.injector.get(EDIT_PERMISSIONS);
        this.hf = (this.injector.get(ADDITIONAL_DATA) as unknown) as HealthFacilityItem;
    }

    ngOnInit() {
        if (this.hf) {
            this.messages = "";
            this.hf.problemsUI.forEach((problem) => {
                this.messages += problem.message + " \n";
            });
            this.updateUI();
        }
    }

    ngOnDestroy(): void {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    public async nameChange() {
        if (_.isNil(this.hf)) {
            return;
        }
        let newName = this.basicInformationFormGroup.get(this.FORM_KEY_NAME)!.value;
        await this.singleHfProcessingService.nameChange(this.hf.json, newName);
    }

    public handleShowHfSiteOnMap(event: MouseEvent) {
        if (_.isNil(this.hf)) {
            return;
        }
        event.stopPropagation();
        this.singleHfProcessingService.handleShowHfSiteOnMap(this.hf.json);
    }

    public async redirectToDetails() {
        if (_.isNil(this.hf)) {
            return;
        }
        await this.singleHfProcessingService.redirectToDetails(this.hf.json);
    }

    public async ownershipChange(event: Event) {
        if (_.isNil(this.hf)) {
            return;
        }
        const newOwnership = event as unknown as string;
        if (newOwnership == OWNERSHIP_PUBLIC || newOwnership == OWNERSHIP_PRIVATE) {
            await this.singleHfProcessingService.ownershipChange(this.hf.json, newOwnership, true);
        } else {
            throw new Error(`Unexpected ownership value: ${newOwnership}`);
        }
    }

    public async typeChange(event: Event) {
        if (_.isNil(this.hf)) {
            return;
        }
        const newType = event as unknown as HealthFacilityLevelOfCare;
        await this.singleHfProcessingService.typeChange(this.hf.json, newType);
    }

    async serviceChange(event: Event) {
        if (_.isNil(this.hf)) {
            return;
        }
        const newServices = event as unknown as HealthFacilityServices[];
        await this.singleHfProcessingService.serviceChange(this.hf.json, newServices);
    }

    public formatPopulation(pop: number | null) {
        return formatPopulation(pop);
    }
    public onOpenPanelAction() {
        if (_.isNil(this.hf)) {
            return;
        }
        this.singleHfProcessingService.onOpenPanelAction(this.panelOpenState, this.hf.json);
    }

    private updateUI() {
        if (_.isNil(this.hf)) {
            return;
        }
        this.problems = {
            [this.FORM_KEY_NAME]: this.hf.problemsUI.filter(issue => issue.type == HFProblemTypes.EMPTY_NAME).length > 0,
            [this.FORM_KEY_SERVICES]: this.hf.problemsUI.filter(issue => issue.type == HFProblemTypes.EMPTY_SERVICES).length > 0,
            [this.FORM_KEY_LEVEL_OF_CARE]: this.hf.problemsUI.filter(issue => issue.type == HFProblemTypes.EMPTY_TYPE).length > 0,
            [this.FORM_KEY_OWNERSHIP]: this.hf.problemsUI.filter(issue => issue.type == HFProblemTypes.EMPTY_OWNERSHIP).length > 0,
        };
        this.basicInformationFormGroup.get(this.FORM_KEY_NAME)!.setValue(this.hf.json.properties.name);
        this.basicInformationFormGroup.get(this.FORM_KEY_SERVICES)!.setValue(this.hf.json.properties.services);
        this.basicInformationFormGroup.get(this.FORM_KEY_LEVEL_OF_CARE)!.setValue(this.hf.json.properties.level_of_care);
        this.basicInformationFormGroup.get(this.FORM_KEY_OWNERSHIP)!.setValue(this.singleHfProcessingService.ownershipMap(this.hf.json.properties.private));
        this.calculateCatchmentInfo();
    }

    private calculateCatchmentInfo() {
        if (_.isNil(this.hf)) {
            return;
        }
        this.coverage = loadHealthFacility({
            logger: this.logger,
            boundaryData: this.bvService.data
        }, this.hf.json.properties.global_id)!;
    }
}
