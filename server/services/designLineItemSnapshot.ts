import type { ProductDesignConfig } from "@shared/schema";

export type DesignSnapshotFields = {
  requiresDesignSnapshot: boolean;
  designBriefRequiredSnapshot: boolean;
  estimatedDesignMinutesSnapshot: number | null;
  includedDesignMinutesSnapshot: number | null;
  designPricingModeSnapshot: ProductDesignConfig["designPricingMode"];
  flatFeeAmountSnapshot: string | null;
  hourlyRateSnapshot: string | null;
  overageRateSnapshot: string | null;
  internalLaborRateSnapshot: string | null;
};

export type MaterializedDesignSnapshot = DesignSnapshotFields & {
  needsDesignOverride: boolean | null;
  effectiveRequiresDesign: boolean;
};

export function buildDesignSnapshotFields(config: ProductDesignConfig | null): DesignSnapshotFields {
  return {
    requiresDesignSnapshot: config?.requiresDesign ?? false,
    designBriefRequiredSnapshot: config?.designBriefRequired ?? false,
    estimatedDesignMinutesSnapshot: config?.estimatedDesignMinutes ?? null,
    includedDesignMinutesSnapshot: config?.includedDesignMinutes ?? null,
    designPricingModeSnapshot: config?.designPricingMode ?? "none",
    flatFeeAmountSnapshot: config?.flatFeeAmount ?? null,
    hourlyRateSnapshot: config?.hourlyRate ?? null,
    overageRateSnapshot: config?.overageRate ?? null,
    internalLaborRateSnapshot: config?.internalLaborRate ?? null,
  };
}

export function materializeLineItemDesignSnapshot(args: {
  config: ProductDesignConfig | null;
  requestedNeedsDesignOverride?: boolean | null;
  requestedEffectiveRequiresDesign?: boolean | null;
  existingEffectiveRequiresDesign?: boolean | null;
}): MaterializedDesignSnapshot {
  const snapshot = buildDesignSnapshotFields(args.config);

  let desiredEffectiveRequiresDesign = snapshot.requiresDesignSnapshot;

  if (args.requestedNeedsDesignOverride !== undefined) {
    desiredEffectiveRequiresDesign = args.requestedNeedsDesignOverride ?? snapshot.requiresDesignSnapshot;
  } else if (typeof args.requestedEffectiveRequiresDesign === "boolean") {
    desiredEffectiveRequiresDesign = args.requestedEffectiveRequiresDesign;
  } else if (typeof args.existingEffectiveRequiresDesign === "boolean") {
    desiredEffectiveRequiresDesign = args.existingEffectiveRequiresDesign;
  }

  return {
    ...snapshot,
    needsDesignOverride:
      desiredEffectiveRequiresDesign === snapshot.requiresDesignSnapshot ? null : desiredEffectiveRequiresDesign,
    effectiveRequiresDesign: desiredEffectiveRequiresDesign,
  };
}

export function copyLineItemDesignSnapshotFields(source: {
  requiresDesignSnapshot?: boolean | null;
  designBriefRequiredSnapshot?: boolean | null;
  estimatedDesignMinutesSnapshot?: number | null;
  includedDesignMinutesSnapshot?: number | null;
  designPricingModeSnapshot?: string | null;
  flatFeeAmountSnapshot?: string | null;
  hourlyRateSnapshot?: string | null;
  overageRateSnapshot?: string | null;
  internalLaborRateSnapshot?: string | null;
  needsDesignOverride?: boolean | null;
  requiresDesign?: boolean | null;
}): MaterializedDesignSnapshot {
  const requiresDesignSnapshot = source.requiresDesignSnapshot ?? source.requiresDesign ?? false;
  const designBriefRequiredSnapshot = source.designBriefRequiredSnapshot ?? false;
  const designPricingModeSnapshot = (source.designPricingModeSnapshot ?? "none") as MaterializedDesignSnapshot["designPricingModeSnapshot"];
  const effectiveRequiresDesign = source.needsDesignOverride ?? requiresDesignSnapshot;

  return {
    requiresDesignSnapshot,
    designBriefRequiredSnapshot,
    estimatedDesignMinutesSnapshot: source.estimatedDesignMinutesSnapshot ?? null,
    includedDesignMinutesSnapshot: source.includedDesignMinutesSnapshot ?? null,
    designPricingModeSnapshot,
    flatFeeAmountSnapshot: source.flatFeeAmountSnapshot ?? null,
    hourlyRateSnapshot: source.hourlyRateSnapshot ?? null,
    overageRateSnapshot: source.overageRateSnapshot ?? null,
    internalLaborRateSnapshot: source.internalLaborRateSnapshot ?? null,
    needsDesignOverride: source.needsDesignOverride ?? null,
    effectiveRequiresDesign,
  };
}