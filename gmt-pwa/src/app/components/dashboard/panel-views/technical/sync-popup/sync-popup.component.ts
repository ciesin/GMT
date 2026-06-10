import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { BoundaryVectorLayersService } from '@services/boundary-vector-layers.service';
import { CancelService } from '@services/cancel.service';
import { DataExportService } from '@services/export/data-export.service';
import { IndicatorService } from '@services/indicator.service';
import { IsLoadingService } from '@services/is-loading.service';
import { IsOnlineService } from '@services/is-online.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { AuthService } from '@services/user/auth.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { CrudAction } from 'src/app/utils/server-interfaces/CrudAction';
import { v4 as uuidv4 } from 'uuid';

interface UserBoundaryChanges {
  //STATE NAME > LGA NAME
  boundaryParentLabel: string;

  //WARD Name
  boundaryLabel: string;

  //1 modification 2 modifications
  modificationLabel: string;
  modificationCount: number;
}

const enum StepStatus {
  DONE,
  PROCESSING = 1,
  //hour glass
  IN_QUEUE = 2,
  ERROR = 3,
}

interface Step {
  status: StepStatus;
  title: string;
  detail: string;

  //Store errors to send to the backend
  errors: Array<string>;

  //Uses epoch
  startTime: number;
  stopTime: number;
}

const enum StepIndex {
  RefreshOffline = 0,
  SubmitActions,
  CalculateCatchments,
  UpdateIndicators,
  FetchCleanCopy,
}

//should match indexes
const STEP_TITLES = [
  'Refresh offline data',
  'Submit actions',
  'Calculate Catchments',
  'Update Indicators',
  'Fetch clean copy of data',
];

const DETAIL_NOT_STARTED_YET = 'Not started yet';
const UNKNOWN_USER_NAME = 'Unknown User';

const STEP_DEFAULT: Step = {
  status: StepStatus.IN_QUEUE,
  detail: DETAIL_NOT_STARTED_YET,
  title: '',
  errors: [],
  startTime: 0,
  stopTime: 0,
};

@Component({
    selector: 'gmt-sync-popup',
    templateUrl: './sync-popup.component.html',
    styleUrls: ['./sync-popup.component.less'],
    standalone: false
})
export class SyncPopupComponent implements OnInit, OnDestroy {
  public syncMessage: string = '';
  public syncStatus: StepStatus = StepStatus.IN_QUEUE;

  public userNames: Array<string> = [];
  public userChanges: Array<Array<UserBoundaryChanges>> = [];

  public isProcessing = false;
  public syncCompleted = false;

  public steps: Array<Step> = [];

  public isOnline = true;

  private unsubscribe = new Subject();

  constructor(
    private dialogRef: MatDialogRef<SyncPopupComponent>,
    private crudLayerService: CrudLayerService,
    private boundaryVectorLayerService: BoundaryVectorLayersService,
    private isLoadingService: IsLoadingService,
    private vectorLayerService: VectorLayerService,
    private authService: AuthService,
    private boundaryLayerService: BoundaryLayerService,
    private indicatorService: IndicatorService,
    private logger: NGXLogger,
    private userContextService: UserContextService,
    private isOnlineService: IsOnlineService,
    private cancelService: CancelService,
    private dataExportService: DataExportService,
    private messageService: MessageService,
    private userActionLogService: UserActionLogService
  ) {
    this.loadToSyncSummary().then();
  }

  ngOnInit() {
    this.isOnlineService
      .isOnlineStream()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isOnline) => {
        this.isOnline = isOnline!;
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private async loadToSyncSummary() {
    this.isLoadingService.setLoading(true);
    try {
      const simplifiedCruds = await this.crudLayerService.getSimplifiedCruds();

      const countedCrudActions = simplifiedCruds.length;

      //User name => boundary id => changes
      const userChangesMap: Map<
        string,
        Map<string, UserBoundaryChanges>
      > = new Map();

      const currentUserName = this.authService.getUserName()!;

      //Always include current user, which could have 0 changes
      userChangesMap.set(currentUserName, new Map());

      const allBoundaryIdsSet = new Set<string>();

      for (const crudAction of simplifiedCruds) {
        const boundaryId = crudAction.geojson_after.properties.boundary_polygon;

        //tracking unique boundary count
        allBoundaryIdsSet.add(boundaryId);

        const userName =
          crudAction.geojson_after.properties.user_name || UNKNOWN_USER_NAME;

        if (!userChangesMap.has(userName)) {
          userChangesMap.set(userName, new Map());
        }

        const boundaryChangeMap = userChangesMap.get(userName)!;

        if (!boundaryChangeMap.has(boundaryId)) {
          //Initialize boundary changes

          //Make sure this boundary data is loaded in order to fetch the parents
          await firstValueFrom(
            this.boundaryVectorLayerService.ensureBoundaryLoaded(boundaryId)
          );

          const boundaryParents =
            this.boundaryVectorLayerService.fetchAllBoundaryParents(boundaryId);
          const boundary = boundaryParents.pop()!;

          //we don't want the country label
          boundaryParents.shift();

          const newBoundaryChange: UserBoundaryChanges = {
            boundaryParentLabel: boundaryParents
              .map((b) => b.properties.name.toUpperCase())
              .join(' > '),
            boundaryLabel: boundary.properties.name,
            modificationCount: 0,
            modificationLabel: '',
          };
          boundaryChangeMap.set(boundaryId, newBoundaryChange);
        }

        const boundaryChange = boundaryChangeMap.get(boundaryId)!;

        boundaryChange.modificationCount += 1;
      }

      //Now switch to an array
      this.userNames = Array.from(userChangesMap.keys());
      //move current user to front
      const currentUserIndex = this.userNames.indexOf(currentUserName);
      if (currentUserIndex != 0) {
        this.userNames.splice(currentUserIndex, 1);
        this.userNames.unshift(currentUserName);
      }

      this.userChanges = [];

      for (const userName of this.userNames) {
        const bChanges = Array.from(userChangesMap.get(userName)!.values());

        //sort
        bChanges.sort((a, b) => {
          if (a.boundaryParentLabel < b.boundaryParentLabel) return -1;
          if (a.boundaryParentLabel > b.boundaryParentLabel) return 1;
          if (a.boundaryLabel < b.boundaryLabel) return -1;
          if (a.boundaryLabel > b.boundaryLabel) return 1;
          return 0;
        });

        for (const bChange of bChanges) {
          if (bChange.modificationCount == 1) {
            bChange.modificationLabel = '1 modification';
          } else {
            bChange.modificationLabel = `${bChange.modificationCount} modifications`;
          }
        }

        this.userChanges.push(bChanges);
      }

      const uniqueBoundaryCount = allBoundaryIdsSet.size;
      this.syncMessage = 'There ';
      if (countedCrudActions == 1) {
        this.syncMessage += `is ${countedCrudActions} action`;
      } else {
        this.syncMessage += `are ${countedCrudActions} actions`;
      }
      this.syncMessage += ` to sync across ${uniqueBoundaryCount} ward`;
      if (uniqueBoundaryCount != 1) {
        this.syncMessage += 's';
      }
      this.syncMessage += '.';
    } finally {
      this.isLoadingService.setLoading(false);
    }
  }

  handleCancelDialog() {
    this.dialogRef.close();
  }

  async handleStartSync() {
    this.syncMessage = 'Synchronizing your changes, please wait....';
    this.syncStatus = StepStatus.PROCESSING;
    this.isProcessing = true;
    this.steps = [];
    for (const stepTitle of STEP_TITLES) {
      this.steps.push({
        ...STEP_DEFAULT,
        title: stepTitle,
        //make sure we have a new array
        errors: [],
      });
    }
    //this.dialogRef.close();
    await this._submitCrudActions();
  }

  handleNoSync() {
    this.dialogRef.close();
  }

  ackSyncCompleted() {
    this.dialogRef.close();

    //reload boundaries / indicators
    if (this.syncStatus == StepStatus.DONE) {
      location.reload();
    }
  }

  cancelSync() {
    if (this.cancelService.isCancelled()) {
      this.logger.info('Sync already cancelled');
    } else {
      this.logger.info('Cancel sync');
      this.cancelService.cancel();
    }
  }

  private async retryStep(
    func: () => Promise<void>,
    step: Step,
    startMessage: string
  ) {
    return this.cancelService.retryImpl(
      func,
      () => {
        startStep(step, startMessage);
      },
      () => {
        stopStep(step);
      },
      (e, retryIndex, maxRetries) => {
        step.detail = `Caught error ${e}, retry #${
          retryIndex + 1
        } of ${maxRetries}`;
        if (retryIndex + 1 >= maxRetries) {
          step.status = StepStatus.ERROR;
        }
        step.errors.push(`${e}`);
      },
      (msg) => {
        step.detail = msg;
      }
    );
  }

  private async _submitCrudActions() {
    try {
      this.cancelService.resetCancel();

      //These 3 all share the same step in order to print the detail messages
      await this.retryStep(
        async () => {
          await this.userContextService.addServerLogMessage('User Sync Start', {
            userChanges: this.userChanges,
            userNames: this.userNames,
          });
        },
        this.steps[StepIndex.RefreshOffline as number],
        'Adding start server log message...'
      );

      await this.retryStep(
        async () => {
          await this.userContextService.logPermissions();
        },
        this.steps[StepIndex.RefreshOffline as number],
        'Logging user permissions...'
      );

      await this.retryStep(
        async () => {
          await this.vectorLayerService.refreshOfflineData(true);
        },
        this.steps[StepIndex.RefreshOffline as number],
        'Refreshing offline data...'
      );

      this.steps[StepIndex.RefreshOffline as number].detail =
        'Latest data fetched from server';
      this.steps[StepIndex.RefreshOffline as number].status =
        StepStatus.PROCESSING;
      await this.crudLayerService.mergeAllLayers();
      this.steps[StepIndex.RefreshOffline as number].detail =
        'Latest data fetched from server and merged with actions';
      stopStep(this.steps[StepIndex.RefreshOffline as number]);

      const directBoundariesAffected = await this.getAffectedBoundaries(
        //Important !  We want simplifiedCruds later to include the corrections we just did
        await this.crudLayerService.getSimplifiedCruds(),
        false
      );
      await this.pruneDanglingCiItems(directBoundariesAffected);
      await this.pruneChildlessSplitParents(directBoundariesAffected);
      await this.pruneUnnamedAutoSplitChildren(directBoundariesAffected);
      await this.handleSplitParentOtherBoundary(directBoundariesAffected);

      //Fetch after doing any potential data corrections above
      const simplifiedCruds = await this.crudLayerService.getSimplifiedCruds();
      const boundariesAffected = await this.getAffectedBoundaries(
        simplifiedCruds,
        true
      );

      await this.retryStep(
        async () => {
          await this.crudLayerService.submitEdits(simplifiedCruds);
        },
        this.steps[StepIndex.SubmitActions as number],
        'Sending actions to server'
      );

      this.steps[StepIndex.SubmitActions as number].detail =
        'Actions sent to server';

      //We need to do this before fetching the data we just submitted, otherwise the existirg
      //crud actions will conflict

      // track download progress as we can have information when each layer is downloaded

      startStep(
        this.steps[StepIndex.CalculateCatchments as number],
        'Calculating catchments'
      );

      //We only want operating level boundaries here for catchments & indicators
      //but not convenient to look up all the boundaries from either the hierarchy data
      //via HierarchyList etc.
      await this.retryStep(
        async () => {
          await this.indicatorService.refreshCatchments(
            Array.from(boundariesAffected)
          );
        },
        this.steps[StepIndex.CalculateCatchments],
        `Calculating catchments for ${boundariesAffected.size} boundaries`
      );

      this.logger.log(
        'requestFullIndicatorUpdate --------------------------------------------------------'
      );

      //This should be done after refresh catchments because we want the stats to have been calculated
      await this.retryStep(
        async () => {
          await this.indicatorService.requestFullIndicatorUpdate(false, false);

          //Only triggers them, does not wait.  Scheduled to run at night, will not re-add the job if already pending/waiting
          await this.dataExportService.refreshStateExports();

          //quick, also just queues the job to check the data
          await this.crudLayerService.requestDataCheck(
            Array.from(directBoundariesAffected)
          );
        },
        this.steps[StepIndex.UpdateIndicators],
        'Calculating boundary indicators'
      );

      //We want to see the updated indicators
      await this.retryStep(
        async () => {
          await this.boundaryLayerService.fetchHierarchyList();
        },
        this.steps[StepIndex.UpdateIndicators],
        'Fetching updated indicators'
      );

      //We need to wait until the 2nd refresh is done before clearing edits
      //because if this refresh fails and we cleared edits, then the user will
      //see the old changes.  And they will not be able to attempt to sync again
      this.logger.log(
        'Downloading updated data --------------------------------------------------------'
      );

      await this.retryStep(
        async () => {
          await this.vectorLayerService.refreshOfflineData(true);
        },
        this.steps[StepIndex.FetchCleanCopy as number],
        'Fetching server side data with server side calculations'
      );

      this.logger.log(
        'Data download done ---------------------------------------------------- '
      );

      //No need to do client side updates
      this.userContextService.spGuidsToCalc$.next(new Set<string>());

      //Reuse the last step
      await this.retryStep(
        async () => {
          await this.userContextService.addServerLogMessage(
            'User Sync Successful',
            this.steps
          );
          await this.userActionLogService.addUserActionDescription(
            'User sync successful'
          );
          await this.userActionLogService.submitToServer();

          await this.userActionLogService.setUserActionDescriptions([]);
        },
        this.steps[StepIndex.FetchCleanCopy as number],
        'Adding server success message'
      );

      //Wait until all the server stuff is done
      await this.crudLayerService.clearEdits();

      await this.crudLayerService.checkIfNeedsSync();

      //This will be called on page reload in technical component
      //await this._initializeOfflineWards();
      this.syncMessage =
        'Synchronization successful!  Press Close to reload the page.';
      this.syncStatus = StepStatus.DONE;
      this.syncCompleted = true;
    } catch (e) {
      this.logger.error('Submit edits failed', e);

      this.syncMessage =
        'Synchronization did not complete successfully.  Your local changes are still present.  Please try submitting your changes again.';

      this.messageService.add({
        summary: 'Synchronization Failed!',
        detail:
          'Synchronization did not complete successfully.  Your local changes are still present.  Often this can be caused by connectivity issues.  Please try submitting your changes again.  If the issue persists, please contact your administrator.',
        severity: 'error',
        sticky: true,
        key: 'error-details',
      });

      this.syncStatus = StepStatus.ERROR;

      //save this because we need to reset the cancel service state to use retry on the log message
      const didUserCancel = this.cancelService.isCancelled();
      if (didUserCancel) {
        this.syncMessage = 'Sync Cancelled.  Your changes are still present.';
      }

      this.syncCompleted = true;

      //to use the retry below
      this.cancelService.resetCancel();

      await this.cancelService.retry(async () => {
        await this.userContextService.addServerLogMessage(
          didUserCancel ? 'User Sync Cancelled' : 'User Sync Failed',
          this.steps
        );
      });

      //throw new Error("Something failed while syncing the edits.");
    }
  }

  /*
  Returns set of unique boundaries impacted by crud
  */
  private async getAffectedBoundaries(
    simplifiedCruds: Array<CrudAction>,
    includeSurroundingBoundaries: boolean
  ): Promise<Set<string>> {
    const boundariesAffected = new Set<string>();
    for (const ca of simplifiedCruds) {
      boundariesAffected.add(ca.geojson_after.properties.boundary_polygon);
    }

    if (!includeSurroundingBoundaries) {
      return boundariesAffected;
    }

    //Get all surrounding boundaries of boundaries affected
    const baList = Array.from(boundariesAffected);
    for (const boundaryId of baList) {
      const surroundingBoundaries =
        await this.vectorLayerService.getSurroundingBoundaryGuids(boundaryId);
      for (const surroundingBoundaryId of surroundingBoundaries.surrounding_boundary_guids) {
        boundariesAffected.add(surroundingBoundaryId);
      }
    }
    return boundariesAffected;
  }

  private async pruneDanglingCiItems(directlyAffectedBoundaryIds: Set<string>) {
    //Some actions like deleting a HF that had includes/excludes
    //can leave includes/excludes danging
    //Here we remove any
    //Done client side so we have the user commit that removed it
    //While possible this could clean up another situation from another user
    //Most of the time this should be the same users actions that cause this

    const bvData = this.boundaryVectorLayerService.data;
    const danglingCiItems = bvData.ciList.filter((ci) => {
      //Only care about use ci items as generated ones get recalced
      if (ci.properties.type == 'generated') {
        return false;
      }

      //Because of the A -> B - > C where B is surrounding boundary that needs settlement in C
      //we only prune what we are actuall ychanging
      if (!directlyAffectedBoundaryIds.has(ci.properties.boundary_polygon)) {
        return false;
      }

      if (!bvData.hfMap.has(ci.properties.health_facility_point)) {
        return true;
      }

      if (!bvData.spMap.has(ci.properties.settlement_part)) {
        return true;
      }

      //All good, both sp and hf exist
      return false;
    });

    if (danglingCiItems.length == 0) {
      this.logger.debug('No dangling catchment items found');
      return;
    }

    this.logger.warn(
      `Removing ${danglingCiItems.length} dangling catchment items !`
    );
    const actionId = uuidv4();
    await this.crudLayerService.bulkDeleteCatchmentItems(
      danglingCiItems,
      false,
      actionId
    );
  }

  private async pruneChildlessSplitParents(
    directlyAffectedBoundaryIds: Set<string>
  ) {
    //Merging all remaining split childs can leave split parents that have no children, find and remove

    const bvData = this.boundaryVectorLayerService.data;
    const splitChildrenParents = new Set<string>(
      bvData.spList
        .filter((sp) => {
          if (
            !directlyAffectedBoundaryIds.has(sp.properties.boundary_polygon)
          ) {
            return false;
          }
          return sp.properties.split_type == 'auto_split_child';
        })
        .map((sp) => sp.properties.split_parent || '')
    );
    const childlessSplitParents = bvData.spList.filter((sp) => {
      if (sp.properties.split_type != 'auto_split_parent') {
        return false;
      }
      if (!directlyAffectedBoundaryIds.has(sp.properties.boundary_polygon)) {
        return false;
      }

      return !splitChildrenParents.has(sp.properties.global_id);
    });

    if (childlessSplitParents.length == 0) {
      this.logger.debug('No childless split parents');
      return;
    }

    const logMessage = `Removing ${childlessSplitParents.length} childless split parents !`;
    await this.userActionLogService.addUserActionDescription(logMessage);
    this.logger.warn(logMessage);
    const actionId = uuidv4();
    for (const sp of childlessSplitParents) {
      const removeMessage = `Removing childless split parent ${sp.properties.global_id} ${sp.properties.bbox}`;
      this.logger.warn(removeMessage);
      await this.userActionLogService.addUserActionDescription(removeMessage);
      await this.crudLayerService.deleteItem(
        'settlement__part',
        sp.properties.global_id,
        false,
        false,
        actionId
      );
    }
  }

  /*
See https://github.com/novelt/GMT/issues/3127

During a sync, when getting latest changes from server,
if this client had split or merged auto split children (causing their settlement parts to be undeleted)
but another client adds a settlement to the auto managed settlements,
we can have undeleted settlement parts.

This will prune them, adding the reason
  */
  private async pruneUnnamedAutoSplitChildren(
    directlyAffectedBoundaryIds: Set<string>
  ) {
    const bvData = this.boundaryVectorLayerService.data;
    const splitChildren = bvData.spList.filter((sp) => {
      if (!directlyAffectedBoundaryIds.has(sp.properties.boundary_polygon)) {
        return false;
      }
      return sp.properties.split_type == 'auto_split_child';
    });

    const unnamedSplitChildren = splitChildren.filter((sp) => {
      const names = bvData.getPrimaryNamesForSettlementPart(
        sp.properties.global_id,
        false
      );

      return names.length <= 0;
    });

    if (unnamedSplitChildren.length <= 0) {
      this.logger.debug(`No unnamed split children`);
      return;
    }

    const idStr = unnamedSplitChildren
      .map((sp) => sp.properties.global_id)
      .join(', ');

    const logMessage = `Removing ${idStr} unnamed split children`;
    await this.userActionLogService.addUserActionDescription(logMessage);
    this.logger.warn(logMessage);
    const actionId = uuidv4();
    for (const sp of unnamedSplitChildren) {
      this.logger.warn(
        `Removing unnamed split child ${sp.properties.global_id} `
      );
      await this.crudLayerService.deleteItem(
        'settlement__part',
        sp.properties.global_id,
        false,
        false,
        actionId
      );
    }
  }

  private async handleSplitParentOtherBoundary(
    directlyAffectedBoundaryIds: Set<string>
  ) {
    //If we have an auto split child and we change its boundary, we want to have it no longer be an auto split child
    const bvData = this.boundaryVectorLayerService.data;

    const splitChildren = bvData.spList.filter((sp) => {
      if (!directlyAffectedBoundaryIds.has(sp.properties.boundary_polygon)) {
        return false;
      }
      return sp.properties.split_type == 'auto_split_child';
    });

    const messages: Array<string> = [];
    const splitParentOtherBoundary = bvData.spList.filter((sp) => {
      const sParent = bvData.spMap.get(sp.properties.split_parent!);

      //We are not handling the case when the split parent is missing
      if (_.isNil(sParent)) {
        messages.push(
          `Found a settlement part with a missing split parent, not handling [${sp.properties.global_id}]`
        );

        return false;
      }

      return (
        sParent.properties.boundary_polygon != sp.properties.boundary_polygon
      );
    });

    const actionId = uuidv4();

    for (const sp of splitParentOtherBoundary) {
      sp.properties.split_parent = null;
      sp.properties.split_type == 'none';

      messages.push(
        `Clearing auto split child fields for [${sp.properties.global_id}]`
      );

      await this.crudLayerService.updateItem(
        'settlement__part',
        sp,
        false,
        false,
        actionId
      );
    }

    for (const m of messages) {
      await this.userActionLogService.addUserActionDescription(m);
    }
  }
}
function startStep(step: Step, message: string) {
  const d = new Date();
  if (step.startTime <= 0) {
    step.startTime = d.getTime();
  }
  step.status = StepStatus.PROCESSING;
  step.detail = message;
}

function stopStep(step: Step) {
  const d = new Date();
  step.stopTime = d.getTime();
  step.status = StepStatus.DONE;
}
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
