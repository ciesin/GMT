import { object, string, array, boolean } from 'yup';

export interface ExportRequest {
  boundaryIds: string[];
  gdb: boolean;
  excel: boolean;
  rew: boolean;
  ExportRequestSchema
}

export const ExportRequestSchema = object({
  boundaryIds: array().of(string().uuid()).min(1, "No boundaries were selected"),
  gdb: boolean().required(),
  excel: boolean().required(),
  rew: boolean().required(),
  // if excel 1 file per boundary, does not impact rew
  boundariesSingle: boolean().required(),
}).defined();