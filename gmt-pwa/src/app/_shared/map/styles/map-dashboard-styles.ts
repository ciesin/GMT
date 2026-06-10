import { FeatureLike } from 'ol/Feature';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { StyleFunction, StyleLike } from 'ol/style/Style';
import {
  coverageLabel,
  dataQualityLabel,
  mpProgressLabel,
  mpStatusCompleteLabel,
  qualityIndexHigh,
  qualityIndexLow,
  qualityIndexLowMedium,
  qualityIndexMedium,
} from 'src/app/constants/indicators.constants';
import { AppConfigService } from 'src/app/utils/app-config.service';

// Configure default style properties
const defaultTextStroke = 'white';
const defaultTextFill = 'black';
const defaultBoundaryStroke = 'black';
const defaultBoundaryFill = 'rgba(255,255,255, 1.0)';
const defaultBoundaryThickness = 1;
const selectedBoundaryFill = 'white';
const selectedBoundaryStroke = '#202c4c';
const selectedBoundaryThickness = 6;

const policyColorFixedPost = '#865DA8';
const policyColorOutreach = '#AB75D6';
const policyColorTooMuchUnclaimed = '#C99DEC';
const policyColorAlignedWithTheoretical = '#E7C9FF';

const populationCoverageLow = 'rgba(255, 245, 180, 1)'; //'#FFF5B4';
const populationCoverageMediumLow = 'rgba(255, 239, 133, 1)'; //'#FFEF85';
const populationCoverageMedium = 'rgba(255, 230, 67, 1)'; //'#FFE643';
const populationCoverageHigh = 'rgba(245, 213, 0, 1)'; //'#F5D500';

const mpProgressNotStarted = 'rgba(231, 239, 239, 1)'; //'#E7EFEF';
const mpProgressInProgress = 'rgba(133, 175, 190, 1)'; //'#85AFBE';
const mpProgressCompleted = 'rgba(24, 79, 103, 1)'; //'#184F67';

//These should also match quality<N>.svg which is what is shown in the legend
const basemapQualityLow = 'rgba(231, 201, 255, 1)';
const basemapQualityMediumLow = 'rgba(201, 157, 236, 1)';
const basemapQualityMedium = 'rgba(171, 117, 214, 1)';
const basemapQualityHigh = 'rgba(134, 93, 168, 1)';
// Text related styles
const emptyText = new Text({
  text: '',
});
const text_fill = new Fill({
  color: defaultTextFill,
});
const text_stroke = new Stroke({
  color: defaultTextStroke,
  width: 3,
});
const boundariesTextCache: Map<string, Text> = new Map();

export interface BoundaryLevel {
  name: string;
  level: number;
  style?: StyleLike;
  visible: boolean;
  color?: string;
  borderColor?: string;
  thickness?: number;
  text: boolean;
  textColor?: string;
  minResolution: number;
  maxResolution: number;
}
//Putting this here so styles can use this
export const BOUNDARY_LEVEL_MAP_DATA: Array<BoundaryLevel> = [
  //level 0
  {
    name: 'Country',
    level: 0,
    visible: true,
    thickness: 2,
    text: false,
    minResolution: 1000,
    maxResolution: 100000,
  },
  {
    name: 'State',
    level: 1,
    visible: true,
    borderColor: '#777777',
    thickness: 1,
    text: true,
    minResolution: 800,
    maxResolution: 100000,
  },
  {
    name: 'LGA',
    level: 2,
    visible: true,
    borderColor: '#999999',
    thickness: 1,
    text: true,
    minResolution: 144,
    maxResolution: 800,
  },
  {
    name: 'Ward',
    level: 3,
    visible: true,
    borderColor: '#bbbbbb',
    thickness: 1,
    text: true,
    textColor: 'purple',
    minResolution: 0,
    maxResolution: 144,
  },
];

function getBoundariesText(
  feature: FeatureLike,
  resolution: number,
  text: string
): Text {
  const cacheKey = `${Math.round(resolution / 10)}_${text}`;

  if (!boundariesTextCache.has(cacheKey)) {
    boundariesTextCache.set(
      cacheKey,
      new Text({
        textAlign: 'center',
        textBaseline: 'middle',
        font: 'Bold 11px Verdana',
        text: text,
        fill: text_fill,
        stroke: text_stroke,
        offsetX: 0,
        offsetY: 0,
        placement: 'point',
        maxAngle: 0.7853981633974483,
        overflow: true,
        rotation: 0,
      })
    );
  }
  return boundariesTextCache.get(cacheKey)!;
}

function applyProgressIndicatorsStyle(feature: FeatureLike, style: Style) {
  const numBoundaryParticipating = feature.get('num_boundary_participating');
  if (!numBoundaryParticipating || numBoundaryParticipating == '0') {
    return;
  }
  const level = feature.get('level');
  let hfMicroplanStatus;
  if (
    parseInt(level) == AppConfigService.conf.generic.operational_boundary_level
  ) {
    hfMicroplanStatus = feature.get('num_fp_mp_status');
  } else {
    hfMicroplanStatus = feature.get('boundary_mp_status');
  }
  if (!hfMicroplanStatus) {
    return;
  }
  const total = hfMicroplanStatus.reduce((a, b) => a + b, 0);
  if (!total) {
    return;
  }
  const completedPerc =
    hfMicroplanStatus[
      AppConfigService.conf.hf_microplan_status![mpStatusCompleteLabel]
    ] / total;

  // coloring by indicators
  if (completedPerc < 0.5) {
    style.getFill()!.setColor(mpProgressNotStarted);
  } else if (completedPerc >= 0.5 && completedPerc < 0.8) {
    style.getFill()!.setColor(mpProgressInProgress);
  } else if (completedPerc >= 0.8) {
    style.getFill()!.setColor(mpProgressCompleted);
  }
}

function applyBasemapQualityIndicatorsStyle(
  feature: FeatureLike,
  style: Style
) {
  const numBoundaryParticipating = feature.get('num_boundary_participating');
  if (!numBoundaryParticipating || numBoundaryParticipating == '0') {
    return;
  }
  const level = feature.get('level');

  if (
    parseInt(level) == AppConfigService.conf.generic.operational_boundary_level
  ) {
    const totalStCount = feature.get('num_set_total');
    const stWithGeneratedNames = feature.get('num_set_mgn');
    if (!totalStCount) {
      return;
    }
    const quality = (totalStCount - stWithGeneratedNames) / totalStCount;
    // coloring by indicators
    if (quality < 0.2) {
      style.getFill()!.setColor(basemapQualityLow);
    } else if (quality < 0.5) {
      style.getFill()!.setColor(basemapQualityMediumLow);
    } else if (quality < 0.8) {
      style.getFill()!.setColor(basemapQualityMedium);
    } else if (quality >= 0.8) {
      style.getFill()!.setColor(basemapQualityHigh);
    }
  } else {
    const dataQualityNumbers = feature.get('boundary_data_quality');
    if (!dataQualityNumbers) {
      return;
    }
    const maxQualityLevel = dataQualityNumbers.reduce(
      (a, b) => Math.max(a, b),
      0
    );
    if (maxQualityLevel == 0) {
      return;
    }
    if (maxQualityLevel == dataQualityNumbers[qualityIndexLow]) {
      style.getFill()!.setColor(basemapQualityLow);
    } else if (maxQualityLevel == dataQualityNumbers[qualityIndexLowMedium]) {
      style.getFill()!.setColor(basemapQualityMediumLow);
    } else if (maxQualityLevel == dataQualityNumbers[qualityIndexMedium]) {
      style.getFill()!.setColor(basemapQualityMedium);
    } else if (maxQualityLevel == dataQualityNumbers[qualityIndexHigh]) {
      style.getFill()!.setColor(basemapQualityHigh);
    }
  }
}

function applyCoverageIndicatorsStyle(feature: FeatureLike, style: Style) {
  const numBoundaryParticipating = feature.get('num_boundary_participating');
  if (!numBoundaryParticipating || numBoundaryParticipating == '0') {
    return;
  }
  const catchmentPopFp = feature.get('catchment_pop_fp');
  const catchmentPopOutreach = feature.get('catchment_pop_outreach');
  const catchmentPopUnclaimed = feature.get('catchment_pop_unclaimed');
  const totalCoveragePop =
    catchmentPopFp + catchmentPopOutreach + catchmentPopUnclaimed;
  let percentageCovered = -1;
  if (totalCoveragePop) {
    percentageCovered =
      (catchmentPopFp + catchmentPopOutreach) / totalCoveragePop;
  }
  if (percentageCovered < 0) {
    return;
  }
  // coloring by indicators
  if (percentageCovered < 0.2) {
    style.getFill()!.setColor(populationCoverageLow);
  } else if (percentageCovered < 0.5) {
    style.getFill()!.setColor(populationCoverageMediumLow);
  } else if (percentageCovered < 0.8) {
    style.getFill()!.setColor(populationCoverageMedium);
  } else if (percentageCovered >= 0.8) {
    style.getFill()!.setColor(populationCoverageHigh);
  }
}

// Highlight style
export const boundaryHighlightStyle = new Style({
  fill: new Fill({
    color: '#efeff5',
  }),
  stroke: new Stroke({
    color: 'black',
    width: 4,
  }),
});

// Selection style
export const boundarySelectionStyle = new Style({
  fill: new Fill({
    color: selectedBoundaryFill,
  }),
  stroke: new Stroke({
    color: selectedBoundaryStroke,
    width: selectedBoundaryThickness,
  }),
});

// Boundary styles
const boundaries_stroke = new Stroke({
  color: defaultBoundaryStroke,
  width: defaultBoundaryThickness,
});
const boundaries_fill = new Fill({
  color: defaultBoundaryFill,
});

const clickedBoundaryStyle1 = new Style({
  stroke: new Stroke({
    color: 'rgba(0, 0, 0, 1)',
    width: 12,
  }),
});
const clickedBoundaryStyle2 = new Style({
  stroke: new Stroke({
    color: 'rgba(255, 243, 229, 1)',
    width: 10,
  }),
  fill: new Fill({
    color: 'rgba(5, 5, 5, 0)',
  }),
});
export const highlightedBoundaryStyleConst = new Style({
  stroke: new Stroke({
    color: 'rgba(5, 5, 5, 0.7)',
    width: 1,
  }),
  // It is important, that this style has a fill, because otherwise the hovering is fighting between 2 states!
  fill: new Fill({
    color: 'rgba(5, 5, 5, 0)',
  }),
});
export const boundaryStyle = new Style({
  stroke: boundaries_stroke,
  fill: boundaries_fill,
});

/**
 * Creates a style function respecting the boundary level settings
 * @param feature
 * @param resolution
 * @param level
 * @param highestLevel
 * @param color
 * @param borderColor
 * @param thickness
 * @param text
 * @param textColor
 * @param boundary
 * @param parent
 * @param indicator
 */
export function getBoundaryStyle(
  feature: FeatureLike,
  resolution: number,
  level: number,
  highestLevel: number,
  color: string,
  borderColor: string,
  thickness: number,
  text: boolean,
  textColor?: string,
  boundary?: string,
  parent?: string | null,
  indicator?: string | null
): Style {
  const style = boundaryStyle;
  if (boundary && feature.get('global_id') === boundary) {
    style.setStroke(boundarySelectionStyle.getStroke());
    style.getStroke()!.setColor(selectedBoundaryStroke);
    style.getStroke()!.setWidth(selectedBoundaryThickness);
    style.getFill()!.setColor(selectedBoundaryFill);
    style.setZIndex(1000);
  } else if (
    parent !== undefined &&
    boundary === undefined &&
    feature.get('global_id') === parent
  ) {
    // Special case if we click on a selected highest level feature (will unselect it and set focus to parent)
    style.setStroke(boundarySelectionStyle.getStroke());
    style.getStroke()!.setColor(selectedBoundaryStroke);
    style.getStroke()!.setWidth(selectedBoundaryThickness);
    style.getFill()!.setColor(selectedBoundaryFill);
    style.setZIndex(1000);
  } else {
    style.setZIndex(0);
    if (thickness) {
      style.getStroke()!.setWidth(thickness);
    } else {
      style.getStroke()!.setWidth(defaultBoundaryThickness);
    }
    if (color) {
      style.getFill()!.setColor(color);
    } else {
      style.getFill()!.setColor(defaultBoundaryFill);
    }
    if (borderColor) {
      style.getStroke()!.setColor(borderColor);
    } else {
      style.getStroke()!.setColor(defaultBoundaryStroke);
    }
  }
  if (level != 0) {
    if (indicator == coverageLabel) {
      applyCoverageIndicatorsStyle(feature, style);
    } else if (indicator == mpProgressLabel) {
      applyProgressIndicatorsStyle(feature, style);
    } else if (indicator == dataQualityLabel) {
      applyBasemapQualityIndicatorsStyle(feature, style);
    }
  }
  if (text) {
    // Apply text
    if (
      feature.get('level') == highestLevel ||
      (feature.get('global_id') !== boundary && feature.get('level') >= level)
    ) {
      // \nPop: ${formatPopulation(feature.get('boundary_pop'))}\nC. Pop: ${formatPopulation(feature.get('catchment_pop_fp') + feature.get('catchment_pop_outreach'))}\nHf ready: ${feature.get('num_fp_mp_ready')} of ${feature.get('num_fp')}
      style.setText(
        getBoundariesText(feature, resolution, `${feature.get('name')}`)
      );
      //style.setText(getBoundariesText(feature, resolution, `${feature.get('name')}` + ' hl ' + highestLevel + ' lvl ' + level + ' flvl' + feature.get('level')));
    } else {
      style.setText(emptyText);
    }

    // Apply text color
    // style.getText().getFill().setColor(textColor ? textColor : defaultTextFill);
  } else {
    style.setText(emptyText);
  }
  return style;
}

/**
 * Similar function to getBoundaryStyle - but it highlights the elements that have
 * "highlight" feature property set to true
 *
 * This style is used in the user management boundary map to show the admin 0 and admin 1 styles
 * as well as the selected boundaries (with different color/thickness params)
 * and in the regular progress boundary selection map to show the selected boundary
 * @param borderColor
 * @param thickness
 */
export const getBoundaryWithHighlightsStyle = (
  borderColor: string,
  thickness: number
): StyleLike => {
  return (_feature: FeatureLike, _resolution: number) => {
    const style = boundaryStyle;
    style.setZIndex(0);
    if (thickness) {
      style.getStroke()!.setWidth(thickness);
    } else {
      style.getStroke()!.setWidth(defaultBoundaryThickness);
    }
    style.getFill()!.setColor('rgba(255,255,255, 0)');

    if (borderColor) {
      style.getStroke()!.setColor(borderColor);
    } else {
      style.getStroke()!.setColor(defaultBoundaryStroke);
    }
    // style.setText(emptyText);
    style.setText(
      getBoundariesText(_feature, _resolution, `${_feature.get('name')}`)
    );
    return style;
  };
};

//This is the selected style, we want the text to not be visible if we are zoomed in too much
export const getBoundaryOverviewSelectedStyle = (
  borderColor: string,
  thickness: number,
  level: number
): StyleLike => {
  return (_feature: FeatureLike, resolution: number) => {
    console.error(`Resolution ${resolution} level ${level}`);
    const levelConfig = BOUNDARY_LEVEL_MAP_DATA[level];
    const styleFunction = getBoundaryWithHighlightsStyle(
      borderColor,
      thickness
    ) as StyleFunction;
    const style = styleFunction(_feature, resolution) as Style;

    if (resolution < levelConfig.minResolution) {
      style.setText(emptyText);
    }
    return style;
  };
};

//This is when you click on a boundary but have not selected it yet via going to details
export function intermediateSelectionBoundaryStyle(indicator?: string) {
  return (feature: FeatureLike, resolution: number): Style[] => {
    let style2 = clickedBoundaryStyle2;
    style2.setText(
      getBoundariesText(feature, resolution, `${feature.get('name')}`)
    );
    // didn't find how to make transparent layer so setting identical colors...
    if (indicator == coverageLabel) {
      applyCoverageIndicatorsStyle(feature, style2);
    } else if (indicator == mpProgressLabel) {
      applyProgressIndicatorsStyle(feature, style2);
    } else if (indicator == dataQualityLabel) {
      applyBasemapQualityIndicatorsStyle(feature, style2);
    }
    return [clickedBoundaryStyle1, style2];
  };
}

export const highlightedBoundaryStyle: StyleFunction = (
  feature: FeatureLike,
  resolution: number
): Style => {
  let style = highlightedBoundaryStyleConst;
  // style.setFill(null);
  return style;
};
