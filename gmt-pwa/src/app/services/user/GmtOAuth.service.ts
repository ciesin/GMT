import { Injectable } from '@angular/core';
import { OAuthInfoEvent, OAuthService } from "angular-oauth2-oidc";
import { debounceTime, filter, tap } from "rxjs/operators";
import { IsOnlineService } from "../is-online.service";
import { of } from "rxjs";

@Injectable({
    providedIn: 'root'
})
export class GmtOAuthService extends OAuthService {
    private waitingToRefreshToken: boolean = false;
    private isOnline: boolean = false;
    public isWaitingToRefreshToken() {
        return this.waitingToRefreshToken;
    }

    //Not sure why the signature is different, but its been working so far
    //@ts-ignore 
    public setupAutomaticSilentRefresh(isOnlineService: IsOnlineService,
        params = {}, listenTo = null,
        noPrompt = true) {
        let shouldRunSilentRefresh = true;
        // subscribe to is online server
        isOnlineService.isOnlineStream().subscribe(async isOnline => {
            if (isOnline === null) {
                return;
            }
            this.isOnline = isOnline;
            // hasValidAccessToken instead of waitingToRefreshToken because waitingToRefreshToken is only set when first
            // server is detected as 504 but not when keycloak first return 504
            // to check this.hasValidAccessToken() is not good enough because we refresh before token expires
            if (isOnline && this.waitingToRefreshToken) {
                this.triggerRefreshTokenScenario();
            }
        });
        this.events
            .pipe(tap(e => {
                if (e.type === 'token_received') {
                    shouldRunSilentRefresh = true;
                }
                else if (e.type === 'logout') {
                    shouldRunSilentRefresh = false;
                }
            }), filter(e => e.type === 'token_expires'), debounceTime(1000))
            .subscribe(e => {
                const event = e;
                if ((listenTo == null || listenTo === 'any') && // || event?.info === listenTo TODO - this was not found by type
                    shouldRunSilentRefresh) {
                    if (this.isOnline !== true) {
                        // just to compensate racing condition for is Logged in check this check
                        this.waitingToRefreshToken = true;
                    } else {
                        this.waitingToRefreshToken = false;
                    }
                    if (!this.isOnline) {
                        return;
                    }
                    this.refreshInternal(params, noPrompt).catch(e => {
                        console.log('auth: Automatic silent refresh did not work', e);
                    });
                }
            });
        this.restartRefreshTimerIfStillLoggedIn();
    }
    /**
     * Checks, whether there is a valid access_token.
     * added from parent class only to have some log in the strange situations
     */
    override hasValidAccessToken() {
        if (this.getAccessToken()) {
            const expiresAt = this._storage.getItem('expires_at');
            const now = new Date();
            if (expiresAt && parseInt(expiresAt, 10) < now.getTime()) {
                return false;
            }
            // console.log('auth: has valid access token but expires in ', parseInt(expiresAt, 10) - now.getTime());
            return true;
        }
        return false;
    }
    protected triggerRefreshTokenScenario() {
        this.accessTokenTimeoutSubscription = of(new OAuthInfoEvent('token_expires', 'access_token'))
            .subscribe(e => {
                this.ngZone.run(() => {
                    this.eventsSubject.next(e);
                });
            });
    }
}
