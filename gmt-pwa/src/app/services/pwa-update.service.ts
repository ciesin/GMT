import {ApplicationRef, Injectable} from '@angular/core';
import {SwUpdate, VersionReadyEvent} from '@angular/service-worker';
import { NGXLogger } from 'ngx-logger';
import {concat, interval} from 'rxjs';
import {filter, first, map} from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {

  constructor(appRef: ApplicationRef,
              private updates: SwUpdate,
              private logger: NGXLogger) {
    // const appIsStable$ = appRef.isStable.pipe(first(isStable => isStable === true));
    // const everySixHours$ = interval(6 * 60 * 60 * 1000);
    // const everySixHoursOnceAppIsStable$ = concat(appIsStable$, everySixHours$);
    //
    // everySixHoursOnceAppIsStable$.subscribe(() => updates.checkForUpdate());
  }

  public async checkPwaUpdate() {
    const msg = await this.updates.checkForUpdate();
    this.logger.info("checkPwaUpdate msg: " + msg);
  }
}
