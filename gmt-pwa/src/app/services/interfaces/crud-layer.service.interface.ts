import { VectorLayerName } from "../../utils/server-interfaces/VectorLayerName";
import { GeoJsonBase } from "../../utils/server-interfaces/GeoJson";
import { CrudAction } from "../../utils/server-interfaces/CrudAction";
import { BehaviorSubject, Observable } from "rxjs";
import { LayerData } from "../vector_layer/vector-layers.service";

export interface UndoRedoEvent {
    lastActionId: string,
    //updatedStIds?: string[],
    updatedHfIds: string[],
}
export interface CrudLayerServiceInterface {
    //Gets a new value of true every time the crud actions change
    crudActionsChanged: BehaviorSubject<boolean>;

    getCrudActions(): Promise<Array<CrudAction>>;

    createItem(layer: VectorLayerName, itemToAdd: GeoJsonBase, notify?: boolean, showToast?: boolean, actionId?: string | null): Promise<boolean>;

    updateItem(layer: VectorLayerName, updatedItem: GeoJsonBase, notify?: boolean, showToast?: boolean, actionId?: string | null): Promise<boolean>;

    deleteItem(layer: VectorLayerName, global_id: string, notify?: boolean, showToast?: boolean, actionId?: string | null): Promise<boolean>;

    clearEdits(): void;

    undoActionIsPossibleObservable(): Observable<boolean>;

    redoActionIsPossibleObservable(): Observable<boolean>;

    isUndoActionIsPossible(): Promise<boolean>;

    isRedoActionIsPossible(): Promise<boolean>;

    undoLastAction(): Promise<UndoRedoEvent | null>;

    redoLastAction(): Promise<UndoRedoEvent | null>;

    submitEdits(simplifiedCruds: Array<CrudAction>): Promise<boolean>;

    updateObservableAfterCrud(layer: VectorLayerName): void

    getIndexDBStore(storename: VectorLayerName, applyCrudOp?: boolean): Promise<Array<GeoJsonBase>>;

    showSuccessToast(): void;

    /**
     * Returns simple crud actions count - no checking for uniqueness or what will
     * be actually synced with the server
     */
    countCrudActions(): Promise<number>;

    isSyncButtonEnabled(): Observable<boolean>;

    checkIfNeedsSync(): Promise<void>;

    removeHistory(): Promise<void>;
}
