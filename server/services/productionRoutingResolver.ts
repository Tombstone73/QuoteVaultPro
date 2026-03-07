import { and, eq } from "drizzle-orm";
import { organizations, productTypes } from "@shared/schema";
import { db } from "../db";

export type InitialProductionRoute = {
  stationKey: string;
  stepKey: string;
  reason: string;
};

type ProductTypeRoutingSnapshot = {
  defaultStationKey?: string | null;
  defaultStepKey?: string | null;
  name?: string | null;
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

function buildNonPrepressRoute(productType?: ProductTypeRoutingSnapshot): InitialProductionRoute {
  const productTypeStationKey = String(productType?.defaultStationKey ?? "").trim();
  const productTypeStepKey = String(productType?.defaultStepKey ?? "").trim();
  const inferredStationKey = inferStationKeyFromProductTypeName(productType?.name);

  const stationKey =
    productTypeStationKey && productTypeStationKey.toLowerCase() !== "prepress"
      ? productTypeStationKey
      : inferredStationKey && inferredStationKey.toLowerCase() !== "prepress"
        ? inferredStationKey
        : "flatbed";

  const stepKey = productTypeStepKey || "queued";

  const reason = productTypeStationKey && productTypeStationKey.toLowerCase() !== "prepress"
    ? "product_type_default_station"
    : inferredStationKey && inferredStationKey.toLowerCase() !== "prepress"
      ? "product_type_name_inferred_station"
      : "post_prepress_fallback_flatbed";

  return {
    stationKey,
    stepKey,
    reason,
  };
}

export async function resolvePostPrepressProductionRoute(args: {
  organizationId: string;
  productTypeId?: string | null;
  productTypeNameSnapshot?: string | null;
}): Promise<InitialProductionRoute> {
  const { organizationId, productTypeId, productTypeNameSnapshot } = args;

  const [productType] = productTypeId
    ? await db
        .select({
          defaultStationKey: productTypes.defaultStationKey,
          defaultStepKey: productTypes.defaultStepKey,
          name: productTypes.name,
        })
        .from(productTypes)
        .where(and(eq(productTypes.organizationId, organizationId), eq(productTypes.id, productTypeId)))
        .limit(1)
    : [];

  return buildNonPrepressRoute({
    defaultStationKey: productType?.defaultStationKey,
    defaultStepKey: productType?.defaultStepKey,
    name: productType?.name || productTypeNameSnapshot,
  });
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

  const nonPrepressRoute = buildNonPrepressRoute(productType);

  const reason = nonPrepressRoute.reason === "post_prepress_fallback_flatbed"
    ? override === false
      ? "product_type_requires_prepress_override_false"
      : typeof lineItemRequiresPrepressSnapshot === "boolean"
        ? "line_item_requires_prepress_snapshot_false"
        : "organization_prepress_default_disabled_or_missing_station_default"
    : nonPrepressRoute.reason;

  return {
    stationKey: nonPrepressRoute.stationKey,
    stepKey: nonPrepressRoute.stepKey,
    reason,
  };
}
