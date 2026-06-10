import { Injectable } from "@angular/core";
import { INGXLoggerConfig, INGXLoggerMetadata, NGXLoggerWriterService } from "ngx-logger";
import { LogsDatabase } from "./logs-database";
import { stringify } from 'flatted';

@Injectable()
export class WriterCustomisedService extends NGXLoggerWriterService {
    public _db: LogsDatabase;

    constructor() {
        let platformId = '';
        super(platformId);
        this._db = new LogsDatabase();
    }

    /** Write the content sent to the log function to the IndexedDB */
    public override writeMessage(metadata: INGXLoggerMetadata, config: INGXLoggerConfig): void {
        if (metadata.additional) {
            // this.saveMessageToIndexedDB(JSON.stringify({0:metadata.message, 1:metadata.additional}));
            this.saveMessageToIndexedDB(stringify({ 0: metadata.message, 1: metadata.additional }));
        } else {
            this.saveMessageToIndexedDB(metadata.message);
        }

        const metaString = this.prepareMetaString(metadata, config);
        this.logFunc(metadata, config, metaString);
    }

    private async saveMessageToIndexedDB(message: any) {
        this._db.logs.add(message);
    }
}
