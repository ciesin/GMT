import { Fill, Stroke, Style } from "ol/style"; // Circle, Icon, RegularShape,
import { ColorLike } from "ol/colorlike";
import { asArray, asString } from "ol/color";
import { SettlementType, StrategyPatterns } from "src/app/utils/server-interfaces/GeoJson";
import { getRGBColorFromCSS } from "./map-styles";
import { mapStyles } from "./map-design";
// TODO: migrate to getFont @see map-styles.ts
export const DEFAULT_MAP_FONT = 'Bold 16px Verdana';


//203 53 202
const buaColor = asString([203, 53, 202]);
//32 112 233
const ssaColor = asString([32, 112, 233]);
//255 175 16
const haColor = asString([255, 175, 16]);

const gmtColor = asString([255, 15, 15]);

export const typeToColor: Map<SettlementType, string> = (() => {
  const m = new Map<SettlementType, string>();
  m.set("bua", buaColor);
  m.set("ha", haColor);
  m.set("ssa", ssaColor);
  m.set("gmt", gmtColor);
  return m;
})();

export function vPolygonStyle(color: ColorLike, strokeColor: ColorLike): Style {
  return new Style({
    stroke: new Stroke({
      color: strokeColor,
      width: 1,
    }),
    fill: new Fill({ color }),
  });
}

export function polygonStyle(color: ColorLike, settlementsFillPattern: StrategyPatterns | null): Style {
  let fill: Fill = new Fill({ color });
  if (settlementsFillPattern == "fixed_post") {
    fill.setColor(colorWithAlpha(color as string, 0.05));
  } else {
    fill.setColor(colorWithAlpha(color as string, 0.05));
  }
  return new Style({
    stroke: new Stroke({
      color: colorWithAlpha(color as string, 0.9),
      width: 1,
    }),
    fill: fill,
  });
};

//https://stackoverflow.com/questions/28004153/setting-vector-feature-fill-opacity-when-you-have-a-hexadecimal-color
export function colorWithAlpha(color: string, alpha: number) {
  let [r, g, b] = [0, 0, 0];
  if (color) {
    [r, g, b] = Array.from(asArray(color));
  }

  return asString([r, g, b, alpha]);
}