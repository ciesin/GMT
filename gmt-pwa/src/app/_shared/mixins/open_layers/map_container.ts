import { Map as OLMap, View } from 'ol';

import { NGXLogger } from 'ngx-logger';
import _ from 'lodash';
import { defaults, MousePosition, ScaleLine } from 'ol/control';
import { createStringXY } from 'ol/coordinate';
//import { get as getProjection, Projection } from 'ol/proj';
import { ElementRef, OnDestroy } from '@angular/core';
import Projection from 'ol/proj/Projection';

// Mixin definition
// eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T;

// See comment in extent_listener
//Note we extend on destroy because we assume that we are basing this off of
//the UnsubscribeMixin, even if not, this ensures we are forced to call super.ngOnDestroy
interface BaseClassRequirements extends OnDestroy {
    getLogger(): NGXLogger;
}

/*
Contains the open layers map object and the unique html ids

Implements the basemap selector as well.

Intented to use the map.component.html which contains the controls common to all
maps: scale bar, position, and basemap selection

Classes must call initializeOpenLayersMapContainer in their constructor

Done this way because mixin constructors are constrained to be any[]
*/
export function OpenLayersMapContainer<
    TBase extends Constructor<BaseClassRequirements>,
>(Base: TBase) {
    return class extends Base implements OnDestroy {
        private map: OLMap | null = null;

        //If there are many maps, should call setPrefix in the constructor to make this unique
        //Public because they are used in the template
        public map_html_id: string = 'map';
        // public map_lat_lon_html_id: string = 'latlot';
        // public map_scalebar_html_id: string = 'scalebar';

        getMap(): OLMap {
            if (_.isNil(this.map)) {
                throw new Error('Map is null!');
            }
            return this.map;
        }

        getMapMaybeNull(): OLMap | null {
            return this.map;
        }

        override ngOnDestroy() {
            super.ngOnDestroy();
            this.getLogger().debug(`ngOnDestroy map container map destroy`);
            this.destroyMap();
        }

        /*
        If a component wants to destroy & rebuild the map
        */
        destroyMap() {
            if (_.isNil(this.map)) {
                return;
            }
            this.map.setTarget(undefined);
            this.map = null;
        }

        setPrefix(id_prefix: string) {
            this.map_html_id = `${id_prefix}_map`;
        }



        protected setOpenLayersMap() {
            const projection = new Projection({
                code: 'EPSG:3857',
                units: 'm',
            });


            //Double check we have the id, angular needs to have updated the template 1st
            const mapElement = document.getElementById(this.map_html_id);

            if (!mapElement) {
                this.getLogger().error(
                    `MapComponent: for ${this.map_html_id} mapElement is null`,
                );
                return;
            }

            this.map = new OLMap({
                target: this.map_html_id,
                controls: [...defaults().getArray()],
                //controls: [...defaults().getArray()],
                view: new View({
                    projection,
                }),
            });

        }

        /*
Open layers needs to have its map element have an explicit size

This reads width/height of the hosting angular component
and sets the map to take the entire width/height
*/
        protected setExplicitWidths(elRef: ElementRef) {
            // Access the native element and check its width
            const element = elRef.nativeElement;
            const width = element.offsetWidth;
            const height = element.offsetHeight;

            this.getLogger().info(
                `MapComponent of ${this.map_html_id}: width is ${width} and height is ${height}`,
            );

            //const mapElement = this.elRef.nativeElement.querySelector('#map');
            const mapElement = document.getElementById(this.map_html_id);

            if (!mapElement) {
                this.getLogger().error(
                    `MapComponent: for ${this.map_html_id} mapElement is null`,
                );
                return;
            }
            // Set the width and height in pixels
            //this.renderer.setStyle(element, 'width', `${width}px`);
            //this.renderer.setStyle(element, 'height', `${height}px`);
            mapElement.style.width = `${width}px`;
            mapElement.style.height = `${height}px`;

            this.getLogger().info(
                `DatasetDetailsMapComponent: set map width/height to ${mapElement.style.width}/${mapElement.style.height}`,
            );

            if (!this.map) {
                this.getLogger().error(
                    `MapComponent of ${this.map_html_id}: map is null`,
                );
                return;
            }

            this.map.updateSize();
        }
    };
}
