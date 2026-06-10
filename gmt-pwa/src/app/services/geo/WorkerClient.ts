import {
  SettlementProblems,
  SettlementProblemArgs, SettlementProblemSingleArgs,
  TravelTimeBetweenPointsArgs,
  WorkerFunction,
  WorkerRequest,
  WorkerResponse,
} from "./WorkerInterface";
import {Observable, Subscriber} from "rxjs";
import {CancelableState} from "../interfaces/cancelable-state.interface";

const worker = new Worker(new URL('./geo-worker.worker', import.meta.url));

const LOG_PREFIX = "WorkerClient: ";

//Main purpose of this is to convert a worker call into a promise
class WorkerClient {
  private index: number = -1;
  private resolveFuncs: { [key: number]: any } = {};
  private rejectFuncs: { [key: number]: any } = {};

  private postWorkerRequestAsPromise(func: WorkerFunction, data: any): Promise<any> {
    //console.log(`Calling worker function ${func}`, data);
    const index = this.getNextIndex();
    const workerRequest: WorkerRequest = {
      index,
      data,
      func
    }

    worker.postMessage(workerRequest);

    const promise = new Promise<any>((resolve, reject) => {
      // the resolve / reject functions control the fate of the promise
      this.resolveFuncs[index] = resolve;
      this.rejectFuncs[index] = reject;
    });

    return promise;
  }



  //Returns time in seconds
  travelTimeBetweenPoints(args: TravelTimeBetweenPointsArgs): Promise<number> {
    return this.postWorkerRequestAsPromise(WorkerFunction.TRAVEL_TIME_SINGLE_POINT, args);
  }


  getSettlementProblems(args: SettlementProblemArgs): Observable<SettlementProblems> {
    return new Observable<SettlementProblems>((observer) => {

      //use an object so the async helper can be notified of a cancellation
      const state: CancelableState = {isSubscribed: true};

      //This will potentially live beyond the unsubscribe
      this.getSettlementProblemsHelper(args, observer, state).then(() => {
        //console.log(`${LOG_PREFIX} promise done from settlement problems`);

      });

      return {
        unsubscribe() {
          //console.log(`${LOG_PREFIX} unsubscribe from settlement problems`);
          state.isSubscribed = false;
        }
      };
    });
  }

  private async getSettlementProblemsHelper(args: SettlementProblemArgs,
                                            observer: Subscriber<SettlementProblems>,
                                            state: CancelableState) {

    args.cacheKey = this.index;
    await this.postWorkerRequestAsPromise(WorkerFunction.INIT_SETTLEMENTS_PROBLEMS, args);

    for (const sn of args.settlementNames) {

      if (!state.isSubscribed) {
        console.log(`${LOG_PREFIX} quitting early, since no longer subscribed`);
        break;
      }
      //console.log(`${LOG_PREFIX} requesting for ${sn.properties.name}`);

      const singleArgs: SettlementProblemSingleArgs = {
        cacheKey: args.cacheKey,
        settlementNameId: sn.properties.global_id,
        settlementPartId: sn.properties.settlement_part!,
      };
      const settlementNameProblems = await this.postWorkerRequestAsPromise(args.problemType, singleArgs);
      observer.next(settlementNameProblems);
      if (args.earlyStop && settlementNameProblems.problems.length > 0) {
        console.log(`${LOG_PREFIX} early stop, since we found a problem`);
        break;
      }
    }

    //console.log(`${LOG_PREFIX} cleanup`);
    await this.postWorkerRequestAsPromise(WorkerFunction.CLEANUP_SETTLEMENTS_PROBLEMS, args.cacheKey);

    observer.complete();
  }

  public handleMessage(message: MessageEvent) {
    const response: WorkerResponse = message.data;
    const index = response.index;
    //console.log("Recieved web worker response", response);
    this.resolveFuncs[index](response.data);

    delete this.rejectFuncs[index];
    delete this.resolveFuncs[index];
  }

  private getNextIndex(): number {
    this.index += 1;
    return this.index;
  }
}

worker.onmessage = (messageEvent) => {
  WORKER_CLIENT.handleMessage(messageEvent);
};

export const WORKER_CLIENT = new WorkerClient();
