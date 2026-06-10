import _ from 'lodash';
import {
  IEnvironment,
  IFullEnvironment,
  IIndicatorsConf,
  IndicatorsConfDefaultValues,
} from '../../environments/iEnvironment';

export interface Map {
  map_projection: number;
  data_projection: number;
}

export class AppConfigService {
  public static conf: IFullEnvironment;

  public static map: Map = {
    map_projection: 3857,
    data_projection: 4326,
  };

  //if true, will fetch and use the friction rasters
  public static calculateTravelTime = false;

  // Can the user change the boundary for Health facilities and Settlement names/parts?
  // Note this is for testing only; in production need to consider things like
  // what if the new boundary is not checked out?  The UI would not let you edit it
  public static canEditBoundaryAttributes = true;

  //Constants to estimate travel time from distance

  //meters / second
  public static WALKING_SPEED_MS = 1.4;

  public static DRIVING_SPEED_MS = 10.0;

  public static SHOW_COORDINATES = false;

  //should also match backend value
  public static BASE_POP_PER_SQUARE = 0.001;

  //Uncovered settlements >= than this distance will not be suggested for out of boundary settlement names
  public static MAX_SUGGESTED_SETTLEMENT_NAME_DISTANCE = 0;

  public static ENABLE_WIZARD_DEBUG = false;
  public static ENABLE_EXPORT_DEBUG = false;
  public static ENABLE_PDF_DEBUG_CACHE = false;
  public static ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE = false;
  public static ENABLE_EXPORT_REW_DEBUG = false;
  public static ENABLE_SPLIT_DEBUG = false;

  public static ENABLE_ACTION_LOG_DEBUG = false;

  public static ENABLE_BOUNDARY_CHOICES = false;

  //Lazily loaded once on fetch
  public static gitHash = '';

  constructor() {}

  public static setConfig(conf: IEnvironment) {
    // without IndicatorsConfDefaultValues, some places use config before api returns result...
    AppConfigService.conf = { ...IndicatorsConfDefaultValues, ...conf };

    console.info('$$$ config set: ', AppConfigService.conf);
  }

  public static addIndicatorsConfig(indicatorsConf: IIndicatorsConf) {
    AppConfigService.conf = {
      ...AppConfigService.conf,
      ...indicatorsConf,
    };
  }

  /*
  returns levels 0 to operating level example -- ['National', 'State', 'LGA', 'Ward']
  */
  public static get_level_to_label() : Array<string> {
    return this.conf.generic.boundary_level_labels.split("|").map(label => label.trim())
  }

  public static async fetchGitHash(): Promise<string> {
    if (AppConfigService.gitHash.length > 0) {
      return AppConfigService.gitHash;
    }
    const response = await fetch('assets/git_info.json', {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache', // Prevents caching
        Pragma: 'no-cache', // For HTTP/1.0 compatibility
        Expires: '0', // Ensures the request is not cached
      },
    });
    const jsonResponse = await response.json();

    const ret = jsonResponse['GIT_COMMIT'];
    if (_.isString(ret)) {
      AppConfigService.gitHash = ret;
      return ret;
    } else {
      return '';
    }
  }
}
