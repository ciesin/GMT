import {
  Component,
  Inject,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  ACCORDION_TOKEN,
  ID_TOKEN,
} from '@components/microplan-view/microplan-list/microplan-list.component';
import { ProgressService } from '@services/dashboard/progress.service';
import { IsOnlineService } from '@services/is-online.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { filter, Subject, take, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { routeFromChunks } from 'src/app/utils/route-helper';
import { GeoJsonBoundaryWithIndicators } from 'src/app/utils/server-interfaces/GeoJson';

@Component({
  selector: 'gmt-boundary-card',
  templateUrl: './boundary-card.component.html',
  styleUrls: [
    '../../../../catchment-card/card.less',
    './boundary-card.component.less',
  ],
  standalone: false
})
export class BoundaryCardComponent implements OnInit, OnDestroy {
  public boundaryIsOffline: boolean;
  public isOnline: boolean = false;
  public boundaryItem: GeoJsonBoundaryWithIndicators;
  public operationalBoundaryLevel =
    AppConfigService.conf.generic.operational_boundary_level;
  public boundaryId: string;
  public urlBoundaryId: string;
  public hierarchy: string[] = [];
  public panelOpenState: boolean = false;
  private unsubscribe = new Subject();
  immunizationRoute = (id: string) =>
    routeFromChunks([RoutesChunks.ROUTINE_IMMUNIZATION, id], true);

  @ViewChild(MatExpansionPanel)
  set matExpansionPanel(panel: MatExpansionPanel) {
    // hook the panel expansion to the accordion when ready
    if (!panel) {
      return;
    }
    this.accordion$
      .pipe(filter(Boolean), take(1))
      .subscribe((accordion) => (panel.accordion = accordion));
  }

  constructor(
    @Inject(ACCORDION_TOKEN) private accordion$: Subject<MatAccordion>,
    private activatedRoute: ActivatedRoute,
    private boundaryLayerService: BoundaryLayerService,
    private vectorLayerService: VectorLayerService,
    private injector: Injector,
    private router: Router,
    private onlineService: IsOnlineService,
    public progressService: ProgressService
  ) {}

  async ngOnInit() {
    const token = this.injector.get(ID_TOKEN);
    const tokens = token.split(',');
    this.boundaryId = tokens[1];
    this.hierarchy = tokens[0].split(':');
    this.boundaryItem = await this.progressService.loadBoundary(
      this.boundaryId
    );
    await this.updateBoundaryIsOffline();
    this.subscribeIsOffline();
    this.subscribeToOfflineBoundariesChange();
    this.activatedRoute.paramMap.subscribe(async (params: ParamMap) => {
      this.urlBoundaryId = params.get(
        RoutesChunks.PARAM_BOUNDARY.replace(':', '')
      )!;
    });
  }
  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public async redirectToDetails(globalId: string) {
    await this.router.navigate([
      routeFromChunks([RoutesChunks.OVERVIEW, RoutesChunks.PROGRESS, globalId]),
    ]);
  }

  async takeOffline(event: MouseEvent | null) {
    if (event) {
      event.stopPropagation();
    }

    await this.progressService.takeOffline(this.boundaryId);
  }

  private async updateBoundaryIsOffline() {
    this.boundaryIsOffline = await this.boundaryLayerService.isBoundaryOffline(
      this.boundaryId
    );
  }

  private subscribeToOfflineBoundariesChange() {
    this.vectorLayerService.offlineBoundariesChanged
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async () => {
        this.updateBoundaryIsOffline();
      });
  }

  public subscribeIsOffline() {
    this.onlineService.isOnlineStream().subscribe((isOnline) => {
      this.isOnline = isOnline!;
    });
  }

  public onOpenPanelAction() {
    this.progressService.onOpenPanelAction(
      this.panelOpenState,
      this.boundaryItem
    );
  }
}
