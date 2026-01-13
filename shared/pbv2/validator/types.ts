import type { Finding } from "../findings";

export type ProductOptionTreeV2Json = Record<string, unknown>;

export type ValidateOpts = {
  strictPricebookRefsAtPublish: boolean;
  divByZeroStrict: boolean;
  negativeQuantityStrict: boolean;
  ambiguousEdgesStrict: boolean;
  outOfRangeSelectionsStrict: boolean;
};

export const DEFAULT_VALIDATE_OPTS: ValidateOpts = {
  strictPricebookRefsAtPublish: true,
  divByZeroStrict: false,
  negativeQuantityStrict: false,
  ambiguousEdgesStrict: true,
  outOfRangeSelectionsStrict: true,
};

export type ValidationResult = {
  ok: boolean;
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  info: Finding[];
};

export type RestoreChangeSet = {
  restoredNodeIds?: string[];
  restoredEdgeIds?: string[];
};
