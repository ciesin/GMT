import {
  ALL_FREQUENCIES,
  ALL_HEALTH_FACILITY_CATCHMENT_STATUS,
  ALL_HEALTH_FACILITY_LEVEL_OF_CARE,
  ALL_HEALTH_FACILITY_MATURITY_LEVEL,
  ALL_HEALTH_FACILITY_MEANS_OF_TRANSPORT,
  ALL_HEALTH_FACILITY_PRIMARY_TYPE,
  ALL_HEALTH_FACILITY_SERVICES,
  ALL_HEALTH_FACILITY_STAFF_POSITION,
  ALL_HEALTH_FACILITY_STAFF_TYPE,
  Frequency,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { formatFrequency } from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';

export const OWNERSHIP_PRIVATE = 'Private';
export const OWNERSHIP_PUBLIC = 'Public';

export type HealthFacilityOwnership =
  | typeof OWNERSHIP_PRIVATE
  | typeof OWNERSHIP_PUBLIC;

export const RI_SERVICE = 'Routine Immunization';

//value is both the label and the key
/*const DAY_MONDAY = "Mo";
const DAY_TUESDAY = "Tu";
const DAY_WEDNESDAY = "We";
const DAY_THURSDAY = "Th";
const DAY_FRIDAY = "Fr";
const DAY_SATURDAY = "Sa";
const DAY_SUNDAY = "Su";*/

export const NOT_OPERATING_HOURS: string = '00:00:00';
export const OPERATING_HOURS: string = '23:59:59';

export const ownershipOptions: Array<SelectOption> = [
  OWNERSHIP_PRIVATE,
  OWNERSHIP_PUBLIC,
].map((type) => {
  return { value: type, label: type };
});

export const hfTypesOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_LEVEL_OF_CARE.map((type) => {
    return {
      value: type,
      label: type,
    };
  });

// Drop down options
export const hfMaturityOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_MATURITY_LEVEL.map((type) => {
    return { value: type, label: type };
  });

export const hfPrimaryTypeOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_PRIMARY_TYPE.map((type) => {
    return { value: type, label: type };
  });
export const mpStatusOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_CATCHMENT_STATUS.map((type) => {
    return { value: type, label: type };
  });

// Drop down options

//Note frequency is special because the displayed frequency "weekly" maps to 1 of 7 actual frequencies
export const frequencyOptions: Array<SelectOption> = [
  ...(
    [
      UNKNOWN,
      'oncePerMonth',
      'twicePerMonth',
      'threePerMonth',
      'other',
    ] as Array<Frequency>
  ).map((freq: Frequency) => {
    return {
      value: freq,
      label: formatFrequency(freq),
    };
  }),
  { value: 'weekly', label: 'Weekly' },
];

export const transportOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_MEANS_OF_TRANSPORT.map((transport) => {
    return { value: transport, label: transport };
  });

export const servicesOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_SERVICES.map((service) => {
    return { value: service, label: service };
  });

export const staffPositionOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_STAFF_POSITION.map((staffPosition) => {
    return { value: staffPosition, label: staffPosition };
  });

export const staffTypeOptions: Array<SelectOption> =
  ALL_HEALTH_FACILITY_STAFF_TYPE.map((staffType) => {
    return { value: staffType, label: staffType };
  });
