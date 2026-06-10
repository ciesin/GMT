import {Fill, Stroke, Style} from "ol/style";
import {ColorLike} from "ol/colorlike";
import {colorWithAlpha} from "./service-api-styles";

export function hfBufferStyle(fillColor: ColorLike) {
  let fill: Fill = new Fill({color: colorWithAlpha(fillColor as string, 0.3)});
  return new Style({
    stroke: new Stroke({
      color: '#525252',
      width: 1,
    }),
    fill: fill,
  });
}
