export enum JobStatusState {
  completed = "completed",
  failed = "failed",
  active = "active",
  waiting = "waiting",
  delayed = "delayed",
  paused = "paused"
}

export interface JobStatusResponse  {
    state: JobStatusState;
    progress: number;
}
