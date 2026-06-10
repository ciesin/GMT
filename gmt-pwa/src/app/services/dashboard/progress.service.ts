import { Injectable } from '@angular/core';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  GeoJsonBoundaryWithIndicators,
  Position,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { MenuItem } from 'src/app/routine-immu/microplan-left-wrapper/microplan-left-wrapper.component';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { formatPopulation } from 'src/app/utils/string-formatting';
import { BOUNDARY_LAYER } from 'src/app/utils/server-interfaces/VectorLayerName';
import { Coordinate } from 'ol/coordinate';
import { getCenter } from 'ol/extent';
import { BoundaryMapEventsService } from '@services/map/boundary/boundary-map-events.service';
import { AppConfigService } from 'src/app/utils/app-config.service';

@Injectable({
  providedIn: 'root',
})
export class ProgressService {
  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private boundaryMapEvents: BoundaryMapEventsService,
    private mapEvents: MapEventsService
  ) {}

  public handleShowBoundaryOnMap(
    event: MouseEvent,
    boundaryItem: GeoJsonBoundaryWithIndicators
  ) {
    event.stopPropagation();
    if (isEmpty(boundaryItem)) {
      return;
    }
    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: getExtentedBoundingBoxForFeatures(1000, boundaryItem),
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  async takeOffline(boundaryId: string) {
    await this.boundaryLayerService.handleTakeBoundaryOffline(boundaryId);

    caches
      .has('GMT_DOC')
      .then((hasCache) => {
        if (!hasCache) {
          window.open(AppConfigService.conf.doc.root + '/index.html', '_blank');
        }
      })
      .catch(() => {
        console.log('error while checking GMT_DOC cache');
      });
  }

  public async loadBoundary(globalId: string) {
    return await this.boundaryLayerService.fetchBoundaryById(globalId);
  }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public onOpenPanelAction(
    panelOpenState: boolean,
    boundaryItem: GeoJsonBoundaryWithIndicators
  ) {
    if (panelOpenState) {
      this.boundaryMapEvents.triggerBoundaryHighlightEvent(
        boundaryItem.properties.global_id
      );
      this.mapEvents.emitClicked({
        coordinates: [] as Coordinate,
        selectedLayer: BOUNDARY_LAYER,
        selectedGlobalId: boundaryItem.properties.global_id,
      });
      this.mapEvents.center({
        movementType: 'Center',
        center: getCenter(
          getExtentedBoundingBoxForFeatures(1, boundaryItem)
        ) as Position,
      });
    } else {
      this.boundaryMapEvents.triggerBoundaryHighlightEvent(null);
    }
  }
}
