import { FeatureLike } from "ol/Feature";
import {GeoJsonHealthFacility, GeoJsonSettlementName} from "src/app/utils/server-interfaces/GeoJson";

export function isHfFixedPostForGeoJson(hf: GeoJsonHealthFacility): boolean{
  return (hf as GeoJsonHealthFacility).properties.type == "fixed_post";
}

export function isHfRiForOlFeature(hf: FeatureLike): boolean{
  return (hf as FeatureLike).get('services').includes('Routine Immunization');
}
export function snIsProblematicForGeoJson(settlementNames: GeoJsonSettlementName[]){
  if(settlementNames.length == 0){
    return true; // if st has no names, maybe it has issues by default
  }
  return settlementNames.some(settlementName => {
    if (!Array.isArray(settlementName.properties.problematic)) {
      return false;
    }
    return settlementName.properties.problematic.length > 0;
  });
}
export function snIsUninhabitedForGeoJson(settlementNames: GeoJsonSettlementName[]){
  if(settlementNames.length == 0){
    return false;
  }
  return settlementNames.some(settlementName => {
    return settlementName.properties?.uninhabited;
  });
}
