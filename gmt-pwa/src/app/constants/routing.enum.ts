import { routeFromChunks } from '../utils/route-helper';

export enum RoutesChunks {
  NOT_FOUND = 'not-found',
  INDEX = '/',
  EMPTY = '',
  ROUTINE_IMMUNIZATION = 'routine-immunization',
  HEALTH_FACILITIES = 'health-facilities',
  SETTLEMENTS = 'settlements',
  MICROPLAN = 'microplan',
  FIELD_DATA_COLLECTION = 'collection',
  DATA_DOWNLOAD = 'download',
  UNSUPPORTED_BROWSER = 'unsupported',
  PARAM_BOUNDARY = ':boundary',
  PARAM_JOB_ID = ':jobId',
  PARAM_HF = ':hf',
  PARAM_SETTLEMENT = ':settlement',
  USER = 'user',
  EDIT = 'edit',
  LOGIN = 'login',
  MAINTENANCE = 'maintenance',
  DASHBOARD = 'dashboard',
  USER_MANAGEMENT = 'user-management',
  USER_LIST = 'user-list',
  PARAM_NODE = 'node-id',
  ADD_HEALTH_FACILITY = 'add-health-facility',
  ADD_SETTLEMENT = 'add-settlement',
  MATERIAL = 'material',
  OVERVIEW = 'overview',
  PROGRESS = 'progress',

  TECHNICAL = 'technical',

  CATCHMENT_TECH_VIEW = 'catchment-tech-view',
}

export const RoutePath = {
  HOME: routeFromChunks([]),
};

export type RouteParam =
  | RoutesChunks.PARAM_BOUNDARY
  | RoutesChunks.PARAM_SETTLEMENT
  | RoutesChunks.PARAM_HF;
