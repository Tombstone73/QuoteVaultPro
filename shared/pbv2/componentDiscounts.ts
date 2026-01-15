import type { Ref } from "./refContract";

export type PricingTier = "default" | "wholesale" | "retail";

export type Pbv2ComponentDiscountScope = "none" | "customerTier" | "volume" | "customerTier+volume";
export type Pbv2ComponentVolumeTrigger = "componentQty" | "productQty";
export type Pbv2ComponentDiscountMethod = "percentage" | "fixedPerUnit" | "tierTable";

export type Pbv2VolumePercentTier = {
  minQty: number;
  percentOff: number;
  customerTier?: PricingTier;
};

export type Pbv2VolumeFixedTier = {
  minQty: number;
  centsOffPerUnit: number;
  customerTier?: PricingTier;
};

export type Pbv2VolumeUnitPriceTier = {
  minQty: number;
  unitPriceCents: number;
  customerTier?: PricingTier;
};

export type Pbv2ComponentDiscountConfig = {
  discountEligible?: boolean;
  discountScope?: Pbv2ComponentDiscountScope;
  volumeTrigger?: Pbv2ComponentVolumeTrigger;
  discountMethod?: Pbv2ComponentDiscountMethod;

  // percentage
  customerTierPercentByTier?: Partial<Record<PricingTier, number>>;
  volumePercentTiers?: Pbv2VolumePercentTier[];
  volumePercentTiersRef?: Ref;

  // fixedPerUnit
  customerTierCentsOffPerUnitByTier?: Partial<Record<PricingTier, number>>;
  volumeCentsOffPerUnitTiers?: Pbv2VolumeFixedTier[];
  volumeCentsOffPerUnitTiersRef?: Ref;

  // tierTable
  customerTierUnitPriceCentsByTier?: Partial<Record<PricingTier, number>>;
  volumeUnitPriceCentsTiers?: Pbv2VolumeUnitPriceTier[];
  volumeUnitPriceCentsTiersRef?: Ref;
};

export type Pbv2DiscountApplicationContext = {
  customerTier?: PricingTier;
  productQty?: number;
};

export type Pbv2DiscountedAmounts = {
  amountCentsBeforeDiscount: number;
  amountCentsAfterDiscount: number;
  unitPriceCentsBeforeDiscount?: number;
  unitPriceCentsAfterDiscount?: number;
  tierStep?: {
    customerTier: PricingTier;
    unitPriceCentsAfterTier?: number;
  };
  volumeStep?: {
    triggerQty: number;
    volumeTrigger: Pbv2ComponentVolumeTrigger;
    unitPriceCentsAfterVolume?: number;
  };
};

function includesCustomerTier(scope: Pbv2ComponentDiscountScope): boolean {
  return scope === "customerTier" || scope === "customerTier+volume";
}

function includesVolume(scope: Pbv2ComponentDiscountScope): boolean {
  return scope === "volume" || scope === "customerTier+volume";
}

function coerceNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

function clampPercentOff(percentOff: number): number {
  if (!Number.isFinite(percentOff)) return 0;
  return Math.min(Math.max(percentOff, 0), 100);
}

function selectBestTierByQty<T extends { minQty: number; customerTier?: PricingTier }>(
  tiers: T[] | undefined,
  qty: number,
  customerTier: PricingTier | undefined
): T | null {
  if (!tiers || !Array.isArray(tiers) || tiers.length === 0) return null;

  let best: T | null = null;
  for (const t of tiers) {
    if (!t || typeof t !== "object") continue;
    const minQty = coerceNonNegativeNumber((t as any).minQty);
    if (minQty == null) continue;
    if (qty < minQty) continue;

    const tierMatch = (t as any).customerTier;
    if (tierMatch && customerTier && tierMatch !== customerTier) continue;
    if (tierMatch && !customerTier) continue;

    if (!best || minQty > best.minQty) best = t;
  }

  return best;
}

export function applyDiscountToPbv2ComponentAmounts(args: {
  quantity: number;
  unitPriceCents: number;
  discountConfig?: Pbv2ComponentDiscountConfig | null;
  ctx?: Pbv2DiscountApplicationContext | null;
}): { unitPriceCents: number; amountCents: number; debug?: Pbv2DiscountedAmounts } {
  const quantityRaw = args.quantity;
  const unitPriceCentsRaw = args.unitPriceCents;

  const qty = Number.isFinite(quantityRaw) ? quantityRaw : 0;
  const unitPriceCents0 = Number.isFinite(unitPriceCentsRaw) ? Math.round(unitPriceCentsRaw) : 0;

  const baseAmountCents = Math.round(qty * unitPriceCents0);

  const dc = args.discountConfig ?? undefined;
  if (!dc) {
    return { unitPriceCents: unitPriceCents0, amountCents: baseAmountCents };
  }

  const eligible = dc.discountEligible !== undefined ? !!dc.discountEligible : true;
  if (!eligible) {
    return { unitPriceCents: unitPriceCents0, amountCents: baseAmountCents };
  }

  const scope: Pbv2ComponentDiscountScope =
    dc.discountScope === "none" || dc.discountScope === "customerTier" || dc.discountScope === "volume" || dc.discountScope === "customerTier+volume"
      ? dc.discountScope
      : "none";

  if (scope === "none") {
    return { unitPriceCents: unitPriceCents0, amountCents: baseAmountCents };
  }

  const method: Pbv2ComponentDiscountMethod =
    dc.discountMethod === "percentage" || dc.discountMethod === "fixedPerUnit" || dc.discountMethod === "tierTable" ? dc.discountMethod : "percentage";

  const ctx = args.ctx ?? undefined;
  const customerTier = ctx?.customerTier;

  let unitPriceCentsAfterTier = unitPriceCents0;
  let tierStep: Pbv2DiscountedAmounts["tierStep"] | undefined;

  if (includesCustomerTier(scope) && customerTier) {
    if (method === "tierTable") {
      const override = dc.customerTierUnitPriceCentsByTier?.[customerTier];
      if (override != null && Number.isFinite(Number(override))) {
        unitPriceCentsAfterTier = Math.max(0, Math.round(Number(override)));
      }
    } else if (method === "fixedPerUnit") {
      const centsOff = dc.customerTierCentsOffPerUnitByTier?.[customerTier];
      if (centsOff != null && Number.isFinite(Number(centsOff))) {
        unitPriceCentsAfterTier = Math.max(0, unitPriceCentsAfterTier - Math.round(Number(centsOff)));
      }
    } else {
      const percentOff = dc.customerTierPercentByTier?.[customerTier];
      if (percentOff != null && Number.isFinite(Number(percentOff))) {
        const p = clampPercentOff(Number(percentOff));
        unitPriceCentsAfterTier = Math.max(0, Math.round(unitPriceCentsAfterTier * (1 - p / 100)));
      }
    }

    tierStep = { customerTier, unitPriceCentsAfterTier };
  }

  let unitPriceCentsAfterVolume = unitPriceCentsAfterTier;
  let volumeStep: Pbv2DiscountedAmounts["volumeStep"] | undefined;

  if (includesVolume(scope)) {
    const volumeTrigger: Pbv2ComponentVolumeTrigger = dc.volumeTrigger === "componentQty" || dc.volumeTrigger === "productQty" ? dc.volumeTrigger : "productQty";

    const productQty = Number.isFinite(Number(ctx?.productQty)) ? Number(ctx?.productQty) : 0;
    const triggerQty = volumeTrigger === "productQty" ? productQty : qty;

    if (triggerQty > 0) {
      if (method === "tierTable") {
        const best = selectBestTierByQty(dc.volumeUnitPriceCentsTiers, triggerQty, customerTier);
        if (best) {
          unitPriceCentsAfterVolume = Math.max(0, Math.round(Number(best.unitPriceCents)));
        }
      } else if (method === "fixedPerUnit") {
        const best = selectBestTierByQty(dc.volumeCentsOffPerUnitTiers, triggerQty, customerTier);
        if (best) {
          unitPriceCentsAfterVolume = Math.max(0, unitPriceCentsAfterVolume - Math.round(Number(best.centsOffPerUnit)));
        }
      } else {
        const best = selectBestTierByQty(dc.volumePercentTiers, triggerQty, customerTier);
        if (best) {
          const p = clampPercentOff(Number(best.percentOff));
          unitPriceCentsAfterVolume = Math.max(0, Math.round(unitPriceCentsAfterVolume * (1 - p / 100)));
        }
      }

      volumeStep = { triggerQty, volumeTrigger, unitPriceCentsAfterVolume };
    }
  }

  const finalAmountCents = Math.round(qty * unitPriceCentsAfterVolume);

  return {
    unitPriceCents: unitPriceCentsAfterVolume,
    amountCents: finalAmountCents,
    debug: {
      amountCentsBeforeDiscount: baseAmountCents,
      amountCentsAfterDiscount: finalAmountCents,
      unitPriceCentsBeforeDiscount: unitPriceCents0,
      unitPriceCentsAfterDiscount: unitPriceCentsAfterVolume,
      tierStep,
      volumeStep,
    },
  };
}
