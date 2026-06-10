export interface Boundary {
  global_id: string,
  code: string,
  level: number,
  name?: string,
  boundary_polygon?: string,
  properties?: string, // TODO - never used so not hard typed
  version_id?: number,
}