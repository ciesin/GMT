import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import {
  BehaviorSubject,
  firstValueFrom,
  Observable,
  Subscription,
} from 'rxjs';
import { defaultIfEmpty, filter } from 'rxjs/operators';
import { AppConfigService } from '../../utils/app-config.service';
import { IdentityTokenContent } from '../../utils/server-interfaces/Token';
import { IsOnlineService } from '../is-online.service';
import { GmtOAuthService } from './GmtOAuth.service';

export interface TokenGenerationResponse {
  token: string;
}
export interface ApiToken {
  name: string;
  user_id: string;
  use_count: number;
  expire_date: string; // "2025-06-13T10:46:47.000Z"
}

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  subscriptions: Subscription[] = [];
  _loggedIn = new BehaviorSubject<boolean | null>(null);
  private excludePages: Array<string> = ['/unsupported'];
  private documentsLoaded: boolean = false;
  private isOnline: boolean = false;
  private tokenRefreshIsInitialized: boolean = false;

  public userApiTokens = new BehaviorSubject<Array<ApiToken>>([]);

  // not sure if I should make this service public or private and reimplement main methods as proxies to the angular-oauth2-oidc functionality
  // also this config could be part of utils/app-config
  constructor(
    public service: GmtOAuthService,
    private isOnlineService: IsOnlineService,
    private route: ActivatedRoute,
    private router: Router,
    private logger: NGXLogger,
    private http: HttpClient
  ) {
    //During tests, keycloak will not be defined
    if (!AppConfigService.conf || !AppConfigService.conf.keycloak) {
      this.logger.error('Keycloak not defined, normal only during unit tests');
      return;
    }
    this.documentsLoaded = false;
    this.isOnline = false;
    this.tokenRefreshIsInitialized = false;
    this.service.configure({
      issuer: `${AppConfigService.conf.keycloak.url}${AppConfigService.conf.keycloak.realm}`,
      redirectUri: `${window.location.origin}`,
      // revocationEndpoint: '',
      clientId: AppConfigService.conf.keycloak.clientId,
      responseType: 'code',
      requireHttps: AppConfigService.conf.keycloak.url.startsWith('https'),
      scope: AppConfigService.conf.keycloak.scope,
      // showDebugInformation: true,
    });

    this.subscriptions.push(
      this.isOnlineService.isOnlineStream().subscribe(async (isOnline) => {
        this.isOnline = isOnline === true;
        if (isOnline === null) {
          return;
        }
        if (this.tokenRefreshIsInitialized == false) {
          this.service.setupAutomaticSilentRefresh(this.isOnlineService);
          this.tokenRefreshIsInitialized = true;
        }
        this.loadAndCheckIfUserIsLoggedIn(
          this.route.snapshot.queryParamMap.get('canceled') != 'true',
          false
        );
      })
    );
    this.subscribeToAuthEvents();
  }
  ngOnDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
  }
  loggedIn(): Observable<boolean | null> {
    return this._loggedIn;
  }
  logout() {
    this.service.revokeTokenAndLogout({
      post_logout_redirect_uri: window.location.href,
    });
  }
  /**
   * Used so when a user creates/modifies/deletes an item, their name is in the JSON
   */
  getUserId(): string | null {
    let claims: IdentityTokenContent =
      this.service.getIdentityClaims() as IdentityTokenContent;
    if (!claims) return null;
    if (claims.sub) {
      return claims.sub;
    }
    return null;
  }

  getUserName(): string | null {
    let claims: IdentityTokenContent =
      this.service.getIdentityClaims() as IdentityTokenContent;
    if (!claims) return null;
    if (claims.preferred_username) {
      return claims.preferred_username;
    }
    return null;
  }

  getUserEmail(): string {
    let claims: IdentityTokenContent =
      this.service.getIdentityClaims() as IdentityTokenContent;
    if (!claims) return '';
    if (claims.email) {
      return claims.email;
    } else {
      return 'User has no email';
    }
  }

  getUserRoles(): string[] {
    let claims: IdentityTokenContent =
      this.service.getIdentityClaims() as IdentityTokenContent;
    if (!claims) return [];
    if (claims.client_roles) {
      return claims.client_roles;
    }
    return [];
  }

  async deleteLocalToken(): Promise<void> {
    await this.service.logOut(true);
    this._loggedIn.next(false);
  }

  handleRefreshTokenError(error) {
    console.debug(
      'auth: Your session has been terminated!',
      error,
      error?.type,
      'this.service.isWaitingToRefreshToken()',
      this.service.isWaitingToRefreshToken(),
      'this.isOnline:',
      this.isOnline
    );
    if (this.isOnline) {
      this._loggedIn.next(false);
      if (!this.service.isWaitingToRefreshToken()) {
        this.loadAndCheckIfUserIsLoggedIn(true, true);
      }
    }
  }

  async handleGenerateToken(
    tokenName: string,
    expiresInDays: number
  ): Promise<TokenGenerationResponse | null> {
    const userId = this.getUserId();
    this.logger.info(`Generating a token for ${userId}`);

    const ret = await firstValueFrom(
      this.http
        .post<TokenGenerationResponse>(
          `${AppConfigService.conf.api_url}/api-token/user/${userId}/generateApiToken`,
          {
            tokenName,
            expiresInDays,
          }
          //errors caught by interceptor
        )
        .pipe(defaultIfEmpty(null))
    );

    await this.listTokens();

    return ret;
  }

  async listTokens(): Promise<Array<ApiToken>> {
    /*
    Fetches the tokens and also updates the observable
    */
    const userId = this.getUserId();
    if (_.isNil(userId)) {
      this.logger.warn(`User id null: ${userId}`);
      return [];
    }
    this.logger.info(`Listing token for ${userId}`);

    let params = new HttpParams().set('user_id', userId.toString());

    const tokens = await firstValueFrom(
      this.http
        .get<Array<ApiToken>>(
          `${AppConfigService.conf.api_url}/api-token/tokens`

          //errors caught by interceptor
        )
        .pipe(defaultIfEmpty([]))
    );

    this.userApiTokens.next(tokens);

    return tokens;
  }

  async deleteApiToken(token: ApiToken): Promise<boolean> {
    const userId = this.getUserId();
    if (_.isNil(userId)) {
      this.logger.warn(`User id null: ${userId}`);
      return false;
    }
    this.logger.info(`Listing token for ${userId}`);

    //let params = new HttpParams().set('user_id', userId.toString());

    const response = await firstValueFrom(
      this.http
        .post<{ deleted: number }>(
          `${AppConfigService.conf.api_url}/api-token/deleteToken`,
          {
            user_id: userId,
            tokenName: token.name,
          }
          //errors caught by interceptor
        )
        .pipe(defaultIfEmpty({ deleted: -1 }))
    );

    this.logger.info('Deleted return', response);

    //refresh observable
    await this.listTokens();

    return response.deleted > 0;
  }

  private async loadAndCheckIfUserIsLoggedIn(
    tryToLogIn: boolean,
    error401: boolean
  ): Promise<void> {
    if (this.isOnline) {
      this.service.redirectUri = window.location.href.split('?')[0];
      if (!this.documentsLoaded) {
        await this.service.loadDiscoveryDocument();
        this.documentsLoaded = true;
      }
      if (!this.service.isWaitingToRefreshToken()) {
        console.log('auth: this.tryLogin, tryToLogIn,', tryToLogIn);
        // if refresh is waiting, it will trigger loadAndCheckIfUserIsLoggedIn in case of failure afterwards
        await this.tryLogin(tryToLogIn);
        this.loginAndSetLoginStatus(tryToLogIn, error401);
      }
    } else {
      console.log('auth: offline, keeping user logged in');
      this.updateUserLoginStatus(this.service.getAccessToken()?.length > 0);
    }
  }

  private async tryLogin(tryToLogIn: boolean) {
    const url = window.location.pathname;
    // we don't want to try to login on unsupported page because user then cannot reach root page and gets stuck in a loop
    if (tryToLogIn && !this.excludePages.includes(url)) {
      return this.service.tryLogin().then((_) => {
        // hide state and other auth related parameters
        this.router.navigate([url]);
      });
    }
  }

  private loginAndSetLoginStatus(
    tryToLogIn: boolean,
    error401: boolean = false
  ) {
    let loggedIn = this.service.hasValidAccessToken();
    if (loggedIn && !error401) {
      this.updateUserLoginStatus(true);
    } else {
      if (tryToLogIn && !this.service.isWaitingToRefreshToken()) {
        // we don't want to try to login on unsupported page because user then cannot reach root page and gets stuck in a loop
        if (!this.excludePages.includes(window.location.pathname)) {
          console.debug('auth: initCodeFlow');
          this.service.initCodeFlow(); // "", {customRedirectUri:window.location.href}
        }
        // this.service.initLoginFlowInPopup().then(a => console.log(a));//{height:200,width:200}); // https://manfredsteyer.github.io/angular-oauth2-oidc/docs/additional-documentation/popup-based-login.html
      } else {
        console.debug(
          'auth:  this.updateUserLoginStatus(this.service.isWaitingToRefreshToken())'
        );
        // if user was offline and refresh is planned, mark user as logged in for now
        this.updateUserLoginStatus(this.service.isWaitingToRefreshToken());
      }
    }
  }
  private updateUserLoginStatus(newLoginStatus: boolean) {
    if (this._loggedIn.value !== newLoginStatus) {
      console.debug('auth: newLoginStatus', newLoginStatus);
      this._loggedIn.next(newLoginStatus);
    }
  }

  private subscribeToAuthEvents() {
    // full list of events https://github.com/manfredsteyer/angular-oauth2-oidc/blob/master/projects/lib/src/events.ts
    this.subscriptions.push(
      this.service.events
        .pipe(
          filter((e) =>
            [
              'session_error',
              'session_terminated',
              'token_refresh_error',
              // 'token_expires', // TODO verify too dangerous
              'silent_refresh_error',
              'silent_refresh_timeout',
              'token_validation_error',
            ].includes(e.type)
          )
        )
        .subscribe((e) => {
          this.handleRefreshTokenError(e);
        })
    );
    this.subscriptions.push(
      this.service.events.subscribe((e) => {
        console.debug(e.type, 'auth event type');
      })
    );
  }
}
