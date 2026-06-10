import { AfterContentChecked, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NGXLogger } from 'ngx-logger';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { filter, map, take } from 'rxjs/operators';
import { IsLoadingService, ProgressBarInfo } from "./services/is-loading.service";
import { VectorLayerService } from "./services/vector_layer/vector-layers.service";
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { RoutesChunks } from "src/app/constants/routing.enum";
import { Router } from "@angular/router";
import { createIndexDbDatabase, deleteIndexDbDatabase, storeItem } from 'src/app/utils/container';
import { IsOnlineService } from 'src/app/services/is-online.service';
import { PwaInstallationService } from "./services/pwa-installation.service";
import { AuthService } from "./services/user/auth.service";
import { NgxSpinnerService } from 'ngx-spinner';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.less'],
    standalone: false
})
export class AppComponent implements OnInit, AfterContentChecked {
    // favIcon: HTMLLinkElement = document.querySelector('#appIcon');
    title = "GMT";

    db_data$: Observable<object> | null = null;
    config = AppConfigService.conf;
    showErrorDetails = false;
    loggedIn: boolean | null = null;
    public loading: boolean = false;
    public progress: ProgressBarInfo = {
        showProgressBar: false,
        progressBarText: '',
        priority: 0,
        progressPercentage: 0,
    };
    private permissionsLoaded: boolean = false;
    private inOnline: boolean | null = null;

    constructor(private http: HttpClient,
        private logger: NGXLogger,
        public isLoadingService: IsLoadingService,
        private vectorLayerService: VectorLayerService,
        private isOnlineService: IsOnlineService,
        private updates: SwUpdate,
        private router: Router,
        private ref: ChangeDetectorRef,
        private pwaInstallationService: PwaInstallationService,
        private authService: AuthService,
        private spinner: NgxSpinnerService
    ) { }

    ngAfterContentChecked() {
        this.ref.detectChanges();
    }

    async ngOnInit() {
        // this.changeIcon();
        //bb: Avoid to change the viewport height when the android keyboard open
        const viewport = document.querySelector("meta[name=viewport]") as any;
        viewport.setAttribute("content", viewport.content + ", height=" + window.innerHeight);

        if (!await this.isBrowserSupported()) {
            await this.router.navigate([RoutesChunks.UNSUPPORTED_BROWSER]);
            return;
        } else {
            // If browser is supported and we load the unsupported page: redirect to root
            if (this.router.url.split('?')[0] === '/' + RoutesChunks.UNSUPPORTED_BROWSER) {
                await this.router.navigate([RoutesChunks.INDEX]);
                return;
            }
        }

        this.db_data$ = this.http.get(`${AppConfigService.conf.api_url}/test_db`).pipe(
            take(1),
            map(res => {
                return res;
            }));

        // take only once as it is usedonly to get permissions (note that it is important that it goes before auth)
        this.isOnlineService.isOnlineStream().subscribe(async inOnline => {
            this.inOnline = inOnline;
        });
        // for now this is not used, but we make sure that the service get loaded fast by importing to the app component
        this.authService.loggedIn().subscribe(async (loggedIn: boolean | null) => {
            this.loggedIn = loggedIn;
            if (this.loggedIn && !this.permissionsLoaded && this.inOnline) {
                await this.vectorLayerService.savePermissionsToIndexDb();
                this.permissionsLoaded = true;
            }
        });
        this.updates.versionUpdates
            .pipe(
                filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'),
                map(evt => ({
                    type: 'UPDATE_AVAILABLE',
                    current: evt.currentVersion,
                    available: evt.latestVersion,
                }))
            )
            .subscribe(update => {
                console.debug('current version is', update.current);
                console.debug('available version is', update.available);

                // ask if app should reload when a newer version becomes available
                if (confirm("App update available. Do you want to reload to activate it?")) {
                    document.location.reload();
                }
            });

        this.isLoadingService.loading.subscribe(loading => {
            this.loading = loading;

            if (loading) {
                this.spinner.show();
            } else {
                this.spinner.hide();
            }
        });

        this.isLoadingService.progressInfo.subscribe(progressInfo => {
            this.progress = progressInfo;
        });

        /*
        This can check registered service workers
        navigator.serviceWorker.getRegistrations().then(registrations => {
            this.logger.info("Service worker registrations", registrations);
        });
    
        See PR https://github.com/novelt/GMT/pull/262
        and issue https://github.com/novelt/GMT/issues/2593
    
        The PWA can be installed before the sw being registered.  If this happens,
        offline won't work.  So this delays the install prompt until the sw is ready.
        
        */

        navigator.serviceWorker.ready.then(reg => {
            this.logger.info("Service worker is ready", reg);

            if (!this.pwaInstallationService.isInstalled()) {
                this.pwaInstallationService.promptInstall();
            }
        });

    }
    // changeIcon() {
    //   let envName = (AppConfigService.conf.environment)? AppConfigService.conf.environment: 'demo';
    //   this.favIcon.href = `assets/icons/logo/${envName}-384.png`;
    // }
    async isBrowserSupported() {
        // Check serviceworker support
        if (!('serviceWorker' in navigator)) {
            console.info("Browser not supported: ServiceWorker");
            return false;
        }

        // Check webassembly support: https://stackoverflow.com/questions/47879864/how-can-i-check-if-a-browser-supports-webassembly
        let wasmSupported = false;
        try {
            if (typeof WebAssembly === "object"
                && typeof WebAssembly.instantiate === "function") {
                const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
                if (module instanceof WebAssembly.Module)
                    wasmSupported = new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
            }
        } catch (e) {
        }
        if (!wasmSupported) {
            console.info("Browser not supported: WebAssembly");
            return false;
        }

        // Check indexDB support and storage size
        try {
            const browserSupportIndexDBName = 'testBrowserSupport';
            await deleteIndexDbDatabase(browserSupportIndexDBName);
            const db = await createIndexDbDatabase(browserSupportIndexDBName);
            const fileSize = 200;
            const x = new Uint8Array(fileSize);
            await storeItem("1", x, db);
            db.close();
            await deleteIndexDbDatabase(browserSupportIndexDBName);
        } catch (e) {
            console.info("Browser not supported: IndexDB error");
            return false;
        }
        return true;
    }

    delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showHeader() {
        return this.router.url.split('?')[0] !== RoutesChunks.INDEX
            && this.router.url.split('?')[0] !== '/' + RoutesChunks.UNSUPPORTED_BROWSER;
    }

    @HostListener('window:beforeinstallprompt', ['$event'])
    onbeforeinstallprompt(e: Event) {
        this.pwaInstallationService.onbeforeinstallprompt(e);
    }

    focus(event: any) {
        event.target.focus();
    }
}
