
//https://stackoverflow.com/questions/44480644/string-union-to-string-array


export const ALL_BASELINE_VISUALIZATIONS = [
  //V polygons of HF and PN points, coloured by HF if only HF claiming it
  "Voronoi",

  //Alpha shapes around catchments (current best)
  "AlphaShapes",
  //"ConvexHull",

  //Just colour settlements
  "Settlements"
] as const;
type AllBaselineVisualizations = typeof ALL_BASELINE_VISUALIZATIONS;

export type BaselineVisualization = AllBaselineVisualizations[number];
