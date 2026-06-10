import { Component, Inject, Injector, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { filter, ReplaySubject, Subject, take } from 'rxjs';
import {
    ACCORDION_TOKEN,
    ADDITIONAL_DATA,
    EDIT_PERMISSIONS
} from "src/app/components/microplan-view/microplan-list/microplan-list.component";
import { HealthFacilityItem } from "src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component";
import { SingleHfProcessingService } from 'src/app/services/vector_layer/single-hf-processing.service';
import _ from "lodash";

@Component({
    selector: 'hf-geometry-edit',
    templateUrl: './hf-geometry-edit.component.html',
    styleUrls: ['./hf-geometry-edit.component.less'],
    standalone: false
})
export class HfGeometryEditComponent implements OnInit, OnDestroy {
    public hf: HealthFacilityItem | null = null; //injected property
    public userCanEdit: boolean = false;
    public messages: string = "";
    private unsubscribe = new Subject();

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
        private injector: Injector,
        private singleHfProcessingService: SingleHfProcessingService
    ) {
        this.userCanEdit = this.injector.get(EDIT_PERMISSIONS);
        this.hf = (this.injector.get(ADDITIONAL_DATA) as unknown) as HealthFacilityItem;
    }

    ngOnInit() {
        if (this.hf) {
            this.messages = "";
            this.hf.problemsUI.forEach((problem) => {
                this.messages += problem.message;
            });
        }
    }

    ngOnDestroy(): void {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    public async enableLocationWizard() {
        if (_.isNil(this.hf)) {
            return;
        }
        if (_.isNil(this.hf.json)) {
            return
        }
        this.singleHfProcessingService.enableLocationWizard(this.hf.json);
    }

    public handleShowHfSiteOnMap(event: MouseEvent) {
        if (_.isNil(this.hf)) {
            return;
        }
        if (_.isNil(this.hf.json)) {
            return
        }
        event.stopPropagation();
        this.singleHfProcessingService.handleShowHfSiteOnMap(this.hf.json);
    }

    public async redirectToDetails() {
        if (_.isNil(this.hf)) {
            return;
        }
        if (_.isNil(this.hf.json)) {
            return
        }
        await this.singleHfProcessingService.redirectToDetails(this.hf.json);
    }

}
