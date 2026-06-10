import { FeatureLike } from 'ol/Feature';
import { Circle, Fill, Icon, Stroke, Style, Text } from 'ol/style';
import ImageStyle from 'ol/style/Image';
import { StyleFunction, StyleLike } from 'ol/style/Style';

// From https://openlayers.org/en/latest/examples/vector-labels.html
const stringDivider = (
  str: string,
  width: number,
  spaceReplacer: string
): string => {
  if (str.length > width) {
    let p = width;
    while (p > 0 && str[p] != ' ' && str[p] != '-') {
      p--;
    }
    if (p > 0) {
      let left;
      if (str.substring(p, p + 1) == '-') {
        left = str.substring(0, p + 1);
      } else {
        left = str.substring(0, p);
      }
      const right = str.substring(p + 1);
      return left + spaceReplacer + stringDivider(right, width, spaceReplacer);
    }
  }
  return str;
};

/**
 * Options for text labels
 */
interface labelOptions {
  maxResolution?: number;
  minResolution?: number;
  labelKey?: string;
  labelPlacement?: 'line' | 'point';
  labelType?: 'normal' | 'hide' | 'shorten' | 'wrap';
  labelWidth?: number;
  labelChars?: number;
}

// export const createGradient = (size: [number, number], color: string) =>{
//   const canvas = document.createElement(`canvas`);
//   (canvas as any).width = size[0] * 1.5;
//   (canvas as any).height = size[1] * 1.5;
//   const context = (canvas as any).getContext('2d');
//   const pixelRatio = DEVICE_PIXEL_RATIO;
//   const gradient = context.createRadialGradient(
//     size[0]+1 + size[0] / 2,
//     size[1]+1 + size[1] / 2,
//     Math.min(...size) / 2,
//     size[0]+1 + size[0] / 2,
//     size[1]+1 + size[1] / 2,
//     Math.min(...size),
//   );
//   gradient.addColorStop(0, color);
//   gradient.addColorStop(1, "rgba(255,255,255,0.0)");
//   return gradient;
// }

/**
 * A cache for ions to minimize memory footprint of style objects
 */
const iconCache: { [key: string]: Style } = {};

/**
 * Ths method creates an outline around icons with a defined thickness and color
 * @param icon
 * @param color
 * @param thickness
 */
const createIconOutlineStyle = (
  icon: Icon,
  color: string,
  thickness?: number
): Style => {
  // @ts-ignore
  const image = icon.getImage();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const dArr = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1];
  const applied_thickness = thickness ? thickness * 1.5 : 6;

  canvas.width = image.width + applied_thickness + applied_thickness;
  canvas.height = image.height + applied_thickness + applied_thickness;

  if (context) {
    for (let i = 0; i < dArr.length; i += 2) {
      context.drawImage(
        image,
        applied_thickness + dArr[i] * applied_thickness,
        applied_thickness + dArr[i + 1] * applied_thickness
      );
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(
        image,
        applied_thickness,
        applied_thickness,
        image.width,
        image.height
      );
    }
  } else {
    console.error('No browser context available to create icon outline');
  }

  return new Style({
    image: new Icon({
      crossOrigin: 'anonymous',
      src: undefined,
      img: canvas,
      //imgSize: canvas ? [canvas.width, canvas.height] : undefined
    }),
  });
};

/**
 * Applies certain style properties from style2 to style1. This is for instance needed if we want to apply an
 * highlight/select style to a feature. This method simply takes for instance an existing text style or icon style
 * from the feature and applies it to the highlight/select style, thus we avoid to manually re-create the text or icon
 * in the highlight/select style.
 * @param style1
 * @param style2
 * @param feature
 * @param resolution
 */
export const applyStyle = (
  style1: StyleLike | undefined,
  style2: StyleLike,
  feature: FeatureLike,
  resolution: number
): StyleFunction => {
  const appplyFn = (feature: FeatureLike, resolution: number): StyleLike => {
    const style =
      style1 instanceof Style
        ? style1
        : ((style1 as StyleFunction)(feature, resolution) as Style);
    const style2_text = extractStyleText(style2, feature, resolution);
    const style2_image = extractStyleImage(style2, feature, resolution);

    // Apply text from style 2
    // @ts-ignore
    style.text_ = undefined;
    if (typeof style.setText === 'function') {
      style.setText(style2_text as Text);
    }
    // Apply image from style 2
    if (style2_image) {
      if (style2_image instanceof Icon) {
        // @ts-ignore
        const style_id = `${style2_image.getSrc()}_${style2_image.getImageSize()}_${
          style.getStroke()?.getWidth() ||
          // @ts-ignore
          style.getImage()!.getStroke()?.getWidth() // @ts-ignore
        }`;
        if (iconCache[style_id] === undefined) {
          let color = 'grey';
          let stroke = 2;
          if (style.getFill()) {
            color = style.getFill()?.getColor() as string;
          } else if (style.getImage()) {
            // @ts-ignore
            color =
              // @ts-ignore
              style.getImage()?.getStroke()?.getColor() || // @ts-ignore
              style.getImage()?.getFill()?.getColor(); // @ts-ignore
          }
          if (style.getStroke()) {
            stroke = style.getStroke()?.getWidth() as number;
            // @ts-ignore
          } else if (style.getImage()) {
            // @ts-ignore
            stroke = style.getImage()?.getStroke()?.getWidth() as number;
          }
          iconCache[style_id] = createIconOutlineStyle(
            style2_image,
            color,
            stroke
          );
        }
        return iconCache[style_id];
      }
      // @ts-ignore
      style.image_ = undefined;
      style.setImage(style2_image as ImageStyle);
    }
    return style as Style;
  };
  return appplyFn as StyleFunction;
};

/**
 * Extracts a style from a style like object (so either style or style function).
 * The latter is the reason why we also need a feature and a resolution.
 * @param style
 * @param feature
 * @param resolution
 */
export const extractStyle = (
  style: StyleLike,
  feature: FeatureLike,
  resolution: number
): Style => {
  return style instanceof Style
    ? style
    : ((style as StyleFunction)(feature, resolution) as Style);
};

/**
 * If present, extracts a stroke style from a style like object (so either style or style function).
 * The latter is the reason why we also need a feature and a resolution.
 * @param style
 * @param feature
 * @param resolution
 */
// export const extractStyleStroke = (style: StyleLike, feature: FeatureLike, resolution: number): Stroke | undefined => {
//   return extractStyle(style, feature, resolution).getStroke();
// }

/**
 * If present, extracts a fill style from a style like object (so either style or style function).
 * The latter is the reason why we also need a feature and a resolution.
 * @param style
 * @param feature
 * @param resolution
 */
// export const extractStyleFill = (style: StyleLike, feature: FeatureLike, resolution: number): Fill | undefined => {
//   return extractStyle(style, feature, resolution).getFill();
// }

/**
 * If present, extracts a text style from a style like object (so either style or style function).
 * The latter is the reason why we also need a feature and a resolution.
 * @param style
 * @param feature
 * @param resolution
 */
const extractStyleText = (
  style: StyleLike,
  feature: FeatureLike,
  resolution: number
): Text | undefined => {
  try {
    return extractStyle(style, feature, resolution)?.getText()!;
  } catch (error) {
    return undefined;
  }
};

/**
 * If present, extracts an image style from a style like object (so either style or style function).
 * The latter is the reason why we also need a feature and a resolution.
 * @param style
 * @param feature
 * @param resolution
 */
const extractStyleImage = (
  style: StyleLike,
  feature: FeatureLike,
  resolution: number
): ImageStyle | undefined => {
  try {
    return extractStyle(style, feature, resolution).getImage()!;
  } catch (error) {
    return undefined;
  }
};

/**
 * Extracts a text label from a feature like object. The label can be influenced by label options
 * @param feature
 * @param resolution
 * @param options
 */
export const getLabelText = (
  feature: FeatureLike,
  resolution: number,
  options?: labelOptions
): string => {
  const type = options?.labelType || 'normal';
  const maxResolution = options?.maxResolution || undefined;
  const minResolution = options?.minResolution || undefined;
  const text = feature.get(options?.labelKey || 'name');
  if (maxResolution !== undefined && resolution > maxResolution) {
    return '';
  } else if (minResolution !== undefined && resolution < minResolution) {
    return '';
  } else if (type === 'hide') {
    return '';
  } else if (type === 'shorten') {
    // TODO: Implement still
    return text;
  } else if (type === 'wrap' && options?.labelPlacement != 'line') {
    return stringDivider(text, options?.labelWidth || 30, '\n');
  }
  return text;
};

/**
 * Generates a Style.font attr value, using consistent defaults and base font
 * @param size
 * @param variant
 *
 * @todo to maintain consistency in styling, it would be good to consider
 * a refactor, as this is all a quick patch
 */
export const getFontStyle = (
  size: number = 0.85,
  variant: string = '500'
): string => {
  return `${variant} ${size}rem "Noto Sans"`;
};

/**
 * Get the CSS var property value and return its RGB composant.
 *  This expects the color to come from the theme and have the less plugin that adds
 *  the color variable rgb value in the prefixed -rgb CSS variable.
 *
 * @param property The css variable, e.g.: --catchement-fixed
 * @returns A list of rgb number, e.g.: [32, 129, 214]
 */
export function getRGBColorFromCSS(property: string): number[] {
  if (!property.endsWith('-rgb')) {
    property += '-rgb';
  }
  return window
    .getComputedStyle(document.body)
    .getPropertyValue(property)
    .split(',')
    .map((x) => parseInt(x));
}

/**
 * Get the CSS var property value and return its hex value.
 *  This expects the color to come from the theme and have the less plugin that adds
 *  the color variable rgb value in the prefixed -rgb CSS variable.
 *
 * @param property The css variable, e.g.: --catchement-fixed
 * @returns A string of the CSS hex color value
 */
export function getHexColorFromCSS(property: string): string {
  return window.getComputedStyle(document.body).getPropertyValue(property); //.replace(/[""]/g, '');
}

/**
 * A default highlighted style for maps
 */
const style_highlighted_points = new Style({
  image: new Circle({
    fill: new Fill({
      color: 'rgba(166, 13, 166, 0.1)',
    }),
    stroke: new Stroke({
      color: 'rgba(166, 13, 166)',
      width: 1,
    }),
    radius: 5,
  }),
});
const style_highlighted_polygons_lines = new Style({
  stroke: new Stroke({
    color: 'rgba(166, 13, 166, 0.7)',
    width: 1,
  }),
  // It is important, that this style has a fill!
  fill: new Fill({
    color: 'rgba(166, 13, 166, 0.1)',
  }),
});
export const highlighted: StyleFunction = (
  feature: FeatureLike,
  resolution: number
): Style => {
  const type = feature.getGeometry()?.getType() || '';
  if (['Point', 'MultiPoint'].includes(type)) {
    return style_highlighted_points;
  }
  return style_highlighted_polygons_lines;
};

/**
 * A default selected style for maps
 */
const style_selected_points = new Style({
  image: new Circle({
    fill: new Fill({
      color: 'rgba(166, 13, 166)',
    }),
    stroke: new Stroke({
      color: 'rgba(166, 13, 166)',
      width: 2,
    }),
    radius: 6,
  }),
});
const style_selected_polygons_linesstroke = new Style({
  stroke: new Stroke({
    color: 'rgba(166, 13, 166, 1.0)',
    width: 3,
  }),
  // It is important, that this style has a fill!
  fill: new Fill({
    color: 'rgba(166, 13, 166, 0.1)',
  }),
});
export const selected: StyleFunction = (
  feature: FeatureLike,
  resolution: number
): Style => {
  const type = feature.getGeometry()?.getType() || '';
  if (['Point', 'MultiPoint'].includes(type)) {
    return style_selected_points;
  }
  return style_selected_polygons_linesstroke;
};
