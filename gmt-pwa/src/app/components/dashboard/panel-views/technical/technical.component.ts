import { Component, OnInit } from '@angular/core';
import {
  MatAutocompleteActivatedEvent,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { ApiTokenDialogComponent } from '@components/api-token-dialog/api-token-dialog.component';
import { SyncPopupComponent } from '@components/dashboard/panel-views/technical/sync-popup/sync-popup.component';
import { ExportDialogComponent } from '@components/export-dialog/export-dialog.component';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { BoundaryTreeService } from '@services/boundary-tree.service';
import { TreeNodeCheckable } from '@services/interfaces/boundary-tree.service.interface';
import { IsLoadingService } from '@services/is-loading.service';
import { IsOnlineService } from '@services/is-online.service';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import { MessageService } from '@services/shared/notifications/message.service';
import { BoundaryNavigationService } from '@services/shared/route/boundary-navigation.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { ApiToken, AuthService } from '@services/user/auth.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { MicroplanEditService } from '@services/vector_layer/edit/microplan-edit.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  Subject,
  takeUntil,
} from 'rxjs';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { GeoJsonBoundaryWithIndicators } from 'src/app/utils/server-interfaces/GeoJson';
import {
  ApiRole,
  EditorRole,
  MicroplanStatusManagerRole,
  ParticipationManagerRole,
} from 'src/app/utils/server-interfaces/user/UserRoles';
import { RoutesChunks } from '../../../../constants/routing.enum';
export type selection = 'all' | 'some' | 'none';
export type mixedSelection =
  | 'all-original'
  | 'all-new'
  | 'all-mixed'
  | 'some-original'
  | 'some-new'
  | 'some-mixed'
  | 'none';

type Level = {
  number: number;
  node: TreeNodeCheckable;
};

interface SearchedBoundary {
  global_id: string;
  label: string;
  hierarchy: Array<string>;
}

@Component({
  selector: 'gmt-technical',
  templateUrl: './technical.component.html',
  styleUrls: ['./technical.component.less'],
  standalone: false,
})
export class TechnicalComponent implements OnInit {
  private unsubscribe = new Subject();
  private resetMpAdmin1GlobalId: string = '';

  // take offline section
  public offlineWards: Set<TreeNodeCheckable> = new Set();
  public modifiedOfflineWardsIds: Set<string> = new Set();
  public needSync: boolean;
  public searchWardDl: string;
  public searchWardDlUpdate = new Subject<string>();
  public userCanResetMicroplan: boolean = false;
  public resetMpAdmin1Name: string = '';
  public resetMicroplanErrorMessage: string = '';
  public searchedWardsDl = new Subject<SearchedBoundary[]>();
  private defaultSyncButtonMessage = 'Synchronize data with server';
  public syncTooltipMsg = this.defaultSyncButtonMessage;
  public canSync = false;
  private boundaryLeaves: TreeNodeCheckable[] = [];

  // export section
  public showPrintPopup = false;
  public exportLevel: Level;
  public searchBoundaryExport: string;
  public searchBoundaryExportUpdate$ = new Subject<string>();
  public searchedBoundariesExport$ = new Subject<SearchedBoundary[]>();
  public shownExportBoundaries: Array<TreeNodeCheckable>;
  public numberOfBoundariesSelectedForExport: number;
  private selectedNodesForExport$ = new Subject<
    Map<string, TreeNodeCheckable>
  >();
  private _selectedNodesForExport = new Map<string, TreeNodeCheckable>();

  public get selectedNodesForExport() {
    return this._selectedNodesForExport;
  }
  private set selectedNodesForExport(map: Map<string, TreeNodeCheckable>) {
    this._selectedNodesForExport = map;
    this.numberOfBoundariesSelectedForExport = [...map.values()].reduce(
      (acc, node) => acc + Number(node.level === 3),
      0
    );
    this.selectedNodesForExport$.next(this._selectedNodesForExport);
  }

  // add to MP section
  public mpLevel: number;
  public searchBoundaryMP: string;
  public searchBoundaryMPUpdate = new Subject<string>();
  public searchedBoundariesMP = new Subject<SearchedBoundary[]>();
  public shownMPBoundaries: Array<TreeNodeCheckable>;
  public selectedBoundariesForMP: Set<string> = new Set();
  public originalSelectedBoundariesForMP: Set<string> = new Set();

  public userHasEditorRole: boolean = false;
  public userHasParticipationManagerRole: boolean = false;
  public userHasApiRole: boolean = false;
  private isOnline: boolean = false;

  //Token section
  public userApiTokens: Array<ApiToken> = [];

  constructor(
    private authService: AuthService,
    private boundaryLayerService: BoundaryLayerService,
    private boundaryTreeService: BoundaryTreeService,
    private confirmationService: ConfirmationService,
    private crudLayerService: CrudLayerService,

    private loadingService: IsLoadingService,
    private logger: NGXLogger,
    private messageService: MessageService,
    private microplanEditService: MicroplanEditService,
    private onlineService: IsOnlineService,
    private vectorLayerService: VectorLayerService,

    private userContextService: UserContextService,

    public boundaryNavigationService: BoundaryNavigationService,
    private matDialog: MatDialog,
    private activatedRoute: ActivatedRoute,
    private userActionLogService: UserActionLogService
  ) {
    this.selectedNodesForExport$
      .pipe(
        // tap(map => console.log('selected node for Export', map)),
        takeUntil(this.unsubscribe)
      )
      .subscribe((_) => this.updateShownExportBoundaries());

    // hook search ward for download autocomplete
    this.searchWardDlUpdate
      .pipe(
        filter((s) => s?.trim().length > 2),
        debounceTime(400),
        map((s) => s.trim().toLocaleLowerCase()),
        distinctUntilChanged(),
        takeUntil(this.unsubscribe)
        // tap(s => console.log('searching ward to download', s))
      )
      .subscribe((s) => this._searchWardDl(s));

    // hook search boundary for export autocomplete
    this.searchBoundaryExportUpdate$
      .pipe(
        filter((s) => s?.trim().length > 2),
        debounceTime(400),
        map((s) => s.trim().toLocaleLowerCase()),
        distinctUntilChanged(),
        takeUntil(this.unsubscribe)
        // tap(s => console.log('searching boundary to export', s))
      )
      .subscribe((s) =>
        this.searchedBoundariesExport$.next(this._searchBoundaries(s))
      );

    // hook search boundary for MP autocomplete
    this.searchBoundaryMPUpdate
      .pipe(
        filter((s) => s?.trim().length > 2),
        debounceTime(400),
        map((s) => s.trim().toLocaleLowerCase()),
        distinctUntilChanged(),
        takeUntil(this.unsubscribe)
        // tap(s => console.log('searching boundary to add to mp', s))
      )
      .subscribe((s) =>
        this.searchedBoundariesMP.next(this._searchBoundaries(s))
      );
  }

  async ngOnInit() {
    //Setting up loading before calling func

    this.loadingService.setProgressBarInfo('initializing', 0, true, 3);

    await this.boundaryTreeService.buildTree();

    this.activatedRoute.paramMap
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (params: ParamMap) => {
        const boundaryId = params.get(
          RoutesChunks.PARAM_BOUNDARY.replace(':', '')
        )!;

        await this.boundaryNavigationService.loadSelectedBoundary(boundaryId);

        //Can user reset the mp status of this boundary?
        //Important to call after boundaryNavigationService.loadSelectedBoundary
        this.checkResetMicroplanPermissions();
      });

    this.loadingService.setProgressBarInfo('initializing', 20, true, 3);

    await this._initializeOfflineWards();
    this.loadingService.setProgressBarInfo('initializing', 40, true, 3);

    await this._initializeShownExportBoundaries();
    this.loadingService.setProgressBarInfo('initializing', 60, true, 3);

    await this._initializeShownMPBoundaries();
    this.loadingService.setProgressBarInfo('initializing', 80, true, 3);

    this.loadingService.setProgressBarInfo('initializing', 100, false, 3);

    // we don't need to block the screen till permissions are updated
    this.subscribeToPermissionsChange();
    this.subscribeToIsOnline();

    this.subscribeToCrudChanges();

    this.subscribeToOfflineBoundariesChange();

    //Debugging, handy to open export dialog with some boundaries pre-selected

    if (
      AppConfigService.ENABLE_EXPORT_DEBUG ||
      AppConfigService.ENABLE_EXPORT_REW_DEBUG
    ) {
      setTimeout(() => {
        // ungogog lga "8eeff76f-806e-41e4-9e40-b8ca45603649"
        const global_id = 'fc887bd8-5847-4c09-be89-fb4c5e9498a4';
        this.selectBoundaryForExport({ global_id, select: true });

        this.selectBoundaryForExport({ global_id: '7e151deb-948f-4e5f-bfb8-94398d98a605', select: true });

        this.openExportDialog();
      }, 750);
    }

    //ODO debug
    /*this.crudLayerService.requestDataCheck([
      '500b170b-2825-42c0-91ae-d370d2bf97fd',

      '83dd81a5-fb92-47f3-bb34-95959f9ca8d7',
    ]);*/

    /*setTimeout(() => {
      //this.synchronize();

      this.openApiTokenDialog();
    }, 2000);*/
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private async fetchAndListenfetchTokens() {
    this.authService.userApiTokens
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((tokens) => {
        this.userApiTokens = tokens;
      });

    await this.authService.listTokens();

    this.logger.info('User API Tokens fetched', this.userApiTokens);
  }

  public formatApiTokenDate(expireDate: string): string {
    const date = new Date(expireDate);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  public async handleDeleteUserApiToken(token: ApiToken) {
    await this.authService.deleteApiToken(token);
  }

  public async startNewMPPeriod() {
    if (
      isNil(this.resetMpAdmin1GlobalId) ||
      this.resetMpAdmin1GlobalId.length <= 0
    ) {
      return;
    }
    await this.microplanEditService.resetMicroplanForBoundaries(
      this.resetMpAdmin1GlobalId,
      this.resetMpAdmin1Name
    );
  }

  boundaryId(index: number, boundary: TreeNodeCheckable) {
    return boundary.global_id;
  }

  isOfflineWardModified(global_id: string) {
    return this.modifiedOfflineWardsIds.has(global_id);
  }

  private async _initializeOfflineWards() {
    // flatten tree to only keep leaves
    this.boundaryLeaves = [];
    const deepFlattenLeaves = (node) => {
      if (node.data.type !== 'boundary') {
        // probably gone too deep already
        return;
      }
      if (!node.children?.length || node.children[0].data.type !== 'boundary') {
        // leaf boundary
        this.boundaryLeaves.push(node);
      } else {
        for (const child of node.children) {
          deepFlattenLeaves(child);
        }
      }
    };
    deepFlattenLeaves(this.boundaryTreeService.allNodes[0]);

    // initialize offline boundaries
    const offlineIds =
      await this.boundaryLayerService.getAllOfflineBoundaries();
    this.offlineWards.clear();
    this.boundaryLeaves
      .filter((b) => offlineIds.has(b.global_id))
      .map((b) => this.offlineWards.add(b));

    // find modified boundaries
    this.modifiedOfflineWardsIds.clear();
    const crudActions = await this.crudLayerService.getSimplifiedCruds();
    for (const ca of crudActions) {
      const boundaryId =
        ca.changed_layer == 'boundary__polygon'
          ? ca.geojson_after.properties.global_id
          : ca.geojson_after.properties.boundary_polygon;
      this.modifiedOfflineWardsIds.add(boundaryId);
    }
    this.logger.info('Modified wards: ', this.modifiedOfflineWardsIds);
    this.needSync = !!this.modifiedOfflineWardsIds.size;
    this.updateSyncMessage();
  }

  private async _initializeShownExportBoundaries() {
    this.exportLevel = {
      number: 0,
      node: this.boundaryTreeService.allNodes[0],
    };
    // this.shownExportBoundaries = this.boundaryTreeService.allNodes[0].children;
  }

  private async updateShownExportBoundaries() {
    const { number: currentLevel, node: currentLevelNode } = this.exportLevel;
    const selectedNodes = this.selectedNodesForExport;

    if (currentLevel === 0) {
      this.shownExportBoundaries = currentLevelNode.children.filter((c) =>
        selectedNodes.has(c.global_id)
      );
    } else {
      this.shownExportBoundaries = currentLevelNode.children.filter(
        (c) => c.data.type === 'boundary'
      );
    }
  }

  private async _initializeShownMPBoundaries() {
    this._initializeParticipation();
    this.mpLevel = 0;
    this.shownMPBoundaries = this.boundaryTreeService.allNodes[0].children;
    // this.selectedBoundariesForMP = new Set(this.originalSelectedBoundariesForMP);
  }

  private async _initializeParticipation() {
    const deepGetParticipation = (node: TreeNodeCheckable) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      //The indicators are computed fields, the source of truth for participation is the
      //participating property in the boundary.polygon_latest view, computed from boundary.polygon
      //if (node.data.indicators?.num_boundary_participating > 0) {
      if (node.data.participating) {
        this.originalSelectedBoundariesForMP.add(node.global_id);
      }
      for (const child of node.children) {
        deepGetParticipation(child);
      }
    };
    deepGetParticipation(this.boundaryTreeService.allNodes[0]);
  }

  async synchronize() {
    if (!this.onlineService.isOnline) {
      throw new Error('You are offline and cannot sync the changes');
    }

    this.matDialog.open(SyncPopupComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      disableClose: true,
      hasBackdrop: true,
      width: '50em',
    });
  }

  openExportDialog() {
    this.matDialog.open(ExportDialogComponent, {
      autoFocus: false,
      data: {
        wards: [...this.selectedNodesForExport.values()].filter(
          (b) => b.level === 3
        ),
      },
    });
  }

  openApiTokenDialog() {
    this.matDialog.open(ApiTokenDialogComponent, {
      autoFocus: false,
      width: '430px',
      data: {},
    });
  }

  async backup() {
    this.loadingService.setLoading(true);
    try {
      await this.vectorLayerService.backupIndexedDb();
      this.messageService.add({
        summary: 'Done',
        detail: 'Database backup is created',
        severity: 'info',
      });
    } finally {
      this.loadingService.setLoading(false);
    }
  }

  async restore(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files as FileList;
    const file: File = files[0];
    if (file) {
      if (!this.backupFormatIsCorrect(file)) {
        this.loadingService.setLoading(false);
        throw 'Uploaded file seems like not a GMT backup file. Please upload file that was backed up from GMT system.';
      }
      this.confirmationService.confirm({
        message:
          'Before loading the backup, your current not-synced data will be deleted. Are you sure you want to continue?',
        header: 'Restore backup',
        icon: 'noicon',
        rejectLabel: 'No',
        acceptLabel: 'Continue',
        showRejectButton: true,
        accept: async () => {
          this.loadingService.setLoading(true);
          await this.restoreIndexedDb(file);
          this._initializeOfflineWards();
        },
      });
    } else {
      this.loadingService.setLoading(false);
      throw 'File was not found';
    }
  }

  public indentifyNode(
    index: number,
    boundary: TreeNodeCheckable | SearchedBoundary
  ) {
    return boundary.global_id;
  }

  private backupFormatIsCorrect(file: any) {
    return file.name.endsWith('.zip') || file.name.endsWith('.indexeddb');
  }

  private async restoreIndexedDb(file: File) {
    try {
      // need to delete token because imported permissions may not match the user or if token is
      // not readable crud actions would be created without username and user id
      await this.authService.deleteLocalToken();
      if (file.name.endsWith('.zip')) {
        await this.vectorLayerService.restoreIndexedDbFromZip(file);
      } else {
        // we send only vector data to the logs but should be able to restore it easily
        await this.vectorLayerService.restoreIndexedDb(file);
      }

      await this.crudLayerService.checkIfNeedsSync();
      this.messageService.add({
        summary: 'Done',
        detail: 'Database restore is finished',
        severity: 'info',
      });
    } catch (error) {
      this.logger.error(error, 'error while loading indexedDb file');
    } finally {
      this.loadingService.setLoading(false);
    }
  }

  private _searchWardDl(search: string) {
    const offlineWardsIds = new Set(
      Array.from(this.offlineWards).map((w) => w.global_id)
    );
    const foundWardsToDl = Array.from(this.boundaryLeaves)
      .filter(
        (w) =>
          !offlineWardsIds.has(w.global_id) &&
          w.label.toLocaleLowerCase().includes(search)
      )
      .map((n) => ({
        global_id: n.global_id,
        label: n.label,
        hierarchy: this._getBoundaryHierarchy(n),
      }));
    this.searchedWardsDl.next(foundWardsToDl);
  }

  async takeOffline(event: MatAutocompleteActivatedEvent) {
    this.searchWardDl = '';
    const boundaryId = event.option?.value;

    await this.boundaryLayerService.handleTakeBoundaryOffline(boundaryId);
    //See https://github.com/novelt/GMT/issues/2216
    caches
      .has('GMT_DOC')
      .then((hasCache) => {
        this.logger.info(`Has Help cache GMT_DOC key == [${hasCache}]`);
        if (!hasCache) {
          window.open(AppConfigService.conf.doc.root + '/index.html', '_blank');
        }
      })
      .catch(() => {
        console.log('error while checking GMT_DOC cache');
      });
  }

  private subscribeToOfflineBoundariesChange() {
    this.vectorLayerService.offlineBoundariesChanged
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async () => {
        this._initializeOfflineWards();
      });
  }

  removeOfflineData(global_id: string) {
    this.confirmationService.confirm({
      message:
        'Are you sure that you want to remove all offline data for the selected boundary? Your local edits will be lost.',
      showRejectButton: true,
      accept: () => {
        this.loadingService.setLoading(true);
        this.loadingService.setProgressBarInfo(
          'Removing boundary data...',
          1,
          true
        );
        this.userActionLogService.addUserActionDescription(
          `Remove offline data [${global_id}] start`
        );
        this.vectorLayerService
          .removeOfflineBoundary(global_id)
          .then(async () => {
            await this.crudLayerService.removeCrudActionsOutsideSurroundingAreas(
              global_id
            );
            // hacking around to remove again surrounding boundary key, because it is added again in boundary-vector_layer/vector-layers.service.ts
            // line 199 ->fetchBoundaryInfo this is not intended as main boundary id is not reset and should not be refreshed at this moment...
            await this.vectorLayerService.resetDataStreams();
            await this.crudLayerService.removeHistory();

            await this._initializeOfflineWards();

            this.userActionLogService.addUserActionDescription(
              `Remove offline data [${global_id}] stop success`
            );

            this.loadingService.setLoading(false);
          });
      },
    });
  }

  private _searchBoundaries(search: string): SearchedBoundary[] {
    const boundaries: SearchedBoundary[] = [];
    const deepSearchBoundary = (node: TreeNodeCheckable) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (node.label.toLocaleLowerCase().includes(search)) {
        boundaries.push({
          global_id: node.global_id,
          label: node.label,
          hierarchy: this._getBoundaryHierarchy(node),
        });
      }
      for (const child of node.children) {
        deepSearchBoundary(child);
      }
    };
    deepSearchBoundary(this.boundaryTreeService.allNodes[0]);
    return boundaries;
  }

  drillDownExportBoundary(global_id: string) {
    const selected_boundary =
      this.boundaryTreeService.idsToNodes.get(global_id);
    if (!selected_boundary) {
      throw new Error(`Cannot drill down, boundary ${global_id} not found`);
    }

    this.exportLevel = {
      number: selected_boundary.level,
      node: selected_boundary,
    };

    this.updateShownExportBoundaries();
  }

  drillUpExportBoundary() {
    const parent = this.exportLevel.node.parent;
    if (!parent) {
      throw new Error('Cannot drill up, no parent boundary found');
    }

    this.exportLevel = {
      number: parent.level,
      node: parent,
    };

    this.updateShownExportBoundaries();
  }

  selectBoundaryForExport(data: { global_id: string; select: boolean });
  selectBoundaryForExport(data: MatAutocompleteSelectedEvent);
  selectBoundaryForExport(data) {
    let select: boolean;
    let global_id: string;
    let targetNode: TreeNodeCheckable;

    // Type guards
    if (
      data &&
      typeof data.global_id === 'string' &&
      typeof data.select === 'boolean'
    ) {
      // selection happens through the list
      global_id = data.global_id;
      select = data.select;
    } else if (
      data &&
      data.option &&
      typeof data.option.value === 'string' &&
      data.option.viewValue
    ) {
      // selection happens through autocomplete
      global_id = data.option.value;
      this.searchBoundaryExport = '';
      select = true;
    } else {
      throw new Error('Invalid argument');
    }

    // the target boundary has not been found
    targetNode = this.boundaryTreeService.idsToNodes.get(global_id)!;
    if (!targetNode) {
      throw new Error(
        `Could not find ${
          select ? '' : 'un'
        }selected boundary ${global_id} for export`
      );
    }

    // update selection of node & childrens
    const tempSelectedNodesForExport = new Map(this.selectedNodesForExport);
    const deepSelectUnselectChildrens = (
      node: TreeNodeCheckable,
      select: boolean
    ) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (select) {
        // add to export
        tempSelectedNodesForExport.set(node.global_id, node);
      } else {
        // remove from export
        tempSelectedNodesForExport.delete(node.global_id);
      }
      // continue digging
      for (const child of node.children) {
        deepSelectUnselectChildrens(child, select);
      }
    };
    deepSelectUnselectChildrens(targetNode, select);

    // update selection of parents
    let parent = targetNode.parent;
    while (parent) {
      if (
        parent.children.some((n) => tempSelectedNodesForExport.has(n.global_id))
      ) {
        tempSelectedNodesForExport.set(parent.global_id, parent);
      } else {
        tempSelectedNodesForExport.delete(parent.global_id);
      }
      parent = parent.parent;
    }

    this.selectedNodesForExport = tempSelectedNodesForExport;
  }

  selectAllForExport(event: MatCheckboxChange) {
    for (const boundary of this.shownExportBoundaries) {
      this.selectBoundaryForExport({
        global_id: boundary.global_id,
        select: event.checked,
      });
    }
  }

  public hasExportChildrenSelected(node: TreeNodeCheckable): selection {
    const boundaryChildren = node.children.filter(
      (n) => n.data.type === 'boundary'
    );
    if (!boundaryChildren.length) {
      // we are Ward level
      return this.selectedNodesForExport.has(node.global_id) ? 'all' : 'none';
    }

    const selectedChildren = boundaryChildren.filter((n) =>
      this.selectedNodesForExport.has(n.global_id)
    );
    if (selectedChildren.length === boundaryChildren.length) {
      return 'all';
    }
    return selectedChildren.length ? 'some' : 'none';
  }

  public hasMPChildrenSelected(node: TreeNodeCheckable): mixedSelection {
    const originalSelection = this.hasChildrenSelected(
      this.originalSelectedBoundariesForMP,
      node
    );
    const newSelection = this.hasChildrenSelected(
      this.selectedBoundariesForMP,
      node
    );
    if (originalSelection === 'all') {
      return 'all-original';
    }
    if (originalSelection === 'some') {
      if (newSelection !== 'none') {
        const mixedSelection = this.hasChildrenSelected(
          new Set([
            ...this.originalSelectedBoundariesForMP,
            ...this.selectedBoundariesForMP,
          ]),
          node
        );
        if (mixedSelection === 'all') {
          return 'all-mixed';
        }
        return 'some-mixed';
      }
      return 'some-original';
    }
    switch (newSelection) {
      case 'all':
        return 'all-new';
      case 'some':
        return 'some-new';
      case 'none':
        return 'none';
    }
  }

  exportWards(): Array<TreeNodeCheckable> {
    return [...this.selectedNodesForExport.values()].filter(
      (n) => n.level === 3
    );
  }

  /*
     this method is used to know if a node should be shown as checked, undeterminated or unchecked.
     */
  private hasChildrenSelected(
    selected: Set<string>,
    node: TreeNodeCheckable
  ): 'all' | 'none' | 'some' {
    let value;
    const deepSearch = (node) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (selected.has(node.global_id)) {
        // boundary selected
        switch (value) {
          case undefined:
          case 'all':
            // all boundaries untill now where selected
            value = 'all';
            break;
          case 'none':
          case 'some':
            // some boundaries or none where not selected
            value = 'some';
            break;
        }
      } else {
        // boundary not selected
        switch (value) {
          case undefined:
          case 'none':
            // all boundaries untill now where not selected
            value = 'none';
            break;
          case 'all':
          case 'some':
            // all or some boundaries where selected previously
            value = 'some';
            break;
        }
      }
      for (const child of node.children) {
        deepSearch(child);
      }
    };
    deepSearch(node);
    return value;
  }

  public resetMPBoundaries() {
    this.selectedBoundariesForMP.clear();
    // FIXME don't just remove everything, also set to original
  }

  public async saveMPBoundaries() {
    //Condence this list

    //Go through lowest levels, if parent is in set, remove them
    let bIdSetToEnable = new Set<string>(this.selectedBoundariesForMP);

    //Build map from bId => boundary data
    const allBoundaryData = await this.boundaryLayerService.getBoundaryData();
    const bMap = new Map<string, GeoJsonBoundaryWithIndicators>();
    for (const b of allBoundaryData) {
      bMap.set(b.properties.global_id, b);
    }

    //Country (level=0) has no parent so will never remove that if it exists in the set
    for (
      let level = AppConfigService.conf.generic.operational_boundary_level;
      level >= 1;
      level--
    ) {
      const toIterate = [...bIdSetToEnable];
      for (const bId of toIterate) {
        const b = bMap.get(bId);

        if (!b) {
          this.logger.debug(`Cannot find entry for boundary guid ${bId}`);
          continue;
        }

        //checking one level at a time
        if (b.properties.level != level) {
          continue;
        }

        const parent = b.properties.boundary_polygon;

        if (bIdSetToEnable.has(parent)) {
          bIdSetToEnable.delete(bId);
        }
      }
    }

    this.microplanEditService.enableParticipation([...bIdSetToEnable]);
  }

  public selectBoundaryForMP(data: {
    global_id: string;
    select: boolean;
  }): void;
  public selectBoundaryForMP(data: MatAutocompleteSelectedEvent): void;
  public selectBoundaryForMP(data: any): void {
    let select: boolean;
    let global_id: string;
    let targetNode: TreeNodeCheckable;

    // Type guards
    if (
      data &&
      typeof data.global_id === 'string' &&
      typeof data.select === 'boolean'
    ) {
      // selection happens through the list
      global_id = data.global_id;
      select = data.select;
      targetNode = this.shownMPBoundaries.find(
        (b) => b.global_id === global_id
      )!;
    } else if (
      data &&
      data.option &&
      typeof data.option.value === 'string' &&
      data.option.viewValue
    ) {
      // selection happens through autocomplete
      global_id = data.option.value;
      this.searchBoundaryMP = '';
      select = true;
      targetNode = this._searchBoundaryNode(global_id)!;
    } else {
      throw new Error('Invalid argument');
    }

    // the target boundary has not been found
    if (!targetNode) {
      throw new Error(
        `Could not find ${
          select ? '' : 'un'
        }selected boundary ${global_id} for MP`
      );
    }

    const tempSelection = this.selectedBoundariesForMP;
    const deepSelectUnselect = (node: TreeNodeCheckable, select: boolean) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (select) {
        // add to export
        tempSelection.add(node.global_id);
      }
      if (!select) {
        // remove from export
        tempSelection.delete(node.global_id);
        // remove parent selection
        let parent = node.parent;
        while (parent) {
          tempSelection.delete(parent.global_id);
          parent = parent.parent;
        }
      }
      for (const child of node.children) {
        deepSelectUnselect(child, select);
      }
    };

    deepSelectUnselect(targetNode, select);
    this.selectedBoundariesForMP = new Set(
      // remove original from selection
      Array.from(tempSelection).filter(
        (s) => !this.originalSelectedBoundariesForMP.has(s)
      )
    );
  }

  private _searchBoundaryiesMP(search: string) {
    const boundaries: SearchedBoundary[] = [];
    const deepSearchBoundary = (node: TreeNodeCheckable) => {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (node.label.toLocaleLowerCase().includes(search)) {
        boundaries.push({
          global_id: node.global_id,
          label: node.label,
          hierarchy: this._getBoundaryHierarchy(node),
        });
      }
      for (const child of node.children) {
        deepSearchBoundary(child);
      }
    };
    deepSearchBoundary(this.boundaryTreeService.allNodes[0]);
    this.searchedBoundariesMP.next(boundaries);
  }

  public drillDownMPBoundary(global_id: string) {
    const selected_boundary = this.shownMPBoundaries.find(
      (b) => b.global_id === global_id
    );
    if (!selected_boundary) {
      throw new Error(`Cannot drill down, boundary ${global_id} not found`);
    }

    this.mpLevel = selected_boundary.level;
    this.shownMPBoundaries = selected_boundary.children;
  }

  public drillUpMPBoundary() {
    // we are looking for grand parent because we are not keeping track of current boundary.
    const grandParent = this.shownMPBoundaries[0].parent?.parent;
    if (!grandParent) {
      throw new Error('Cannot drill up, no parent boundary found');
    }

    this.mpLevel = grandParent.level;
    this.shownMPBoundaries = grandParent.children;
  }

  public selectAllForMP(event: MatCheckboxChange) {
    for (const boundary of this.shownMPBoundaries) {
      this.selectBoundaryForMP({
        global_id: boundary.global_id,
        select: event.checked,
      });
    }
  }

  /*
  If user can reset mp of the currently selected state
  set userCanResetMicroplan to true
  */
  private async checkResetMicroplanPermissions() {
    //boundaryNavigationService.loadSelectedBoundary has been called, making
    //this up to date
    const bList = this.boundaryNavigationService.boundariesList;

    //Reset everything
    this.resetMpAdmin1GlobalId = '';
    this.resetMpAdmin1Name = '';
    this.resetMicroplanErrorMessage = '';

    //Even if they can't reset the current one, this is to show the messages if they select a different state
    const roles = this.authService.getUserRoles();
    this.userCanResetMicroplan = roles.includes(MicroplanStatusManagerRole.id);

    if (bList.length < 2) {
      //country selected
      return;
    }

    if (!this.userCanResetMicroplan) {
      return;
    }

    const mainUserGeoPermissions =
      this.userContextService.getUserMainPermissions();

    //state level
    const RESET_MP_LEVEL = 1;

    //Does current state exist in the geo permissions?
    const hasPerm = mainUserGeoPermissions.includes(
      bList[RESET_MP_LEVEL].properties.global_id
    );

    if (hasPerm) {
      this.resetMpAdmin1GlobalId = bList[RESET_MP_LEVEL].properties.global_id;
      this.resetMpAdmin1Name = bList[RESET_MP_LEVEL].properties.name;
      return;
    } else {
      //Build the massage you can't reset this when the usre
      //has the role but the priviledges for this exact state
      //let geoPermissionBoundaryList: string[] = [];

      /*
      for (const boundaryGlobalId of mainUserGeoPermissions) {
        const boundary = await this.boundaryLayerService.fetchBoundaryById(
          boundaryGlobalId
        );
        geoPermissionBoundaryList.push(
          `${boundary.properties.name} (level = ${boundary.properties.level})`
        );
      }*/

      this.resetMicroplanErrorMessage = `You don't have geo permission for exactly State level to reset the microplan status of ${bList[RESET_MP_LEVEL].properties.name}.`;

      //geoPermissionBoundaryList includes not just states, so this is confusing.  Plus the message is really long...
      /* if (geoPermissionBoundaryList.length > 0) {
        this.resetMicroplanErrorMessage +=
          ' You have geo permissions for boundaries: ' +
          geoPermissionBoundaryList.join(', ');
      }*/

      return;
    }
  }

  private _searchBoundaryNode(
    global_id: string,
    node?: TreeNodeCheckable
  ): TreeNodeCheckable | undefined {
    if (!node) {
      node = this.boundaryTreeService.allNodes[0];
    }

    const deepSearch = function (node: TreeNodeCheckable) {
      if (node.data.type !== 'boundary') {
        return;
      }
      if (node.global_id === global_id) {
        return node;
      }
      for (const child of node.children) {
        const result = deepSearch(child);
        if (result) {
          return result;
        }
      }
    };
    return deepSearch(node);
  }

  private _getBoundaryHierarchy(node: TreeNodeCheckable): Array<string> {
    const hierarchy: Array<string> = [];
    let parent: TreeNodeCheckable = node.parent!;
    while (parent) {
      hierarchy.unshift(parent.label);
      parent = parent.parent!;
    }
    return hierarchy;
  }

  private subscribeToPermissionsChange(): void {
    this.authService
      .loggedIn()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((loggedIn: boolean | null) => {
        if (loggedIn) {
          this.handlePermissionsChange();
        }
      });
  }

  private handlePermissionsChange(): void {
    let roles = this.authService.getUserRoles();
    this.userHasParticipationManagerRole = roles.includes(
      ParticipationManagerRole.id
    );
    this.userHasApiRole = roles.includes(ApiRole.id);

    if (this.userHasApiRole) {
      this.fetchAndListenfetchTokens().then();
    }

    this.userHasEditorRole = roles.includes(EditorRole.id);
    this.updateSyncMessage();

    //as roles changed
    this.checkResetMicroplanPermissions();
  }

  private subscribeToIsOnline() {
    this.onlineService
      .isOnlineStream()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isOnline) => {
        this.isOnline = isOnline!;
        this.updateSyncMessage();
      });
  }

  private subscribeToCrudChanges() {
    //This is to update the status to modified after a crud action has changed
    //https://github.com/novelt/GMT/issues/2104
    this.crudLayerService.crudActionsChanged
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (_ok) => {
        this._initializeOfflineWards().then();
      });
  }

  public handleDownloadClick(e: Event) {
    e.stopPropagation();
    this.searchWardDl = '';
  }

  private updateSyncMessage() {
    // Matches the ENV_NAME environment variable for training & demo
    if (
      AppConfigService.conf.environment == 'training' ||
      AppConfigService.conf.environment == 'demo'
    ) {
      this.syncTooltipMsg = `Disabling sync for ${AppConfigService.conf.environment}`;
      this.canSync = false;
      return;
    }

    if (!this.isOnline) {
      this.syncTooltipMsg =
        'You are offline so you cannot synchronize your changes with the server.';
      this.canSync = false;
    } else if (!this.userHasEditorRole) {
      this.syncTooltipMsg =
        "You don't have 'editor' role to synchronize your changes with the server.";
      this.canSync = false;
    } else if (!this.needSync) {
      this.syncTooltipMsg = 'No changes to synchronize.';
      this.canSync = false;
    } else {
      this.syncTooltipMsg = this.defaultSyncButtonMessage;
      this.canSync = true;
    }
  }

  public getBackBoundaryLabel(): string {
    if (this.exportLevel.number < 2) {
      return 'States';
    } else {
      return 'LGAs';
    }
  }
}
