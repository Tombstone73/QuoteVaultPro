import { and, eq } from "drizzle-orm";
import { organizations, productTypes } from "@shared/schema";
import { db } from "../db";

export type InitialProductionRoute = {
  stationKey: string;
  stepKey: string;
  reason: string;
};

function inferStationKeyFromProductTypeName(productTypeName?: string | null): string | null {
  const value = String(productTypeName ?? "").trim().toLowerCase();
  if (!value) return null;

  if (value.includes("prepress")) return "prepress";
  if (value.includes("roll")) return "roll";
  if (value.includes("flatbed") || value.includes("sheet")) return "flatbed";
  if (value.includes("cnc")) return "cnc";
  if (value.includes("laminat")) return "lamination";
  if (value.includes("fabricat")) return "fabrication";
  if (value.includes("design")) return "design";
  if (value.includes("finish")) return "finishing";

  return null;
}

export async function resolveInitialProductionRoute(args: {
  organizationId: string;
  productTypeId?: string | null;
  lineItemRequiresPrepressSnapshot?: boolean;
}): Promise<InitialProductionRoute> {
  const { organizationId, productTypeId, lineItemRequiresPrepressSnapshot } = args;

  const [org] = await db
    .select({ prepressDefaultEnabled: organizations.prepressDefaultEnabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const orgPrepressDefaultEnabled = org?.prepressDefaultEnabled ?? true;

  const [productType] = productTypeId
    ? await db
        .select({
          defaultStationKey: productTypes.defaultStationKey,
          defaultStepKey: productTypes.defaultStepKey,
          requiresPrepressOverride: productTypes.requiresPrepressOverride,
          name: productTypes.name,
        })
        .from(productTypes)
        .where(and(eq(productTypes.organizationId, organizationId), eq(productTypes.id, productTypeId)))
        .limit(1)
    : [];

  const override = productType?.requiresPrepressOverride;

  const requiresPrepressEffective =
    override === true
      ? true
      : override === false
        ? false
        : typeof lineItemRequiresPrepressSnapshot === "boolean"
          ? lineItemRequiresPrepressSnapshot
          : orgPrepressDefaultEnabled;

  if (requiresPrepressEffective) {
    const reason =
      override === true
        ? "product_type_requires_prepress_override_true"
        : typeof lineItemRequiresPrepressSnapshot === "boolean"
          ? "line_item_requires_prepress_snapshot_true"
          : "organization_prepress_default_enabled";

    return {
      stationKey: "prepress",
      stepKey: "queued",
      reason,
    };
  }

  const productTypeStationKey = String(productType?.defaultStationKey ?? "").trim();
  const productTypeStepKey = String(productType?.defaultStepKey ?? "").trim();
  const inferredStationKey = inferStationKeyFromProductTypeName(productType?.name);

  const stationKey = productTypeStationKey || inferredStationKey || "flatbed";
  const stepKey = productTypeStepKey || "queued";

  const reason = productTypeStationKey
    ? "product_type_default_station"
    : inferredStationKey
      ? "product_type_name_inferred_station"
      : override === false
        ? "product_type_requires_prepress_override_false"
        : typeof lineItemRequiresPrepressSnapshot === "boolean"
          ? "line_item_requires_prepress_snapshot_false"
          : "organization_prepress_default_disabled_or_missing_station_default";

  return {
    stationKey,
    stepKey,
    reason,
  };
}
