import {defineConfig} from "cypress";
import {log_cypress} from './cypress/plugins/logging';

export default defineConfig({
  chromeWebSecurity: false, //to avoid cross origin / iframe limitation
  viewportWidth: 1280,
  viewportHeight: 800,

  reporter: "cypress-multi-reporters",
  reporterOptions: {
    reporterEnabled: 'spec, mocha-junit-reporter',
    mochaJunitReporterReporterOptions: {
      mochaFile: '/cypress_results/results-[hash].xml'
    }
  },

  env: {
    oauth: {
      grant_type: "password",
      client_id: "dashboard",
    },
  },

  retries: {
    "runMode": 2
  },

  e2e: {
    hideXHRInCommandLog: true,
    specPattern: [
      "cypress/e2e/**/*.ts",
    ],
    setupNodeEvents(on, config) {
      // implement node event listeners here
      on("task", {
        log: (message) => log_cypress(message)
      });
    },
  },
});
