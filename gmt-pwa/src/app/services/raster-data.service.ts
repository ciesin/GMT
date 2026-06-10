import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { exportDB, importInto } from "dexie-export-import";
import { AppConfigService } from "../utils/app-config.service";
import { GeoJsonBase, GeoJsonBoundary, GeoJsonSettlementPart } from "../utils/server-interfaces/GeoJson";
import { bbox, toMercator } from "@turf/turf";
import {
    buildRasterStatsFromTiff,
    OriginResolutionData,
    RasterDatabase,
} from "./vector_layer/RasterDatabase";
import { fromSpOrHf, SettlementPartRasterInfo } from "./geo/RasterStats";
import { roundPosition } from "../utils/coords";
import { topDownGenerator } from "./geo/RasterIterators";
import { computePopSquareValue } from "./geo/ZonalStats";
import { LRUMap } from 'lru_map';
import { NGXLogger } from 'ngx-logger';
import { firstValueFrom } from 'rxjs';
import _ from "lodash";

declare global {
    const GeoTIFF: any;
}

//10 km increase in the boundary extent
//If this is changed in prod, must clean all offline rasters
export const RASTER_BUFFER_DISTANCE = 10000;

//const LOG_PREFIX = "RasterDataService -- "

@Injectable({
    providedIn: 'root'
})
export class RasterDataService {

    private readonly _db: RasterDatabase;

    //The limit is chosen to always be larger than the total # of surrounding boundaries
    private readonly _lruCache = new LRUMap<string, OriginResolutionData>(100);

    constructor(private http: HttpClient,
        private logger: NGXLogger) {
        this._db = new RasterDatabase();

    }

    // async bulkFetchRasters(boundaryIds: Array<string>) : Promise<Array<OriginResolutionData>> {
    //   return this._db.pop.bulkGet(boundaryIds) as Promise<Array<OriginResolutionData>>;
    // }

    clearLruCache() {
        this._lruCache.clear();
    }

    /*
    This pop raster will be just the extent of the given boundary
  
    If the user is not online, this will fail but that would be expected
  
    Normally at boundary checkout, all rasters will be fetched
     */
    async fetchPopRasterIfNeeded(boundary: GeoJsonBoundary): Promise<OriginResolutionData> {

        //this.logger.info("Checking indexdb");

        const existingCacheItem = this._lruCache.get(boundary.properties.global_id);
        if (existingCacheItem) {
            //this.logger.debug(`Raster LRU cache hit for ${boundary.properties.global_id}`);
            return existingCacheItem;
        }

        const existingItem = await this._db.pop.get(boundary.properties.global_id);

        if (existingItem) {

            if (_.isSafeInteger(existingItem.data.width) && _.isSafeInteger(existingItem.data.height)) {
                //Since we clean on remove offline data, we can assume that our rasters are good, and the right version
                //Boundary changes are rare too
                this.logger.debug(`Raster LRU cache miss for ${boundary.properties.global_id}, in index db`);
                this._lruCache.set(boundary.properties.global_id, existingItem);
                return existingItem;
            } else {
                this.logger.warn(`Raster width/height info missing for ${boundary.properties.global_id} so re-fetching`);
            }
            //check we have a raster in 4326 and the right version
            // if (existingItem.resolution[0] > 0.1) {
            //   this.logger.info(`Version in indexdb of boundary ${boundary.properties.global_id} appears to be in 3857.  ${existingItem.version} vs ${boundary.properties.version_id}`);
            // } else if (existingItem.version == boundary.properties.version_id) {
            //   return existingItem;
            // } else {
            //   this.logger.info(`Version in indexdb of boundary ${boundary.properties.global_id} is out of date.  ${existingItem.version} vs ${boundary.properties.version_id}`);
            //   //the put will overright it
            // }
        }

        this.logger.debug(`Raster server side fetch http for ${boundary.properties.global_id}`);

        //Make sure the cache doesn't get too large
        await this._db.enforceRasterSize();

        //minX, minY, maxX, maxY
        const extent4326 = bbox(boundary.geometry);

        const bufferDegrees = 0.001;

        let params = new HttpParams()
            .set("min_x", extent4326[0] - bufferDegrees)
            .set("min_y", extent4326[1] - bufferDegrees)
            .set("max_x", extent4326[2] + bufferDegrees)
            .set("max_y", extent4326[3] + bufferDegrees);

        if (boundary.properties["is_gva"]) {
            params = params.set("is_gva", true)
        }
        this.logger.info(`${AppConfigService.conf.api_url}/read_pop_raster`, { params, responseType: "arraybuffer" });
        const response = await firstValueFrom(this.http.get(`${AppConfigService.conf.api_url}/read_pop_raster`,
            {
                params,
                responseType: "arraybuffer",
            }));
        //this.logger.info("Raster Response", response);

        const tiff = await GeoTIFF.fromArrayBuffer(response);
        //const rd = await readRasterData(tiff);
        //this.logger.info("Tiff read");
        //this.logger.info(tiff)

        const data = await readRasterData(tiff, boundary.properties.global_id, boundary.properties.version_id!);

        //this.logger.info(`@@@ Fetched raster length for boundary ${boundary.properties.name}: ${data.data[0].length.toLocaleString()}`);

        await this._db.pop.put(data);

        return data;
    }

    // async removeRastersForBoundary(boundaryGuid: string) {

    //   const frictionWalkingKey = this._db.getTravelTimeKey(boundaryGuid, true);
    //   const frictionMixedKey = this._db.getTravelTimeKey(boundaryGuid, false);

    //   await this._db.friction.delete(frictionMixedKey);
    //   await this._db.friction.delete(frictionWalkingKey);

    //   await this._db.pop.delete(boundaryGuid);
    // }

    async keepOnly(offlineBoundariesSet: Set<string>) {
        const keys = await this._db.pop.toCollection().primaryKeys();

        const keysToDelete = keys.filter(boundaryId => !offlineBoundariesSet.has(boundaryId));

        await this._db.pop.bulkDelete(keysToDelete);

        //Note when friction rasters are added, need to remove those too

        this.clearLruCache();
    }

    async fetchFrictionRasterIfNeeded(boundary: GeoJsonBoundary, isWalking: boolean): Promise<OriginResolutionData> {

        //this.logger.info("Checking indexdb");

        const frictionRasterKey = this._db.getTravelTimeKey(boundary.properties.global_id, isWalking)

        const existingItem = await this._db.friction.get(frictionRasterKey);

        if (existingItem) {

            //check version
            if (existingItem.version == boundary.properties.version_id) {
                return existingItem;
            } else {
                this.logger.info(`Version in indexdb of boundary ${boundary.properties.global_id} is out of date.  ${existingItem.version} vs ${boundary.properties.version_id}`);
                //the put will overright it
            }
        }

        this.logger.info("Server side fetch");

        //Make sure the cache doesn't get too large
        await this._db.enforceRasterSize();

        const boundary3857 = toMercator(boundary);

        console.log("Boundary 3857", boundary3857);

        //minX, minY, maxX, maxY
        const extent3857 = bbox(boundary3857);

        console.log("Extent 3857", extent3857);
        let params = new HttpParams()
            .set("min_x", extent3857[0] - RASTER_BUFFER_DISTANCE)
            .set("min_y", extent3857[1] - RASTER_BUFFER_DISTANCE)
            .set("max_x", extent3857[2] + RASTER_BUFFER_DISTANCE)
            .set("max_y", extent3857[3] + RASTER_BUFFER_DISTANCE)
            .set("is_walking", isWalking ? "true" : "false")
            ;
        this.logger.info(`${AppConfigService.conf.api_url}/read_friction_raster`, { params, responseType: "arraybuffer" });
        const response = await this.http.get(`${AppConfigService.conf.api_url}/read_friction_raster`,
            {
                params,
                responseType: "arraybuffer",
            }).toPromise();

        console.log("Raster Response", response);

        const tiff = await GeoTIFF.fromArrayBuffer(response);

        //const rd = await readRasterData(tiff);
        console.log("Tiff read");
        console.log(tiff)

        const data = await readRasterData(tiff, frictionRasterKey, boundary.properties.version_id!);

        await this._db.friction.put(data);


        return data;
    }


    rasterToGeojson(ord: OriginResolutionData): Array<GeoJsonBase> {
        const { origin, resolution, data } = ord;
        let data_array = data[0];
        const data_width = data.width;
        const data_height = data.height;

        let rasterized_features: Array<object> = [];

        for (let x = 0; x < data_width; x += 1) {
            for (let y = 0; y < data_height; y += 1) {
                const data_value = data_array[x + y * data_width];
                const x_min = origin[0] + resolution[0] * x;
                const x_max = origin[0] + resolution[0] * (x + 1);
                const y_min = origin[1] + resolution[1] * y;
                const y_max = origin[1] + resolution[1] * (y + 1);

                if (data_value < 0) {
                    continue;
                }

                rasterized_features.push({
                    "geometry": {
                        "coordinates": [[
                            [x_min, y_min],
                            [x_min, y_max],
                            [x_max, y_max],
                            [x_max, y_min],
                            [x_min, y_min],
                        ]],
                        "type": "Polygon"
                    },
                    "type": "Feature",
                    "properties": {
                        "value": data_value,
                        //just need a unique number for display purposes
                        "global_id": x + y * data_height
                    }

                })
            }
        }

        return rasterized_features as unknown as Array<GeoJsonBase>;
    }



    /**
     * This method will fill in the raster fields of settlement part
     *
     * This will normally only happen with client side settlement part changes
     * The server calculates all of this
     * @param settlementPart
     * @param popRaster
     */
    getSettlementPartRasterInfo(
        settlementPart: GeoJsonSettlementPart,
        popRaster: OriginResolutionData): SettlementPartRasterInfo {

        // console.log(`Checking raster indexdb for settlement part ${settlementPart.properties.global_id}`);
        const popRasterStats = buildRasterStatsFromTiff(popRaster);

        const subRasterStats = fromSpOrHf(settlementPart);

        /*    console.log(`${LOG_PREFIX}Sub raster stats`, subRasterStats);
            console.log(`${LOG_PREFIX}Sub raster extent`, subRasterStats.getRasterExtent());
            console.log(`${LOG_PREFIX}Pop raster stats`, popRasterStats);
            console.log(`${LOG_PREFIX}Pop raster extent`, popRasterStats.getRasterExtent());
            */

        const offset = roundPosition(popRasterStats.toIndex(subRasterStats.origin));

        let popValues: Array<number> = [];
        for (const rasterPositionIndex of topDownGenerator(subRasterStats)) {
            const [rasterX, rasterY] = rasterPositionIndex;

            const popValue = computePopSquareValue(rasterX, rasterY, subRasterStats, popRasterStats, offset, popRaster);

            popValues.push(popValue);
        }

        const ret: SettlementPartRasterInfo = {
            global_id: settlementPart.properties.global_id,
            popValues,
            stats: subRasterStats,
        };

        return ret;
    }

    /**
     * Export indexeddb to blob
     */
    async exportDb() {
        console.log("Backing up raster IndexedDB");
        return await exportDB(this._db);
    }

    /**
     * Restore IndexedDB from file.
     * !!! Important - it will delete any existing changes now in the database
     * @param file
     */
    async restoreIndexedDb(file: Blob): Promise<void> {
        console.log("Restoring Raster IndexedDB", typeof (file));
        await this.clearAll();
        await importInto(this._db, file);
        console.log("Raster IndexedDB is restored");
    }

    private async clearAll() {
        for (let t of this._db.tables) {
            await t.clear();
        }
    }
}


export async function readRasterData(tiff: any, geometry_id: string, version: number): Promise<OriginResolutionData> {
    const image = await tiff.getImage();

    const width2 = image.getWidth();
    const height2 = image.getHeight();
    const tileWidth = image.getTileWidth();
    const tileHeight = image.getTileHeight();
    const samplesPerPixel = image.getSamplesPerPixel();

    // when we are actually dealing with geo-data the following methods return
    // meaningful results:
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const bbox = image.getBoundingBox();

    console.log(`readRasterData Tiff height ${height2} width ${width2} tile width ${tileWidth} tile height ${tileHeight} samples/pixel ${samplesPerPixel}`);
    console.log(`readRasterData Origin ${origin} Resolution ${resolution} bbox ${bbox}`);

    const data = await image.readRasters();

    /*
    localStorage.setItem("data", JSON.stringify(data));
    localStorage.setItem("origin", JSON.stringify(origin));
    localStorage.setItem("resolution", JSON.stringify(resolution));
    */

    return { origin, resolution, data, geometry_id, version };
}



