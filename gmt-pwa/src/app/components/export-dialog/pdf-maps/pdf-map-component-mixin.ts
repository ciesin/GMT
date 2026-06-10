import { EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import VectorSource from 'ol/source/Vector';
import { Subject } from 'rxjs';
import { BoundaryData, BoundaryMapArgs } from 'src/app/utils/export/pdf';
import { Extent } from 'src/app/utils/server-interfaces/GeoJson';
import _ from "lodash";
import { bufferExtent } from 'src/app/_shared/map/util/map-utils';
import { Control, ScaleLine } from 'ol/control';
import { Feature, Map as OLMap, View } from "ol";
import { getCenter } from 'ol/extent';
import { AppConfigService } from 'src/app/utils/app-config.service';

const MAP_RESOLUTION_FACTOR = 2;

let mapCount = 0;

// Require ondestroy as we assume base class ipmlements to make sure we dont forget super call
interface BaseClassRequirements extends OnDestroy {
    getLogger(): NGXLogger;


    width: number;
    height: number;
    mapLoaded: EventEmitter<OLMap>;
    mapHtmlIdPrefix: string;
    parentHtmlId: string | null;
    map: OLMap | null;
}

// Mixin definition
// eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T;

export function PdfMapComponent<TBase extends Constructor<BaseClassRequirements>>(
    Base: TBase,
) {
    return class extends Base implements OnDestroy {

        protected boundaryLoaded = false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args: any[]) {
            super(...args);
        }


        protected buildMap(
            extent3857: Extent,
            mapLayers: Array<BaseLayer | TileLayer>
        ) {
            mapCount += 1;
            //We want a unique html id in case we are loading these in ||
            const mapHtmlId = `${this.mapHtmlIdPrefix}_${mapCount}`;
            //[x_min, y_min, x_max, y_max]
            const extentWidth = extent3857[2] - extent3857[0];
            const extentHeight = extent3857[3] - extent3857[1];
            this.getLogger().info(`Building map ${mapHtmlId} with extent width ${extentWidth.toFixed(1)} height ${extentHeight.toFixed(1)}`);

            const mapElement = document.createElement('div');
            mapElement.setAttribute('id', mapHtmlId);
            //mapElement.setAttribute('style', `visibility:hidden;position:absolute;top:0;`);

            //The pdf generation can't see this anyway as its loaded via dynamic angular component loader
            //so no need to make hidden
            //We also want this to be visible when invoking the component directly
            //mapElement.setAttribute('style', `position:absolute;top:0;`);
            mapElement.setAttribute('class', 'ol-map');

            if (!_.isNil(this.parentHtmlId)) {
                const parent = document.getElementById(this.parentHtmlId);
                if (_.isNil(parent)) {
                    throw new Error(`Could not find parent with id [${this.parentHtmlId}]`);
                }
                parent.appendChild(mapElement);
            } else {
                document.body.appendChild(mapElement);
            }

            const mapElementCheck = document.getElementById(mapHtmlId);
            if (_.isNil(mapElementCheck)) {
                throw new Error(`Map element not found: [${mapHtmlId}]`);
            }
            const mapPixelWidth = this.width * MAP_RESOLUTION_FACTOR;
            const mapPixelHeight = this.height * MAP_RESOLUTION_FACTOR;
            mapElement.style.width = `${mapPixelWidth}px`;
            mapElement.style.height = `${mapPixelHeight}px`;


            //const mapLayers = this.getLayers(mapArgs, boundaryData, visualizeCatchmentVectorSource);



            const controls: Array<Control> = [];

            //Not visible in pdf
            controls.push(new ScaleLine({ units: 'metric' }));


            // Create map object
            const map = new OLMap({
                target: mapElement,
                view: new View({
                    center: getCenter(extent3857),
                    zoom: 2,
                    projection: `EPSG:${AppConfigService.map.map_projection}`
                }),
                controls,
                layers: mapLayers
            });
            this.map = map;

            map.getView().fit(extent3857, {
                size: map.getSize(),
                nearest: false,
                duration: 0,
                callback: (_success) => {
                    //mapLayers.forEach(l => map.addLayer(l));

                    // Wait until map has rendered
                    map.once('rendercomplete', async () => {
                        this.mapLoaded.emit(map);
                    });
                }
            });

            // Wait until map has rendered
            map.once('rendercomplete', async () => {
                this.mapLoaded.emit(map);
            });
        }

        override ngOnDestroy(): void {
            super.ngOnDestroy();
            this.getLogger().debug("Pdf map mixin ngOnDestroy");
            if (_.isNil(this.map)) {
                this.getLogger().debug("No map to destroy!");
                return;
            }
            const mapElement = this.map.getTarget() as HTMLElement;
            this.map.setTarget(undefined);


            if (!_.isNil(this.parentHtmlId)) {
                const parent = document.getElementById(this.parentHtmlId);
                if (!_.isNil(parent)) {
                    parent.removeChild(mapElement);
                } else {
                    this.getLogger().warn(`In destructor--Could not find parent with id [${this.parentHtmlId}]`);
                }

            } else {
                document.body.removeChild(mapElement);
            }
        }
    }
};

