import { SelectOption } from "src/app/utils/ui/ui-component-interfaces";
import { ALL_PROBLEMATIC_OPTIONS, ALL_UNINHABITED_OPTIONS } from "src/app/utils/server-interfaces/GeoJson";

// Drop down options
export const problematicOptions: Array<SelectOption> = ALL_PROBLEMATIC_OPTIONS.map(type => {
  return { value: type, label: type }
});
export const uninhabitedReasonsOptions: Array<SelectOption> = ALL_UNINHABITED_OPTIONS.map(type => {
  return { value: type, label: type }
});
