import { Component, EventEmitter, Input, Output } from "@angular/core";
import { NGXLogger } from "ngx-logger";
import _ from "lodash";
import { BoundaryData, BoundaryMapArgs, } from "src/app/utils/export/pdf";
import BaseLayer from "ol/layer/Base";
import VectorSource from "ol/source/Vector";
import { Map as OLMap } from "ol";
import TileLayer from "ol/layer/Tile";

@Component({
    standalone: true,
    template: ''
})
export class PdfMapBaseComponent {

    @Input() width: number;
    @Input() height: number;
    @Output() mapLoaded = new EventEmitter<OLMap>();

    map: OLMap | null = null;

    @Input() parentHtmlId: string | null = null;

    getLogger(): NGXLogger {
        throw new Error('Component must override this');
    }


}