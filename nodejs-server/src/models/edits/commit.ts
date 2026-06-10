import { PoolClient } from "pg";
import escape from "pg-escape";

export async function saveNewCommit(client: PoolClient,
                                    userName: string,
                                    comment: string) {
    userName = escape.literal(userName);
    comment = escape.literal(comment);
    const queryResult = await client.query(`insert into master.commits (publish_user, comment)
                                            values (${userName}, ${comment}) RETURNING id;`);
    return queryResult.rows[0].id;
}