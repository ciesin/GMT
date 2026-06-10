import {Injectable} from '@angular/core';
import Dexie from "dexie";
import { interval } from 'rxjs';
import {saveAs} from 'file-saver';
import {saveFileName} from "src/app/utils/export/pdf";

@Injectable({
  providedIn: 'root'
})
export class LogsDatabase extends Dexie {
  logs!: Dexie.Table<string, number>;
  private maxLogsRows = 500;

  constructor() {
    super("LogsDatabase");
    console.log("Constructing LogsDatabase");
    const store_schema = {}
    store_schema["logs"] = "++"
    this.version(1).stores(store_schema);

    this.logs = this.table("logs");
    console.log("Finished Constructing LogsDatabase");
    const source = interval(5 * 60 * 1000); // each 5 minutes 5 * 60 * 1000
    source.subscribe(_ => this.rotateLogs());
  }

  /**
   * Each 1h rotate the logs if user has too many of them
   * @private
   */
  private async rotateLogs(){
    const logsCount = await this.logs.count();
    if(logsCount > this.maxLogsRows){
      this.logs
        .reverse()
        .offset(this.maxLogsRows)
        .limit(1)
        .primaryKeys()
        .then((results: number[]) => {
            if(results.length > 0){
              this.logs
                .where(":id")
                .below(results[0])
                .delete();
            }
        });
    }
  }

  /**
   * Backup IndexedDB to binary file that could be restored
   */
  async backupIndexedDb(): Promise<{filename: string, blob: Blob}> {
    console.debug("Backing up logs indexedDB"); // console.log to not edit existing logs
    const logs = await this.logs.toArray();
    const logsStr = logs.join('\n');
    const logsBlob = new Blob([logsStr], {type: 'text/csv'});
    // const logsBlob = await exportDB(this); Commented out because we want txt or csv file that is more readable
    const filename = `${(new Date(Date.now())).toISOString()}_logs_data.csv`;
    saveAs(logsBlob, saveFileName(filename));
    console.debug("Logs indexedDB backup is created"); // console.log to not edit existing logs
    return {filename: filename, blob: logsBlob};
  }
}
