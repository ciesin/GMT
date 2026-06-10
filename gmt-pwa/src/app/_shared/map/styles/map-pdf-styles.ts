import { FeatureLike } from 'ol/Feature';
import { Circle, Fill, Icon, Stroke, Style, Text } from 'ol/style';

export const pdfBoundariesOverviewMap = new Style({
  stroke: new Stroke({
    color: 'black',
    width: 3,
  }),
  fill: new Fill({
    color: 'white',
  }),
});

// PDF Settlement styles
const pdfSettlementIconSmall = new Style({
  image: new Circle({
    radius: 2,
    fill: new Fill({
      color: 'rgb(255,225,54)',
    }),
  }),
});

const pdfSettlementIcon = [
  new Style({
    image: new Circle({
      radius: 7,
      fill: new Fill({
        color: 'rgb(255,225,54)',
      }),
      stroke: new Stroke({
        color: 'white',
        width: 1,
      }),
    }),
    text: new Text({
      text: '',
      font: '16px sans-serif',
      offsetX: 0,
      offsetY: 20,
      fill: new Fill({
        color: 'black',
      }),
      stroke: new Stroke({
        color: 'white',
        width: 4,
      }),
    }),
  }),
];

export const pdfSettlementsOverviewMap = (
  feature: FeatureLike,
  _resolution: number
): Style => {
  return pdfSettlementIconSmall;
};

export const pdfSettlements = (
  feature: FeatureLike,
  _resolution: number
): Style[] => {
  pdfSettlementIcon[0].getText()!.setText(`${feature.get('name')}`);
  return pdfSettlementIcon;
};
export const pdfSettlementsNoLabel = (
  _feature: FeatureLike,
  _resolution: number
): Style[] => {
  pdfSettlementIcon[0].getText()!.setText('');
  return pdfSettlementIcon;
};

// PDF HF styles
const pdfHealthfacilitiesIconSmall = new Style({
  image: new Icon({
    anchor: [0.5, 0.5],
    scale: 0.5,
    src: 'assets/icons/map/pois/FixedPostDefault.svg',
  }),
});

const pdfHealthfacilitiesIcon = new Style({
  image: new Icon({
    anchor: [0.5, 0.5],
    src: 'assets/icons/map/pois/FixedPostDefault.svg',
  }),
});

const pdfOutreachIconSmall = new Style({
  image: new Icon({
    anchor: [0.5, 0.5],
    scale: 0.5,
    src: 'assets/icons/map-markers/outreach_default.svg',
  }),
});

const pdfOutreachIcon = new Style({
  image: new Icon({
    anchor: [0.5, 0.5],
    src: 'assets/icons/map-markers/outreach_default.svg',
  }),
});

const pdfHealthfacilitiesLabelSmall = new Style({
  image: new Circle({
    radius: 6,
    displacement: [8, 8],
    fill: new Fill({
      color: 'black',
    }),
  }),
  text: new Text({
    text: '',
    font: '8px sans-serif',
    offsetX: 8,
    offsetY: -8,
    fill: new Fill({
      color: 'white',
    }),
  }),
});

const pdfHealthfacilitiesLabel = new Style({
  image: new Circle({
    radius: 11,
    displacement: [15, 15],
    fill: new Fill({
      color: 'black',
    }),
  }),
  text: new Text({
    text: '',
    font: '13px sans-serif',
    offsetX: 15,
    offsetY: -15,
    fill: new Fill({
      color: 'white',
    }),
    stroke: new Stroke({
      color: 'white',
    }),
  }),
});

export function pdfHealthfacilitiesOverviewMap(
  feature: FeatureLike,
  _resolution: number
): Style[] {
  const indexLabel = feature.get('index');
  const color = feature.get('color');
  //console.log(`Color is ${color} for ${indexLabel}`);
  pdfHealthfacilitiesLabelSmall.getText()!.setText(indexLabel);
  pdfHealthfacilitiesLabelSmall.setImage(
    new Circle({
      radius: 6,
      displacement: [8, 8],
      fill: new Fill({
        color,
      }),
    })
  );
  //pdfHealthfacilitiesLabelSmall.setZIndex(feature.get('hf_id'));

  if (feature.get('strategy') == 'outreach') {
    return [pdfOutreachIconSmall, pdfHealthfacilitiesLabelSmall];
  }
  return [pdfHealthfacilitiesIconSmall, pdfHealthfacilitiesLabelSmall];
}

export function pdfHealthfacilities(
  feature: FeatureLike,
  _resolution: number
): Style[] {
  const indexLabel = feature.get('index');

  //pdfHealthfacilitiesLabel.setZIndex(feature.get('hf_id'));
  const color = feature.get('color');
  //console.log(`Color is ${color} for ${indexLabel}`);
  pdfHealthfacilitiesLabel.getText()!.setText(indexLabel);
  pdfHealthfacilitiesLabel.setImage(
    new Circle({
      radius: 11,
      displacement: [15, 15],
      fill: new Fill({
        color,
      }),
    })
  );

  if (feature.get('type') == 'outreach') {
    return [pdfOutreachIcon, pdfHealthfacilitiesLabel];
  }

  return [pdfHealthfacilitiesIcon, pdfHealthfacilitiesLabel];
}
