import { ColorLike } from 'ol/colorlike';
import { FeatureLike } from 'ol/Feature';
import { Icon, Stroke, Style, Text } from 'ol/style';
import { StyleFunction } from 'ol/style/Style';
import { isMachineGenerated } from 'src/app/utils/string-formatting';
import { getMarkerSVGPath, labelBuild, labelMarker } from './map-design';
import { getSizeFromResolution } from './map-poi-styles';
import { getFontStyle, getLabelText } from './map-styles';

/**
 * ==================================
 * ====== All cached styles =========
 * ==================================
 */
const DEFAULT_ANCHOR = [0.5, 1];
const SELECTED_Z_INDEX = 0.00000001; // smaller z-index - higher priority in declutter https://github.com/openlayers/openlayers/issues/8126
const MUTED_STATE = 'muted';
const SELECTED_STATE = 'selected';
const INACTIVE_STATE = 'inactive';

// ::
// :: Markers
// ::
const STL_ACTIVE = getMarkerSVGPath('settlement_active');
const STL_INACTIVE = getMarkerSVGPath('settlement_default');
const STL_SPECIAL_ACTIVE = getMarkerSVGPath('settlement_special_active');
const STL_SPECIAL_INACTIVE = getMarkerSVGPath('settlement_special_default');

const ICON_MUTED = 0.5;
const ICON_INACTIVE = 0.9;
const ICON_ACTIVE = 1;

const ICON_SM = 1;
const ICON_LG = 1;

const settlementStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_INACTIVE,
  src: STL_INACTIVE,
};
const settlementStyle = new Style({ image: new Icon(settlementStyleTemplate) });
const settlementSmall = new Style({
  image: new Icon({ ...settlementStyleTemplate, scale: ICON_SM }),
});
const settlementLarge = new Style({
  image: new Icon({ ...settlementStyleTemplate, scale: ICON_LG }),
});

const settlementSelectedStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_ACTIVE,
  src: STL_ACTIVE,
};
const settlementSelectedStyle = new Style({
  image: new Icon(settlementSelectedStyleTemplate),
  zIndex: SELECTED_Z_INDEX,
});
const settlementSelectedSmall = new Style({
  image: new Icon({ ...settlementSelectedStyleTemplate, scale: ICON_SM }),
  zIndex: SELECTED_Z_INDEX,
});
const settlementSelectedLarge = new Style({
  image: new Icon({ ...settlementSelectedStyleTemplate, scale: ICON_LG }),
  zIndex: SELECTED_Z_INDEX,
});

const problematicSettlementSelectedStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_ACTIVE,
  src: STL_SPECIAL_ACTIVE,
};
const problematicSelected = new Style({
  image: new Icon(problematicSettlementSelectedStyleTemplate),
});
const problematicSelectedSmall = new Style({
  image: new Icon({
    ...problematicSettlementSelectedStyleTemplate,
    scale: ICON_SM,
  }),
});
const problematicSelectedLarge = new Style({
  image: new Icon({
    ...problematicSettlementSelectedStyleTemplate,
    scale: ICON_LG,
  }),
});

const problematicSettlementStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_INACTIVE,
  src: STL_SPECIAL_INACTIVE,
};
const problematic = new Style({
  image: new Icon(problematicSettlementStyleTemplate),
});
const problematicSmall = new Style({
  image: new Icon({ ...problematicSettlementStyleTemplate, scale: ICON_SM }),
});
const problematicLarge = new Style({
  image: new Icon({ ...problematicSettlementStyleTemplate, scale: ICON_LG }),
});

const problematicMutedSettlementStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_MUTED,
  src: STL_SPECIAL_INACTIVE,
};
const problematicMuted = new Style({
  image: new Icon(problematicMutedSettlementStyleTemplate),
});
const problematicMutedSmall = new Style({
  image: new Icon({
    ...problematicMutedSettlementStyleTemplate,
    scale: ICON_SM,
  }),
});
const problematicMutedLarge = new Style({
  image: new Icon({
    ...problematicMutedSettlementStyleTemplate,
    scale: ICON_LG,
  }),
});

const settlementMutedStyleTemplate = {
  anchor: DEFAULT_ANCHOR,
  opacity: ICON_MUTED,
  src: STL_INACTIVE,
};
const settlementMuted = new Style({
  image: new Icon(settlementMutedStyleTemplate),
});
const settlementMutedSmall = new Style({
  image: new Icon({ ...settlementMutedStyleTemplate, scale: ICON_SM }),
});
const settlementMutedLarge = new Style({
  image: new Icon({ ...settlementMutedStyleTemplate, scale: ICON_LG }),
});

const stIcon: { [key: string]: { [key: number]: Style } } = {
  [MUTED_STATE]: {
    1.5: settlementMutedSmall,
    4: settlementMutedSmall,
    6: settlementMuted,
    8: settlementMutedLarge,
  },
  [SELECTED_STATE]: {
    1.5: settlementSelectedSmall,
    4: settlementSelectedSmall,
    6: settlementSelectedStyle,
    8: settlementSelectedLarge,
  },
  [INACTIVE_STATE]: {
    1.5: settlementSmall,
    4: settlementSmall,
    6: settlementStyle,
    8: settlementLarge,
  },
};

const problematicStIcon: { [key: string]: { [key: number]: Style } } = {
  [MUTED_STATE]: {
    1.5: problematicMutedSmall,
    4: problematicMutedSmall,
    6: problematicMuted,
    8: problematicMutedLarge,
  },
  [SELECTED_STATE]: {
    1.5: problematicSelectedSmall,
    4: problematicSelectedSmall,
    6: problematicSelected,
    8: problematicSelectedLarge,
  },
  [INACTIVE_STATE]: {
    1.5: problematicSmall,
    4: problematicSmall,
    6: problematic,
    8: problematicLarge,
  },
};
export function settlementPartStyleForColour(color: ColorLike): Style {
  return new Style({
    //fill: new Fill({color: fillColor}),
    stroke: new Stroke({
      color,
      width: 3,
      lineDash: [4, 8],
    }),
  });
}

export const settlementPartStyle = new Style({
  stroke: new Stroke({
    color: '#ff0000',
    width: 3,
  }),
});

export const newSettlementStyle = [
  new Style({
    image: new Icon({
      anchor: [0.5, 0.5],
      src: 'assets/icons/map/pois/settlementDefault.svg',
      color: '#FFE136',
      // @ts-ignore
      imgSize: [21, 21],
    }),
  }),
];
let settlementNameStyleCache: { [key: string]: Style } = {};
/**
 * ==================================
 * ====== End All cached styles =========
 * ==================================
 */

function settlementNameStyle(
  feature: FeatureLike,
  resolution: number,
  opacity: number = 1.0,
  isUninhabited: boolean,
  satelliteImagery: boolean = false
): Text {
  let labelFillColor: string | undefined = undefined;
  let strokeColor: string | undefined = undefined;
  if (satelliteImagery) {
    labelFillColor = '--base-light';
    strokeColor = '--base-dark';
  }
  if (isUninhabited) {
    labelFillColor = '--gray';
  }
  return new Text({
    textAlign: 'center',
    textBaseline: 'middle',
    // TODO: after testing not sure what it's doing
    font: getFontStyle(0.75, isUninhabited ? 'italic' : '400'),
    text: getLabelText(feature, resolution, {
      labelKey: 'name',
      maxResolution: 10,
    }),
    //offsetY: 13,
    overflow: true,
    rotation: 0,
    // this is a nasty hacky approach for now
    ...labelMarker,
    ...labelBuild(
      labelFillColor,
      opacity,
      strokeColor,
      opacity === ICON_MUTED ? 0 : opacity
    ),
  });

  // const resolutionStep = resolution > 8 ? 10 : 12;
  //
  // const cacheKey = feature.get('name') + `_${resolutionStep}`;
  // if (settlementNameStyleCache[cacheKey] === undefined) {
  //   settlementNameStyleCache[cacheKey] =
  //     new Style({
  //       text: new Text({
  //         textAlign: 'center',
  //         textBaseline: 'middle',
  //         font: `${resolution > 8 ? 14 : 18}px Verdana`,
  //         text: (isUninhabited ? "X " : '') + getLabelText(feature, resolution, {
  //           labelKey: 'name',
  //           maxResolution: 8
  //         }),
  //         fill: textFill,
  //         stroke: textStroke,
  //         offsetY: 13,
  //         overflow: true,
  //         rotation: 0,
  //       })
  //     });
  // }
  // return settlementNameStyleCache[cacheKey];
}

function getIcon(
  iconStyleSet,
  muted: boolean,
  selected: boolean,
  iconSize: number
) {
  if (muted) {
    return iconStyleSet[MUTED_STATE][iconSize];
  } else if (selected) {
    return iconStyleSet[SELECTED_STATE][iconSize];
  } else {
    return iconStyleSet[INACTIVE_STATE][iconSize];
  }
}

/**
 * If generatedName is null then hiding of generated name will be not applied to the style
 * @param selected
 * @param muted
 * @param generatedName
 * @param satelliteImagery
 */
export function settlementsStyleFunction(
  selected: boolean,
  muted: boolean,
  generatedName: boolean | null = false,
  satelliteImagery: boolean = false
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    let isMachineGeneratedName = isMachineGenerated(feature.get('name'));
    if (
      (generatedName === false && isMachineGeneratedName) ||
      (generatedName && !isMachineGeneratedName)
    ) {
      return [];
    }
    const iconSize = getSizeFromResolution(resolution);
    const isProblematic =
      (feature.getProperties().problematic || []).length > 0;
    let iconStyle;
    if (isProblematic) {
      iconStyle = getIcon(problematicStIcon, muted, selected, iconSize);
    } else {
      iconStyle = getIcon(stIcon, muted, selected, iconSize);
    }
    const isUninhabited = feature.getProperties().uninhabited || false;
    const setTextOpacity = muted ? ICON_MUTED : undefined;
    iconStyle.setText(
      settlementNameStyle(
        feature,
        resolution,
        setTextOpacity,
        isUninhabited,
        satelliteImagery
      )
    );
    return iconStyle;
  };
}

/**
 * If generatedName is null then hiding of generated name will be not applied to the style
 * @param selected
 * @param muted
 * @param generatedName - if null - generated name will be shown - strange name for the parameter...
 * @param satelliteImagery
 */
export function settlementsTextStyleFunction(
  selected: boolean,
  muted: boolean,
  generatedName: boolean | null = false,
  satelliteImagery: boolean = false
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    let isMachineGeneratedName = isMachineGenerated(feature.get('name'));
    if (
      (generatedName === false && isMachineGeneratedName) ||
      (generatedName && !isMachineGeneratedName)
    ) {
      return [];
    }
    const isUninhabited = feature.getProperties().uninhabited || false;
    const setTextOpacity = muted ? ICON_MUTED : undefined;
    return new Style({
      text: settlementNameStyle(
        feature,
        resolution,
        setTextOpacity,
        isUninhabited,
        satelliteImagery
      ),
    });
  };
}

/**
 * If generatedName is null then hiding of generated name will be not applied to the style
 * @param selected
 * @param muted
 * @param generatedName
 */
export function settlementsIconStyleFunction(
  selected: boolean,
  muted: boolean,
  generatedName: boolean | null = false
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    let isMachineGeneratedName = isMachineGenerated(feature.get('name'));
    if (
      (generatedName === false && isMachineGeneratedName) ||
      (generatedName && !isMachineGeneratedName)
    ) {
      return [];
    }
    const iconSize = getSizeFromResolution(resolution);
    const isProblematic =
      (feature.getProperties().problematic || []).length > 0;
    let iconStyle;
    if (isProblematic) {
      iconStyle = getIcon(problematicStIcon, muted, selected, iconSize);
    } else {
      iconStyle = getIcon(stIcon, muted, selected, iconSize);
    }
    return iconStyle;
  };
}

/**
 * settlementsStyleFunction() + handling outside boundary cases
 * @param boundaryId
 * @param selected
 * @param generatedName
 * @param satelliteImagery
 * @param focusedSettlements
 */
export function settlementsNameTextScoped(
  boundaryId: string,
  selected: boolean = false,
  generatedName: boolean | null = false,
  satelliteImagery: boolean = false,
  focusedSettlements: string[] | boolean
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    let muted = boundaryId !== feature.get('boundary_polygon');
    // only check with filter settlements that are inside the boundary
    if (!muted) {
      muted =
        focusedSettlements === false
          ? false
          : !(focusedSettlements as string[]).includes(
              feature.get('global_id')
            );
    }
    return settlementsTextStyleFunction(
      selected,
      muted,
      generatedName,
      satelliteImagery
    )(feature, resolution);
  };
}

/**
 * settlementsStyleFunction() + handling outside boundary cases
 * @param boundaryId
 * @param selected
 * @param generatedName
 * @param focusedSettlements
 */
export function settlementsNameIconScoped(
  boundaryId: string,
  selected: boolean = false,
  generatedName: boolean | null = false,
  focusedSettlements: string[] | boolean
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    // let machineGenerated = highlightMachineGenerated ? isMachineGenerated(feature.get('name')) : false;
    let muted = boundaryId !== feature.get('boundary_polygon');
    // only check with filter settlements that are inside the boundary
    if (!muted) {
      muted =
        focusedSettlements === false
          ? false
          : !(focusedSettlements as string[]).includes(
              feature.get('global_id')
            );
    }
    return settlementsIconStyleFunction(
      selected,
      muted,
      generatedName
    )(feature, resolution);
  };
}
