import Router from "koa-router";
import {Context, DefaultState} from "koa";
import {handle_get_latest_version} from "../db-read/get_latest_version";
import {handle_get_surrounding_boundaries} from "../db-read/get_surrounding_boundaries";
import {handle_get_current_version_id, is_online} from "../db-read/get_current_version";
import {handle_get_boundaries} from "../db-read/get_boundaries";
import {handle_get_hierarchy_list} from "../db-read/get_hierarchy_list";
import {setUserInfoAndPermissions, userIsAuthenticated} from "../utils/auth/permissions.util";
import {handle_read_friction_raster, handle_read_pop_raster} from "../raster-read/handle_read_raster";
import {handleGetUserInfo} from "../api/user/profile";
import {handleGetDbEnumIndexes} from "../db-read/get_db_enum_indexes";
import {Pool} from "pg";
import MBTiles from '@mapwhit/mbtiles';
import fs from "fs";

const router = new Router<DefaultState, Context>();

router.post("/get_latest_version", userIsAuthenticated, handle_get_latest_version);
router.get("/get_surrounding_boundaries", userIsAuthenticated, handle_get_surrounding_boundaries);
router.get("/get_current_version_id", userIsAuthenticated, handle_get_current_version_id);

router.get("/get_boundaries", userIsAuthenticated, handle_get_boundaries);
router.get("/get_hierarchy_list", userIsAuthenticated, handle_get_hierarchy_list);


router.get("/read_pop_raster", userIsAuthenticated, handle_read_pop_raster);
router.get("/read_friction_raster", userIsAuthenticated, handle_read_friction_raster);



//For the tests we need a protected get that takes no params and doesn't access the database
//This API could also be used to check the user is authenticated
router.get("/is_user_online", userIsAuthenticated, is_online);
// router.post("/submit_edits", handleSubmitEdits);


// User related endpoints
//'realm:gmt-editor'
router.get("/get_user_info", userIsAuthenticated, handleGetUserInfo);
router.get("/me", userIsAuthenticated, async (ctx: Context, next) => {
    await setUserInfoAndPermissions(ctx);
    ctx.body = {
        permissions: ctx.user_permissions,
        geo_permissions: ctx.user_geo_permissions,
        hierarchical_geo_permissions: ctx.user_hierarchical_geo_permissions
    };
    next();
});

let mbtiles;
router.get("/mbtile/:z/:x/:y", userIsAuthenticated, async (ctx: Context, next) => {
    if (!mbtiles) {
        //get this file from D:\Dropbox (Novel-T Sarl)\Novel-T Projects\CIESIN - NGA - GMT\01 - Inputs\010 - Business\011 - Data\Basemap
        if (fs.existsSync("./nigeria.mbtiles")) {
            mbtiles = new MBTiles('./nigeria.mbtiles');
        }
        if (fs.existsSync("/data/nigeria.mbtiles")) {
            mbtiles = new MBTiles('/data/nigeria.mbtiles');
        }
        // Output available at gmt-pwa/src/app/routine-immu/page-microplan-boundary/nigeria.mbtiles.info.ts
        // console.log("mbtiles info :",mbtiles.getInfo());
    }
    const {z, x, y} = ctx.params;
    // console.log("z:",z, ", x:",x,", y:", y)
    const {error, tile, headers} = mbtiles.getTile(z, x, y);

    if (error) {
        console.error("mbtile error :", error)
    } else{
        // console.log("headers :",headers)
        if (headers)
            Object.keys(headers).forEach(key =>  ctx.set(key,headers[key]));
        ctx.body = tile
    }
    next();
});


//The public ones
router.get("/is_online", is_online);
router.get("/db_enum_indexes", handleGetDbEnumIndexes);

// Test DB
router.get("/test_db", async (ctx: Context, next) => {
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PWD, // Password is empty be default
        port: parseInt(process.env.DB_PORT), // Default port
    });
    const {rows} = await pool.query('SELECT * from public.test_ci_cd');
    ctx.body = {row_0: rows[0]};
    next();
});



export default router;