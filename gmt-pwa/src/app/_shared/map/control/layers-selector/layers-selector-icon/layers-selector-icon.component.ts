import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
    DEFAULT_WIZARD_DIALOG_OPTIONS
} from "@components/wizard/health-facility-wizard/health-facility-wizard.component";
import BaseLayer from 'ol/layer/Base';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
    MapControlLayersSelectorComponent
} from "src/app/_shared/map/control/layers-selector/map-control-layers-selector.component";
import { MapControlBaseComponent } from "src/app/_shared/map/control/map-control-base.component";

export interface Layer {
    label: string;
    icon?: string;
    command?: any;
    checked?: boolean | null;
    items?: Layer[];
    allChecked?: boolean;
}
@Component({
    selector: 'map-control-layers-selector-icon',
    templateUrl: './layers-selector-icon.component.html',
    styleUrls: ['./layers-selector-icon.component.less'],
    providers: [{ provide: MapControlBaseComponent, useExisting: LayersSelectorIconComponent }],
    standalone: false
})
export class LayersSelectorIconComponent extends MapControlBaseComponent {
    private initialMapLayers: Array<BaseLayer> = [];

    isLegendOpen: boolean = false;
    // @Output() legendOpenChange = new EventEmitter<boolean>();
    private unsubscribe = new Subject();

    constructor(private dialog: MatDialog) {
        super();
    }

    override ngOnInit() {
        super.ngOnInit();
        this.subscribeToMapLayers();
    }

    ngOnDestroy() {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }
    toggleLegend() {
        if (this.initialMapLayers.length === 0) {
            return;
        }
        this.isLegendOpen = !this.isLegendOpen;
        // this.legendOpenChange.emit(this.isLegendOpen);
        if (this.dialog.openDialogs.length > 0) {
            // this.logger.info("Not opening additional dialog");
            return;
        }
        let data = {
            initialMapLayers: this.initialMapLayers
        };
        const dialogRef = this.dialog.open(MapControlLayersSelectorComponent, {
            // hasBackdrop:false,
            ...DEFAULT_WIZARD_DIALOG_OPTIONS,
            data
        });

        //Note that using takeUntil causes this not to respond.  So this component may get destroyed while this is still being processed
        // dialogRef.afterClosed().pipe(take(1)).subscribe(async (result: ExcludeDialogResult) => {
        //   //this.logger.debug(`eee result`, result);
        //   // await this.handleExcludeDialog(result);
        // });

    }

    private subscribeToMapLayers() {
        // When control gets bound to map
        this.bindControl.pipe(takeUntil(this.unsubscribe)).subscribe(map => {
            setTimeout(() => {
                this.initialMapLayers = this._mapPanel?.overlays!;
            }, 200);
            map.overlaysChange.subscribe(() => {
                this.initialMapLayers = this._mapPanel?.overlays!;
            });
        });

        // When control gets unbound from map
        this.unbindControl.subscribe(map => {
            this.unsubscribe.next(undefined);
            this.unsubscribe.complete();
        });
    }
}
