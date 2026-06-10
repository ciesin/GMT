import { Fill, Icon, Stroke, Style } from 'ol/style';

export const goodAccuracyStyle = new Style({
  stroke: new Stroke({
    color: 'blue',
    width: 2,
  }),
  fill: new Fill({
    color: 'rgba(0, 0, 255, 0.1)',
  }),
});
export const badAccuracyStyle = new Style({
  stroke: new Stroke({
    color: 'red',
    width: 2,
  }),
  fill: new Fill({
    color: 'rgba(255, 0, 0, 0.1)',
  }),
});

export const activeLocationStyle = new Style({
  image: new Icon({
    opacity: 0.8,
    // @ts-ignore
    imgSize: [40, 40],
    src: 'assets/icons/map/tabletLocation.svg',
  }),
});

export const notActiveLocationStyle = new Style({
  image: new Icon({
    opacity: 0.8,
    // @ts-ignore
    imgSize: [40, 40],
    src: 'assets/icons/map/tabletLocationNotActive.svg',
  }),
});
