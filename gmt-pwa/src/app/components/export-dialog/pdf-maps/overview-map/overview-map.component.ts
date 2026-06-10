import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit, SimpleChanges } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { NGXLogger } from "ngx-logger";
import { Unsubscribe } from "src/app/_shared/mixins/unsubscribe";
import { MatModule } from "src/app/mat.module";
import _ from "lodash";
import { PdfDataService } from "../pdf-data-service";
import { BoundaryData, BoundaryMapArgs, } from "src/app/utils/export/pdf";
import { GeoJsonBoundary } from "src/app/utils/server-interfaces/GeoJson";
import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import { mapStyles } from "src/app/_shared/map/styles/map-design";
import { pdfBoundariesOverviewMap, pdfHealthfacilitiesOverviewMap, pdfSettlementsOverviewMap } from "src/app/_shared/map/styles/map-pdf-styles";
import VectorSource from "ol/source/Vector";
import { createPolygonMask } from "src/app/_shared/map/util/map-utils";
import { AuthService } from "@services/user/auth.service";
import { IsOnlineService } from "@services/is-online.service";
import { VectorLayerService } from "@services/vector_layer/vector-layers.service";
import TileLayer from "ol/layer/Tile";

import { LAYER_BOUNDARY_ID, LAYER_HEALTH_FACILITIES_ID, LAYER_SETTLEMENTS_NAMES_ID, LAYER_SETTLEMENTS_PARTS_ID } from "../pdf-constants";
import { PdfMapComponent } from "../pdf-map-component-mixin";
import { PdfMapBaseComponent } from "../pdf-map-basecomponent";


//Mixin base component which is mostly the same between the 2 maps
class BaseMapComponent extends PdfMapBaseComponent {
    mapHtmlIdPrefix = "pdf-overview-map"
}

const MixedComponent = PdfMapComponent(Unsubscribe(BaseMapComponent));


@Component({
    selector: 'gmt-pdf-overview-map',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatModule,
        CommonModule
    ],
	standalone: true
})
export class OverviewMapComponent extends MixedComponent implements OnInit, OnChanges {



    //Must be online as well
    @Input() includeImagery: boolean = false;
    @Input() isHfDetailPage: boolean = false;

    @Input() boundaryGuid: string;

    constructor(
        private pdfDataService: PdfDataService,
        private logger: NGXLogger) {
        super();
    }

    override getLogger(): NGXLogger {
        return this.logger;
    }

    ngOnChanges(_changes: SimpleChanges): void {
        this.logger.info("HF map changes", _changes);
        this.loadBoundary();
    }
    ngOnInit(): void {
        this.logger.info("HF map ngOninit");
        this.loadBoundary();
    }

    private async loadBoundary() {
        //We should only load the boundary once
        if (this.boundaryLoaded) {
            return;
        }

        if (!_.isString(this.boundaryGuid)) {
            return;
        }

        this.boundaryLoaded = true;
        this.logger.info(`Loading PDF Boundary map for ${this.boundaryGuid}`);

        const boundaryDataClass = await this.pdfDataService.getBoundaryData(this.boundaryGuid, false);

        if (this.boundaryGuid != boundaryDataClass.boundaryId) {
            throw new Error(`Boundary id in boundaryData ${boundaryDataClass.boundaryId} != ${this.boundaryGuid}`);
        }

        const boundaryData = await this.pdfDataService.calculateMicroplanData(boundaryDataClass, null);

        const visualizeCatchmentVectorSource = this.pdfDataService.buildVisualizeCatchmentVectorSource(boundaryData);
        const boundary: GeoJsonBoundary = boundaryData.data.getCurrentBoundary();
        const boundaryExtent = this.pdfDataService.calculateBoundaryExtent(boundary, visualizeCatchmentVectorSource);

        this.logger.info(`PDF Boundary map extent ${boundaryExtent}`);
        this.logger.info(`# of boundaries ${boundaryData.data.bList.length}`);
        this.logger.info(`In vector source: ` + boundaryData.vectorSources.get(LAYER_BOUNDARY_ID)?.getFeatures().length);

        const layers = this.getLayers(boundaryData,);

        this.buildMap(
            boundaryExtent, layers
        );
    }

    private getLayers(
        boundaryData: BoundaryData,

    ): Array<BaseLayer | TileLayer> {



        const mapLayers: Array<BaseLayer | TileLayer> = [

            new VectorLayer({
                zIndex: 0,
                style: pdfBoundariesOverviewMap,
                source: boundaryData.vectorSources.get(LAYER_BOUNDARY_ID)
            }),
            new VectorLayer({
                zIndex: 1,
                style: mapStyles.STL.polygon,
                source: boundaryData.vectorSources.get(LAYER_SETTLEMENTS_PARTS_ID)
            }),
            new VectorLayer({
                zIndex: 2,
                style: pdfSettlementsOverviewMap,
                source: new VectorSource({
                    features: boundaryData.vectorSources.get(LAYER_SETTLEMENTS_NAMES_ID)!.getFeatures().filter(f => f.get('is_primary'))
                })
            }),
            new VectorLayer({
                zIndex: 3,
                style: pdfHealthfacilitiesOverviewMap,
                source: boundaryData.vectorSources.get(LAYER_HEALTH_FACILITIES_ID)
            })


        ];




        return mapLayers;
    }




}
