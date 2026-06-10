import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { BrowserPermissionStatusName } from "src/app/constants/browser-permission-state.enum";
import { haversineDistance } from "src/app/utils/generic/harvesine-distance";
import { AppConfigService } from "src/app/utils/app-config.service";
import { NGXLogger } from 'ngx-logger';
import _ from "lodash";

// maximumAge: 60*1000 - allows to cache results for 1min https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
// Removed timeout property to not have issues with cold start, timeout: 10 mins,
// more information in this presentation https://novelt-my.sharepoint.com/:p:/g/personal/ivn_novel-t_ch/EboYbEs1YohAstep5wSLxQ8BBC0Qq39d1V9pZBRORWZRmg?e=xEzmME
const DEFAULT_WALKING_LOCATION_PARAMETERS = { enableHighAccuracy: true, maximumAge: 60 * 1000, timeout: 10 * 60 * 1000 };
const DEFAULT_DRIVING_LOCATION_PARAMETERS = { enableHighAccuracy: true, maximumAge: 15 * 1000, timeout: 10 * 60 * 1000 };

//5 minutes
const GPS_KEEP_WARM_INTERVAL_MS = 5 * 60 * 1000;
const LOG_PREFIX = "geolocation: ";


export interface GeolocationCoordinatesInterfaceFix {
    readonly accuracy: number;
    readonly altitude: number | null;
    readonly altitudeAccuracy: number | null;
    readonly heading: number | null;
    readonly latitude: number;
    readonly longitude: number;
    readonly speed: number | null;

    //copied from dom GeolocationCoordinatesInterfaceFix, but as an interface, not a class
}

export interface GeolocationPositionInterface {
    readonly coords: GeolocationCoordinatesInterfaceFix;
    readonly timestamp: EpochTimeStamp;
}


@Injectable({
    providedIn: 'root'
})
export class UserLocationService {
    private watchId: number | null = null;
    private locationIsActive: boolean = false;
    private permissionGranted: boolean | null = null;
    private previousLocation: GeolocationPositionInterface | null = null;
    private currentLocation: GeolocationPositionInterface | null = null;
    // private acceleration = null;
    private speedFromDistance: number = 0;
    private maxCurrentSpeed: number = 0;
    private reactiveDeviceLocation$: BehaviorSubject<GeolocationCoordinatesInterfaceFix | null>;
    private userIsWalking$: BehaviorSubject<boolean>;
    private defaultPositionParameters: { enableHighAccuracy: boolean, maximumAge: number, timeout: number } = DEFAULT_WALKING_LOCATION_PARAMETERS;

    private permissionDeniedError = {
        code: 1,
        summaryMessage: "GPS is not enabled. ",
        detailsMessage: "Please enable GPS to see your location.\n If you've blocked your location,\n please follow the tutorial\n for your browser to enable it \nhttps://support.google.com/chrome/answer/114662?visit_id=638068034263169091-1784529406&rd=1.",
    }
    private positionUnavailableError = {
        code: 2,
        summaryMessage: "No location yet. ",
        detailsMessage: "The tablet has no location yet. If you changed location permissions, please reload the app to see updated position. Otherwise you may need to wait a minute."
    }
    private timeoutError = {
        code: 3
    };

    // used only for debugging movement
    private i = 1;
    private debug = false;
    constructor(private logger: NGXLogger) {
        this.logger.info(`${LOG_PREFIX} constructor`);
        this.reactiveDeviceLocation$ = new BehaviorSubject<GeolocationCoordinatesInterfaceFix | null>(null);
        this.userIsWalking$ = new BehaviorSubject<boolean>(false); // false at the start to get better location faster
        // this.getSpeedFromAccelerometer();
        this.listenForPermissionChange();
        this.listenForWalkingModeChange();
        if (this.debug) {
            this.updateFakePosition();
        }
    }

    public getLocation(): Observable<GeolocationCoordinatesInterfaceFix | null> {
        return this.reactiveDeviceLocation$;
    }

    /**
     * this.queryLocation() is private in case we would use watchLocation in the future
     * for accuracy reasons. This method would force to query position right now.
     */
    public queryInstantLocation(): void {
        this.logger.debug(`${LOG_PREFIX} queryInstantLocation`);
        this.queryLocation();
    }

    public gpsErrorMessage(): { summary: string, detail: string, severity: string, life: number } {
        // show only 1 error message at once
        let summary = this.positionUnavailableError.summaryMessage;
        let detail = this.positionUnavailableError.detailsMessage;
        if (!navigator.geolocation) {
            summary = "GPS not supported";
            detail = "Location by GPS not supported.";
        } else if (!this.permissionGranted) {
            summary = this.permissionDeniedError.summaryMessage;
            detail = this.permissionDeniedError.detailsMessage;
        }
        return {
            summary: summary,
            detail: detail,
            severity: "error",
            life: 10000,
        }
    }
    public isLocationActive(): boolean {
        return this.locationIsActive;
    }
    public getLowAccuracyNoteMessage(accuracy: number | null): { summary: string; severity: string; } {
        return {
            summary: `Note that your accuracy is low. We recommend that your location would be up to ${AppConfigService.conf.generic.suggested_location_accuracy_m}m, but now it is ${Math.round(accuracy!)}m`,
            severity: 'info'
        }
    }
    public isGPSSupported(): boolean {
        if (!navigator.geolocation || !this.permissionGranted || !this.locationIsActive) {
            return false;
        } else {
            return true;
        }
    }

    private watchLocation(): void {
        if (!navigator.geolocation) {
            this.logger.warn(`${LOG_PREFIX} geolocation falsy`);
            return;
        }
        this.queryLocation();
        this.logger.info(`${LOG_PREFIX} queryLocation in ${this.defaultPositionParameters.maximumAge} ms`);
        this.watchId = window.setInterval(() => this.queryLocation(),
            this.defaultPositionParameters.maximumAge);
    }

    private queryLocation() {
        navigator.geolocation.getCurrentPosition((position: GeolocationPosition) => {
            this.logger.debug(`${LOG_PREFIX} position - ${position}`);
            this.locationIsActive = true;
            if (this.currentLocation != null) {
                // just copying the object was yielding empty object
                this.previousLocation = {
                    timestamp: this.currentLocation.timestamp,
                    coords: this.currentLocation.coords,
                };//Object.assign({}, this.currentLocation);
            }
            this.currentLocation = position;
            this.reactiveDeviceLocation$.next(this.currentLocation.coords);
            this.updateWalkingMode();
        },
            (err) => {
                this.handleErrorCallback(err);
            },
            // if we use getCurrentPosition, the cache parameter is not needed
            DEFAULT_DRIVING_LOCATION_PARAMETERS
        )
    }
    // LEAVE THIS COMMENTED CODE
    // It implements watch position using navigator.geolocation.watchPosition, if we will want more accurate results
    // this may be solution, now we choose more energy efficient solution, more information https://novelt-my.sharepoint.com/:p:/g/personal/ivn_novel-t_ch/EboYbEs1YohAstep5wSLxQ8BBC0Qq39d1V9pZBRORWZRmg?e=dYSZI1
    // private watchLocation(): void {
    //     if (!navigator.geolocation) {
    //       return;
    //     }
    //     this.watchId = navigator.geolocation.watchPosition((position: GeolocationPosition) => {
    //         this.logger.debug('geolocation: position - ',position);
    //         this.locationIsActive = true;
    //         if(this.currentLocation != null){
    //           // just copying the object was yielding empty object
    //           this.previousLocation = {
    //             timestamp: this.currentLocation.timestamp,
    //             coords: this.currentLocation.coords,
    //           };//Object.assign({}, this.currentLocation);
    //         }
    //         this.currentLocation = position;
    //         this.reactiveDeviceLocation$.next(this.currentLocation.coords);
    //         this.updateWalkingMode();
    //     },
    //     (err) => {
    //        this.handleErrorCallback(err);
    //     },
    //     this.defaultPositionParameters);
    //   }
    /**
     * Simulate moving point in Ariaria
     * @private
     */
    private handleErrorCallback(err): void {
        this.locationIsActive = false;
        this.logger.error(`${LOG_PREFIX} GPS positionError`, err);
        switch (err.code) {
            case this.permissionDeniedError.code:
                throw (this.permissionDeniedError.summaryMessage + this.permissionDeniedError.detailsMessage);
            case this.positionUnavailableError.code:
                throw (this.positionUnavailableError.summaryMessage + this.positionUnavailableError.detailsMessage);
            case this.timeoutError.code:
                //We don't want this popup to be displayed to the user
                this.logger.error(`${LOG_PREFIX} The request to get user location with navigator.geolocation timed out.`);
                return;
            default:
                throw ("An unknown error occurred with the navigator.geolocation service");
        }

    }

    private updateFakePosition() {
        setInterval(() => {
            this.reactiveDeviceLocation$.next({
                // latitude: 5.11476 + (this.i * 0.0005),// Ariaria
                latitude: 46.21080 + (this.i * 0.0005),
                // longitude: 7.32884 + (this.i * 0.0005), // Ariaria
                longitude: 6.14719 + (this.i * 0.0005),
                accuracy: 100000,
                altitudeAccuracy: 100000,
                altitude: 0,
                heading: 0,
                speed: 0,
            });
            this.i += 1;
        }, 4000);
    }

    // private getSpeedFromAccelerometer(){
    //    fromEvent(window, 'devicemotion')
    //       .pipe(throttleTime(2000))
    //       .subscribe((event: DeviceMotionEvent) => {
    //         this.logger.info('geolocation: devicemotion event', event);
    //         this.acceleration = event?.acceleration;
    //       });
    // }

    //This is called once from the constructor
    private listenForPermissionChange(): void {
        this.logger.info(`${LOG_PREFIX} listenForPermissionChange`);
        navigator.permissions.query({ name: 'geolocation' })
            .then((permissionStatus) => {
                this.updatePermissionStatus(permissionStatus);

                //This is to handle when they answer the browser popup
                permissionStatus.onchange = (event: Event) => this.updatePermissionStatus(permissionStatus);
            });
    }

    private updatePermissionStatus(permissionStatus: PermissionStatus): void {
        this.logger.info(`${LOG_PREFIX} permission state is ${permissionStatus.state}`);
        if (permissionStatus.state == BrowserPermissionStatusName.granted) {
            this.permissionGranted = true;
            //Once the user granted permissions, start the listeners where the getCurrentPosition call
            //is expected to succeed
            this.watchLocation();
            this.keepGPSWarmInTheBackground();
        }
        else if (permissionStatus.state == BrowserPermissionStatusName.prompt) {
            //Call this once to trigger the browser permission prompt
            //Once they answer, this method gets called again as part of onChange
            navigator.geolocation.getCurrentPosition((position: GeolocationPosition) => {
                this.logger.debug(`${LOG_PREFIX} post prompt call ok`, position);
            }, (err) => {
                this.logger.error(`${LOG_PREFIX} post prompt positionError`, err);
            });
        }
        else {
            this.permissionGranted = false;
            this.stopListeningForLocation();
        }
    }

    private updateWalkingMode(): void {

        if (_.isNil(this.currentLocation)) {
            return;
        }
        if (this.previousLocation?.coords != null) {
            const distance = haversineDistance(this.currentLocation.coords, this.previousLocation.coords);
            this.speedFromDistance = distance / (this.currentLocation.timestamp - this.previousLocation.timestamp) / 1000;
            if (this.currentLocation.coords.speed && this.speedFromDistance) {
                this.maxCurrentSpeed = Math.max(this.speedFromDistance, this.currentLocation.coords.speed);
            } else if (this.currentLocation.coords.speed) {
                this.maxCurrentSpeed = this.currentLocation.coords.speed;
            } else if (this.speedFromDistance || this.speedFromDistance === 0) {
                this.maxCurrentSpeed = this.speedFromDistance;
            } else {
                this.maxCurrentSpeed = -1; // for us to know if the speed recording fails and that is not the user who doesn't move
            }
            this.logger.debug('geolocation:: speedFromDistance - ', this.speedFromDistance, ' position.coords.speed - ', this.currentLocation.coords.speed, 'distance - ', distance, 'time passed ', (this.currentLocation.timestamp - this.previousLocation.timestamp) / 1000);
            const userIsWalking = this.maxCurrentSpeed <= 5;
            if (userIsWalking != this.userIsWalking$.value) {
                this.userIsWalking$.next(userIsWalking);
            }
        }
    }

    //This will switch the default position parameters
    private listenForWalkingModeChange(): void {
        this.userIsWalking$.subscribe((userIsWalking: boolean) => {
            if (!_.isNumber(this.watchId)) {
                return;
            }
            this.stopListeningForLocation();
            this.defaultPositionParameters = (userIsWalking) ? DEFAULT_WALKING_LOCATION_PARAMETERS : DEFAULT_DRIVING_LOCATION_PARAMETERS;
            this.logger.debug(`${LOG_PREFIX} user is walking - ${userIsWalking}`);
            this.watchLocation();

        });
    }

    private stopListeningForLocation() {
        if (!_.isNumber(this.watchId)) {
            this.logger.debug(`${LOG_PREFIX} stopListeningForLocation, not listening, doing nothing`);
            return;
        }
        // LEAVE commented code, it is for navigator.geolocation.watchPosition implementation
        //  navigator.geolocation.clearWatch(this.watchId);
        window.clearInterval(this.watchId);
        this.locationIsActive = false;

    }

    public keepGPSWarmInTheBackground(): void {
        this.logger.info(`${LOG_PREFIX} keepGPSWarmInTheBackground starting`);

        let i = 0;
        if (!navigator.geolocation) {
            this.logger.warn(`${LOG_PREFIX} is falsy`);
            return;
        }

        const interval = setInterval(() => {
            i += 1;
            this.logger.log(`${LOG_PREFIX} GPS keep warm #${i}`);
            this.positionQueryFunction();
        }, GPS_KEEP_WARM_INTERVAL_MS); // each 5 minutes retrieve one position to keep GPS warm
        //clearInterval(interval);
    }


    //Used to keep GPS warm
    private positionQueryFunction() {
        this.logger.info(`${LOG_PREFIX} positionQueryFunction start`);
        navigator.geolocation.getCurrentPosition((position: GeolocationPosition) => {
            this.logger.debug(`${LOG_PREFIX} keeping GPS warm`, position);
        }, (err) => {
            this.logger.error(`${LOG_PREFIX} GPS positionError`, err);
        },
            DEFAULT_WALKING_LOCATION_PARAMETERS);
    }
}

