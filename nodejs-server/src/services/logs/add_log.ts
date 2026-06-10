import {pool} from "../../db-read/common";
import {Job} from "bull";

export async function logAndPrint(job: Job, message: string) : Promise<void> {
    console.log(message);
    await job.log(message);
}

export async function createLogTableIfNeeded(): Promise<void> {
    try {
        console.log(`Creating log table if needed`);

        //use a prepared statement, https://node-postgres.com/features/queries
        const query = {
            text: `CREATE TABLE IF NOT EXISTS master.logs
        (
            id serial PRIMARY KEY,
            user_name text NOT NULL,
            message text NOT NULL,
            payload jsonb NOT NULL,
            timestamp timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            githash text NULL,
            app_version text NULL
        )`,
            values: [],
            name: "createLogTableIfNeeded"
        };
        
        await pool.query(query);

        // Conditionally add 'githash' column if it doesn't exist
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'master' AND table_name = 'logs' AND column_name = 'githash'
                ) THEN
                    ALTER TABLE master.logs ADD COLUMN githash text;
                END IF;
            END
            $$;
        `);

        // Conditionally add 'app_version' column if it doesn't exist
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'master' AND table_name = 'logs' AND column_name = 'app_version'
                ) THEN
                    ALTER TABLE master.logs ADD COLUMN app_version text;
                END IF;
            END
            $$;
        `);

    } catch (e) {
        throw e;
    }
}

export async function addLogMessage(message: string, userName: string, payload: object, appVersion: string, gitHash: string): Promise<void> {

    try {
        console.log(`Adding log message to database`);
        const payloadStr = JSON.stringify(payload);
        console.log(`Payload`, payloadStr);

        let sql = `INSERT INTO master.logs
        (
            user_name,
            message,
            payload,
            app_version,
            githash
        ) VALUES ($1, $2, $3, $4, $5)`;

        await pool.query(sql, [userName, message, payloadStr, appVersion || '', gitHash || '']);

    } catch (e) {
        throw e;
    }
}
