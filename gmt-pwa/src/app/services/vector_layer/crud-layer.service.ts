import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import _ from 'lodash';
import cloneDeep from 'lodash/cloneDeep';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, firstValueFrom, Observable, Subject } from 'rxjs';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigService } from '../../utils/app-config.service';
import {
  CrudAction,
  CrudActions,
  DefaultQueueResponse,
} from '../../utils/server-interfaces/CrudAction';
import {
  GeoJsonBase,
  GeoJsonCatchmentItem,
  GeoJsonCatchmentProperties,
  GeoJsonSettlementPart,
} from '../../utils/server-interfaces/GeoJson';
import { JobStatusState } from '../../utils/server-interfaces/JobStatus';
import { isFloat } from '../../utils/server-interfaces/utils/string.util';
import {
  BOUNDARY_EDITED_LAYER,
  HF_LAYER,
  ST_GEOMETRY_LAYER,
  VectorLayerName,
} from '../../utils/server-interfaces/VectorLayerName';
import {
  CrudLayerServiceInterface,
  UndoRedoEvent,
} from '../interfaces/crud-layer.service.interface';
import { AuthService } from '../user/auth.service';
import { VectorLayerService } from '../vector_layer/vector-layers.service';
import { getChangedFields } from './DiffUtil';
import { applyCrudOperations } from './VectorLayerDatabase';

const LOG_PREFIX = 'VLS1 Vector Layer Service';

/**
 * Helper interface to do 3 way merge, see mergeLayer
 */
interface ItemsNeedingMergeArrayItem {
  fieldsToApply: Array<string>;
  lastCrudItem: CrudAction;
  currentServerVersion: GeoJsonBase;
}

interface ItemsNeedingMerge {
  serverMap: Map<string, GeoJsonBase>;
  itemsToMerge: Array<ItemsNeedingMergeArrayItem>;
}

//is_fixed_post / is_outreach are raster fields
const CALCULATED_FIELDS = new Set([
  'version_id',
  'computed_pop',
  'bbox',
  'origin_x',
  'origin_y',
  'is_outreach',
  'is_fixed_post',
  'color',
  'index',
  'raster_height',
  'raster_width',
  'catchment_raster',
]);

@Injectable({
  providedIn: 'root',
})
export class CrudLayerService implements CrudLayerServiceInterface {
  //Gets a new value of true every time the crud actions change
  public crudActionsChanged = new BehaviorSubject<boolean>(false);
  private undoActionIsPossible = new BehaviorSubject<boolean>(false);
  private redoActionIsPossible = new BehaviorSubject<boolean>(false);
  private undoEvent = new Subject<UndoRedoEvent>();
  private redoEvent = new Subject<UndoRedoEvent>();

  //Used during operations that are touching many layers or have several steps
  //Such as merging / splitting / refresh offline data / and syncing
  //When set back to false, the UI would be expected to update
  //This is used in addition to notify = true/false
  //Notify = false is still useful to suppress non UI observable effects, such as boundary vector processing the observable
  //subscription handlers.
  //Should follow the ensureBoundaryLoaded usually, see examples in the code
  public suppressUserInterfaceUpdates = new BehaviorSubject<boolean>(false);

  constructor(
    private vectorLayerService: VectorLayerService,
    private authService: AuthService,
    private http: HttpClient,
    private messageService: MessageService,
    private logger: NGXLogger
  ) {
    this.updateUndoRedoStatus().then();
    this.checkIfNeedsSync().then();
  }

  async getCrudActions(): Promise<Array<CrudAction>> {
    return this.vectorLayerService._db.crud_actions.toArray();
  }

  async createItem(
    layer: VectorLayerName,
    itemToAdd: GeoJsonBase,
    notify = true,
    showToast = true,
    actionId: string | null = null,
    isCatchmentCalculation: boolean = false
  ): Promise<boolean> {
    //console.log(`${LOG_PREFIX} createItem ${layer} notify: ${notify}`, itemToAdd);
    //Set the source; perhaps add the username too

    itemToAdd.properties.created_date = new Date().toISOString();
    this.setCommonFields(itemToAdd);

    const creationActionId = actionId || uuidv4();
    const crudAdd: CrudAction = {
      geojson_before: itemToAdd,
      geojson_after: itemToAdd,
      action: 'create',
      changed_fields: [],
      changed_layer: layer,
      actionId: creationActionId,
      isCatchmentCalculation,
    };

    //remove other potential creates - this will be done before submitting changes to the server
    // await this.removeCrudForGlobalId(itemToAdd.properties.global_id);

    await this.vectorLayerService._db.crud_actions.add(crudAdd);
    this.vectorLayerService._needSync.next(true);

    if (notify) {
      await this.updateObservableAfterCrud(layer);
    }

    if (showToast) {
      this.showSuccessToast();
    }
    await this.saveToHistory(creationActionId);
    return true;
  }

  async updateItem(
    layer: VectorLayerName,
    updatedItem: GeoJsonBase,
    notify = true,
    showToast = true,
    actionId: null | string = null,
    isCatchmentCalculation: boolean = false
  ): Promise<boolean> {
    const actionIdToSave: string = actionId || uuidv4();
    this.logger.debug(`${LOG_PREFIX} updateItem ${layer} notify: ${notify}`);

    const global_id = updatedItem.properties.global_id;
    this.setCommonFields(updatedItem);
    let action: CrudActions = 'update';
    let geojson_before = await this.vectorLayerService._db[layer].get(
      global_id
    );
    if (!geojson_before) {
      //Also check any creates, we want to replace them with the latest updated properties
      const existing = this.vectorLayerService._db.crud_actions.where({
        'geojson_after.properties.global_id': updatedItem.properties.global_id,
        action: 'create',
      });
      const existingArray = await existing.toArray();
      if (existingArray.length > 0) {
        // we should take the last edit
        geojson_before = existingArray[existingArray.length - 1].geojson_before;
        action = 'create';
      }
    }

    if (!geojson_before) {
      throw Error(`Cannot find global_id ${global_id} in ${layer}`);
    }

    const changed_fields = getChangedFields(geojson_before, updatedItem);

    const crudUpdate: CrudAction = {
      geojson_before,
      geojson_after: updatedItem,
      action,
      changed_fields,
      changed_layer: layer,
      actionId: actionIdToSave,
      isCatchmentCalculation,
    };

    this.logger.debug('Adding updated item', crudUpdate);

    await this.vectorLayerService._db.crud_actions.add(crudUpdate);

    this.vectorLayerService._needSync.next(true);

    if (notify) {
      await this.updateObservableAfterCrud(layer);
    }
    if (showToast) {
      this.showSuccessToast();
    }
    await this.saveToHistory(actionIdToSave);
    return true;
  }

  /**
   *
   */
  async bulkUpdateItem(
    layer: VectorLayerName,
    updatedItems: Array<GeoJsonBase>,
    notify = true,
    showToast = true,
    actionId: null | string = null,
    isCatchmentCalculation: boolean = false
  ): Promise<boolean> {
    if (!Array.isArray(updatedItems) || updatedItems.length <= 0) {
      return false;
    }

    const actionIdToSave: string = actionId || uuidv4();
    this.logger.debug(
      `${LOG_PREFIX} bulkUpdateItem ${layer} notify: ${notify}`,
      updatedItems
    );

    const crudUpdateList: Array<CrudAction> = [];

    const globalIds = updatedItems.map((uItem) => uItem.properties.global_id);
    let geojsonBeforeArray = await this.vectorLayerService._db[layer].bulkGet(
      globalIds
    );

    for (const [idx, updatedItem] of updatedItems.entries()) {
      const global_id = updatedItem.properties.global_id;
      this.setCommonFields(updatedItem);
      let action: CrudActions = 'update';

      let geojsonBefore = geojsonBeforeArray[idx];

      if (!geojsonBefore) {
        //Also check any creates, we want to replace them with the latest updated properties
        const existing = this.vectorLayerService._db.crud_actions.where({
          'geojson_after.properties.global_id':
            updatedItem.properties.global_id,
          action: 'create',
        });
        const existingArray = await existing.toArray();
        if (existingArray.length > 0) {
          // we should take the last edit
          geojsonBefore =
            existingArray[existingArray.length - 1].geojson_before;
          action = 'create';
        }
      }

      if (!geojsonBefore) {
        throw Error(`Cannot find global_id ${global_id} in ${layer}`);
      }

      const changed_fields = getChangedFields(geojsonBefore, updatedItem);

      const crudUpdate: CrudAction = {
        geojson_before: geojsonBefore,
        geojson_after: updatedItem,
        action,
        changed_fields,
        changed_layer: layer,
        actionId: actionIdToSave,
        isCatchmentCalculation,
      };

      this.logger.debug('Adding updated item', crudUpdate);

      crudUpdateList.push(crudUpdate);
    }

    await this.vectorLayerService._db.crud_actions.bulkAdd(crudUpdateList);

    this.vectorLayerService._needSync.next(true);

    if (notify) {
      await this.updateObservableAfterCrud(layer);
    }
    if (showToast) {
      this.showSuccessToast();
    }
    await this.saveToHistory(actionIdToSave);
    return true;
  }

  async bulkCreateItem(
    layer: VectorLayerName,
    createdItems: Array<GeoJsonBase>,
    notify = true,
    showToast = true,
    actionId: null | string = null,
    isCatchmentCalculation: boolean = false
  ): Promise<boolean> {
    if (!Array.isArray(createdItems) || createdItems.length <= 0) {
      return false;
    }

    const actionIdToSave: string = actionId || uuidv4();
    this.logger.debug(
      `${LOG_PREFIX} bulkUAddtem ${layer} notify: ${notify}`,
      createdItems
    );

    const crudCreateList: Array<CrudAction> = [];

    for (const [idx, createdItem] of createdItems.entries()) {
      this.setCommonFields(createdItem);
      createdItem.properties.created_date = new Date().toISOString();
      let action: CrudActions = 'create';

      const crudAdd: CrudAction = {
        geojson_before: createdItem,
        geojson_after: createdItem,
        action,
        changed_fields: [],
        changed_layer: layer,
        actionId: actionIdToSave,
        isCatchmentCalculation,
      };

      this.logger.debug('Adding updated item', crudAdd);

      crudCreateList.push(crudAdd);
    }

    await this.vectorLayerService._db.crud_actions.bulkAdd(crudCreateList);

    this.vectorLayerService._needSync.next(true);

    if (notify) {
      await this.updateObservableAfterCrud(layer);
    }
    if (showToast) {
      this.showSuccessToast();
    }
    await this.saveToHistory(actionIdToSave);
    return true;
  }

  /**
   * Make certain optimizations.
   *
   * Don't compute changed properties
   * Use object.assign to clone
   * Use the passed in object to make sure required fields are defined (needed for importer)
   *
   * @param itemsToDelete
   * @param notify
   * @param actionId
   */
  async bulkDeleteCatchmentItems(
    itemsToDelete: Array<GeoJsonCatchmentItem>,
    notify: boolean = true,
    actionId: string
  ): Promise<boolean> {
    if (!Array.isArray(itemsToDelete) || itemsToDelete.length <= 0) {
      return false;
    }
    //Any catchment items generated in this session (version_id not an integer)
    //and are not exclude=true entries (so not user created), we want to delete directly
    //from the crud array in indexdb.  The reason is becasue we don't want there to be too many
    //crud actions, and because these are computed, we don't need them to undo

    const itemsToRemoveFromCrudActions: Array<GeoJsonCatchmentItem> = [];
    const itemsToAddDeleteCrudAction: Array<GeoJsonCatchmentItem> = [];

    for (const ciToDelete of itemsToDelete) {
      if (
        isFloat(ciToDelete.properties.version_id) ||
        ciToDelete.properties.type != 'generated'
      ) {
        itemsToAddDeleteCrudAction.push(ciToDelete);
      } else {
        itemsToRemoveFromCrudActions.push(ciToDelete);
      }
    }

    const crudActions: Array<CrudAction> = [];

    for (const ciToDelete of itemsToAddDeleteCrudAction) {
      const itemToDeleteClone: GeoJsonCatchmentItem = {
        geometry: ciToDelete.geometry,
        properties: Object.assign({}, ciToDelete.properties),
        type: 'Feature',
      };
      this.setCommonFields(itemToDeleteClone);
      (itemToDeleteClone as GeoJsonBase).properties.to_delete = true;

      const crudDelete: CrudAction = {
        geojson_before: ciToDelete,
        geojson_after: itemToDeleteClone,
        action: 'delete',
        changed_fields: [],
        changed_layer: 'ri__catchment_item',
        actionId: actionId,
        //We could be removing a sp, so this is a real delete
        isCatchmentCalculation: false,
      };

      crudActions.push(crudDelete);
    }

    await this.vectorLayerService._db.crud_actions.bulkAdd(crudActions);

    const toRemoveGlobalIds = itemsToRemoveFromCrudActions.map(
      (ci) => ci.properties.global_id
    );
    if (toRemoveGlobalIds.length > 0) {
      const toRemove = this.vectorLayerService._db.crud_actions
        .where('geojson_after.properties.global_id')
        .anyOf(toRemoveGlobalIds);
      await toRemove.delete();
    }

    if (notify) {
      await this.updateObservableAfterCrud('ri__catchment_item');
    }

    //don't save this to history, any bulk delete would already have an entry with this actionId
    return true;
  }

  /*
    For crud actions marked with generated with the given ids, remove them permanently
    */
  async bulkDeleteGeneratedItems(
    itemsToRemoveFromCrudActions: Array<string>,
    notifyLayer: typeof ST_GEOMETRY_LAYER | typeof HF_LAYER | null
  ): Promise<boolean> {
    if (
      !Array.isArray(itemsToRemoveFromCrudActions) ||
      itemsToRemoveFromCrudActions.length <= 0
    ) {
      return false;
    }

    const toRemove = this.vectorLayerService._db.crud_actions
      .where('geojson_after.properties.global_id')
      .anyOf(itemsToRemoveFromCrudActions);
    await toRemove.and((x) => x.isCatchmentCalculation).delete();

    if (notifyLayer) {
      await this.updateObservableAfterCrud(notifyLayer);
    }

    //don't save this to history, any bulk delete would already have an entry with this actionId
    return true;
  }

  async deleteItem(
    layer: VectorLayerName,
    global_id: string,
    notify = true,
    showToast = true,
    actionId: string | null = null
  ): Promise<boolean> {
    const actionIdToDelete = actionId || uuidv4();

    //https://github.com/novelt/GMT/issues/2647 we could have the case where another action has
    //a delete and a create case.  For that we want to check both (really only need the last  one, but doesn't hurt
    //to do both
    const itemsToDelete: Array<GeoJsonBase> = [];

    const existingItemToDelete: GeoJsonBase | undefined =
      (await this.vectorLayerService._db[layer].get(
        global_id
      )) as unknown as GeoJsonBase;
    if (existingItemToDelete) {
      itemsToDelete.push(existingItemToDelete);
    }

    //Even if we have an existing item, because of https://github.com/novelt/GMT/issues/2647, we still need to check
    //any existing create cruds (which would be in another ward)

    //We could also have created this item with a crud, we don't need to submit it to the server

    //The reason we need to find an existing item is that the importer, even during a delete,
    //needs values for all non NULL fields.  We can't just create a json with empty values

    //That being said, we could change this method to not take a globalID, but the crud itself in order
    //to have required fields defined
    const existing = this.vectorLayerService._db.crud_actions.where({
      'geojson_after.properties.global_id': global_id,
      action: 'create',
    });
    const existingArray = await existing.toArray();

    for (const existingCreate of existingArray) {
      itemsToDelete.push(existingCreate.geojson_after);
    }

    if (itemsToDelete.length == 0) {
      throw Error(`Cannot find global_id ${global_id} in ${layer}`);
    }

    const ret = await this.deleteGeojsonItems(
      layer,
      itemsToDelete,
      notify,
      showToast,
      actionId
    );

    return ret;
  }

  async deleteGeojsonItems(
    layer: VectorLayerName,
    itemsToDelete: Array<GeoJsonBase>,
    notify = true,
    showToast = true,
    actionId: string | null = null
  ): Promise<boolean> {
    const actionIdToDelete = actionId || uuidv4();

    if (!_.isArray(itemsToDelete) || itemsToDelete.length <= 0) {
      this.logger.warn(`Items to delete is empty`);
      return false;
    }

    for (const itemToDelete of itemsToDelete) {
      const itemToDeleteClone: GeoJsonBase = cloneDeep(
        itemToDelete
      ) as GeoJsonBase;
      this.setCommonFields(itemToDeleteClone);
      itemToDeleteClone.properties.to_delete = true;

      this.logger.info(
        `${LOG_PREFIX} deleteItem ${layer} notify: ${notify} id=${itemToDeleteClone.properties.global_id}`,
        itemToDelete
      );

      const crudDelete: CrudAction = {
        geojson_before: itemToDelete,
        geojson_after: itemToDeleteClone,
        action: 'delete',
        //changed fields are used for refined permissions, but as we are deleting, no need to calculate this
        changed_fields: [],
        changed_layer: layer,
        actionId: actionIdToDelete,
        isCatchmentCalculation: false,
      };

      await this.vectorLayerService._db.crud_actions.add(crudDelete);
    }

    await this.checkIfNeedsSync();

    if (notify) {
      await this.updateObservableAfterCrud(layer);
    }

    if (showToast) {
      this.showSuccessToast();
    }

    await this.saveToHistory(actionIdToDelete);
    return true;
  }

  async clearEdits() {
    const currentCrudActions = await this.getCrudActions();

    //Find which layers will change
    const changedLayers = new Set<VectorLayerName>(
      currentCrudActions.map((ca) => ca.changed_layer)
    );

    this.vectorLayerService._needSync.next(false);
    await this.vectorLayerService._db.crud_actions.clear();
    await this.removeHistory();

    this.crudActionsChanged.next(true);

    for (const cl of changedLayers) {
      await this.updateObservableAfterCrud(cl);
    }
    await this.updateUndoRedoStatus();
  }

  undoActionIsPossibleObservable(): Observable<boolean> {
    return this.undoActionIsPossible.asObservable();
  }

  redoActionIsPossibleObservable(): Observable<boolean> {
    return this.redoActionIsPossible.asObservable();
  }

  async isUndoActionIsPossible(): Promise<boolean> {
    let currentPosition = await this.getCurrentHistoryPosition();
    return currentPosition >= 0;
  }

  async isRedoActionIsPossible(): Promise<boolean> {
    let currentPosition = await this.getCurrentHistoryPosition();
    let historyLength = await this.getCrudHistoryLength();
    return currentPosition < historyLength - 1;
  }

  //Returns the event so we can process it inline if needed
  async undoLastAction(): Promise<UndoRedoEvent | null> {
    let currentPosition = await this.getCurrentHistoryPosition();
    if (currentPosition < 0) {
      this.logger.debug('No crud actions, nothing to undo');
      return null;
    }
    let actionId = await this.getLastActionId();
    if (!actionId) {
      this.logger.debug('Action is undoable or no more actions to undo');
      return null;
    }
    //remove everything with that action id
    const toUndo = this.vectorLayerService._db.crud_actions.where({
      actionId: actionId,
    });
    const toUndoArray = await toUndo.toArray();
    await toUndo.delete();

    //Find which layers will change
    const changedLayers = new Set<VectorLayerName>(
      toUndoArray.map((ca) => ca.changed_layer)
    );
    this.crudActionsChanged.next(true);
    for (const cl of changedLayers) {
      this.logger.debug(`Processing undo -- changed layer ${cl}`);
      await this.updateObservableAfterCrud(cl);
    }

    // update history related data
    let updatedStAndHfIds = this.getUpdatedHfsAndSts(toUndoArray);

    await this.vectorLayerService._db.crud_actions_redo.bulkPut(toUndoArray);
    await this.updateCurrentHistoryPosition(currentPosition - 1);

    // update properties needed for UI changes
    let actionIdAfterUndo = await this.getLastActionId();

    //Note this will trigger some recalculations in boundary & geometry issues
    //Ideally these would just listen to the crud observables (updated in updateObservableAfterCrud)
    //to treate new crud actions and undo the exact same
    //Or the this.crudLayerService.crudActionsChanged event
    //The reason is to be able to block the ui while all the recalculations are being done
    //to prevent oddities / bugs when the user is al
    const undoRedoEvent: UndoRedoEvent = {
      lastActionId: actionIdAfterUndo!,
      updatedHfIds: updatedStAndHfIds.updatedHfIds,
    };
    this.undoEvent.next(undoRedoEvent);
    await this.checkIfNeedsSync();
    return undoRedoEvent;
  }

  async redoLastAction(): Promise<UndoRedoEvent | null> {
    let currentPosition = await this.getCurrentHistoryPosition();
    let historyLength = await this.getCrudHistoryLength();
    if (currentPosition >= historyLength - 1) {
      this.logger.debug(
        'No crud actions, nothing to redo',
        currentPosition,
        'currentPosition',
        historyLength,
        'historyLength'
      );
      return null;
    }
    currentPosition += 1;
    await this.updateCurrentHistoryPosition(currentPosition);
    let actionId = await this.getLastActionId();
    const redoCrudActions = this.vectorLayerService._db.crud_actions_redo.where(
      { actionId: actionId }
    );
    const redoCrudActionsArray = await redoCrudActions.toArray();
    await this.vectorLayerService._db.crud_actions.bulkPut(
      redoCrudActionsArray
    );
    this.crudActionsChanged.next(true);

    //Find which layers will change
    const changedLayers = new Set<VectorLayerName>(
      redoCrudActionsArray.map((ca) => ca.changed_layer)
    );

    for (const cl of changedLayers) {
      this.logger.debug(`Processing redo -- changed layer ${cl}`);
      await this.updateObservableAfterCrud(cl);
    }

    await redoCrudActions.delete();
    let updatedStAndHfIds = this.getUpdatedHfsAndSts(redoCrudActionsArray);

    // update properties needed for UI changes
    let actionIdAfterUndo = await this.getLastActionId();
    const undoRedoEvent: UndoRedoEvent = {
      lastActionId: actionIdAfterUndo!,
      updatedHfIds: updatedStAndHfIds.updatedHfIds,
    };
    this.redoEvent.next(undoRedoEvent);
    await this.checkIfNeedsSync();
    return undoRedoEvent;
  }

  private getUpdatedHfsAndSts(crudArray: CrudAction[]): {
    updatedStIds: string[];
    updatedHfIds: string[];
  } {
    let updatedHfIds: Array<string> = [];
    let updatedStIds: Array<string> = [];
    for (const toUndoItem of crudArray) {
      if (toUndoItem.changed_layer == 'ri__catchment_item') {
        const ci = toUndoItem.geojson_after as GeoJsonCatchmentItem;
        if (!updatedHfIds.includes(ci.properties.health_facility_point)) {
          updatedHfIds.push(ci.properties.health_facility_point);
        }
        if (!updatedStIds.includes(ci.properties.settlement_part)) {
          updatedStIds.push(ci.properties.settlement_part);
        }
      }
    }
    return { updatedStIds, updatedHfIds };
  }

  private async requestSubmitEdits(
    simplifiedCruds: Array<CrudAction>
  ): Promise<number> {
    // Updates cruds table by deleting unnecessary ones and deletes the history

    let jobId: number = 0;
    if (simplifiedCruds.length == 0) {
      //errorsList.push("There are no edits that could be saved");
      //This is not an error.  This is called with the Sync button,
      //which also can be used to refresh offline data
      await this.checkIfNeedsSync();
      return -1;
    } else {
      // const httpData: SubmitEditsResponse = await this.http.post<GeoJsonList>(`${AppConfigService.conf.api_url}/submit_edits`, crudList)
      this.logger.info(`${AppConfigService.conf.api_url}/submit_edits`);
      this.logger.info(simplifiedCruds);
      const httpData = (await this.http
        .post<DefaultQueueResponse>(
          `${AppConfigService.conf.api_url}/submit_edits`,
          simplifiedCruds
        )
        .toPromise())!;
      this.logger.debug(httpData, 'httpData');
      jobId = httpData.jobId;
    }

    //since we just submitted edits, we know the version is out of date
    this.vectorLayerService.latestVersionLastCall = 0;
    return jobId;
  }

  async submitEdits(simplifiedCruds: Array<CrudAction>): Promise<boolean> {
    this.logger.debug(`submitting edits...`);
    const jobId: number = await this.requestSubmitEdits(simplifiedCruds);

    if (jobId == -1) {
      throw new Error('Error while requesting requestSubmitEdits, no job id');
    }

    let milliSecondsLeftToWait = 20 * 60 * 1000;
    const waitTimeMs = 1000;

    while (milliSecondsLeftToWait > 0) {
      await new Promise((r) => setTimeout(r, waitTimeMs));

      const jobStatus = await firstValueFrom(
        this.vectorLayerService.getSubmitEditsJobStatus(jobId)
      );

      this.logger.debug(
        'Sync job status, ms time left',
        jobStatus,
        milliSecondsLeftToWait
      );

      if (!jobStatus || jobStatus.state == JobStatusState.failed) {
        this.logger.error(`Sync failed`, jobStatus);
        throw new Error(`Sync failed`);
      }

      if (jobStatus.state == JobStatusState.completed) {
        return true;
      }

      milliSecondsLeftToWait -= waitTimeMs;
    }

    throw new Error('Sync timed out');
  }

  async requestDataCheck(boundaryIds: Array<string>): Promise<boolean> {
    const postUrl = `${AppConfigService.conf.api_url}/request_data_check`;
    this.logger.info(
      `Requesting data check ${postUrl} for boundaries [${boundaryIds.join(
        ', '
      )}]`
    );

    const httpData = (await firstValueFrom(
      this.http.post<DefaultQueueResponse>(postUrl, {boundaryIds})
    ))!;
    this.logger.debug(httpData, 'httpData');
    const jobId = httpData.jobId;

    //warn as this is not required, don't want user to see it
    if (!_.isSafeInteger(jobId)) {
      this.logger.warn('Error while requesting requestDataCheck, no job id');
      return false;
    }

    return true;
  }

  async updateObservableAfterCrud(layer: VectorLayerName) {
    /*
        Data flow

        IndexDB is updated in CrudLayerService
        If notify is true, updateObservableAfterCrud
        VectorLayerService.setDataStream

        This method is what notify=true does, it updates the observables
        listening to data changes in the vector indexdb backed observables
         */

    //this.logger.debug(`${LOG_PREFIX} updateObservableAfterCrud ${layer}`);

    const server_version: Array<GeoJsonBase> =
      await this.vectorLayerService._db[layer].toArray();

    const crudActions = await this.vectorLayerService._db.crud_actions
      .where({ changed_layer: layer })
      .toArray();

    this.crudActionsChanged.next(true);
    const withCrudApplied = applyCrudOperations(
      server_version,
      crudActions,
      this.logger
    );

    this.vectorLayerService.setDataStream(
      layer,
      server_version,
      crudActions,
      withCrudApplied
    );
  }

  /**
   * Merge assumes that the latest server data has been fetched
   *
   * Any detectable merge is added as addition CRUD items
   */
  public async mergeAllLayers() {
    const actionId = uuidv4();

    await this.mergeLayer('health_facility__point', actionId);
    await this.mergeLayer('settlement__name', actionId);
    await this.mergeLayer('settlement__part', actionId);
    await this.mergeLayer(BOUNDARY_EDITED_LAYER, actionId);
  }

  /**
   * A helper method for merging cruds together upon sync.
   * This is merging server side changes to the local ones as additional crud changes
   *
   * @param layer
   * @returns
   */
  private async findFirstAndLastCruds(
    layer: VectorLayerName
  ): Promise<[Map<string, CrudAction>, Map<string, CrudAction>]> {
    const crudActions = await this.vectorLayerService._db.crud_actions
      .where({ changed_layer: layer })
      .toArray();

    //1st crud will contain the original server version in the geojson_before field
    const guidToFirstCrud = new Map<string, CrudAction>();

    const guidToLastCrud = new Map<string, CrudAction>();

    //last is most recent
    for (const crudAction of crudActions) {
      guidToLastCrud.set(
        crudAction.geojson_after.properties.global_id,
        crudAction
      );

      //Note there is no version id when the geojson has been created client side
      if (
        isFloat(crudAction.geojson_before.properties.version_id) &&
        !guidToFirstCrud.has(crudAction.geojson_before.properties.global_id)
      ) {
        guidToFirstCrud.set(
          crudAction.geojson_before.properties.global_id,
          crudAction
        );
      }
    }

    return [guidToFirstCrud, guidToLastCrud];
  }

  /*
    This is about finding server side changes to merge to the local ones
    */
  private async findItemsNeedingMerge(
    layer: VectorLayerName,
    guidToFirstCrud: Map<string, CrudAction>,
    guidToLastCrud: Map<string, CrudAction>
  ): Promise<ItemsNeedingMerge> {
    const serverMap = new Map<string, GeoJsonBase>();

    const serverVersion: Array<GeoJsonBase> = await this.vectorLayerService._db[
      layer
    ].toArray();

    const itemsToMerge: Array<ItemsNeedingMergeArrayItem> = [];

    for (const currentServerVersion of serverVersion) {
      serverMap.set(
        currentServerVersion.properties.global_id,
        currentServerVersion
      );

      const lastCrudItem = guidToLastCrud.get(
        currentServerVersion.properties.global_id
      );

      if (!lastCrudItem) {
        continue;
      }

      const firstCrudItem = guidToFirstCrud.get(
        currentServerVersion.properties.global_id
      );

      if (!firstCrudItem) {
        continue;
      }

      if (
        firstCrudItem.geojson_before.properties.version_id! >=
        currentServerVersion.properties.version_id!
      ) {
        continue;
      }

      const serverChanged = getChangedFields(
        firstCrudItem.geojson_before,
        currentServerVersion
      );
      const userChanged = getChangedFields(
        firstCrudItem.geojson_before,
        lastCrudItem.geojson_after
      );

      //Anything changed on the server but not changed locally
      const fieldsToApply = serverChanged.filter((fn) => {
        if (userChanged.includes(fn)) {
          return false;
        }

        // For https://github.com/novelt/GMT/issues/2656 if another user
        // synced something, we'll see differences in calculated fields which we do not care
        // about merging
        if (CALCULATED_FIELDS.has(fn)) {
          return false;
        }

        return true;
      });

      if (fieldsToApply.length <= 0) {
        continue;
      }

      this.logger.debug(
        'Found merge between',
        firstCrudItem.geojson_before,
        currentServerVersion,
        lastCrudItem.geojson_after
      );
      this.logger.debug(
        'Server changed',
        serverChanged,
        'user changed',
        userChanged,
        'fields to apply',
        fieldsToApply
      );

      itemsToMerge.push({
        currentServerVersion,
        fieldsToApply,
        lastCrudItem,
      });
    }

    return {
      itemsToMerge,
      serverMap,
    };
  }

  private async handleMergeDeletions(
    layer: VectorLayerName,
    //Current server version
    serverMap: Map<string, GeoJsonBase>,
    //Old server version
    guidToFirstCrud: Map<string, CrudAction>,
    actionId: string
  ) {
    const origGlobalIdsToRemove = new Set<string>();

    for (const crudAction of guidToFirstCrud.values()) {
      //Care about the 1st crud action, we are looking for ids that are no longer there
      const initialVersion = crudAction.geojson_before;

      if (!serverMap.get(initialVersion.properties.global_id)) {
        this.logger.debug(`Deletion detected ${layer}`, initialVersion);

        //If we deleted a settlement part that is no longer on the server, this means that
        //on the server we either merged or split that settlement, so we delete any settlement part that has
        //that orig fid

        origGlobalIdsToRemove.add(initialVersion.properties.global_id);
      } else {
        this.logger.debug(`ok server version exists ${layer}`, initialVersion);
      }
    }

    for (const currentServerVersion of serverMap.values()) {
      const sp: GeoJsonSettlementPart =
        currentServerVersion as GeoJsonSettlementPart;

      for (const oi of sp.properties.original_guids) {
        if (origGlobalIdsToRemove.has(oi)) {
          this.logger.debug('Going to delete', sp);
          await this.deleteItem(
            layer,
            sp.properties.global_id,
            true,
            false,
            actionId
          );
          break;
        }
      }
    }
  }

  /**
   * Do a 3 way merge between
   * original server version => current server version (just fetched with refresh offline)
   * and
   * original server version => last geo json item (what's on this client)
   *
   * the original server version is stored in the first geo json items "geojson_before" field
   *
   * @param layer
   * @param actionId
   * @private
   */
  private async mergeLayer(layer: VectorLayerName, actionId: string) {
    //this.logger.debug(`${LOG_PREFIX} updateObservableAfterCrud ${layer}`);

    const [guidToFirstCrud, guidToLastCrud] = await this.findFirstAndLastCruds(
      layer
    );

    const { serverMap, itemsToMerge } = await this.findItemsNeedingMerge(
      layer,
      guidToFirstCrud,
      guidToLastCrud
    );

    for (const {
      fieldsToApply,
      lastCrudItem,
      currentServerVersion,
    } of itemsToMerge) {
      this.logger.debug('Fields to Apply', fieldsToApply);

      //Copy the fields
      const mergeResult = cloneDeep(lastCrudItem.geojson_after);

      for (const fieldName of fieldsToApply) {
        if (fieldName == 'geometry') {
          mergeResult.geometry = currentServerVersion.geometry;
        } else {
          //copy the property value over
          //without the typescript stuff this is just
          //mergeResult.properties[fieldName] = currentServerVersion.properties[fieldName];
          (
            mergeResult.properties as {
              [key: string]: string | number | unknown;
            }
          )[fieldName] =
            currentServerVersion.properties[
              fieldName as keyof GeoJsonBase['properties']
            ];
        }
      }

      //Save the merge result as a new crud action
      await this.updateItem(layer, mergeResult, true, false, actionId);
    }

    //Detect deletions, this only matters with settlement parts
    //because they are the only things that can be deleted by the UI during a split/merge

    //TODO health facilities can also be deleted, handle this too

    if (layer != 'settlement__part') {
      return;
    }

    //Avoid deleting settlement part area

    //await this.handleMergeDeletions(layer, serverMap, guidToFirstCrud, actionId);
  }

  getUndoEventObservable(): Subject<UndoRedoEvent> {
    return this.undoEvent;
  }

  getRedoEventObservable(): Subject<UndoRedoEvent> {
    return this.redoEvent;
  }

  async getIndexDBStore(
    storename: VectorLayerName,
    applyCrudOp: boolean = false
  ): Promise<Array<GeoJsonBase>> {
    let indexDbData: Array<GeoJsonBase> = await this.vectorLayerService._db[
      storename as VectorLayerName
    ].toArray();

    if (applyCrudOp) {
      const currentCrudActions = await this.vectorLayerService._db.crud_actions
        .where({ changed_layer: storename })
        .toArray();
      indexDbData = applyCrudOperations(
        indexDbData,
        currentCrudActions,
        this.logger
      );
    }

    return indexDbData;
  }

  showSuccessToast(): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Edits successfully saved',
      key: 'small',
      life: 2000,
    });
  }

  /**
   * Returns simple crud actions count - no checking for uniqueness or what will
   * be actually synced with the server
   */
  async countCrudActions(): Promise<number> {
    const simplifiedCruds = await this.getSimplifiedCruds();
    return simplifiedCruds.length;
  }

  isSyncButtonEnabled(): Observable<boolean> {
    // and 2 reasons why we would need to sync
    //1 is we have crud actions to submit
    //2 is we have stale offline data
    return this.vectorLayerService._needSync.asObservable();
  }

  async checkIfNeedsSync(): Promise<void> {
    const simplifiedCrudsCount = await this.countCrudActions();
    this.vectorLayerService._needSync.next(simplifiedCrudsCount > 0);
  }

  public async removeHistory(): Promise<void> {
    await this.vectorLayerService._db.crud_actions_history.clear();
    await this.vectorLayerService._db.crud_actions_history_position.clear();
    await this.vectorLayerService._db.crud_actions_redo.clear();
  }

  private setCommonFields(json: GeoJsonBase) {
    json.properties.user_id = this.authService.getUserId();
    json.properties.user_name = this.authService.getUserName();
    json.properties.modified_date = new Date().toISOString();
    json.properties.version_id = null;
    json.properties.to_delete = false;
  }

  private async getLastActionId(): Promise<string | undefined> {
    let currentHistoryPosition = await this.getCurrentHistoryPosition();
    return this.vectorLayerService._db.crud_actions_history.get(
      currentHistoryPosition
    );
  }

  private async getCrudHistoryLength(): Promise<number> {
    return this.vectorLayerService._db.crud_actions_history.count();
  }

  private async removeActionIdsForRedo(currentPosition: number): Promise<void> {
    this.vectorLayerService._db.crud_actions_history
      .where(':id')
      .above(currentPosition)
      .delete();
    await this.vectorLayerService._db.crud_actions_redo.toCollection().delete();
  }

  private async getCurrentHistoryPosition(): Promise<number> {
    let currentPosition =
      await this.vectorLayerService._db.crud_actions_history_position
        .toCollection()
        .last();
    return currentPosition !== undefined ? currentPosition : -1;
  }

  private async updateCurrentHistoryPosition(
    currentPosition: number
  ): Promise<void> {
    await this.vectorLayerService._db.crud_actions_history_position.put(
      currentPosition,
      0
    );
    await this.updateUndoRedoStatus();
  }

  private async saveToHistory(actionId: string): Promise<void> {
    /*
        If actionId is not the last one then save it to history
         */
    let currentPosition = await this.getCurrentHistoryPosition();
    let lastActionId =
      await this.vectorLayerService._db.crud_actions_history.get(
        currentPosition
      );
    const shouldSaveHistory = await this.actionShouldBeSavedToHistory(actionId);
    if (lastActionId !== actionId && shouldSaveHistory) {
      // remove any cruds that were left for redo so that the history would not branch out
      await this.removeActionIdsForRedo(currentPosition);
      await this.vectorLayerService._db.crud_actions_history.put(
        actionId,
        currentPosition + 1
      );
      await this.updateCurrentHistoryPosition(currentPosition + 1);
    }
  }

  private async actionShouldBeSavedToHistory(
    actionId: string
  ): Promise<boolean> {
    const actionCruds = this.vectorLayerService._db.crud_actions.where({
      actionId: actionId,
    });
    const actionCrudsArray = await actionCruds.toArray();
    let shouldBeSaved = true;
    actionCrudsArray.forEach((crud) => {
      if (crud.geojson_after) {
        // undo/redo only for merge and split settlements - does not work because if hf includes st that was merged,
        // this would still return true - which is good but then it is very confusing and still could have the same
        // issues with exclusions
        // if(crud.geojson_after.properties.hasOwnProperty('split_type') && [SPLIT_BY_HAND, MERGED_BY_HAND].includes((crud.geojson_after.properties as GeoJsonSettlementPartProperties).split_type)){
        //   shouldBeSaved = true;
        // }
        if (
          crud.geojson_after.properties.hasOwnProperty('type') &&
          ['include', 'exclude'].includes(
            (crud.geojson_after.properties as GeoJsonCatchmentProperties).type
          )
        ) {
          shouldBeSaved = false;
        }
      }
    });
    return shouldBeSaved;
  }

  private async updateUndoRedoStatus() {
    this.undoActionIsPossible.next(await this.isUndoActionIsPossible());
    this.redoActionIsPossible.next(await this.isRedoActionIsPossible());
  }

  /**
   * Removes any crud action that is not in the offline boundaries, nor their surrounding areas
   */
  async removeCrudActionsOutsideSurroundingAreas(boundaryId: string) {
    const offlineBoundariesSet =
      await this.vectorLayerService.getOfflineBoundaryIdSet(true);
    const globalIdsToRemove = new Set<string>();

    const caActions = await this.vectorLayerService._db.crud_actions.toArray();
    //after removing a boundary offline data, we need to remove any crud actions
    //that no longer apply
    for (const ca of caActions) {
      if (
        !offlineBoundariesSet.has(ca.geojson_after.properties.boundary_polygon)
      ) {
        globalIdsToRemove.add(ca.geojson_after.properties.global_id);
      } else if (ca.geojson_after.properties.boundary_polygon == boundaryId) {
        // remove all cruds that are created for this particular boundary (this is needed if we had offline 2 adjacent wards)
        // note, this will leave ri_catchments that are in surrounding boundaries as they could be found only with actionId
        // but as Eric told that they are recalculated on checkout, it should be fine
        globalIdsToRemove.add(ca.geojson_after.properties.global_id);
      }
    }
    // not deleting by boundary because it is not indexed and indexing costs storage
    //We could do the redo items too, but if they redo, then remove a boundary, those will get cleaned too
    await this.vectorLayerService._db.crud_actions
      .where('geojson_after.properties.global_id')
      .anyOf(Array.from(globalIdsToRemove))
      .delete();
  }

  /**
   * Get simplified cruds (removed cases like create->delete) or multiple edits
   *
   * Note this can include actions that affect boundaries not explicitly taken offline
   * but rather in the surrounding region
   * @private
   */
  async getSimplifiedCruds(): Promise<Array<CrudAction>> {
    /*
        Note that what we want is the latest CRUD action for any particular global_id

        We don't ignore previous action_ids, for example

        Action ID 1 creates Settlement name 123 and settlement part 456
        Action ID 2 modifies settlement part 456

        We still want some of action ID 1, namely settlement name 123
         */

    let crudActionList =
      await this.vectorLayerService._db.crud_actions.toArray();

    //We assume that crud actions are done in insertion order, 1st is oldest
    crudActionList.reverse();

    //Because we can change the boundary_polygon attribute, we need to use the boundary_polygon + global_id as the unique
    //id
    const seenGuids = new Set<string>();
    const onlyLatest: Array<CrudAction> = [];

    //because the list is sorted (most recent first), we delete any dup
    //on a global_id level, not action_id
    for (const crudAction of crudActionList) {
      //Any pure client side generation we ignore
      if (crudAction.isCatchmentCalculation) {
        continue;
      }

      const boundaryPlusGlobalId =
        crudAction.geojson_after.properties.boundary_polygon +
        crudAction.geojson_after.properties.global_id;

      if (seenGuids.has(boundaryPlusGlobalId)) {
        continue;
      }

      seenGuids.add(boundaryPlusGlobalId);

      if (crudAction.changed_layer == 'ri__catchment_item') {
        const isGenerated =
          (crudAction.geojson_after as GeoJsonCatchmentItem).properties.type ==
          'generated';

        //Anything that is generated will be recalculated, so we don't sync them
        if (isGenerated) {
          continue;
        }
      }

      //Another case, only allow deletes that are removing an actual server item, we can tell if
      //It has a version_id
      if (
        crudAction.action == 'delete' &&
        !_.isSafeInteger(crudAction.geojson_before.properties.version_id)
      ) {
        continue;
      }

      onlyLatest.push(crudAction);
    }

    return onlyLatest;
  }
}
