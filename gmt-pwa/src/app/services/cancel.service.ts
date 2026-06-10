import { Injectable } from '@angular/core';
import { firstValueFrom, of, race, Subject } from "rxjs";
import { HttpClient, HttpParams } from "@angular/common/http";
import { takeUntil, delay as rxDelay, filter } from "rxjs/operators";
import * as _ from "lodash";
import { IsOnlineService } from "@services/is-online.service";
import { NGXLogger } from "ngx-logger";


const DEFAULT_NUM_RETRIES = 3;

//Since the online check is every 10 seconds we want num retries * sec between to be more than 10
const DEFAULT_SEC_BETWEEN_RETRIES = 4;

@Injectable({
    providedIn: 'root'
})
export class CancelService {
    //Used to implement cancel, since takeUntil will unsubscribe and this cancels any pending http calls
    private cancelSubject$ = new Subject<void>();

    //Used to not start an http call or action if we are cancelled
    private _isCancelled = false;

    constructor(private http: HttpClient, private isOnlineService: IsOnlineService, private logger: NGXLogger) {
    }

    public resetCancel() {
        this._isCancelled = false;
        this.cancelSubject$ = new Subject<void>();
    }

    public isCancelled(): boolean {
        return this._isCancelled;
    }

    public cancel() {
        this.cancelSubject$.next();
        this.cancelSubject$.complete();

        this._isCancelled = true;
    }

    /*
    Does a cancellable post
  
    Will throw an empty sequence error if this was cancelled
    */
    public async doPost<T>(url: string, postPayload: any, params: HttpParams | null = null): Promise<T> {

        if (this._isCancelled) {
            throw new Error("User cancelled");
        }

        const options = {};
        if (!_.isNil(params)) {
            options["params"] = params;
        }
        const obs = this.http.post<T>(url, postPayload, options).pipe(takeUntil(this.cancelSubject$));

        //If cancelled, there is no value, and we get the empty sequence error
        return firstValueFrom(obs);
    }

    public async doGet<T>(url: string, params: HttpParams | null = null): Promise<T> {
        if (this._isCancelled) {
            throw new Error("User cancelled");
        }

        const options = {};
        if (!_.isNil(params)) {
            options["params"] = params;
        }
        const obs = this.http.get<T>(url, options).pipe(takeUntil(this.cancelSubject$));

        return firstValueFrom(obs);
    }

    private delay(ms: number): Promise<void | null> {
        this.logger.debug(`Waiting ${ms} seconds`);
        const obs = of(null).pipe(rxDelay(ms), takeUntil(this.cancelSubject$));
        return firstValueFrom(obs);
    }

    /*
    Without a step but still retrying
    */
    public async retry(func: () => Promise<void>,
        maxRetries: number = DEFAULT_NUM_RETRIES, secBetweenRetries = DEFAULT_SEC_BETWEEN_RETRIES) {
        return this.retryImpl(func,
            () => {
                //do nothing
            },
            () => {
                //do nothing
            },
            (_msg, _retryIndex, _maxRetries) => {
                //do nothing
            },
            (_msg) => {
                //do nothing
            },
            maxRetries,
            secBetweenRetries);

    }

    public async retryImpl(func: () => Promise<void>,
        startCallBack: () => void,
        stopCallBack: () => void,
        errorCallBack: (e: Error, retryIndex: number, maxRetries: number) => void,
        detailMessageCallback: (msg: string) => void,
        maxRetries: number = DEFAULT_NUM_RETRIES, secBetweenRetries = DEFAULT_SEC_BETWEEN_RETRIES) {

        let retryIndex = 0;
        while (retryIndex < maxRetries) {
            try {
                //Before each function wait until we are online

                if (this._isCancelled) {
                    break;
                }
                //Don't call additional online checks, since is online has a 10sec timer
                const isOnlineWait = this.isOnlineService.isOnlineStream().pipe(
                    takeUntil(this.cancelSubject$),
                    filter((isOnline) => {
                        if (!isOnline) {
                            detailMessageCallback("Cannot connect to the server, waiting until connection is reestablished");
                        }
                        return isOnline!;
                    })
                );

                await firstValueFrom(isOnlineWait);

                //Do this here to set the detail message (in case we reconnected)
                if (this._isCancelled) {
                    break;
                }
                startCallBack();
                await func();
                stopCallBack();
                return true;
            } catch (e) {
                this.logger.error(e);
                errorCallBack(e, retryIndex, maxRetries);
                await this.delay(1000 * secBetweenRetries);
            }

            retryIndex += 1;
        }

        const e = new Error(this._isCancelled ? "User Cancel" : "Max # of retries attained");
        //pass maxRetries-1 so even if we cancelled its as if we tried until max
        //this helps distinguish an error while we are retrying and when we are done
        errorCallBack(e, maxRetries - 1, maxRetries);
        throw e;

    }
}
