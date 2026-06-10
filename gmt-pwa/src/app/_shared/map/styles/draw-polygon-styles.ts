import { Stroke, Style } from "ol/style";

export const DRAW_STYLE = [
  new Style({
    stroke: new Stroke({
      color: 'black',
      lineDash: [4, 6],
      width: 4
    })
  }),
  //draw_icon
];
