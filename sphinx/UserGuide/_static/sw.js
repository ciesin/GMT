const cacheName = 'GMT_DOC';
let broadcastChannel = new BroadcastChannel('sw-messages');

const cacheAll = async () => {
    console.log("start  cacheAll:",)
    const response = await fetch("_static/filesToCache.txt");
    const pathsStr = await response.text();
    let paths = pathsStr.split("\n")
        .map(url => {
            url = url.trim();
            const indexOf = url.lastIndexOf("\\html\\")
            if (indexOf > 0) {
                url = url.substr(indexOf + "\\html\\".length)
            }
            return url;
        });
    console.log("pathsStr :", paths);
    const cache = await caches.open(cacheName);
    const errors = [];
    for (let i = 0; i < paths.length; i++) {
        const value = paths[i];
        if (value) {
            try {
                await cache.add(value);
            }catch (error){
                errors.push(error);
            }
        }
    }
    if (errors.length > 5)
        throw Error(errors);
};

broadcastChannel.addEventListener('message', event => {
    // console.log('ws Received', event.data);
    if (event.data.updateCache) {
        cacheAll().then(() => {
            // console.log("postMessage :",{reload:true})
            broadcastChannel.postMessage({cacheDone: true});
            if (event.data.oldVersion !== undefined)
                broadcastChannel.postMessage({reload: true});
        }).catch(errors=> {
            console.log("cacheAll errors:",errors);
        });
    }
});

// Our service worker will intercept all fetch requests
// and check if we have cached the file
// if so it will serve the cached file
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.open(cacheName)
            .then(cache => cache.match(event.request, {ignoreSearch: true}))
            .then(response => {
                // console.log("event.request :",event.request,", cache: ", response);
                if (response && !response.url.includes("_static/version"))
                    return response;
                if (event.request)
                    return fetch(event.request);
                console.log("fetch interceptor Event error :", event)
            })
    );
});