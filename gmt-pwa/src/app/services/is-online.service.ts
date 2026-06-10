import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, timer, of, firstValueFrom } from 'rxjs';
import { AppConfigService } from '../utils/app-config.service';
import { catchError, tap, timeout } from 'rxjs/operators';
import { NGXLogger } from 'ngx-logger';

@Injectable({
  providedIn: 'root',
})
export class IsOnlineService {
  private _isOnlineStream: BehaviorSubject<boolean | null> =
    new BehaviorSubject<boolean | null>(null);

  constructor(private http: HttpClient, private logger: NGXLogger) {
    // check each 10s
    timer(0, 10000).subscribe(() => this.checkIsOnline());
  }

  async checkIsOnline(): Promise<boolean> {
    return firstValueFrom(
      this.http.get<boolean>(`${AppConfigService.conf.api_url}/is_online`).pipe(
        timeout(4000),
        catchError(() => of(false)),
        tap((isOnline) => {
          if (isOnline !== this._isOnlineStream.value) {
            if (!isOnline) {
              this._isOnlineStream.next(false);
            } else {
              this._isOnlineStream.next(isOnline as boolean);
            }
          }
        })
      )
    );
  }

  isOnline(): boolean | null {
    return this._isOnlineStream.value;
  }

  isOnlineStream(): Observable<boolean | null> {
    return this._isOnlineStream.asObservable();
  }
}
