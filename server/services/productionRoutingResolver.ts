import { and, eq, sql } from "drizzle-orm";
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

const DEFAULT_ROUTE_STEP_KEY = "queued";

function normalizeManagedStepKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

async function resolveManagedStepKeyOrFallback(args: {
  organizationId: string;
  stationKey: string;
  stepKey?: string | null;
  context: string;
}): Promise<string> {
  const stationKey = String(args.stationKey ?? "").trim();
  const requestedStepKey = normalizeManagedStepKey(args.stepKey);

  if (!stationKey) return DEFAULT_ROUTE_STEP_KEY;
  if (!requestedStepKey || requestedStepKey === DEFAULT_ROUTE_STEP_KEY) {
    return DEFAULT_ROUTE_STEP_KEY;
  }

  const result = await db.execute(sql`
    select active
    from production_station_steps
    where organization_id = ${args.organizationId}
      and station_key = ${stationKey}
      and key = ${requestedStepKey}
    limit 1
  `);

  const row = result.rows?.[0] as { active?: boolean } | undefined;
  if (row?.active !== false && row) {
    return requestedStepKey;
  }

  console.warn("[ProductionRoutingResolver] invalid managed step; falling back to queued", {
    organizationId: args.organizationId,
    stationKey,
    stepKey: requestedStepKey,
    reason: row ? "inactive_step" : "missing_step",
    context: args.context,
  });

  return DEFAULT_ROUTE_STEP_KEY;
}

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

  const route = buildNonPrepressRoute({
    defaultStationKey: productType?.defaultStationKey,
    defaultStepKey: productType?.defaultStepKey,
    name: productType?.name || productTypeNameSnapshot,
  });

  return {
    ...route,
    stepKey: await resolveManagedStepKeyOrFallback({
      organizationId,
      stationKey: route.stationKey,
      stepKey: route.stepKey,
      context: "resolvePostPrepressProductionRoute",
    }),
  };
}

export async function resolveInitialProductionRoute(args: {
  organizationId: string;
  productTypeId?: string | null;
  lineItemRequiresDesignSnapshot?: boolean;
  lineItemRequiresPrepressSnapshot?: boolean;
}): Promise<InitialProductionRoute> {
  const { organizationId, productTypeId, lineItemRequiresDesignSnapshot, lineItemRequiresPrepressSnapshot } = args;

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

  if (lineItemRequiresDesignSnapshot === true) {
    return {
      stationKey: "design",
      stepKey: "design",
      reason: "line_item_requires_design_snapshot_true",
    };
  }

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
    stepKey: await resolveManagedStepKeyOrFallback({
      organizationId,
      stationKey: nonPrepressRoute.stationKey,
      stepKey: nonPrepressRoute.stepKey,
      context: "resolveInitialProductionRoute",
    }),
    reason,
  };
}
