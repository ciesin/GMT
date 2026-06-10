import { Injectable } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { HttpClient } from '@angular/common/http';

const DB_NAME = "UrlRequestCacheDb";
const STORE_NAME = "UrlRequestCacheStore";

@Injectable({
    providedIn: 'root'
})

export class UrlRequestCacheService {
    private db: IDBDatabase;
    private store: IDBObjectStore;

    constructor(private logger: NGXLogger,
        private http: HttpClient) {
        let openRequest = indexedDB.open(DB_NAME, 1);

        openRequest.onupgradeneeded = (event) => {
            this.db = (event.target! as any).result as IDBDatabase;
            console.info(DB_NAME + " onupgradeneeded, oldVersion:", event.oldVersion)
            if (event.oldVersion === 0 && !this.db.objectStoreNames.contains(STORE_NAME)) {
                try {
                    this.store = this.db.createObjectStore(STORE_NAME);
                    console.info(DB_NAME + " createObjectStore done:", STORE_NAME)
                } catch (error) {
                    this.logger.error(DB_NAME + " createObjectStore error:", error)
                }
            }
        };

        openRequest.onerror = function () {
            console.error(DB_NAME + " error:", openRequest.error);
        };

        openRequest.onsuccess = () => {
            this.db = openRequest.result;

            this.db.onversionchange = () => {
                console.warn("There's another open connection to the same database with different version");
                this.db.close();
                window.location.reload();
            };
            openRequest.onblocked = () => {
                console.warn("There's another open connection to the same database with different version");
                window.location.reload();
            };
        };
    }

    async getOrFetch(url: string): Promise<ArrayBuffer> {

        let data = await this.get<ArrayBuffer>(url);
        if (data) {
            //console.info("Fetching data from CACHE, url :", url);
            return data;
        }
        console.debug("Fetching data from SERVER, url :", url);

        const response = await this.http.get(url, {
            headers: { 'Content-Type': 'image/jpg' },
            responseType: 'blob'
        }).toPromise();
        data = await response!.arrayBuffer();
        await this.put(url, data);
        return data;
    }

    async get<T>(url: string) {
        return new Promise<T | undefined>((resolve, reject) => {
            const transaction = this.db.transaction(STORE_NAME, "readonly");
            let request = transaction.objectStore(STORE_NAME).get(url);
            request.onsuccess = () => {
                // console.info("get done, url:",url,", result:", request.result);
            };
            transaction.oncomplete = function () {
                // console.info("Transaction get done, url: ",url,", result:", request.result);
                resolve(request.result as T | undefined);
            };
            request.onerror = function () {
                // console.error("get error, url:",url,", error:", request.error);
                reject(request.error);
            };
            return request;
        });
    }

    async put(url: string, value: any) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(STORE_NAME, "readwrite");
            let request = transaction.objectStore(STORE_NAME).put(value, url);
            request.onsuccess = () => {
                // console.info("PUT done, url:",url,", result:", request.result);
            };
            transaction.oncomplete = function () {
                // console.info("Transaction PUT done, url: ",url,", result:", request.result);
                resolve(request.result);
            };
            request.onerror = function () {
                // console.error("put error, url:",url,", error:", request.error);
                reject(request.error);
            };
        });
    }
}
