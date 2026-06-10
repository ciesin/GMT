import {pool} from "./common";

export async function get_current_version_id() : Promise<number> {

    const {rows} = await pool.query(`
        SELECT MAX(id) as max_id FROM master.commits
    `);

    //console.log("Current version rows", rows);

    return Number.parseInt(rows[0].max_id);
}

export async function handle_get_current_version_id(ctx, next)  {

    ctx.body = await get_current_version_id();

    return await next();
}

export async function is_online(ctx, next)  {

    ctx.body = true;

    return await next();
}