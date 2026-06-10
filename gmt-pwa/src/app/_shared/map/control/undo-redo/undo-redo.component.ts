import { Component, OnDestroy, OnInit } from '@angular/core';
import { callBlockingUiUntilDone } from '@components/wizard/wizard-location-control/helper-methods';
import { BoundaryVectorLayersService } from '@services/boundary-vector-layers.service';
import { IsLoadingService } from '@services/is-loading.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { NGXLogger } from 'ngx-logger';
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';

@Component({
  selector: 'undo-redo',
  templateUrl: './undo-redo.component.html',
  styleUrls: ['./undo-redo.component.less'],
  providers: [],
  standalone: false
})
export class UndoRedoComponent implements OnInit, OnDestroy {
  public undoActionIsPossible: boolean = false;
  public redoActionIsPossible: boolean = false;
  public undoTooltipText: string = 'No more actions could be undone';
  public redoTooltipText: string = 'No more actions could be re-done';

  private unsubscribe = new Subject();

  constructor(
    public crudLayerService: CrudLayerService,
    public microplanMapEvents: MicroplanMapEventsService,
    public isLoadingService: IsLoadingService,
    private bvService: BoundaryVectorLayersService,
    private userContextService: UserContextService,
    private logger: NGXLogger,
    private userActionLogService: UserActionLogService
  ) {}

  async ngOnInit() {
    this.crudLayerService
      .undoActionIsPossibleObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((undoActionIsPossible) => {
        this.undoActionIsPossible = undoActionIsPossible;
        if (this.undoActionIsPossible) {
          this.undoTooltipText = 'Undo action';
        } else {
          this.undoTooltipText = 'No more actions could be undone';
        }
      });
    this.crudLayerService
      .redoActionIsPossibleObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((redoActionIsPossible) => {
        this.redoActionIsPossible = redoActionIsPossible;
        if (this.redoActionIsPossible) {
          this.redoTooltipText = 'Redo action';
        } else {
          this.redoTooltipText = 'No more actions could be re-done';
        }
      });

    this.userContextService
      .getCurrentBoundaryObservable()
      .pipe(
        filter((boundary) => !!boundary),
        switchMap((boundary) => {
          this.logger.info('Microplan Add Wizard List Boundary id', boundary);
          return this.bvService.ensureBoundaryLoaded(boundary!.boundaryId);
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(() => {
        //do nothing
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  async undoLastAction() {
    await callBlockingUiUntilDone(this, async () => {
      this.userActionLogService.addUserActionDescription('Undo clicked');

      const undoRedoEvent = await this.crudLayerService.undoLastAction();
      await this.bvService.recalculateCatchmentForUndoRedo(undoRedoEvent!);
      return true;
    });
  }

  async redoLastAction() {
    await callBlockingUiUntilDone(this, async () => {
      this.userActionLogService.addUserActionDescription('Redo clicked');

      const undoRedoEvent = await this.crudLayerService.redoLastAction();
      await this.bvService.recalculateCatchmentForUndoRedo(undoRedoEvent!);
      return true;
    });
  }
}
