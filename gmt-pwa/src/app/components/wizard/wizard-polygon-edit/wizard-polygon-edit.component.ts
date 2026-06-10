import {
  Component,
  EventEmitter,
  Input,
  Output,
  SimpleChanges,
} from '@angular/core';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { Polygon } from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import { StyleLike } from 'ol/style/Style';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import {
  GeoJsonBase,
  Polygon as PolygonGeoJson,
} from 'src/app/utils/server-interfaces/GeoJson';
import { boundaryEditSuggestionStyle } from 'src/app/_shared/map/styles/map-boundary-styles';
import { v4 as uuidv4 } from 'uuid';
import {
  enableWizardsOverlay,
  switchWizardCssClass,
} from '../health-facility-wizard/health-facility-wizard.component';

@Component({
  selector: 'gmt-wizard-polygon-edit',
  templateUrl: './wizard-polygon-edit.component.html',
  styleUrls: ['./wizard-polygon-edit.component.less'],
  standalone: false
})
export class WizardPolygonEditComponent {
  //@Input() stepTitle : string;
  @Input() stepDescription: string;
  @Input() style: StyleLike;
  @Input() isVisible: boolean;

  @Output() nextClicked = new EventEmitter<PolygonGeoJson>();

  private drawnPolygonSubscription: Subscription | null = null;
  private drawnPolygon: PolygonGeoJson | null = null;

  public editMode = false;
  private unsubscribe = new Subject();

  constructor(
    public messageService: MessageService,
    public microplanMapEvents: MicroplanMapEventsService,
    private mapEvents: MapEventsService,
    private logger: NGXLogger,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit(): void {
    this.subscribeToPolygonEditResult();
  }

  ngOnChanges(changes: SimpleChanges) {
    console.log(changes);
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleNextClicked() {
    this.userActionLogService.addUserActionDescription(
      'Wizard polygon next clicked'
    );

    //We should be edit mode for this to even be enabled
    if (!this.editMode) {
      return;
    }
    if (!this.drawnPolygon) {
      return;
    }

    this.nextClicked.next(this.drawnPolygon);
  }

  private subscribeToPolygonEditResult() {
    //This will only subscribe once, the 1st time this is called
    if (this.drawnPolygonSubscription) {
      return;
    }

    //This will fire after the user finishes drawing the initial polygon
    this.drawnPolygonSubscription = this.microplanMapEvents.drawPolygonResult
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((mapDrawnPolygon) => {
        this.logger.debug('Drawn polygon result from observable');
        this.drawnPolygon = mapDrawnPolygon.polygon;
        this.drawPolygonOnMap();

        this.initializeEditPolygonMode();

        //Note after user has drawn the polygon, we need to leave map interaction enabled
        //because the user can edit the polygon afterwards
      });
    //This will fire after the user has edited the drawn polygon
    this.microplanMapEvents.editPolygonResult
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((mapDrawnPolygon) => {
        this.logger.debug('Edit polygon result from observable');
        this.drawnPolygon = mapDrawnPolygon.polygon;
      });
  }

  //Called by the parent component, signals we will begin drawing
  //Also linked to "Start Over"
  initializeDrawing(isUserClick: boolean) {
    if (isUserClick) {
      this.userActionLogService.addUserActionDescription(
        'Wizard polygon start over'
      );
    }
    //User needs to be able to click the map to draw the polygon
    enableWizardsOverlay(false);
    this.drawnPolygon = null;
    this.mapEvents.removeAllFeatures(OverlayLayer.DRAWN_POLYGONS);

    //Order is important here, we want to disactive first, then activate
    //This is because the call to suppressClickEvents in draw-polygon.component
    this.microplanMapEvents.editPolygonConfig.next({
      active: false,
    });
    this.microplanMapEvents.drawPolygonConfig.next({
      active: true,
    });
    this.mapEvents.emitInteractions(false);
    this.editMode = false;
  }

  initializeEditExistingPolygon(polygonToEdit: PolygonGeoJson) {
    this.drawnPolygon = polygonToEdit;

    this.initializeEditPolygonMode();

    this.drawPolygonOnMap();

    //Find the feature we just added and add it to the select interaction
    this.microplanMapEvents.editPolygonConfig.next({
      active: true,
      selectCurrentFeatures: true,
    });
  }

  //Called by the parent component, signals we are finished drawing
  //Note the overlay is enabled here, so this assumes the wizard is still open!
  finishedDrawing() {
    enableWizardsOverlay(true);
    this.drawnPolygon = null;
    this.mapEvents.removeAllFeatures(OverlayLayer.DRAWN_POLYGONS);
    this.microplanMapEvents.drawPolygonConfig.next({
      active: false,
    });
    this.microplanMapEvents.editPolygonConfig.next({
      active: false,
    });
    this.editMode = false;
    this.mapEvents.emitInteractions(true);
  }

  undoDrawnVertices() {
    this.userActionLogService.addUserActionDescription('Undo point clicked');
    this.microplanMapEvents.triggerUndoForPolygonDrawing();
  }

  private initializeEditPolygonMode() {
    //User is about to draw so the overlay needs to be disabled
    switchWizardCssClass(true);
    this.microplanMapEvents.editPolygonConfig.next({ active: true });
    this.microplanMapEvents.drawPolygonConfig.next({ active: false });
    this.editMode = true;
  }

  public disableDrawing() {
    this.microplanMapEvents.drawPolygonConfig.next({
      active: false,
    });
    this.microplanMapEvents.editPolygonConfig.next({
      active: false,
    });
  }

  private drawPolygonOnMap() {
    this.mapEvents.removeAllFeatures(OverlayLayer.DRAWN_POLYGONS);

    let style = this.style;

    if (!style) {
      style = boundaryEditSuggestionStyle;
    }

    let polygonJsonBaseData = {
      geometry: this.drawnPolygon as Polygon,
      properties: {
        global_id: uuidv4(),
        boundary_polygon: '',
        user_id: '',
        user_name: '',
        modified_date: '',
        created_date: '',
        version_id: null,
        to_delete: false,
      },
      type: 'Feature' as 'Feature',
    } as GeoJsonBase;
    this.mapEvents.addFeature({
      geo_json: polygonJsonBaseData,
      style,
      layer: OverlayLayer.DRAWN_POLYGONS,
    });
  }
}
