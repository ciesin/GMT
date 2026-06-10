import escape from "pg-escape";
const {Pool} = require('pg');

export const EXTENT_PADDING_METERS = 3000;

export const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PWD,
        port: process.env.DB_PORT,
    });

export async function getPartitionId(client, boundaryGuid: string) : Promise<number | null> {
  const boundaryIdRows = await client.query(`select id
    from partitions.boundary_id
    where global_id = ${escape.literal(boundaryGuid)}`);
  if (boundaryIdRows.rows.length < 1) {
    return null;
  }
  const boundaryId = boundaryIdRows.rows[0].id;
  return boundaryId;
}