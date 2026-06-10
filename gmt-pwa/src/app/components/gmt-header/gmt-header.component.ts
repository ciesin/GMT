import {Component} from '@angular/core';
import {ActivatedRoute, NavigationEnd, Router} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {RoutesChunks} from 'src/app/constants/routing.enum';
import {FrontendService} from 'src/app/frontend.service';
import {IsOnlineService} from "src/app/services/is-online.service";
import {VectorLayerService} from 'src/app/services/vector_layer/vector-layers.service';
import {IsLoadingService} from "src/app/services/is-loading.service";
import {UserContextService} from "src/app/services/user-context.service";
import {AuthService} from "src/app/services/user/auth.service";
import {hasPermission} from "src/app/utils/server-interfaces/utils/permissions.util";
import {AppConfigService} from 'src/app/utils/app-config.service';
import {CrudLayerService} from "src/app/services/vector_layer/crud-layer.service";
import {PermissionsLayerService} from "src/app/services/vector_layer/permissions-layer.service";
import {IndicatorService} from "src/app/services/indicator.service";
import {MicroplanMapEventsService} from "src/app/services/map/MicroplanMapEventsService";
import {VectorLayerForPermissions} from "src/app/utils/server-interfaces/VectorLayerName";
import { NGXLogger } from 'ngx-logger';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';

export type iBreadcrumbDisplay = 'boundary' | 'hf' | 'settlement';

@Component({
    selector: 'gmt-header',
    templateUrl: './gmt-header.component.html',
    styleUrls: ['./gmt-header.component.less'],
    standalone: false
})
export class GmtHeaderComponent {
  public DEFAULT_PAGE_TITLE = "Routine Immunization";
  public pageTitle = this.DEFAULT_PAGE_TITLE;

  title = "GMT";
  isEdit: boolean = true;
  public userIsEditor: boolean = false;
  public userHasPermissionsEditAdminBoundary: boolean = false;
  public loggedIn: boolean | null = null;
  public email: string | null = "";


  public environment?: string = AppConfigService.conf.environment;
  public isOnline: boolean = true;
  public isOfflineMessage: string = "";
  private thereAreChangesForSyncing: boolean = false;
  public pageIsEditable: boolean = false;

  private unsubscribe = new Subject();
  private headerIsInitialized = false;

  private routeSubscription: any;
  private boundaryIdSubscription: any;
  private routeChild: any;
  private boundaryId: string | null;

  constructor(
    private vectorLayerService: VectorLayerService,
    private crudLayerService: CrudLayerService,
    private permissionsLayerService: PermissionsLayerService,
    private router: Router,
    public activatedRoute: ActivatedRoute,
    public loadingService: IsLoadingService,
    public userContextService: UserContextService,
    private isOnlineService: IsOnlineService,
    private authService: AuthService,
    private logger: NGXLogger
  ) {

    this.isOnlineService.isOnlineStream().pipe(takeUntil(this.unsubscribe)).subscribe(isOnline => {
      this.isOnline = isOnline as boolean;
      this.isOfflineMessage = (!isOnline)? "You are offline": "";
      if(!this.headerIsInitialized){
        this.setInitialBoundaryId(); // it is important that it comes before the permissions
        this.saveAndUpdatePermissions().then();
        this.headerIsInitialized = true;
      }
    });
    this.vectorLayerService.getPermissionsObservable().pipe(takeUntil(this.unsubscribe)).subscribe(p => {
      this.saveAndUpdatePermissions().then();
    });


    this.userContextService.getIsEditingObservable().pipe(takeUntil(this.unsubscribe)).subscribe(isEdit => {
      this.isEdit = isEdit;
    });
  }

  async ngOnInit(): Promise<void> {

    // 1. Monitor HF/settlement id change
    // this will only get the initial value on page load
    this.activatedRoute.firstChild?.data.subscribe(data => {
      if (data.hasOwnProperty('pageTitle')) {
        this.pageTitle = data.pageTitle;
      }
    });

    // this will subscribe to children parameters change (like settlement or HF id)
    this.router.events.subscribe(e => {
      if (e instanceof NavigationEnd && this.routeChild !== this.activatedRoute.firstChild) {
        if (this.routeSubscription) {
          this.routeSubscription.unsubscribe();
        }
        if (this.boundaryIdSubscription) {
          this.boundaryIdSubscription.unsubscribe();
        }
        this.routeChild = this.activatedRoute.firstChild;

        this.boundaryIdSubscription = this.activatedRoute.firstChild?.params?.subscribe(params => {
          if (params.hasOwnProperty('boundary')) {
            if(params.boundary != this.boundaryId){
              this.boundaryId = params.boundary;
              this.setComponentPermissions();
            }
          }
        });
        this.routeSubscription = this.activatedRoute.firstChild?.data.subscribe(data => {
          if (data.hasOwnProperty('pageTitle')) {
            this.pageTitle = data.pageTitle;
          }
        });
      }
    });

    this.pageIsEditable = this.router.url.includes(RoutesChunks.ROUTINE_IMMUNIZATION);
    this.router.events.pipe().subscribe(() => this.pageIsEditable = this.router.url.includes(RoutesChunks.ROUTINE_IMMUNIZATION));

    this.email = this.authService.getUserEmail();
    this.authService.loggedIn().pipe(takeUntil(this.unsubscribe)).subscribe(
      (loggedIn: boolean | null) => {
        this.loggedIn = loggedIn;
        this.saveAndUpdatePermissions();
        if (this.loggedIn) {
          this.crudLayerService.isSyncButtonEnabled().pipe(takeUntil(this.unsubscribe)).subscribe(
            thereAreChangesForSyncing => {
              this.thereAreChangesForSyncing = thereAreChangesForSyncing;
            });

          this.email = this.authService.getUserEmail();
        }
      });


    this.permissionsLayerService.getPermissionsObservable().pipe(takeUntil(this.unsubscribe)).subscribe(_ => {
      this.setComponentPermissions();
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private setInitialBoundaryId() {
    this.activatedRoute.firstChild?.params.subscribe(params => {
      if (params.hasOwnProperty('boundary')) {
        this.boundaryId = params.boundary;
        // setting permissions could be skip as we download permissions in the same component
        // so this will be triggered with permissions update
        // this.setComponentPermissions();
      }
    });
  }

  private setComponentPermissions(): void {
    if (this.boundaryId) {
      // TODO now we consider that user has edit permissions if he/she can edit settlements - when we will have
      // more granular permissions this should be decided depending on the page where user is
      this.userHasPermissionsEditAdminBoundary = this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlement,"update", this.boundaryId);
    }
  }
  async saveAndUpdatePermissions() {
    let permissions = await this.permissionsLayerService.getPermissions();
    if (permissions && permissions["permissions"]) {
      this.userIsEditor = hasPermission(permissions["permissions"], "settlement", "update");
      this.userContextService.setIsEditing(this.userIsEditor);
    }
  }



}
