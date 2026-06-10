import {GeoJsonBase} from "./server-interfaces/GeoJson";

export function buildMap<T extends GeoJsonBase>(list: Array<T>): Map<string, T> {
  const m = new Map<string, T>();

  for (const item of list) {
    m.set(item.properties.global_id, item);
  }

  return m;
}

/** Queries available disk quota.
 @see https://developer.mozilla.org/en-US/docs/Web/API/StorageEstimate
 @returns {Promise<{quota: number, usage: number}>} Promise resolved with
 {quota: number, usage: number} or undefined.
 */
export async function getAvailableAndUsedSpace(): Promise<[number, number]> {
  if (!navigator.storage || !navigator.storage.estimate) {
    return [0,0];
  }

  const q = await navigator.storage.estimate();

  console.log("Quota done", q);
  return [q.quota || 0, q.usage || 0];
}

/*
Create an indexdb just for testing storage size
 */
//https://javascript.info/indexeddb
export async function testLocalStorageLimits() {

  const testIndexDbName = "StorageLimitTest";

  const initial = await getAvailableAndUsedSpace();
  console.log("Quota done Available space", initial[0].toLocaleString(),
    "Used space", initial[1].toLocaleString()
    );

  await deleteIndexDbDatabase(testIndexDbName);

  const db = await createIndexDbDatabase(testIndexDbName);

  //store larger and large file sizes, double each time, until we get past a gig

  const FILE_SIZE_LIMIT = 1000 * 1000 * 1000;
  let fileSize = 1;
  let i = 0;
  while (fileSize < FILE_SIZE_LIMIT) {
    fileSize *= 2;
    i += 1;

    const x = new Uint8Array(fileSize);
    await storeItem(i.toString(), x, db);

    const currentSpace = await getAvailableAndUsedSpace();
    console.log(`Additional space used for file of size ${fileSize.toLocaleString()} is:`, (currentSpace[1] - initial[1]).toLocaleString());
  }

  /*
  //10 megs
  const x = new Uint8Array(10 * 1000 * 1000);

  //store up to 3 gigs
  for(let i = 0; i < 300; i+=1) {
    await storeArray(i, x, db);

    const currentSpace = await getAvailableAndUsedSpace();

    console.log("Additional space used", (currentSpace[1] - initial[1]).toLocaleString());
  }*/
}

const STORE_NAME = "debugArrayStorage";

export function createIndexDbDatabase(indexDbName: string) : Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(indexDbName, 1);

    request.onerror =  (event) => {
      // Handle errors.
      console.error(event);
      reject("Error opening indexdb");
    };
    request.onupgradeneeded =  (event) => {
      const db = request.result;
      db.createObjectStore(STORE_NAME, {keyPath: "id"});


    };

    request.onsuccess = () => {
      resolve(request.result);
    }
  });
}

export function deleteIndexDbDatabase(indexDbName: string) : Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(indexDbName);
    req.onsuccess = function () {
      resolve(true);
    };
    req.onerror = function () {
      reject("Couldn't delete database");
    };
    req.onblocked = function () {
      reject("Couldn't delete database due to the operation being blocked");
    };
  });
}

export function storeItem<T>(id: string, a: T, db: IDBDatabase) : Promise<boolean> {
  return new Promise((resolve, reject) => {
    let transaction = db.transaction(STORE_NAME, "readwrite"); // (1)

    transaction.oncomplete = function () {
      //console.log("Transaction is complete");
      resolve(true);
    };
// get an object store to operate on it
    let store = transaction.objectStore(STORE_NAME); // (2)

    let array_item = {
      id,
      data: a
    };

    let request = store.put(array_item); // (3)

    request.onsuccess = function () { // (4)
      console.log(`array added to the store id: [${id}]`, request.result);

    };

    request.onerror = function () {
      console.log("Error", request.error);
      reject(request.error);
    };

  });
}

export function retrieveItem<T>(id: string, db: IDBDatabase) : Promise<null | T> {
  return new Promise((resolve, reject) => {
    let transaction = db.transaction(STORE_NAME, "readonly"); // (1)

    transaction.oncomplete = function () {
      console.log("retrieveArray Transaction is complete");
    };
// get an object store to operate on it
    let store = transaction.objectStore(STORE_NAME); // (2)


    let request = store.get(id); // (3)

    request.onsuccess = function () { // (4)
      console.log(`retrieveArray success ${id}`, request.result);
      if (request.result) {
        let arr : T = request.result.data;
        //console.log(`retrieveArray success ${id} array length ${arr.byteLength}`, request.result);
        resolve(arr);
      } else {
        console.log(`retrieveArray data not found for ${id}`, request.result);
        resolve(null);
      }
    };

    request.onerror = function () {
      console.log("Error", request.error);
      reject(request.error);
    };

  });
}
