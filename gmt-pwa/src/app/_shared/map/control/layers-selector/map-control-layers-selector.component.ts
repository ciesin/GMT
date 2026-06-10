import { AfterViewInit, Component, EventEmitter, Inject, OnInit } from '@angular/core';
import BaseLayer from 'ol/layer/Base';
import {
    HF_LAYER,
    ST_GEOMETRY_LAYER,
    ST_NAME_LAYER,
    CHURCH_LAYER,
    MARKET_LAYER,
    MOSQUE_LAYER,
    OUTREACH,
    SCHOOL_LAYER
} from "src/app/utils/server-interfaces/VectorLayerName";
import { LayerIds, MapEventsService } from '@services/map/base/map-events.service';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
    addWizardCssClassToCdkOverlayWrapper,
    switchWizardCssClass
} from "@components/wizard/health-facility-wizard/health-facility-wizard.component";

export interface Layer {
    label: string;
    icon?: string;
    command?: any;
    checked?: boolean | null;
    items?: Layer[];
    allChecked?: boolean;
}
export interface MapLayerSelection {
    id: string,
    visible: boolean
}

@Component({
    selector: 'map-control-layers-selector',
    templateUrl: './map-control-layers-selector.component.html',
    styleUrls: ['./map-control-layers-selector.component.less'],
    standalone: false
})
export class MapControlLayersSelectorComponent implements OnInit, AfterViewInit {

    public mapLayers: Layer[] = [];
    // It is simpler to have it separate from the layers as the legend has custom rows or may not use the icons one day
    layersIconsMapping = {
        [ST_GEOMETRY_LAYER]: 'boundaries',
        [CHURCH_LAYER]: 'church',
        [MOSQUE_LAYER]: 'mosque',
        [MARKET_LAYER]: 'market',
        [SCHOOL_LAYER]: 'school',
        [ST_NAME_LAYER]: 'settlement',
        [HF_LAYER]: 'hf',
        [OUTREACH]: 'outreach',
        [LayerIds.CATCHMENT]: 'catchment',
        [LayerIds.HF_BUFFERS]: 'buffer',
        [LayerIds.HF_VORONOI]: 'voronoi',
    }
    public loaded: boolean = false;
    constructor(
        public dialogRef: MatDialogRef<MapControlLayersSelectorComponent>,
        @Inject(MAT_DIALOG_DATA) private data,
        private mapEvents: MapEventsService,
    ) {
    }

    ngOnInit() {
        this.createLegendMenu();
        this.loaded = true;
    }

    ngAfterViewInit() {
        setTimeout(() => {
            switchWizardCssClass(true);
            addWizardCssClassToCdkOverlayWrapper(true);
        }, 1);
    }
    handleCancelDialog() {
        this.dialogRef.close();
    }

    updateChecked(layer: Layer) {
        let checked = 0;
        let unChecked = 0;
        layer.items!.forEach(l => {
            l.command(l.checked);
            if (l.checked == false) {
                unChecked += 1;
            } else {
                checked += 1;
            }
        });
        layer.allChecked = unChecked === 0;
    }

    someChecked(layer: Layer): boolean {
        if (layer.items == null) {
            return false;
        }
        return layer.items.filter(l => l.checked).length > 0 && !layer.allChecked;
    }

    setAll(layer: Layer, checked: boolean) {
        layer.allChecked = checked;
        if (layer.items == null) {
            return;
        }
        layer.items.forEach(l => {
            l.command(checked);
            l.checked = checked;
        });
    }

    private createLegendMenu() {
        this.mapLayers = [];

        if (this.data.initialMapLayers && this.data.initialMapLayers.length > 0) {
            const filteredLayers = this.data.initialMapLayers.filter(
                layer => layer.get('overlay') !== true
            );

            // Loop through all layers and append them to the correct top-level item
            filteredLayers.forEach(layer => {
                const layerName = layer.get('name') || `Layer (ID: ${layer.get('id')})`;
                const layerGroup = layer.get('legendGroup') || 'Others';
                this.addLayerToTopLevel(layerGroup, layerName, layer);
            });
            this.mapLayers.forEach(layer => {
                this.updateChecked(layer);
            });
            this.addLayerWithoutCheckbox();
        }

        const sortOrder = ["HEALTH FACILITIES", "SETTLEMENTS", "POPULATION", "POINTS OF INTEREST", "GUIDES"]
        this.mapLayers.sort((a, b) => {
            return sortOrder.indexOf(a.label || "") - sortOrder.indexOf(b.label || "");
        })
    }

    private addLayerToTopLevel(topLevelName: string, layerName: string, layer: BaseLayer) {
        if (topLevelName === "Others") {
            return;
        }
        const matchingTopLevelItem = this.mapLayers.find(el => el.label === topLevelName);
        if (matchingTopLevelItem) {
            matchingTopLevelItem.items?.push({
                label: layerName,
                checked: layer.getVisible(),
                icon: this.layersIconsMapping[layer?.get('id')],
                command: (checked) => {
                    this.handleCheckedChange(checked, layer);
                }
            } as Layer);
        } else {

            this.mapLayers.push({
                label: topLevelName,
                items: [{
                    label: layerName,
                    checked: layer.getVisible(),
                    icon: this.layersIconsMapping[layer?.get('id')],
                    command: (checked) => {
                        this.handleCheckedChange(checked, layer);
                    }
                } as Layer]
            });
        }
    }

    private handleCheckedChange(checked: boolean, layer: BaseLayer) {
        // only trigger visibility change once all layers are loaded
        if (this.loaded) {
            this.mapEvents.triggerLayerVisibilityChange(layer.get('id'), checked);
        }
    }

    private addLayerWithoutCheckbox() {
        const matchingTopLevelItem = this.mapLayers.find(el => el.label === 'HEALTH FACILITIES');
        if (!matchingTopLevelItem) {
            return;
        }
        matchingTopLevelItem.items!.splice(1, 0, {
            label: OUTREACH,
            checked: null,
            icon: this.layersIconsMapping[OUTREACH],
            command: () => {
            }
        } as Layer);
    }
}
