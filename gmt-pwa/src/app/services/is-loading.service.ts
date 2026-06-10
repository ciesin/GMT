import { Injectable } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, Subject } from 'rxjs';

export interface ProgressBarInfo {
  showProgressBar: boolean;
  progressPercentage: number;
  //null to keep existing text
  progressBarText: string | null;
  // 1 is lowest 10 is highest - this helps to override default small tasks overrides with longer progressbar
  // like printing multiple boundary pdfs
  priority: number;
}

@Injectable({
  providedIn: 'root',
})
export class IsLoadingService {
  private _mapLoading: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  public loading: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );

  public progressInfo: Subject<ProgressBarInfo> =
    new Subject<ProgressBarInfo>();
  public visualizedProgressBarPriority: number = 0;

  constructor(private logger: NGXLogger) {}

  isLoading(): boolean {
    return this.loading.value;
  }

  /**
   * Show if global loading is false to not overlap spinners
   */
  isMapLoading(): boolean {
    return this._mapLoading.value && !this.isLoading();
  }

  setLoading(isLoading: boolean) {
    this.loading.next(isLoading);
    if (!isLoading) {
      this.setProgressBarInfo(null, 100, false);
    }
    this.logger.info('this.isLoading :' + this.isLoading());
  }

  setProgressBarInfo(
    progressBarText: string | null,
    progressPercentage: number,
    showProgressBar: boolean,
    priority: number = 1
  ) {
    // do not push new data for the visualization if previous data have higher priority and was not finished
    if (this.visualizedProgressBarPriority <= priority) {
      this.progressInfo.next({
        progressBarText,
        progressPercentage,
        showProgressBar,
        priority,
      });
      //once progress bar is finished loading reset the visualizedProgressBarPriority
      if (!showProgressBar || progressPercentage == 100) {
        this.visualizedProgressBarPriority = 0;
      } else {
        this.visualizedProgressBarPriority = priority;
      }
    }
  }

  setMapLoading(isLoading: boolean) {
    this._mapLoading.next(isLoading);
    this.logger.info('this.mapLoading :' + this.isMapLoading());
  }
}
