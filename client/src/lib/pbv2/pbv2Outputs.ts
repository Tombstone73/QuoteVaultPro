import type {
  Pbv2PricingAddonsResult,
  Pbv2MaterialEffectsResult,
  Pbv2ChildItemProposalsResult,
} from "@shared/pbv2/pricingAdapter";

export type PBV2Outputs = {
  pricingAddons?: Pbv2PricingAddonsResult | null;
  materialEffects?: Pbv2MaterialEffectsResult | null;
  childItemProposals?: Pbv2ChildItemProposalsResult | null;
};
