import { Component, HostBinding, OnDestroy, OnInit } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { MapEvent } from 'ol';
import { first, Subject, takeUntil } from 'rxjs';
import { MicroplanMapEventsService } from "../../../../services/map/MicroplanMapEventsService";
import { MapControlBaseComponent } from '../map-control-base.component';
import { AppConfigService } from "src/app/utils/app-config.service";
import { transform } from 'ol/proj';
import { animate, sequence, style, transition, trigger } from "@angular/animations";

@Component({
    selector: 'location-selector',
    templateUrl: './location-selector.component.html',
    styleUrls: ['./location-selector.component.less'],
    animations: [
        trigger('bounceAnimation', [
            transition(':enter', [
                sequence([
                    style({ transform: 'translateY(-500px)' }),
                    animate("350ms cubic-bezier(0,0,0,1)", style({ transform: 'translateY(-30px)' })),
                    animate("200ms cubic-bezier(1,0,1,1)", style({ transform: 'translateY(0)' })),
                    animate("100ms cubic-bezier(0,0,0,1)", style({ transform: 'translateY(-20px)' })),
                    animate("50ms cubic-bezier(1,0,1,1)", style({ transform: 'translateY(0)' })),
                    animate("50ms cubic-bezier(0,0,0,1)", style({ transform: 'translateY(-10px)' })),
                    animate("25ms cubic-bezier(1,0,1,1)", style({ transform: 'translateY(0)' })),
                ])
            ])
        ])
    ],
    providers: [{ provide: MapControlBaseComponent, useExisting: LocationSelectorComponent }],
    standalone: false
})
export class LocationSelectorComponent extends MapControlBaseComponent implements OnInit, OnDestroy {

    visible = false;

    private unsubscribe = new Subject();

    //This is the height in pixels of the location marker; the bottom of it should match the location
    @HostBinding("style.--height") height: number = 40;

    constructor(private mapEvents: MicroplanMapEventsService,
        private logger: NGXLogger,) {
        super();
    }

    override ngOnInit() {
        super.ngOnInit();
        this.subscribeToMapLocationConfig();
        this.subscribeToMapLocationState();
    }



    ngOnDestroy() {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }


    private subscribeToMapLocationConfig() {
        //The flow here is the wizard wants to know the current location or it wants
        //to set the visibility of the location selector (the centered location icon on the map, part of this component)
        this.mapEvents.mapPointLocationConfig.pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(config => {
            this.visible = config.visible;
            if (config.requestMapLocation) {
                //getCoordinateFromPixel

                //Get coordinate value at bottom of location icon
                const size = this._mapPanel!.map!.getSize()!;
                const coords = this._mapPanel!.map!.getCoordinateFromPixel([size[0] / 2, size[1] / 2]);
                const dataProjection = `EPSG:${AppConfigService.map.data_projection}`;
                const featureProjection = `EPSG:${AppConfigService.map.map_projection}`;
                const dataCoords = transform(coords, featureProjection, dataProjection);

                this.logger.debug("Sending location back", dataCoords);
                this.mapEvents.mapPointLocationState.next({
                    latitude: dataCoords[1],
                    longitude: dataCoords[0],
                    fromMap: true
                });
            }
        });

    }

    private subscribeToMapLocationState() {
        this.mapEvents.mapPointLocationState.pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(async state => {
            if (state.fromMap) {
                //Ignore, we are the map in this control
                return;
            }

            //Move the map such that the center
            if (this._mapPanel) {
                this.logger.info("Location selector Centering to", [state.longitude, state.latitude]);
                //this._mapPanel.panToLocation([state.longitude, state.latitude], 18);
                // this.mapEvents.center({
                //   movementType: "Center",
                //   center: [state.longitude, state.latitude]
                // });
                const size = this._mapPanel.map!.getSize();

                //this._mapPanel.map!.updateSize();

                let center = this._mapPanel.map!.getView().getCenter();
                const dataProjection = `EPSG:${AppConfigService.map.data_projection}`;
                const featureProjection = `EPSG:${AppConfigService.map.map_projection}`;
                let centerDataProj = transform(center!, featureProjection, dataProjection);
                this.logger.debug("Location selector currentcenter was ", center, centerDataProj, [state.longitude - centerDataProj[0], state.latitude - centerDataProj[1]]);

                // Can be strange, hold of on surprising zoom changes
                // if (this._mapPanel.map!.getView().getZoom() < 15) {
                //   await this._mapPanel.zoomToZoomlevel(18);
                // }
                //this._mapPanel.map!.getView().centerOn(transform([state.longitude, state.latitude], dataProjection, featureProjection), size, [size[0]/2,size[1]/2 - this.height / 2]);
                this._mapPanel.map!.getView().centerOn(transform([state.longitude, state.latitude], dataProjection, featureProjection), size!, [size![0] / 2, size![1] / 2]);

                this.logger.debug("map size is ", size);
                this.logger.debug("icon height ", this.height);

                center = this._mapPanel.map!.getView().getCenter();
                centerDataProj = transform(center!, featureProjection, dataProjection);
                this.logger.info("Location selector currentcenter is ", center, centerDataProj, [state.longitude - centerDataProj[0], state.latitude - centerDataProj[1]]);

            } else {
                //Map is still initalizing, wait a bit and try again
                //Normally this wouldn't happen too often
                this.logger.warn("Location selector, mapPanel is NOT defined");


            }


        });

    }
}
