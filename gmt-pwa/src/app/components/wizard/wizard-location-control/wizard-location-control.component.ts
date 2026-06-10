import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  SimpleChanges,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { UserActionLogService } from '@services/user-action-log.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Subject, take, takeUntil } from 'rxjs';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { UserLocationService } from 'src/app/services/map/user-location.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { formatCoordinate } from 'src/app/utils/string-formatting';

export interface LocationControlOutput {
  lon: number;
  lat: number;
  set_with_gps: boolean;
}

@Component({
  selector: 'gmt-wizard-location-control',
  templateUrl: './wizard-location-control.component.html',
  styleUrls: ['./wizard-location-control.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class WizardLocationControlComponent {
  @Input() dialog!: MatDialogRef<any, any>;
  @Input() lonLat!: [number, number];

  @Output() lonLatChange = new EventEmitter<LocationControlOutput>();

  //does the GPS exist?
  hasGPS: boolean = false;

  isGPSInaccurate: boolean = false;

  private unsubscribe = new Subject();

  constructor(
    public messageService: MessageService,
    public mapEvents: MicroplanMapEventsService,
    private locationService: UserLocationService,
    private logger: NGXLogger,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit(): void {
    this.initializeFlags();

    this.listenToSetLocation();
  }

  ngOnChanges(changes: SimpleChanges) {
    //console.log(changes);
    if (changes['lonLat']) {
      this.logger.debug(
        `Coords are ` +
          formatCoordinate(this.lonLat[0], 7) +
          ', ' +
          formatCoordinate(this.lonLat[1], 7)
      );
    }
  }

  handleStopChooseLocation() {
    this.mapEvents.mapPointLocationConfig.next({
      visible: false,
      requestMapLocation: true,
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  async handleGPS() {
    if (!this.hasGPS) {
      return;
    }
    if (!this.locationService.isGPSSupported()) {
      this.messageService.add(this.locationService.gpsErrorMessage());
      return;
    }
    this.locationService
      .getLocation()
      .pipe(take(1), takeUntil(this.unsubscribe))
      .subscribe((position) => {
        if (_.isNil(position)) {
          return;
        }
        this.lonLatChange.next({
          lon: position.longitude,
          lat: position.latitude,
          set_with_gps: true,
        });

        // there is some listener that makes gps coordinate appear slower
        if (
          position.accuracy >
          AppConfigService.conf.generic.suggested_location_accuracy_m
        ) {
          this.messageService.add(
            this.locationService.getLowAccuracyNoteMessage(position.accuracy)
          );
        }
      });
  }

  private initializeFlags() {
    //initialize flags
    this.hasGPS = this.locationService.isGPSSupported();
  }

  private listenToSetLocation() {
    this.mapEvents.mapPointLocationState
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((mapLocationState) => {
        if (!mapLocationState.fromMap) {
          return;
        }

        //Validation is done by the hosting wizard
        this.lonLat = [mapLocationState.longitude, mapLocationState.latitude];
        this.lonLatChange.next({
          lon: mapLocationState.longitude,
          lat: mapLocationState.latitude,
          set_with_gps: false,
        });
        this.userActionLogService.addUserActionDescription(
          `Location selected [${this.lonLat}]`
        );
      });
  }
}
