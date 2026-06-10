import {HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi} from '@angular/common/http';
import {ErrorHandler, isDevMode, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {OAuthModule, OAuthModuleConfig, OAuthResourceServerConfig, OAuthStorage,} from 'angular-oauth2-oidc';
import {LoggerModule, NgxLoggerLevel, TOKEN_LOGGER_WRITER_SERVICE,} from 'ngx-logger';
import {FieldsetModule} from 'primeng/fieldset';
import {PaginatorModule} from 'primeng/paginator';
import {AppConfigService} from 'src/app/utils/app-config.service';
import {AppErrorHandler} from 'src/app/utils/app-error.handler';
import {ErrorInterceptor} from 'src/app/utils/error.interceptor';
import {AppRoutingModule} from './app-routing.module';
import {AppComponent} from './app.component';
import {IndeterminateDirective} from './directives/indeterminate.directive';
import {LandingPageComponent} from './landing-page/landing-page.component';
import {RoutineImmuModule} from './routine-immu/routine-immu.module';
import {AuthService} from './services/user/auth.service';
import {UnsupportedBrowserComponent} from './unsupported-browser/unsupported-browser.component';
import {AppPrimengModule} from './_shared/libs/primeng.module';
import {SharedModule} from './_shared/shared.module';

import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {ServiceWorkerModule} from '@angular/service-worker';
import {NgxGoogleAnalyticsModule, NgxGoogleAnalyticsRouterModule,} from 'ngx-google-analytics';
import {NgxSpinnerModule} from 'ngx-spinner';
import {WriterCustomisedService} from 'src/app/services/shared/logs/write-custom.service';
import {UserManagementModule} from './components/admin/user-management/user-management.module';
import {DashboardModule} from './components/dashboard/dashboard.module';
import {DevToolsModule} from './components/dev-tools/dev-tools.module';
import {MicroplanViewModule} from './components/microplan-view/microplan-view.module';
import {PopupDirective} from './directives/popup.directive';
import {MatModule} from './mat.module';
import {storageFactory} from './utils/gmt-storage';

@NgModule({ declarations: [
        AppComponent,
        LandingPageComponent,
        UnsupportedBrowserComponent,
        IndeterminateDirective,
    ],
    exports: [
        PopupDirective
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        //I used TS dynamic import to import the module. (see gmt-pwa/src/main.ts) Which means the app module is
        //loaded only once the config is loaded. So it should never be null.
        NgxGoogleAnalyticsModule.forRoot(AppConfigService.conf?.google_analytics_tracking_code),
        NgxGoogleAnalyticsRouterModule,
        LoggerModule.forRoot({
            // serverLoggingUrl: '/api/logs',
            level: isDevMode() ? NgxLoggerLevel.DEBUG : NgxLoggerLevel.INFO, // TRACE
            // serverLogLevel: NgxLoggerLevel.ERROR
        }, {
            writerProvider: {
                provide: TOKEN_LOGGER_WRITER_SERVICE,
                useClass: WriterCustomisedService
            }
        }),
        OAuthModule.forRoot(),
        ServiceWorkerModule.register('ngsw-worker.js', {
            enabled: !isDevMode(), // see https://github.com/angular/angular/issues/47455
            // Register the ServiceWorker as soon as the app is stable
            // or after 30 seconds (whichever comes first).
            registrationStrategy: 'registerWhenStable:30000'
        }),
        RoutineImmuModule,
        DashboardModule,
        UserManagementModule,
        AppPrimengModule,
        PaginatorModule,
        FieldsetModule,
        SharedModule,
        BrowserAnimationsModule,
        NgxSpinnerModule,
        MicroplanViewModule,
        DevToolsModule,
        MatModule], providers: [
        { provide: ErrorHandler, useClass: AppErrorHandler },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        {
            provide: OAuthModuleConfig,
            useFactory: () => {
                // https://stackoverflow.com/a/54473123/1835270
                return {
                    resourceServer: {
                        allowedUrls: AppConfigService.conf ? [AppConfigService.conf.api_url] : ['http://localhost:4248/*'],
                        sendAccessToken: true,
                    } as OAuthResourceServerConfig
                };
            }
        },
        { provide: OAuthStorage, useFactory: storageFactory },
        AuthService,
        provideHttpClient(withInterceptorsFromDi())
    ] })
export class AppModule {
  constructor() {}
}
