import {ALL_FREQUENCIES, Frequency} from "../app/utils/server-interfaces/GeoJson";

export interface Keycloak {
  url: string;
  realm: string;
  token_endpoint: string;
  clientId: string;
  scope: string;
}

export interface IEnvironment {
  doc: { root: string };
  production: boolean;
  disable_sync: boolean;
  api_url: string;
  geoserver_url: string;
  app_version: string;
  google_analytics_tracking_code: string;
  environment: string;
  developer_mode: boolean;
  env_color: string;
  keycloak: Keycloak;
  generic: {
    "operational_boundary_level": number,
    "boundary_level_labels": string,
    "default_language": string,
    "suggested_location_accuracy_m": number,
    "dev_tools_pin_code": string
  },
  catchment: {
    "min_fixed_post_buffer_m": number,
    "max_fixed_post_buffer_m": number,
    "target_population_perc": number
  },
  "coverage_weight": {
    "strategy": {
      "fixed_post": number,
      "outreach": number
    },
    "frequency": { [key in Frequency] : number }
      /*"unknown": number,
      "once_per_month": number,
      "twice_per_month": number,
      "three_per_month": number,
      "weekly": number,
      "daily": number,
      "other": number,
    },*/
    "boundary": {
      "in": number,
      "out": number
    },
    //"0,100;500,90;1000,50;2000,10;3001,0"
    "distance": string,
    "min_square_perc": number,
    "max_hf_per_square": number,

    "min_sett_percentage": number,
    "min_sett_pop": number,
  }
}

export interface IIndicatorsConf {
  "hf_level_of_care"?: {
    "Unknown": number,
    "Primary": number,
    "Secondary": number,
    "Tertiary": number,
    "Dispensary": number,
    "Other": number,
  },
  "sn_uninhabited_reason"?: {
    "Abandoned": number,
    "Destroyed": number,
    "No settlement": number,
    "Other": number,
    "Unknown": number
  },
  "sn_problematic"?: {
    "Security Compromised": number,
    "Slum": number,
    "Densely Populated": number,
    "Hard To Reach": number,
    "Nomadic/Fulani": number,
    "Scattered": number,
    "Riverine": number,
    "Internally Displaced": number,
    "Non-compliant": number,
    "Zero-dose": number,
    "Uptake Issue": number,
    "Measles Outbreak": number,
    "cVDPV Outbreak": number,
    "Polio High-Risk": number,
    "Other": number,
    "Unknown": number
  },
  "hf_microplan_status"?: {
    "Unknown": number,
    "Not Started": number,
    "In Progress": number,
    "Complete": number
  }
}
export const IndicatorsConfDefaultValues = {
  hf_level_of_care: {
    "Unknown": 0,
    "Primary": 1,
    "Secondary": 2,
    "Tertiary": 3,
    "Dispensary": 5,
    "Other": 4,
  },
  sn_uninhabited_reason: {
    "Abandoned": 0,
    "Destroyed": 1,
    "No settlement": 2,
    "Other": 3,
    "Unknown": 4
  },
  sn_problematic: {
    "Security Compromised": 0,
    "Slum": 1,
    "Densely Populated": 2,
    "Hard To Reach": 3,
    "Nomadic/Fulani": 4,
    "Scattered": 5,
    "Riverine": 6,
    "Internally Displaced": 7,
    "Non-compliant": 8,
    "Zero-dose": 9,
    "Uptake Issue": 10,
    "Measles Outbreak": 11,
    "cVDPV Outbreak": 12,
    "Polio High-Risk": 13,
    "Other": 14,
    "Unknown": 15
  },
  hf_microplan_status: {
    "Unknown": 0,
    "Not Started": 1,
    "In Progress": 2,
    "Complete": 3
  }
}
export interface IFullEnvironment extends IEnvironment, IIndicatorsConf {};
