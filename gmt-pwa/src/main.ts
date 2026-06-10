import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';


import {AppConfigService} from 'src/app/utils/app-config.service';
import {IEnvironment} from "./environments/iEnvironment";

const headers = new Headers();
headers.append('pragma', 'no-cache');
headers.append('cache-control', 'no-cache');
headers.append('cache-control', 'max-age=0');

const options = {
  method: 'GET',
  headers
};

export const APP_ROOT_ID = "gmt_app_root";

// this 'config.json' file is modified in the docker container so cannot be cached by the angular service worker as the hashes will be different
fetchOrGetFromLocalStorage('/assets/config.json').then(() => {
  // We need to load app module dynamically. Because we need the conf to be loaded in the imports of that module (for GA code).
  // Imports are loaded when the module is loaded. We need to wait for the config to be ready before loading the app module.
 import('./app/app.module').then(({AppModule}) => {
   platformBrowserDynamic().bootstrapModule(AppModule)
     .catch(err => console.log('Error while bootstrapping AppModule: ' + err));
 });

}).catch(err => console.log('Error while loading file  \'/assets/config.json\': ' + err));

async function fetchOrGetFromLocalStorage(url: string) {
  let LOCAL_STORAGE_CONFIG_JSON_KEY = url.replace(/[/.]/g, '_');
  let localConfig = localStorage.getItem(LOCAL_STORAGE_CONFIG_JSON_KEY);

  function setConfig(data: IEnvironment) {
    // we want to not replace but update the config so that setDbEnumIndexConfig would not need to be refreshed each time
    if(localConfig){
      data = {...JSON.parse(localConfig), ...data};
    }

    AppConfigService.setConfig(data);
    if(!data.hasOwnProperty('hf_level_of_care')){
      setDbEnumIndexConfig();
    }

    if (localConfig) {
      let oldConfig = JSON.parse(localConfig);
      if (oldConfig && AppConfigService.conf.app_version !== oldConfig.app_version) {
        localStorage.setItem(LOCAL_STORAGE_CONFIG_JSON_KEY, JSON.stringify(AppConfigService.conf));
        window.location.reload();
      }
    }
  }

  function setDbEnumIndexConfig(){
    // it would be nice to have default values so we wouldn't need to wait till this api returns response.
    if (!AppConfigService.conf?.api_url) {
      return;
    }
    const headers = new Headers();
    headers.append('pragma', 'no-cache');
    headers.append('cache-control', 'no-cache');
    headers.append('cache-control', 'max-age=0');
    fetch(`${AppConfigService.conf.api_url}/db_enum_indexes`, {
      method: 'GET',
      headers
    })
      .then(res => res.json())
      .then(result => {
        AppConfigService.addIndicatorsConfig(result);
        localStorage.setItem(LOCAL_STORAGE_CONFIG_JSON_KEY, JSON.stringify(AppConfigService.conf));
      }).catch(err => {
      console.log(`Impossible to get indicator indexes from ${AppConfigService.conf.api_url}/db_enum_indexes`, err)
    })
  }

  if (localConfig) {
    setConfig(JSON.parse(localConfig));
    if (AppConfigService.conf.production) {
      enableProdMode();
    }
    //check server if new config.json version is available
    fetch(url, options)
      .then(res => res.json())
      .then(setConfig).catch(err => {
      console.log('Impossible to get new version of config.json from ' + url, err)
    });

    //Notice this returns right away so the config might change after the above json check finishes
    return Promise.resolve();
  }

  return fetch(url, options)
    .then(res => res.json())
    .then(setConfig).catch(err => {
      console.error('Error while reading response from ' + url, err)
      alert("no cached config for " + url + " available locally, please go online first");
      return Promise.reject("no cached config for" + url + " available locally, please go online first");
    });
}
