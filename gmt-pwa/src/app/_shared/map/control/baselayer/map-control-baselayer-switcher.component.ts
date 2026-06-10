import { Component, ViewChild } from '@angular/core';
import { MapControlBaseComponent } from "../map-control-base.component";
import { MenuItem } from "primeng/api";
import BaseLayer from "ol/layer/Base";
import { Menu } from "primeng/menu";
import { Subscription } from "rxjs";
import { MatSelectChange } from '@angular/material/select';
import { none } from 'ol/centerconstraint';
import { NO_BASEMAP, OSM_CACHED } from "src/app/constants/basemap-names";

interface SelectOption {
    value: BaseLayer | null,
    label: string
}


@Component({
    selector: 'map-control-baselayer-switcher',
    templateUrl: './map-control-baselayer-switcher.component.html',
    styleUrls: ['./map-control-baselayer-switcher.component.less'],
    providers: [{ provide: MapControlBaseComponent, useExisting: MapControlBaselayerSwitcherComponent }],
    standalone: false
})
export class MapControlBaselayerSwitcherComponent extends MapControlBaseComponent {

    @ViewChild('baselayerButton') baselayerButton?: any;
    @ViewChild('baselayerMenu') baselayerMenu?: Menu;

    selectedBaselayer: string = OSM_CACHED;
    baselayerMenuEntries: Array<SelectOption> = [];

    public isBaseLayerSwitcherContainerOpen = false;

    private subscription?: Subscription;

    override ngOnInit() {
        // When control gets bound to map
        this.bindControl.subscribe(map => {
            this.subscription = map.baselayerChange.subscribe((bl) => {
                this.createBaselayerMenu(map.baselayers || []);
                this.updateLayerIcon();
            });
            this.createBaselayerMenu(map.baselayers || []);
            this.updateLayerIcon();
        });

        // When control gets unbound from map
        this.unbindControl.subscribe(map => {
            this.subscription?.unsubscribe();
            this.createBaselayerMenu([]);
        });

        // First bind to events, then init parent class
        super.ngOnInit();
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    closeBaseLayerSwitcher() {
        this.isBaseLayerSwitcherContainerOpen = false;
    }
    toggleBaseLayerSwitcher() {
        this.isBaseLayerSwitcherContainerOpen = !this.isBaseLayerSwitcherContainerOpen;
    }

    createBaselayerMenu(baselayers: BaseLayer[]) {
        this.baselayerMenuEntries = [];

        if (baselayers.length > 0) {
            this.baselayerMenuEntries = baselayers.map((l) => {
                return {
                    label: l.get('name') || `Layer (ID: ${l.get('id')})`,
                    value: l
                };
            });
            this.baselayerMenuEntries.splice(0, 0, {
                label: "None",
                value: null
            });
        } else {
            this.baselayerMenuEntries = [];
        }
    }

    handleSelection(selected: SelectOption['value'], label: string) {
        if (!selected) {
            this.selectedBaselayer = NO_BASEMAP;
            this._mapPanel!.removeBaseLayer();
        } else {
            this.selectedBaselayer = label;
            this._mapPanel!.toggleBaseLayer(selected);
        }
    }

    updateLayerIcon() {
        const element = this.baselayerButton?.nativeElement;
        if (element && this._mapPanel?.baselayer?.get('icon')) {
            element.style.backgroundImage = `url(assets/icons/map/${this._mapPanel?.baselayer?.get('icon')})`;
        }
    }
}
