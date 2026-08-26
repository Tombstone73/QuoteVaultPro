/**
 * prepress.routes.ts
 *
 * Route registration for the Prepress Queue workflow (manual prepress, not AI pipeline).
 * Extracted from server/routes.ts — behavior-preserving, no contract changes.
 *
 * Placement: server/routes/prepress.routes.ts
 * Exported surface: registerPrepressQueueRoutes
 *
 * NOTE: File-transport routes (multipart upload, download, ZIP, replace) are NOT
 * extracted here — they remain in routes.ts for a later pass.
 *
 * NOTE: The existing `registerPrepressRoutes` export from ./prepress/routes is the
 * AI prepress pipeline — a separate concern. This module uses the distinct name
 * `registerPrepressQueueRoutes` to avoid collision.
 */

import crypto from "crypto";
import type { Express } from "express";
import { and, asc, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  auditLogs,
  customerContacts,
  customers,
  inventoryAdjustments,
  inventoryReservations,
  lineItemFiles,
  materials,
  orderAttachments,
  orderAuditLog,
  orderLineItems,
  orderMaterialUsage,
  orders,
  organizations,
  pbv2TreeVersions,
  prepressSessions,
  productionEvents,
  productionJobs,
  products,
} from "@shared/schema";
import { resolveMaterialsOverrideModeFromOrgPreferences } from "@shared/materialsOverrideMode";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import {
  findActiveJobForLineItem,
  isPrepressOwnershipJob,
  transitionToStation,
} from "../services/productionOwnership";
import { resolvePrepressQueueEligibility } from "../services/prepressQueueEligibility";
import { routeLineItemToProduction } from "../services/productionRoutingService";
import { resolvePostPrepressProductionRoute } from "../services/productionRoutingResolver";
import { assertParentOrderInProduction } from "../services/orderProductionGate";
import { resolveLineItemProofReleaseGate } from "../services/proofGateService";
import { computePlannedMaterialsForLineItem } from "../services/prepressPlannedMaterials";
import {
  appendMaterialOverrideToSpecsJson,
  computeEffectiveMaterials,
  materialOverrideOpInputSchema,
  materialOverridesFromSpecsJson,
  withServerDefaultsForOverride,
} from "../services/prepressMaterialOverrides";
import * as prepressFileService from "../prepressFileService";
import {
  parseDimensionsFromDescription,
  computeTotalSqFt,
  resolveLineItemProductionDisplayData,
  resolvePrepressJobSpecificationsDisplay,
} from "./flatStockNesting.shared";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  resolveDerivativeFileAccess,
} from "../lib/supabaseObjectHelpers";
import { canAutoDeductMaterialStock } from "../lib/materialStockDeductionGuard";
import { buildNormalizedMaterialReservationPlan, type RollMediaReservationContext } from "@shared/materialReservationNormalization";
import { normalizeFinalProductionArtworkAllocations } from "../services/canonicalArtworkAllocationService";
import {
  getProductionStationLabel,
  normalizeProductionStationKey,
  readPrepressProductionDestinationOverride,
  writePrepressProductionDestinationOverride,
} from "@shared/productionStations";
import {
  calculateSheetProductionLayout,
  resolveArtworkSideIntent,
  resolveProductionArtworkSideReadiness,
  resolveProductionSides,
  resolveSheetConfiguration,
  resolveSheetProductionLayoutUnavailableReason,
} from "@shared/productionHydration";
import { GENERATED_PROOF_DESCRIPTION_MARKER } from "@shared/prepressFileClassification";
import { buildArtworkAllocationStatus, defaultNewProductionArtworkAllocation } from "@shared/artworkAllocation";
import { lineItemArtworkReadResolver } from "../services/artwork/LineItemArtworkReadResolver";

// ---------------------------------------------------------------------------
// Local utility (mirrors top-level helper in routes.ts)
// ---------------------------------------------------------------------------

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

async function loadPrepressArtworkSideReadiness(executor: any, args: {
  organizationId: string;
  lineItemId: string;
}) {
  const [lineItem] = await executor
    .select({
      id: orderLineItems.id,
      optionSelectionsJson: orderLineItems.optionSelectionsJson,
      pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      selectedOptions: orderLineItems.selectedOptions,
      specsJson: orderLineItems.specsJson,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);
  if (!lineItem) return null;

  const resolution = await lineItemArtworkReadResolver.resolveForLineItem({
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    purpose: "prepress",
  }, executor);
  const canonicalArtwork = resolution.artwork.map((artwork) => ({
    id: artwork.id,
    fileRecordId: artwork.fileRecordId,
    side: artwork.side,
  }));

  const sides = resolveProductionSides(lineItem);
  const intent = resolveArtworkSideIntent(lineItem);
  return {
    sides,
    ...resolveProductionArtworkSideReadiness({
      sides,
      artwork: canonicalArtwork,
      useSameArtworkBothSides: intent.useSameArtworkBothSides,
      sameArtworkFileId: intent.sameArtworkFileId,
    }),
  };
}

const insertPrepressTimelineLog = async (args: {
  orderId: string;
  orderLineItemId: string;
  actorUserId: string;
  actionType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousStation?: string | null;
  newStation?: string | null;
  sessionId?: string | null;
  note?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  await db.insert(orderAuditLog).values({
    orderId: args.orderId,
    orderLineItemId: args.orderLineItemId,
    userId: args.actorUserId,
    actionType: args.actionType,
    fromStatus: args.previousStatus ?? null,
    toStatus: args.newStatus ?? null,
    note: args.note ?? args.reason ?? null,
    metadata: {
      orderId: args.orderId,
      orderLineItemId: args.orderLineItemId,
      previousStatus: args.previousStatus ?? null,
      newStatus: args.newStatus ?? null,
      previousStation: args.previousStation ?? null,
      newStation: args.newStation ?? null,
      actorUserId: args.actorUserId,
      sessionId: args.sessionId ?? null,
      note: args.note ?? null,
      reason: args.reason ?? null,
      ...(args.metadata ?? {}),
    },
  } as any);
};

// ---------------------------------------------------------------------------
// Module-private constants
// ---------------------------------------------------------------------------

const PREPRESS_OVERRIDE_ALLOWED_STATUSES = new Set([
  "new",
  "in_production",
]);

const PRODUCTION_TERMINAL_STATUSES = new Set(["produced", "done", "complete", "canceled"]);

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

const getMaterialsOverrideMode = async (organizationId: string) => {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const prefs = ((org?.settings as any)?.preferences && typeof (org?.settings as any)?.preferences === "object")
    ? (org?.settings as any).preferences
    : {};

  return resolveMaterialsOverrideModeFromOrgPreferences(prefs);
};

const evaluateMaterialsOverrideAccess = (statusRaw: unknown, mode: "prepress_only" | "prepress_and_production") => {
  const status = String(statusRaw || "").trim().toLowerCase();

  if (mode === "prepress_only") {
    if (PREPRESS_OVERRIDE_ALLOWED_STATUSES.has(status)) {
      return { allowed: true as const };
    }
    return {
      allowed: false as const,
      message: "Material overrides are allowed in prepress stages only for this organization",
    };
  }

  if (PRODUCTION_TERMINAL_STATUSES.has(status)) {
    return {
      allowed: false as const,
      message: "Material overrides are locked for terminal production statuses",
    };
  }

  return { allowed: true as const };
};

const getPrepressMaterialContext = async (organizationId: string, lineItemId: string) => {
  const [lineItem] = await db
    .select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      status: orderLineItems.status,
      quantity: orderLineItems.quantity,
      width: orderLineItems.width,
      height: orderLineItems.height,
      specsJson: orderLineItems.specsJson,
      optionSelectionsJson: orderLineItems.optionSelectionsJson,
      pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      pbv2TreeVersionId: orderLineItems.pbv2TreeVersionId,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!lineItem) return null;

  if (!lineItem.pbv2TreeVersionId) {
    return {
      lineItem,
      treeJson: null,
    };
  }

  const [treeVersion] = await db
    .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
    .from(pbv2TreeVersions)
    .where(
      and(
        eq(pbv2TreeVersions.id, lineItem.pbv2TreeVersionId),
        eq(pbv2TreeVersions.organizationId, organizationId)
      )
    )
    .limit(1);

  return {
    lineItem,
    treeJson: (treeVersion?.treeJson as any) ?? null,
  };
};

const resolveFlatSheetReservationContext = (lineItem: any, treeJson: any) => {
  const sheetConfig = resolveSheetConfiguration({
    pbv2SnapshotJson: lineItem?.pbv2SnapshotJson,
    pricingProfileConfig: treeJson?.meta?.pricingProfileConfig,
  });
  return {
    pieceWidthIn: lineItem?.width,
    pieceHeightIn: lineItem?.height,
    allowRotation: sheetConfig.allowRotation,
  };
};

const readNumericConfigValue = (records: Array<Record<string, any> | null | undefined>, keys: string[], fallback?: number): number | null => {
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    for (const key of keys) {
      const parsed = Number(record[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback ?? null;
};

const resolveRollMediaReservationContext = (lineItem: any, treeJson: any) => {
  const snapshot = lineItem?.pbv2SnapshotJson && typeof lineItem.pbv2SnapshotJson === "object" ? lineItem.pbv2SnapshotJson : {};
  const snapshotMeta = (snapshot as any)?.treeJson?.meta && typeof (snapshot as any).treeJson.meta === "object" ? (snapshot as any).treeJson.meta : {};
  const treeMeta = treeJson?.meta && typeof treeJson.meta === "object" ? treeJson.meta : {};
  const configs = [
    (snapshotMeta as any)?.pricingProfileConfig?.formulaVariables,
    (snapshotMeta as any)?.pricingFormulaVariables,
    (snapshotMeta as any)?.formulaVariables,
    (treeMeta as any)?.pricingProfileConfig?.formulaVariables,
    (treeMeta as any)?.pricingFormulaVariables,
    (treeMeta as any)?.formulaVariables,
  ];

  return {
    finishedWidthIn: lineItem?.width,
    finishedHeightIn: lineItem?.height,
    quantity: lineItem?.quantity,
    productionAllowanceXIn: readNumericConfigValue(configs, ["piece_allowance_x", "production_allowance_x"], 0),
    productionAllowanceYIn: readNumericConfigValue(configs, ["piece_allowance_y", "production_allowance_y"], 0),
    registrationWasteIn: readNumericConfigValue(configs, ["registration_waste"], 0),
    billingWidthIncrementIn: readNumericConfigValue(configs, ["billing_width_increment"], 12),
    billingLengthIncrementIn: readNumericConfigValue(configs, ["billing_length_increment"], 12),
    allowRotation: readNumericConfigValue(configs, ["allow_rotation"], 0),
  };
};

const resolveMaterialMetaForOrg = async (organizationId: string, materialIds: string[]) => {
  const uniqueIds = Array.from(new Set(materialIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (uniqueIds.length === 0) return new Map<string, { name: string; consumptionUnit: string | null }>();

  const rows = await db
    .select({ id: materials.id, name: materials.name, consumptionUnit: materials.consumptionUnit })
    .from(materials)
    .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, uniqueIds)));

  return new Map<string, { name: string; consumptionUnit: string | null }>(
    rows.map((row) => [row.id, { name: row.name, consumptionUnit: row.consumptionUnit ?? null }])
  );
};

const normalizeMaterialUomForPlanning = (value: unknown): "sqft" | "ft" | "each" | null => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "sqft" || raw === "sf" || raw === "square_foot" || raw === "square_feet") return "sqft";
  if (raw === "ft" || raw === "foot" || raw === "feet" || raw === "linear_ft") return "ft";
  if (raw === "ea" || raw === "each" || raw === "sheet" || raw === "roll") return "each";
  return null;
};

const normalizeMaterialQty6dp = (value: unknown): string => {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(6);
  return (Math.round(n * 1_000_000) / 1_000_000).toFixed(6);
};

const toMaterialQtyNumber6dp = (value: unknown): number => Number(normalizeMaterialQty6dp(value));

const buildEffectiveMaterialsFingerprint = (
  materialsInput: Array<{ materialId: string; uom: string; qty: number }>
): string => {
  const canonical = (materialsInput || [])
    .map((m) => ({
      materialId: String(m.materialId || "").trim(),
      uom: String(m.uom || "").trim(),
      qty: normalizeMaterialQty6dp(m.qty),
    }))
    .filter((m) => !!m.materialId && !!m.uom && Number(m.qty) > 0)
    .sort((a, b) => `${a.materialId}:${a.uom}`.localeCompare(`${b.materialId}:${b.uom}`));

  const serialized = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(serialized).digest("hex");
};

const buildReservedFingerprintFromRows = (
  rows: Array<{ sourceKey: string; uom: string; qty: string | number }>
): string => {
  return buildEffectiveMaterialsFingerprint(
    (rows || []).map((r) => ({
      materialId: String(r.sourceKey || "").trim(),
      uom: String(r.uom || "").trim(),
      qty: toMaterialQtyNumber6dp(r.qty),
    }))
  );
};

const buildPrepressMaterialsEffectivePayload = async (args: {
  organizationId: string;
  lineItem: any;
  treeJson: any;
}) => {
  const overrideMode = await getMaterialsOverrideMode(args.organizationId);
  const overrideAccess = evaluateMaterialsOverrideAccess(args.lineItem.status, overrideMode);

  const plannedResult = args.treeJson && args.treeJson.schemaVersion === 2
    ? computePlannedMaterialsForLineItem({ lineItem: args.lineItem, treeJson: args.treeJson as any })
    : { materials: [], message: "PBV2 tree not available for planned material calculation" };

  const overrides = materialOverridesFromSpecsJson(args.lineItem.specsJson);
  const effectiveResult = computeEffectiveMaterials({
    plannedMaterials: plannedResult.materials,
    overrides,
  });

  const materialMetaById = await resolveMaterialMetaForOrg(args.organizationId, [
    ...plannedResult.materials.map((m) => m.materialId),
    ...effectiveResult.effectiveMaterials.map((m) => m.materialId),
  ]);

  const plannedMaterials = plannedResult.materials.map((m) => {
    const meta = materialMetaById.get(m.materialId);
    const normalizedMaterialUom = normalizeMaterialUomForPlanning(meta?.consumptionUnit);
    const hasUomMismatch = !!normalizedMaterialUom && normalizedMaterialUom !== m.uom;

    return {
      ...m,
      materialName: meta?.name,
      ...(hasUomMismatch
        ? {
            uomMismatch: {
              materialUom: normalizedMaterialUom,
              impliedUom: m.uom,
            },
          }
        : {}),
    };
  });

  const effectiveMaterials = effectiveResult.effectiveMaterials.map((m) => ({
    ...m,
    materialName: materialMetaById.get(m.materialId)?.name,
  }));
  const effectiveFingerprint = buildEffectiveMaterialsFingerprint(effectiveMaterials);

  const messageParts: string[] = [];
  if (plannedResult.message) messageParts.push(plannedResult.message);
  if (!overrideAccess.allowed && overrideAccess.message) messageParts.push(overrideAccess.message);

  return {
    plannedMaterials,
    effectiveMaterials,
    overrides,
    pricingReviewRequired: effectiveResult.pricingReviewRequired,
    effectiveFingerprint,
    overrideMode,
    overrideAllowed: overrideAccess.allowed,
    overrideBlockedReason: overrideAccess.allowed ? null : (overrideAccess.message || null),
    diffSummary: effectiveResult.diffSummary,
    message: messageParts.length > 0 ? messageParts.join(" | ") : undefined,
  };
};

const ensureProductionJobForLineItem = async (
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    lineItemId: string;
    mode?: "prepress" | "downstream";
    productTypeId?: string | null;
    productTypeName?: string | null;
  }
) => {
  if ((args.mode || "prepress") === "prepress") {
    // Check if there's already an active prepress job
    const activeJob = await findActiveJobForLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });

    const activeJobIsPrepress = isPrepressOwnershipJob(activeJob);

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV][ensureProductionJobForLineItem]", {
        mode: "prepress",
        organizationId: args.organizationId,
        lineItemId: args.lineItemId,
        activeJobId: activeJob?.id ?? null,
        activeStationKey: activeJob?.stationKey ?? null,
        activeStepKey: activeJob?.stepKey ?? null,
      });
    }

    if (activeJob && activeJobIsPrepress) {
      // Already at prepress — idempotent
      return activeJob.id;
    }

    if (activeJob && !activeJobIsPrepress) {
      // Active downstream job exists — transition to prepress (close downstream, create prepress)
      const transition = await transitionToStation(tx, {
        organizationId: args.organizationId,
        orderId: args.orderId,
        lineItemId: args.lineItemId,
        targetStationKey: "flatbed",
        targetStepKey: "prepress",
        reason: "return_to_prepress",
        actorUserId: null,
      });
      return transition.createdJobId;
    }

    // No active job — create first prepress job
    const result = await routeLineItemToProduction({
      tx,
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineItemId: args.lineItemId,
      stationKey: "flatbed",
      stepKey: "prepress",
      trigger: "prepress",
    });
    return result.jobId;
  }

  // DOWNSTREAM mode: route from prepress to production station
  const downstreamRoute = await resolvePostPrepressProductionRoute({
    organizationId: args.organizationId,
    productTypeId: args.productTypeId ?? null,
    productTypeNameSnapshot: args.productTypeName ?? null,
  });

  const activeJob = await findActiveJobForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const activeJobAtPrepress = isPrepressOwnershipJob(activeJob);

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEV][ensureProductionJobForLineItem]", {
      mode: "downstream",
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      targetStationKey: downstreamRoute.stationKey,
      targetStepKey: downstreamRoute.stepKey,
      activeJobId: activeJob?.id ?? null,
      activeStationKey: activeJob?.stationKey ?? null,
      activeStepKey: activeJob?.stepKey ?? null,
    });
  }

  // Already at a non-prepress station — idempotent success
  if (activeJob && !activeJobAtPrepress) {
    return activeJob.id;
  }

  // Active prepress job — do canonical close/create transition
  if (activeJob && activeJobAtPrepress) {
    const transition = await transitionToStation(tx, {
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineItemId: args.lineItemId,
      targetStationKey: downstreamRoute.stationKey,
      targetStepKey: downstreamRoute.stepKey,
      reason: "post_prepress_handoff",
      actorUserId: null,
    });
    return transition.createdJobId;
  }

  // No active job at all — create new downstream job
  const result = await routeLineItemToProduction({
    tx,
    organizationId: args.organizationId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
    stationKey: downstreamRoute.stationKey,
    stepKey: downstreamRoute.stepKey,
    trigger: "prepress_handoff",
  });

  return result.jobId;
};

const listReservedMaterialsForLineItem = async (tx: any, args: { organizationId: string; orderId: string; lineItemId: string }) => {
  return tx
    .select({
      id: inventoryReservations.id,
      sourceKey: inventoryReservations.sourceKey,
      uom: inventoryReservations.uom,
      qty: inventoryReservations.qty,
      materialForm: materials.materialForm,
      materialInventoryUnit: materials.inventoryUnit,
      materialConsumptionUnit: materials.consumptionUnit,
      materialWidth: materials.width,
      materialRollLengthFt: materials.rollLengthFt,
      materialEdgeWasteInPerSide: materials.edgeWasteInPerSide,
      materialLeadWasteFt: materials.leadWasteFt,
      materialTailWasteFt: materials.tailWasteFt,
    })
    .from(inventoryReservations)
    .leftJoin(
      materials,
      and(
        eq(materials.organizationId, inventoryReservations.organizationId),
        eq(materials.id, inventoryReservations.sourceKey),
      ),
    )
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.orderLineItemId, args.lineItemId),
        eq(inventoryReservations.sourceType, "PBV2_MATERIAL"),
        eq(inventoryReservations.status, "RESERVED")
      )
    );
};

const syncReservedMaterialsForLineItem = async (
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    lineItemId: string;
    createdByUserId: string | null;
    effectiveMaterials: Array<{ materialId: string; uom: "sqft" | "ft" | "each"; qty: number }>;
    flatSheet?: {
      pieceWidthIn?: string | number | null;
      pieceHeightIn?: string | number | null;
      allowRotation?: unknown;
    };
    rollMedia?: RollMediaReservationContext;
  }
) => {
  const now = new Date();
  const existing = await listReservedMaterialsForLineItem(tx, {
    organizationId: args.organizationId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
  });

  const existingByKey = new Map<string, { id: string; qty: string }>();
  for (const row of existing) {
    existingByKey.set(`${row.sourceKey}::${row.uom}`, { id: row.id, qty: normalizeMaterialQty6dp(row.qty) });
  }

  const materialIds = Array.from(new Set((args.effectiveMaterials || []).map((item) => String(item.materialId || "").trim()).filter(Boolean)));
  const materialRows = materialIds.length > 0
    ? await tx.select({ id: materials.id, name: materials.name, materialForm: materials.materialForm, inventoryUnit: materials.inventoryUnit, consumptionUnit: materials.consumptionUnit, width: materials.width, height: materials.height, rollLengthFt: materials.rollLengthFt, edgeWasteInPerSide: materials.edgeWasteInPerSide, leadWasteFt: materials.leadWasteFt, tailWasteFt: materials.tailWasteFt }).from(materials).where(and(eq(materials.organizationId, args.organizationId), inArray(materials.id, materialIds)))
    : [];
  const desiredByKey = new Map<string, { materialId: string; uom: string; qty: string }>();
  const reservationPlan = buildNormalizedMaterialReservationPlan({
    requests: args.effectiveMaterials,
    materials: materialRows,
    flatSheet: args.flatSheet,
    rollMedia: args.rollMedia,
  });
  if (!reservationPlan.ok) throw new Error(reservationPlan.error.message);
  for (const desired of reservationPlan.reservations) {
    desiredByKey.set(`${desired.materialId}::${desired.uom}`, {
      materialId: desired.materialId,
      uom: desired.uom,
      qty: normalizeMaterialQty6dp(desired.qty),
    });
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let releasedCount = 0;

  for (const [key, desired] of Array.from(desiredByKey.entries())) {
    const existingRow = existingByKey.get(key);
    if (!existingRow) {
      await tx.insert(inventoryReservations).values({
        organizationId: args.organizationId,
        orderId: args.orderId,
        orderLineItemId: args.lineItemId,
        sourceType: "PBV2_MATERIAL",
        sourceKey: desired.materialId,
        uom: desired.uom,
        qty: desired.qty,
        status: "RESERVED",
        createdByUserId: args.createdByUserId,
        createdAt: now,
        updatedAt: now,
      } as any);
      insertedCount += 1;
      continue;
    }

    if (normalizeMaterialQty6dp(existingRow.qty) !== desired.qty) {
      await tx
        .update(inventoryReservations)
        .set({ qty: desired.qty, updatedAt: now } as any)
        .where(
          and(
            eq(inventoryReservations.organizationId, args.organizationId),
            eq(inventoryReservations.orderId, args.orderId),
            eq(inventoryReservations.id, existingRow.id),
            eq(inventoryReservations.status, "RESERVED")
          )
        );
      updatedCount += 1;
    }
  }

  for (const [key, existingRow] of Array.from(existingByKey.entries())) {
    if (desiredByKey.has(key)) continue;
    await tx
      .update(inventoryReservations)
      .set({ status: "RELEASED", updatedAt: now } as any)
      .where(
        and(
          eq(inventoryReservations.organizationId, args.organizationId),
          eq(inventoryReservations.orderId, args.orderId),
          eq(inventoryReservations.id, existingRow.id),
          eq(inventoryReservations.status, "RESERVED")
        )
      );
    releasedCount += 1;
  }

  const nextReserved = await listReservedMaterialsForLineItem(tx, {
    organizationId: args.organizationId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
  });

  return {
    insertedCount,
    updatedCount,
    releasedCount,
    changed: insertedCount > 0 || updatedCount > 0 || releasedCount > 0,
    previousFingerprint: buildReservedFingerprintFromRows(existing),
    nextFingerprint: buildReservedFingerprintFromRows(nextReserved),
    nextCount: nextReserved.length,
  };
};

const wasMaterialsLifecycleEventProcessed = async (
  tx: any,
  args: { organizationId: string; productionJobId: string; eventType: string; fingerprint: string }
) => {
  const rows = await tx
    .select({ payload: productionEvents.payload })
    .from(productionEvents)
    .where(
      and(
        eq(productionEvents.organizationId, args.organizationId),
        eq(productionEvents.productionJobId, args.productionJobId),
        eq(productionEvents.type, "note")
      )
    )
    .orderBy(desc(productionEvents.createdAt))
    .limit(200);

  return rows.some((row: any) => {
    const payload = row?.payload as any;
    return (
      payload &&
      payload.eventType === args.eventType &&
      (
        String(payload.requestedMaterialFingerprint || "") === args.fingerprint
        || String(payload.materialFingerprint || "") === args.fingerprint
      )
    );
  });
};

const consumeReservedMaterialsForLineItem = async (
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    lineItemId: string;
    productionJobId: string;
    userId: string;
  }
) => {
  if (!args.organizationId) {
    throw Object.assign(new Error("Missing organization context for inventory adjustment"), { statusCode: 500 });
  }

  const reserved = await listReservedMaterialsForLineItem(tx, {
    organizationId: args.organizationId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
  });

  if (!reserved.length) {
    return { consumed: false, reason: "no_reserved_rows" as const, fingerprint: buildReservedFingerprintFromRows([]), consumedCount: 0 };
  }

  const fingerprint = buildReservedFingerprintFromRows(reserved);
  const alreadyConsumed = await wasMaterialsLifecycleEventProcessed(tx, {
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    eventType: "materials_consumed",
    fingerprint,
  });

  if (alreadyConsumed) {
    return { consumed: false, reason: "idempotent_skip" as const, fingerprint, consumedCount: 0 };
  }

  const now = new Date();
  let consumedCount = 0;
  let deductedCount = 0;
  let skippedStockDeductionCount = 0;
  const stockDeductionWarnings: Array<{
    materialId: string;
    materialUom: string | null;
    usageUom: string | null;
    reason: string;
  }> = [];

  for (const row of reserved) {
    const materialId = String(row.sourceKey || "").trim();
    if (!materialId) continue;
    const qty = toMaterialQtyNumber6dp(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const usageUom = String(row.uom || "each");
    const deductionDecision = canAutoDeductMaterialStock(
      {
        materialForm: (row as any).materialForm,
        inventoryUnit: (row as any).materialInventoryUnit,
        consumptionUnit: (row as any).materialConsumptionUnit,
        width: (row as any).materialWidth,
        rollLengthFt: (row as any).materialRollLengthFt,
        edgeWasteInPerSide: (row as any).materialEdgeWasteInPerSide,
        leadWasteFt: (row as any).materialLeadWasteFt,
        tailWasteFt: (row as any).materialTailWasteFt,
      },
      usageUom,
      qty,
    );

    await tx.insert(orderMaterialUsage).values({
      orderId: args.orderId,
      orderLineItemId: args.lineItemId,
      materialId,
      quantityUsed: normalizeMaterialQty6dp(deductionDecision.convertedQuantity ?? qty),
      unitOfMeasure: deductionDecision.materialUom || usageUom,
      calculatedBy: "auto",
    } as any);

    if (deductionDecision.allowed) {
      await tx.insert(inventoryAdjustments).values({
        organizationId: args.organizationId,
        materialId,
        type: "job_usage",
        quantityChange: normalizeMaterialQty6dp(-(deductionDecision.convertedQuantity ?? qty)),
        reason: `Auto-consumed from reservation for line item ${args.lineItemId}`,
        orderId: args.orderId,
        userId: args.userId,
      } as any);

      await tx
        .update(materials)
        .set({
          stockQuantity: sql`${materials.stockQuantity} - ${normalizeMaterialQty6dp(deductionDecision.convertedQuantity ?? qty)}`,
          updatedAt: now,
        } as any)
        .where(and(eq(materials.organizationId, args.organizationId), eq(materials.id, materialId)));
      deductedCount += 1;
    } else {
      skippedStockDeductionCount += 1;
      stockDeductionWarnings.push({
        materialId,
        materialUom: deductionDecision.materialUom,
        usageUom: deductionDecision.usageUom,
        reason: deductionDecision.reason,
      });
      console.warn("[InventoryDeductionGuard] Skipped automatic stock deduction", {
        organizationId: args.organizationId,
        orderId: args.orderId,
        lineItemId: args.lineItemId,
        materialId,
        materialUom: deductionDecision.materialUom,
        usageUom: deductionDecision.usageUom,
        reason: deductionDecision.reason,
      });
    }

    consumedCount += 1;
  }

  await tx
    .update(inventoryReservations)
    .set({ status: "RELEASED", updatedAt: now } as any)
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.orderLineItemId, args.lineItemId),
        eq(inventoryReservations.sourceType, "PBV2_MATERIAL"),
        eq(inventoryReservations.status, "RESERVED")
      )
    );

  await tx.insert(productionEvents).values({
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    orderId: args.orderId,
    orderLineItemId: args.lineItemId,
    actorUserId: args.userId,
    type: "note",
    payload: {
      eventType: "materials_consumed",
      lineItemId: args.lineItemId,
      orderId: args.orderId,
      materialFingerprint: fingerprint,
      consumedCount,
      deductedCount,
      skippedStockDeductionCount,
      stockDeductionWarnings,
    },
  });

  return { consumed: true, reason: "ok" as const, fingerprint, consumedCount, deductedCount, skippedStockDeductionCount, stockDeductionWarnings };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPrepressQueueRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;

  // GET /api/prepress/queue - List line items for prepress
  app.get("/api/prepress/queue", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const statusFilter = req.query.status ? String(req.query.status).split(",") : [];
      const destinationFilterRaw = req.query.destination ?? req.query.printType;
      const destinationFilter = String(destinationFilterRaw || "all").toLowerCase() === "all"
        ? "all"
        : normalizeProductionStationKey(destinationFilterRaw);
      if (destinationFilterRaw && String(destinationFilterRaw).toLowerCase() !== "all" && !destinationFilter) {
        return res.status(400).json({ error: "Invalid production destination filter" });
      }
      const searchQuery = req.query.search as string | undefined;
      const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "due_date";
      const sortOrder = String(req.query.sortOrder || "asc").toLowerCase() === "desc" ? "desc" : "asc";
      const rushOnly = String(req.query.rush || "").toLowerCase() === "true";

      // Resolve canonical default queue membership shared with the navigation badge.
      // The status filter param is kept for UI compatibility and maps to derived prepress stage.
      const eligibility = await resolvePrepressQueueEligibility(db, {
        organizationId,
        debugLabel: "GET /api/prepress/queue",
      });

      const conditions: any[] = [
        eq(orders.organizationId, organizationId),
        eligibility.lineItemIds.length > 0
          ? inArray(orderLineItems.id, eligibility.lineItemIds)
          : sql`false`,
      ];

      // Get line items with order/customer/material data (session is resolved separately)
      const items = await db
        .select({
          lineItemId: orderLineItems.id,
          orderId: orders.id,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          requiresProofApproval: orderLineItems.requiresProofApproval,
          approvedProofVersionId: orderLineItems.approvedProofVersionId,
          description: orderLineItems.description,
          productFormalName: products.name,
          productType: orderLineItems.productType,
          productTypeId: products.productTypeId,
          productShopName: products.shopName,
          productPrimaryMaterialId: products.primaryMaterialId,
          productSheetWidth: products.sheetWidth,
          productSheetHeight: products.sheetHeight,
          productMaterialType: products.materialType,
          productPricingProfileConfig: products.pricingProfileConfig,
          pbv2TreeVersionId: orderLineItems.pbv2TreeVersionId,
          pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          sqft: orderLineItems.sqft,
          materialId: orderLineItems.materialId,
          materialName: materials.name,
          materialUsageJson: orderLineItems.materialUsageJson,
          specsJson: orderLineItems.specsJson,
          optionSelectionsJson: orderLineItems.optionSelectionsJson,
          selectedOptions: orderLineItems.selectedOptions,
          productionNotes: orderLineItems.productionNotes,
          orderNumber: orders.orderNumber,
          dueDate: orders.dueDate,
          priority: orders.priority,
          customerName: customers.companyName,
          contactFirstName: customerContacts.firstName,
          contactLastName: customerContacts.lastName,
          contactEmail: customerContacts.email,
          billToName: orders.billToName,
          billToCompany: orders.billToCompany,
          proofApprovalPolicyOverride: orders.proofApprovalPolicyOverride,
          proofApprovalOverrideReason: orders.proofApprovalOverrideReason,
          proofApprovalOverrideAt: orders.proofApprovalOverrideAt,
          proofApprovalOverrideByUserId: orders.proofApprovalOverrideByUserId,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .leftJoin(customerContacts, and(eq(orders.contactId, customerContacts.id), eq(customerContacts.organizationId, organizationId)))
        .leftJoin(materials, eq(orderLineItems.materialId, materials.id))
        .leftJoin(products, eq(orderLineItems.productId, products.id))
        .where(and(...conditions))
        .orderBy(asc(orders.dueDate), desc(orders.priority));

      const queueOrderIds = Array.from(new Set(items.map((item) => String(item.orderId))));
      const lineNumberById = new Map<string, number>();
      if (queueOrderIds.length > 0) {
        const orderedSiblings = await db
          .select({
            id: orderLineItems.id,
            orderId: orderLineItems.orderId,
          })
          .from(orderLineItems)
          .where(inArray(orderLineItems.orderId, queueOrderIds))
          .orderBy(asc(orderLineItems.orderId), asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt), asc(orderLineItems.id));
        const nextLineNumberByOrder = new Map<string, number>();
        for (const sibling of orderedSiblings) {
          const orderId = String(sibling.orderId);
          const lineNumber = (nextLineNumberByOrder.get(orderId) ?? 0) + 1;
          nextLineNumberByOrder.set(orderId, lineNumber);
          lineNumberById.set(String(sibling.id), lineNumber);
        }
      }

      const destinationByLineItem = new Map<string, {
        suggested: "roll" | "flatbed";
        selected: "roll" | "flatbed";
        overrideActive: boolean;
      }>();
      await Promise.all(items.map(async (item) => {
        const suggestedRoute = await resolvePostPrepressProductionRoute({
          organizationId,
          productTypeId: item.productTypeId ?? null,
          productTypeNameSnapshot: item.productType,
        });
        const suggested = normalizeProductionStationKey(suggestedRoute.stationKey) ?? "flatbed";
        const override = readPrepressProductionDestinationOverride(item.specsJson);
        const selected = override?.selectedStationKey ?? suggested;
        destinationByLineItem.set(item.lineItemId, {
          suggested,
          selected,
          overrideActive: Boolean(override?.selectedStationKey && override.selectedStationKey !== suggested),
        });
      }));

      const activeOwnerByLineItem = eligibility.activeOwnerByLineItem;
      const queueItems = items.filter((item) => isPrepressOwnershipJob(activeOwnerByLineItem.get(item.lineItemId)));

      // Get file counts for each line item
      const lineItemIdsForQueue = queueItems.map((i) => i.lineItemId);
      await Promise.all(lineItemIdsForQueue.map((lineItemId) => normalizeFinalProductionArtworkAllocations({
        organizationId,
        lineItemId,
      })));
      const fileCounts = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              lineItemId: lineItemFiles.lineItemId,
              role: lineItemFiles.role,
              count: sql<number>`count(*)::int`,
            })
            .from(lineItemFiles)
            .where(
              and(
                inArray(lineItemFiles.lineItemId, lineItemIdsForQueue),
                eq(lineItemFiles.status, "active")
              )
            )
            .groupBy(lineItemFiles.lineItemId, lineItemFiles.role)
        : [];

      const previewFiles = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              id: lineItemFiles.id,
              lineItemId: lineItemFiles.lineItemId,
              fileRecordId: lineItemFiles.fileRecordId,
              role: lineItemFiles.role,
              mimeType: lineItemFiles.mimeType,
              createdAt: lineItemFiles.createdAt,
            })
            .from(lineItemFiles)
            .where(
              and(
                inArray(lineItemFiles.lineItemId, lineItemIdsForQueue),
                eq(lineItemFiles.status, "active")
              )
            )
            .orderBy(desc(lineItemFiles.createdAt))
        : [];

      const finalArtworkRows = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              id: lineItemFiles.id,
              lineItemId: lineItemFiles.lineItemId,
              fileRecordId: lineItemFiles.fileRecordId,
              originalFilename: lineItemFiles.originalFilename,
              tag: lineItemFiles.tag,
              mimeType: lineItemFiles.mimeType,
              sizeBytes: lineItemFiles.sizeBytes,
              side: lineItemFiles.sourceArtworkSide,
              productionQuantity: lineItemFiles.productionQuantity,
              productionGroupId: lineItemFiles.productionGroupId,
              sourceOrderAttachmentId: lineItemFiles.sourceOrderAttachmentId,
            })
            .from(lineItemFiles)
            .where(and(
              eq(lineItemFiles.organizationId, organizationId),
              inArray(lineItemFiles.lineItemId, lineItemIdsForQueue),
              eq(lineItemFiles.role, "final"),
              eq(lineItemFiles.status, "active"),
            ))
            .orderBy(asc(lineItemFiles.createdAt))
        : [];
      const finalArtworkByLineItem = new Map<string, any[]>();
      for (const row of finalArtworkRows) {
        const thumbnail = row.fileRecordId
          ? await resolveDerivativeFileAccess({ id: row.id, fileRecordId: row.fileRecordId }, "thumbnail")
          : { url: null };
        const list = finalArtworkByLineItem.get(row.lineItemId) ?? [];
        list.push({
          id: row.id,
          source: "final_production",
          filename: row.originalFilename || "Production artwork",
          thumbnailUrl: thumbnail.url ?? null,
          productionArtStatus: "Production art",
          side: row.side ?? "na",
          productionQuantity: row.productionQuantity ?? null,
          productionGroupId: row.productionGroupId ?? null,
          tag: row.tag ?? null,
          mimeType: row.mimeType ?? null,
          sizeBytes: row.sizeBytes ?? null,
        });
        finalArtworkByLineItem.set(row.lineItemId, list);
      }

      const customerArtworkRows = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              id: orderAttachments.id,
              lineItemId: orderAttachments.orderLineItemId,
              fileRecordId: orderAttachments.fileRecordId,
              fileName: orderAttachments.fileName,
              originalFilename: orderAttachments.originalFilename,
              role: orderAttachments.role,
              side: orderAttachments.side,
              productionQuantity: orderAttachments.productionQuantity,
              productionGroupId: orderAttachments.productionGroupId,
              thumbKey: orderAttachments.thumbKey,
              thumbnailUrl: orderAttachments.thumbnailUrl,
              fileUrl: orderAttachments.fileUrl,
              isPrimary: orderAttachments.isPrimary,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
            .where(and(
              eq(orders.organizationId, organizationId),
              inArray(orderAttachments.orderLineItemId as any, lineItemIdsForQueue),
              sql`coalesce(${orderAttachments.role}::text, 'other') in ('artwork','output')`,
              sql`coalesce(${orderAttachments.description}, '') not like ${`%${GENERATED_PROOF_DESCRIPTION_MARKER}%`}`,
            ))
            .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.createdAt))
        : [];
      const originalArtworkRows = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              id: lineItemFiles.id,
              lineItemId: lineItemFiles.lineItemId,
              fileRecordId: lineItemFiles.fileRecordId,
              originalFilename: lineItemFiles.originalFilename,
              mimeType: lineItemFiles.mimeType,
              sizeBytes: lineItemFiles.sizeBytes,
              side: lineItemFiles.sourceArtworkSide,
              productionQuantity: lineItemFiles.productionQuantity,
              productionGroupId: lineItemFiles.productionGroupId,
              sourceOrderAttachmentId: lineItemFiles.sourceOrderAttachmentId,
            })
            .from(lineItemFiles)
            .where(and(
              eq(lineItemFiles.organizationId, organizationId),
              inArray(lineItemFiles.lineItemId, lineItemIdsForQueue),
              eq(lineItemFiles.role, "original"),
              eq(lineItemFiles.status, "active"),
            ))
            .orderBy(asc(lineItemFiles.createdAt))
        : [];
      const customerLogOnce = createRequestLogOnce();
      const enrichedCustomerArtworkRows = await Promise.all(customerArtworkRows.map((row) => enrichAttachmentWithUrls(row, { logOnce: customerLogOnce })));
      const customerArtworkByLineItem = new Map<string, any[]>();
      const activeOrderAttachmentIds = new Set(enrichedCustomerArtworkRows.map((row) => String(row.id)));
      const activeOrderAttachmentsByFileRecord = new Map<string, any[]>();
      const artworkRelationshipIssueByLineItem = new Map<string, string>();
      for (const row of enrichedCustomerArtworkRows) {
        if (!row.lineItemId || !row.fileRecordId) continue;
        const relationshipKey = `${String(row.lineItemId)}:${String(row.fileRecordId)}`;
        activeOrderAttachmentsByFileRecord.set(relationshipKey, [
          ...(activeOrderAttachmentsByFileRecord.get(relationshipKey) ?? []),
          row,
        ]);
      }
      for (const row of originalArtworkRows) {
        // Direct-order promotion creates a line_item_files original as a
        // traceability mirror of order_attachments.  It is not a second source
        // artwork relationship. Prefer the Order attachment, and retain an
        // old mirror only when no active canonical attachment identifies it.
        const matchingAttachments = row.fileRecordId
          ? activeOrderAttachmentsByFileRecord.get(`${String(row.lineItemId)}:${String(row.fileRecordId)}`) ?? []
          : [];
        const mirroredByProvenance = Boolean(row.sourceOrderAttachmentId && activeOrderAttachmentIds.has(String(row.sourceOrderAttachmentId)));
        // A legacy mirror without provenance can only be inferred when exactly
        // one active Order attachment has the same canonical file record.
        // Multiple matches are intentionally left visible and blocking so an
        // admin can repair them without the server guessing which is canonical.
        const safelyInferredLegacyMirror = !row.sourceOrderAttachmentId && matchingAttachments.length === 1;
        if (mirroredByProvenance) continue;
        if (safelyInferredLegacyMirror) {
          artworkRelationshipIssueByLineItem.set(
            row.lineItemId,
            "Artwork relationship inconsistency detected. A duplicate source-art mirror was excluded; an admin can repair it permanently.",
          );
          continue;
        }
        if (!row.sourceOrderAttachmentId && matchingAttachments.length > 1) {
          artworkRelationshipIssueByLineItem.set(
            row.lineItemId,
            "Artwork relationship inconsistency detected. Multiple active attachments share a legacy mirror and require admin review.",
          );
        }
        const thumbnail = row.fileRecordId
          ? await resolveDerivativeFileAccess({ id: row.id, fileRecordId: row.fileRecordId }, "thumbnail")
          : { url: null };
        const list = customerArtworkByLineItem.get(row.lineItemId) ?? [];
        list.push({
          id: row.id,
          source: "customer_artwork",
          filename: row.originalFilename || "Customer artwork",
          thumbnailUrl: thumbnail.url ?? null,
          productionArtStatus: "Needs production-art assignment",
          side: row.side ?? "na",
          productionQuantity: row.productionQuantity ?? defaultNewProductionArtworkAllocation("artwork"),
          productionGroupId: row.productionGroupId ?? null,
          tag: null,
          mimeType: row.mimeType ?? null,
          sizeBytes: row.sizeBytes ?? null,
        });
        customerArtworkByLineItem.set(row.lineItemId, list);
      }
      for (const row of enrichedCustomerArtworkRows) {
        if (!row.lineItemId) continue;
        const list = customerArtworkByLineItem.get(row.lineItemId) ?? [];
        list.push({
          id: row.id,
          source: "customer_artwork",
          filename: row.originalFilename || row.fileName || "Customer artwork",
          thumbnailUrl: (row.thumbnailUrl as string | null) ?? (row.previewThumbnailUrl as string | null) ?? (row.thumbUrl as string | null) ?? null,
          productionArtStatus: "Needs production-art assignment",
          side: row.side ?? "na",
          productionQuantity: row.productionQuantity ?? defaultNewProductionArtworkAllocation(row.role),
          productionGroupId: row.productionGroupId ?? null,
          tag: null,
          mimeType: null,
          sizeBytes: null,
        });
        customerArtworkByLineItem.set(row.lineItemId, list);
      }

      const treeVersionIds = Array.from(new Set(items
        .map((item) => item.pbv2TreeVersionId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)));

      const treeVersions = treeVersionIds.length > 0
        ? await db
            .select({
              id: pbv2TreeVersions.id,
              treeJson: pbv2TreeVersions.treeJson,
            })
            .from(pbv2TreeVersions)
            .where(
              and(
                eq(pbv2TreeVersions.organizationId, organizationId),
                inArray(pbv2TreeVersions.id, treeVersionIds),
              )
            )
        : [];

      const treeByVersionId = new Map<string, any>(
        treeVersions.map((tv) => [tv.id, tv.treeJson])
      );

      const productPrimaryMaterialIds = Array.from(new Set(items
        .map((item) => item.productPrimaryMaterialId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)));
      const productPrimaryMaterialRows = productPrimaryMaterialIds.length > 0
        ? await db
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, productPrimaryMaterialIds)))
        : [];
      const productPrimaryMaterialNameById = new Map<string, string>(
        productPrimaryMaterialRows.map((row) => [row.id, row.name])
      );

      const firstPreviewByLineItem = new Map<string, {
        thumbFileId: string | null;
        thumbnailUrl: string | null;
        thumbSelectionReason: 'original_fallback' | 'final_fallback' | 'none';
        thumbCandidateMimeType: string | null;
      }>();
      const previewCandidatesByLineItem = new Map<string, {
        originalImageId: string | null;
        originalImageFileRecordId: string | null;
        finalImageId: string | null;
        finalImageFileRecordId: string | null;
        firstOriginalMimeType: string | null;
        firstFinalMimeType: string | null;
      }>();
      for (const pf of previewFiles) {
        const bucket = previewCandidatesByLineItem.get(pf.lineItemId) || {
          originalImageId: null,
          originalImageFileRecordId: null,
          finalImageId: null,
          finalImageFileRecordId: null,
          firstOriginalMimeType: null,
          firstFinalMimeType: null,
        };

        if (pf.role === "original") {
          if (!bucket.firstOriginalMimeType) bucket.firstOriginalMimeType = pf.mimeType || null;
          if (!bucket.originalImageId) {
            bucket.originalImageId = pf.id;
            bucket.originalImageFileRecordId = pf.fileRecordId ?? null;
          }
        } else if (pf.role === "final") {
          if (!bucket.firstFinalMimeType) bucket.firstFinalMimeType = pf.mimeType || null;
          if (!bucket.finalImageId) {
            bucket.finalImageId = pf.id;
            bucket.finalImageFileRecordId = pf.fileRecordId ?? null;
          }
        }
        previewCandidatesByLineItem.set(pf.lineItemId, bucket);
      }

      for (const [lineItemId, candidate] of Array.from(previewCandidatesByLineItem.entries())) {
        // Once Prepress promotes artwork, the line-specific final relation is
        // authoritative. Its fileRecordId points to the exact selected source.
        const thumbFileId = candidate.finalImageId || candidate.originalImageId || null;
        const thumbFileRecordId = candidate.finalImageFileRecordId || candidate.originalImageFileRecordId || null;
        const thumbSelectionReason: 'original_fallback' | 'final_fallback' | 'none' =
          candidate.finalImageId ? 'final_fallback' :
          candidate.originalImageId ? 'original_fallback' :
          'none';
        const thumbCandidateMimeType =
          candidate.finalImageId ? candidate.firstFinalMimeType :
          candidate.originalImageId ? candidate.firstOriginalMimeType :
          (candidate.firstOriginalMimeType || candidate.firstFinalMimeType || null);

        const thumbnailAccess = thumbFileRecordId
          ? await resolveDerivativeFileAccess({ id: thumbFileId, fileRecordId: thumbFileRecordId }, "thumbnail")
          : { url: null };

        firstPreviewByLineItem.set(lineItemId, {
          thumbFileId,
          thumbnailUrl: thumbnailAccess.url ?? null,
          thumbSelectionReason,
          thumbCandidateMimeType,
        });
      }

      // Thumbnail fallback: if lineItemFiles had no image for a line item, try orderAttachments
      // (some artwork is uploaded via orderAttachments, not lineItemFiles).
      const lineItemIdsNeedingThumbFallback = lineItemIdsForQueue.filter(
        (id) => !firstPreviewByLineItem.has(id) || firstPreviewByLineItem.get(id)?.thumbFileId === null
      );
      if (lineItemIdsNeedingThumbFallback.length > 0) {
        const orderIdsForThumbFallback = Array.from(new Set(
          queueItems
            .filter((i) => lineItemIdsNeedingThumbFallback.includes(i.lineItemId))
            .map((i) => i.orderId)
        ));
        if (orderIdsForThumbFallback.length > 0) {
          const fallbackAttachments = await db
            .select({
              id: orderAttachments.id,
              fileRecordId: orderAttachments.fileRecordId,
              orderLineItemId: orderAttachments.orderLineItemId,
              orderId: orderAttachments.orderId,
              fileName: orderAttachments.fileName,
              thumbKey: orderAttachments.thumbKey,
              thumbnailUrl: orderAttachments.thumbnailUrl,
              fileUrl: orderAttachments.fileUrl,
              thumbStatus: orderAttachments.thumbStatus,
              isPrimary: orderAttachments.isPrimary,
              mimeType: sql<string | null>`null`, // orderAttachments has no mimeType column
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
            .where(
              and(
                eq(orders.organizationId, organizationId),
                inArray(orderAttachments.orderId, orderIdsForThumbFallback),
                eq(orderAttachments.role, "artwork"),
              ),
            )
            .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.createdAt));

          // Map by line item (prefer) or by order id (fallback)
          const fallbackByLineItem = new Map<string, string>();
          const fallbackLogOnce = createRequestLogOnce();
          const enrichedFallbackAttachments = await Promise.all(
            fallbackAttachments.map((att) => enrichAttachmentWithUrls(att, { logOnce: fallbackLogOnce })),
          );

          for (const att of enrichedFallbackAttachments) {
            const thumbUrl =
              (att.thumbnailUrl as string | null) ??
              (att.previewThumbnailUrl as string | null) ??
              (att.thumbUrl as string | null) ??
              null;
            if (!thumbUrl) continue;

            if (att.orderLineItemId && lineItemIdsNeedingThumbFallback.includes(att.orderLineItemId)) {
              if (!fallbackByLineItem.has(att.orderLineItemId)) {
                fallbackByLineItem.set(att.orderLineItemId, thumbUrl);
              }
            }
          }

          for (const item of queueItems) {
            if (firstPreviewByLineItem.has(item.lineItemId) && firstPreviewByLineItem.get(item.lineItemId)?.thumbFileId !== null) continue;
            const thumbUrl =
              fallbackByLineItem.get(item.lineItemId) ?? null;
            if (thumbUrl) {
              firstPreviewByLineItem.set(item.lineItemId, {
                thumbFileId: null,
                thumbnailUrl: thumbUrl,
                thumbSelectionReason: 'original_fallback',
                thumbCandidateMimeType: null,
              });
            }
          }
        }
      }

      // Resolve latest active session per line item (non-exclusive sessions supported)
      const activeSessions = lineItemIdsForQueue.length > 0
        ? await db
            .select({
              id: prepressSessions.id,
              lineItemId: prepressSessions.lineItemId,
              startedByUserId: prepressSessions.startedByUserId,
              notesText: prepressSessions.notesText,
              issueFlag: prepressSessions.issueFlag,
              issueType: prepressSessions.issueType,
              updatedAt: prepressSessions.updatedAt,
              startedAt: prepressSessions.startedAt,
            })
            .from(prepressSessions)
            .where(
              and(
                inArray(prepressSessions.lineItemId, lineItemIdsForQueue),
                eq(prepressSessions.organizationId, organizationId),
                eq(prepressSessions.status, "active")
              )
            )
            .orderBy(desc(prepressSessions.updatedAt), desc(prepressSessions.startedAt))
        : [];

      const latestSessionByLineItem = new Map<string, typeof activeSessions[number]>();
      for (const session of activeSessions) {
        if (!latestSessionByLineItem.has(session.lineItemId)) {
          latestSessionByLineItem.set(session.lineItemId, session);
        }
      }

      // Query completed prepress sessions for handoff/readiness context only
      const completedSessionLineItemIds = lineItemIdsForQueue.length > 0
        ? await db
            .select({ lineItemId: prepressSessions.lineItemId })
            .from(prepressSessions)
            .where(
              and(
                inArray(prepressSessions.lineItemId, lineItemIdsForQueue),
                eq(prepressSessions.organizationId, organizationId),
                eq(prepressSessions.status, "complete"),
              ),
            )
        : [];
      const completedSessionLineItems = new Set<string>(
        completedSessionLineItemIds.map((r) => r.lineItemId)
      );

      // Map to flat QueueItem shape the frontend expects
      const queue = queueItems.map((item, index) => {
        const counts = fileCounts.filter((fc) => fc.lineItemId === item.lineItemId);
        const originals = customerArtworkByLineItem.get(item.lineItemId)?.length ?? 0;
        const finals = counts.find((c) => c.role === "final")?.count || 0;
        const latestSession = latestSessionByLineItem.get(item.lineItemId);
        const computedSqFt = computeTotalSqFt({
          width: item.width,
          height: item.height,
          quantity: item.quantity,
          description: item.description,
        });
        const treeJson = item.pbv2TreeVersionId ? treeByVersionId.get(item.pbv2TreeVersionId) : undefined;
        const displayData = resolveLineItemProductionDisplayData({
          lineItem: { ...item, lineItemId: item.lineItemId },
          treeJson,
          materialName: item.materialName ?? null,
          productShopName: item.productShopName ?? null,
          primaryMaterialName: item.productPrimaryMaterialId ? productPrimaryMaterialNameById.get(item.productPrimaryMaterialId) ?? null : null,
        });
        const specificationsDisplay = resolvePrepressJobSpecificationsDisplay({
          productName: item.productFormalName ?? item.description,
          productShopName: item.productShopName ?? null,
          optionRows: displayData.optionRows,
        });
        const finishingBullets = specificationsDisplay.optionRows
          .filter((row) => /(finish|laminat|grommet|hem|trim|weld|mount|sew|pocket|tape|edge|contour|cut)/i.test(row.optionLabel))
          .map((row) => `${row.optionLabel}: ${row.selectedLabel}`);
        const optionsRows = specificationsDisplay.optionRows;
        const printSides = resolveProductionSides(item);
        const destination = destinationByLineItem.get(item.lineItemId) ?? {
          suggested: "flatbed" as const,
          selected: "flatbed" as const,
          overrideActive: false,
        };
        const sheetConfiguration = resolveSheetConfiguration({
          pbv2SnapshotJson: item.pbv2SnapshotJson,
          pricingProfileConfig: treeJson?.meta?.pricingProfileConfig ?? item.productPricingProfileConfig,
          sheetWidth: item.productSheetWidth,
          sheetHeight: item.productSheetHeight,
          materialType: item.productMaterialType,
        });
        const productionLayout = calculateSheetProductionLayout({
          stationKey: destination.selected,
          materialType: sheetConfiguration.materialType,
          widthIn: item.width,
          heightIn: item.height,
          quantity: item.quantity,
          sheetWidthIn: sheetConfiguration.sheetWidthIn,
          sheetHeightIn: sheetConfiguration.sheetHeightIn,
          allowRotation: sheetConfiguration.allowRotation,
          sides: printSides,
        });
        const productionLayoutUnavailableReason = productionLayout
          ? null
          : resolveSheetProductionLayoutUnavailableReason({
              stationKey: destination.selected,
              materialType: sheetConfiguration.materialType,
              widthIn: item.width,
              heightIn: item.height,
              quantity: item.quantity,
              sheetWidthIn: sheetConfiguration.sheetWidthIn,
              sheetHeightIn: sheetConfiguration.sheetHeightIn,
            });
        // This is the pricing-time snapshot, not a recalculation from the
        // current catalog. It keeps the production warning stable after a
        // product's media configuration changes.
        const mediaFit = item.pbv2SnapshotJson && typeof item.pbv2SnapshotJson === "object"
          ? (item.pbv2SnapshotJson as any)?.pbv2PricingSnapshot?.mediaFit ?? null
          : null;
        const artworkSideIntent = resolveArtworkSideIntent(item);
        const activeOwner = activeOwnerByLineItem.get(item.lineItemId) ?? null;
        const activeOwnerIsPrepress = isPrepressOwnershipJob(activeOwner);
        const computedWorkflowState = String(item.workflowState || '').toLowerCase();
        const contactName = [item.contactFirstName, item.contactLastName]
          .map((part) => String(part || "").trim())
          .filter(Boolean)
          .join(" ");
        const customerDisplayName =
          item.customerName
          ?? item.billToCompany
          ?? item.billToName
          ?? contactName
          ?? item.contactEmail
          ?? "Contact-only order";
        const proofBypassed = String(item.proofApprovalPolicyOverride || "").toLowerCase() === "bypass";
        const hasApprovedProof = Boolean(item.approvedProofVersionId);
        const productionReleaseBlockedReason =
          item.requiresProofApproval && !hasApprovedProof && !proofBypassed
            ? "Cannot release to production until proof approved"
            : null;
        const finalArtwork = finalArtworkByLineItem.get(item.lineItemId) ?? [];
        const customerArtwork = customerArtworkByLineItem.get(item.lineItemId) ?? [];
        const artworkRelationshipIssue = artworkRelationshipIssueByLineItem.get(item.lineItemId) ?? null;
        const artworkBreakdownDesigns = finalArtwork.length > 0 ? finalArtwork : customerArtwork;
        const artworkAllocation = buildArtworkAllocationStatus({
          lineQuantity: item.quantity,
          members: artworkBreakdownDesigns.map((design) => ({
            id: design.id,
            role: finalArtwork.length > 0 ? "final" : "artwork",
            side: design.side,
            productionQuantity: design.productionQuantity,
            productionGroupId: design.productionGroupId,
            active: true,
          })),
        });

        if (process.env.NODE_ENV !== "production" && index === 0) {
          const selectedCount = (() => {
            const source = item?.optionSelectionsJson as any;
            if (source && typeof source === "object" && source.selected && typeof source.selected === "object") {
              return Object.keys(source.selected).length;
            }
            if (source && typeof source === "object") {
              return Object.keys(source).length;
            }
            return 0;
          })();

          console.log(`[Prepress Options] lineItemId=${item.lineItemId} selections=${selectedCount} displayRows=${optionsRows.length}`);
        }

        return {
          lineItemId: item.lineItemId,
          lineNumber: lineNumberById.get(String(item.lineItemId)) ?? null,
          orderId: item.orderId,
          jobNumber: item.orderNumber,
          customerName: customerDisplayName,
          productName: specificationsDisplay.productLabel,
          formalProductName: item.productFormalName ?? item.description,
          printType: item.productType ?? null,
          suggestedProductionDestination: destination.suggested,
          selectedProductionDestination: destination.selected,
          destinationOverrideActive: destination.overrideActive,
          productionDestinationLabel: getProductionStationLabel(destination.selected),
          materialId: item.materialId ?? null,
          materialName: item.materialName ?? null,
          media: item.productShopName ? specificationsDisplay.productLabel : displayData.mediaLabel,
          dueDate: item.dueDate ?? null,
          status: item.status,
          workflowState: item.workflowState,
          requiresProofApproval: item.requiresProofApproval,
          approvedProofVersionId: item.approvedProofVersionId ?? null,
          proofApprovalPolicyOverride: item.proofApprovalPolicyOverride ?? "inherit_default",
          proofBypassed,
          proofBypassReason: item.proofApprovalOverrideReason ?? null,
          proofBypassedAt: item.proofApprovalOverrideAt ? new Date(item.proofApprovalOverrideAt as any).toISOString() : null,
          proofBypassedByUserId: item.proofApprovalOverrideByUserId ?? null,
          productionReleaseBlockedReason,
          hasCompletedSession: completedSessionLineItems.has(item.lineItemId),
          rush: item.priority === "rush",
          assignedTo: null,
          sessionId: latestSession?.id ?? null,
          sessionStartedAt: latestSession?.startedAt ? new Date(latestSession.startedAt as any).toISOString() : null,
          sessionStartedByUserId: latestSession?.startedByUserId ?? null,
          prepressNotes: latestSession?.notesText ?? null,
          lineItemNotes: displayData.lineItemNotes,
          priorityLabel: displayData.priorityLabel,
          issueFlag: latestSession?.issueFlag ?? false,
          issueType: latestSession?.issueType ?? null,
          hasDownstreamActiveJob: !!activeOwner && !activeOwnerIsPrepress,
          hasAnyProductionJob: !!activeOwner,
          activeOwnerJobId: activeOwner?.id ?? null,
          activeOwnerStationKey: activeOwner?.stationKey ?? null,
          activeOwnerStepKey: activeOwner?.stepKey ?? null,
          isActivelyOwnedByPrepress: activeOwnerIsPrepress,
          thumbFileId: firstPreviewByLineItem.get(item.lineItemId)?.thumbFileId ?? null,
          thumbnailUrl: firstPreviewByLineItem.get(item.lineItemId)?.thumbnailUrl ?? null,
          thumbSelectionReason: firstPreviewByLineItem.get(item.lineItemId)?.thumbSelectionReason ?? 'none',
          thumbCandidateMimeType: firstPreviewByLineItem.get(item.lineItemId)?.thumbCandidateMimeType ?? null,
          fileCounts: { originals, finals },
          quantity: Number(item.quantity) || 0,
          width: item.width != null ? Number(item.width) : null,
          height: item.height != null ? Number(item.height) : null,
          sqFootage: computedSqFt ?? (item.sqft != null ? Number(item.sqft) : null),
          bleed: null,
          finishing: finishingBullets.length > 0 ? finishingBullets.join(" • ") : null,
          finishingBullets,
          optionsRows,
          printSides,
          mediaFit,
          productionLayout,
          productionLayoutUnavailableReason,
          artworkProductionBreakdown: {
            source: finalArtwork.length > 0 ? "final_production" : customerArtwork.length > 0 ? "customer_artwork" : "none",
            productionArtStatus: finalArtwork.length > 0 ? "Production art" : customerArtwork.length > 0 ? "Needs production-art assignment" : "No artwork",
            allocatedTotal: artworkAllocation.allocatedTotal,
            requiredQuantity: artworkAllocation.requiredQuantity,
            valid: artworkAllocation.valid && finalArtwork.length > 0 && !artworkRelationshipIssue,
            issue: artworkRelationshipIssue ?? (finalArtwork.length === 0 && customerArtwork.length > 0
              ? "Production artwork is not assigned yet."
              : artworkAllocation.issue),
            relationshipInconsistency: artworkRelationshipIssue,
            designs: artworkBreakdownDesigns,
          },
          useSameArtworkBothSides: artworkSideIntent.useSameArtworkBothSides,
          sameArtworkFileId: artworkSideIntent.sameArtworkFileId,
        };
      });

      const matchesPrepressStatusFilter = (item: any, filterValue: string) => {
        const normalizedFilter = String(filterValue || '').trim().toLowerCase();
        const workflowState = String(item.workflowState || '').trim().toLowerCase();

        if (!normalizedFilter || normalizedFilter === 'all') {
          return true;
        }

        if (normalizedFilter === 'ready_for_prepress') {
          return workflowState === 'ready_for_prepress';
        }

        if (normalizedFilter === 'in_prepress') {
          return workflowState === 'in_prepress';
        }

        return false;
      };

      const destinationFilteredQueue = destinationFilter && destinationFilter !== "all"
        ? queue.filter((q: any) => q.selectedProductionDestination === destinationFilter)
        : queue;

      const filteredQueue = statusFilter.length > 0
        ? destinationFilteredQueue.filter((q: any) => statusFilter.some((filterValue) => matchesPrepressStatusFilter(q, filterValue)))
        : destinationFilteredQueue;

      const rushFilteredQueue = rushOnly
        ? filteredQueue.filter((q: any) => q.rush === true)
        : filteredQueue;

      const normalizedSearchQuery = searchQuery?.trim().toLowerCase() || "";
      const searchedQueue = normalizedSearchQuery
        ? rushFilteredQueue.filter((item: any) => {
            const searchFields = [
              item.jobNumber,
              item.orderId,
              item.customerName,
              item.productName,
              item.formalProductName,
              item.productionDestinationLabel,
              item.media,
              item.lineItemId,
            ];

            return searchFields.some((value) => String(value || "").toLowerCase().includes(normalizedSearchQuery));
          })
        : rushFilteredQueue;

      const compareStrings = (left: string | null | undefined, right: string | null | undefined) =>
        String(left || "").localeCompare(String(right || ""), undefined, { numeric: true, sensitivity: "base" });

      const compareDates = (left: string | null | undefined, right: string | null | undefined) => {
        const leftValue = left ? new Date(left).getTime() : Number.POSITIVE_INFINITY;
        const rightValue = right ? new Date(right).getTime() : Number.POSITIVE_INFINITY;

        if (leftValue === rightValue) return 0;
        return leftValue < rightValue ? -1 : 1;
      };

      const sortedQueue = [...searchedQueue].sort((left: any, right: any) => {
        let comparison = 0;

        switch (sortBy) {
          case "job_number":
            comparison = compareStrings(left.jobNumber, right.jobNumber);
            break;
          case "client":
            comparison = compareStrings(left.customerName, right.customerName);
            break;
          case "type":
            comparison = compareStrings(left.productionDestinationLabel, right.productionDestinationLabel);
            break;
          case "material":
            comparison = compareStrings(left.media, right.media);
            break;
          case "due_date":
          default:
            comparison = compareDates(left.dueDate, right.dueDate);
            break;
        }

        if (comparison === 0) {
          comparison = compareStrings(left.jobNumber, right.jobNumber);
        }

        return sortOrder === "desc" ? comparison * -1 : comparison;
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(`[Prepress Queue] org=${organizationId} ownerDrivenQueue=${sortedQueue.length}`);
      }

      res.json({
        success: true,
        data: sortedQueue,
        meta: {
          totalCount: queue.length,
          filteredCount: sortedQueue.length,
        },
      });
    } catch (error: any) {
      console.error("[Prepress] Error fetching queue:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch prepress queue" });
    }
  });

  // GET /api/prepress/line-items/:lineItemId/materials-planned - Planned materials from PBV2 selected choices
  app.get("/api/prepress/line-items/:lineItemId/materials-planned", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: { materials: [] }, message: "Missing organization context" });
      }

      const { lineItemId } = req.params;
      const context = await getPrepressMaterialContext(organizationId, lineItemId);

      if (!context) {
        return res.status(404).json({ success: false, data: { materials: [] }, message: "Line item not found" });
      }

      if (!context.lineItem.pbv2TreeVersionId || !context.treeJson || context.treeJson.schemaVersion !== 2) {
        return res.json({ success: true, data: { materials: [] }, message: "No PBV2 tree linked to this line item" });
      }

      const payload = await buildPrepressMaterialsEffectivePayload({
        organizationId,
        lineItem: context.lineItem,
        treeJson: context.treeJson,
      });

      return res.json({
        success: true,
        data: { materials: payload.plannedMaterials },
        ...(payload.message ? { message: payload.message } : {}),
      });
    } catch (error: any) {
      console.error("[Prepress] Error computing planned materials:", error);
      return res.status(500).json({
        success: false,
        data: { materials: [] },
        message: error?.message || "Failed to compute planned materials",
      });
    }
  });

  // GET /api/prepress/line-items/:lineItemId/materials-effective - Planned + effective materials with overrides
  app.get("/api/prepress/line-items/:lineItemId/materials-effective", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const { lineItemId } = req.params;
      const context = await getPrepressMaterialContext(organizationId, lineItemId);
      if (!context) {
        return res.status(404).json({ success: false, data: null, message: "Line item not found" });
      }

      const payload = await buildPrepressMaterialsEffectivePayload({
        organizationId,
        lineItem: context.lineItem,
        treeJson: context.treeJson,
      });

      return res.json({
        success: true,
        data: {
          plannedMaterials: payload.plannedMaterials,
          effectiveMaterials: payload.effectiveMaterials,
          effectiveFingerprint: payload.effectiveFingerprint,
          overrides: payload.overrides,
          pricingReviewRequired: payload.pricingReviewRequired,
          overrideMode: payload.overrideMode,
          overrideAllowed: payload.overrideAllowed,
          overrideBlockedReason: payload.overrideBlockedReason,
        },
        ...(payload.message ? { message: payload.message } : {}),
      });
    } catch (error: any) {
      console.error("[Prepress] Error computing effective materials:", error);
      return res.status(500).json({ success: false, data: null, message: error?.message || "Failed to compute effective materials" });
    }
  });

  // GET /api/prepress/line-items/:lineItemId/materials-availability - Effective materials with live stock availability
  app.get("/api/prepress/line-items/:lineItemId/materials-availability", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const { lineItemId } = req.params;
      const context = await getPrepressMaterialContext(organizationId, lineItemId);
      if (!context) {
        return res.status(404).json({ success: false, data: null, message: "Line item not found" });
      }

      const payload = await buildPrepressMaterialsEffectivePayload({
        organizationId,
        lineItem: context.lineItem,
        treeJson: context.treeJson,
      });

      const materialIds = Array.from(new Set(payload.effectiveMaterials.map((m) => String(m.materialId || "")).filter(Boolean)));
      const materialRows = materialIds.length
        ? await db
            .select({ id: materials.id, stockQuantity: materials.stockQuantity })
            .from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
        : [];

      const stockByMaterialId = new Map<string, number>(
        materialRows.map((row) => [row.id, toMaterialQtyNumber6dp(row.stockQuantity)])
      );

      const items = payload.effectiveMaterials.map((m) => {
        const requiredQty = toMaterialQtyNumber6dp(m.qty);
        const availableQty = toMaterialQtyNumber6dp(stockByMaterialId.get(m.materialId) ?? 0);
        const shortageQty = Math.max(0, toMaterialQtyNumber6dp(requiredQty - availableQty));
        return {
          materialId: m.materialId,
          materialName: m.materialName,
          uom: m.uom,
          requiredQty,
          availableQty,
          shortageQty,
          isAvailable: shortageQty <= 0,
        };
      });

      return res.json({
        success: true,
        data: {
          effectiveFingerprint: payload.effectiveFingerprint,
          allAvailable: items.every((i) => i.isAvailable),
          items,
        },
      });
    } catch (error: any) {
      console.error("[Prepress] Error computing materials availability:", error);
      return res.status(500).json({ success: false, data: null, message: error?.message || "Failed to compute materials availability" });
    }
  });

  // POST /api/prepress/line-items/:lineItemId/material-overrides - Append a sparse material override op
  app.post("/api/prepress/line-items/:lineItemId/material-overrides", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const userId = getUserId(req.user) || undefined;
      const { lineItemId } = req.params;

      const context = await getPrepressMaterialContext(organizationId, lineItemId);
      if (!context) {
        return res.status(404).json({ success: false, data: null, message: "Line item not found" });
      }

      const overrideMode = await getMaterialsOverrideMode(organizationId);
      const access = evaluateMaterialsOverrideAccess(context.lineItem.status, overrideMode);
      if (!access.allowed) {
        return res.status(400).json({
          success: false,
          data: null,
          message: access.message || "Material overrides are not allowed for the current line item status",
        });
      }

      const parsed = materialOverrideOpInputSchema.safeParse((req.body as any)?.op);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          data: null,
          message: parsed.error.issues[0]?.message || "Invalid override payload",
        });
      }

      const persistedOp = withServerDefaultsForOverride(parsed.data, userId);
      let updatedSpecsJson: Record<string, any> | null = null;

      await db.transaction(async (tx) => {
        updatedSpecsJson = appendMaterialOverrideToSpecsJson(context.lineItem.specsJson, persistedOp);

        await tx
          .update(orderLineItems)
          .set({
            specsJson: updatedSpecsJson as any,
            updatedAt: new Date(),
          })
          .where(eq(orderLineItems.id, lineItemId));

        const productionJobId = await ensureProductionJobForLineItem(tx, {
          organizationId,
          orderId: context.lineItem.orderId,
          lineItemId,
        });

        const plannedForAudit = context.treeJson && context.treeJson.schemaVersion === 2
          ? computePlannedMaterialsForLineItem({ lineItem: context.lineItem, treeJson: context.treeJson as any })
          : { materials: [] as any[] };

        const effectiveForAudit = computeEffectiveMaterials({
          plannedMaterials: plannedForAudit.materials,
          overrides: materialOverridesFromSpecsJson(updatedSpecsJson),
        });
        const effectiveFingerprint = buildEffectiveMaterialsFingerprint(effectiveForAudit.effectiveMaterials);

        const currentReserved = await listReservedMaterialsForLineItem(tx, {
          organizationId,
          orderId: context.lineItem.orderId,
          lineItemId,
        });

        if (currentReserved.length > 0 && !PRODUCTION_TERMINAL_STATUSES.has(String(context.lineItem.status || "").toLowerCase())) {
          const rebalance = await syncReservedMaterialsForLineItem(tx, {
            organizationId,
            orderId: context.lineItem.orderId,
            lineItemId,
            createdByUserId: userId ?? null,
            effectiveMaterials: effectiveForAudit.effectiveMaterials,
            flatSheet: resolveFlatSheetReservationContext(context.lineItem, context.treeJson),
            rollMedia: resolveRollMediaReservationContext(context.lineItem, context.treeJson),
          });

          await tx.insert(productionEvents).values({
            organizationId,
            productionJobId,
            orderId: context.lineItem.orderId,
            orderLineItemId: lineItemId,
            actorUserId: userId ?? null,
            type: "note",
            payload: {
              eventType: "materials_rebalanced",
              lineItemId,
              previousFingerprint: rebalance.previousFingerprint,
              materialFingerprint: rebalance.nextFingerprint,
              changed: rebalance.changed,
              insertedCount: rebalance.insertedCount,
              updatedCount: rebalance.updatedCount,
              releasedCount: rebalance.releasedCount,
              reservationCount: rebalance.nextCount,
            },
          });
        }

        await tx.insert(productionEvents).values({
          organizationId,
          productionJobId,
          orderId: context.lineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId ?? null,
          type: "note",
          payload: {
            eventType: "material_override",
            lineItemId,
            op: persistedOp,
            reasonNote: persistedOp.reasonNote,
            pricingReviewRequired: effectiveForAudit.pricingReviewRequired,
            materialFingerprint: effectiveFingerprint,
            diffSummary: effectiveForAudit.diffSummary,
          },
        });
      });

      const payload = await buildPrepressMaterialsEffectivePayload({
        organizationId,
        lineItem: {
          ...context.lineItem,
          specsJson: updatedSpecsJson || context.lineItem.specsJson,
        },
        treeJson: context.treeJson,
      });

      return res.json({
        success: true,
        data: {
          plannedMaterials: payload.plannedMaterials,
          effectiveMaterials: payload.effectiveMaterials,
          effectiveFingerprint: payload.effectiveFingerprint,
          overrides: payload.overrides,
          pricingReviewRequired: payload.pricingReviewRequired,
          overrideMode: payload.overrideMode,
          overrideAllowed: payload.overrideAllowed,
          overrideBlockedReason: payload.overrideBlockedReason,
        },
        ...(payload.message ? { message: payload.message } : {}),
      });
    } catch (error: any) {
      console.error("[Prepress] Error applying material override:", error);
      return res.status(500).json({ success: false, data: null, message: error?.message || "Failed to apply material override" });
    }
  });

  // GET /api/prepress/line-item/:lineItemId/history - Timeline for prepress/production activity
  app.get("/api/prepress/line-item/:lineItemId/history", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const { lineItemId } = req.params;

      const [lineItem] = await db
        .select({ id: orderLineItems.id })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const sessions = await db
        .select({
          id: prepressSessions.id,
          startedAt: prepressSessions.startedAt,
          updatedAt: prepressSessions.updatedAt,
          completedAt: prepressSessions.completedAt,
          status: prepressSessions.status,
          notesText: prepressSessions.notesText,
          issueFlag: prepressSessions.issueFlag,
          issueType: prepressSessions.issueType,
        })
        .from(prepressSessions)
        .where(
          and(
            eq(prepressSessions.organizationId, organizationId),
            eq(prepressSessions.lineItemId, lineItemId)
          )
        )
        .orderBy(desc(prepressSessions.updatedAt));

      const sessionIds = sessions.map((s) => s.id);

      const events = await db
        .select({
          createdAt: productionEvents.createdAt,
          type: productionEvents.type,
          payload: productionEvents.payload,
        })
        .from(productionEvents)
        .innerJoin(productionJobs, eq(productionEvents.productionJobId, productionJobs.id))
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            eq(productionJobs.lineItemId, lineItemId)
          )
        )
        .orderBy(desc(productionEvents.createdAt));

      const auditFilter = sessionIds.length > 0
        ? or(
            and(eq(auditLogs.entityType, "order_line_item"), eq(auditLogs.entityId, lineItemId)),
            and(eq(auditLogs.entityType, "prepress_session"), inArray(auditLogs.entityId, sessionIds))
          )
        : and(eq(auditLogs.entityType, "order_line_item"), eq(auditLogs.entityId, lineItemId));

      const audits = await db
        .select({
          createdAt: auditLogs.createdAt,
          actionType: auditLogs.actionType,
          entityType: auditLogs.entityType,
          description: auditLogs.description,
        })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, organizationId), auditFilter!))
        .orderBy(desc(auditLogs.createdAt));

      const describeProductionEvent = (type: string, payload: any) => {
        const eventType = String(payload?.eventType || "").trim().toLowerCase();
        const formatState = (value: unknown) => String(value || "").replace(/_/g, " ").trim();

        if (eventType === "workflow_transition") {
          const fromState = formatState(payload?.fromState);
          const toState = formatState(payload?.toState);
          if (fromState && toState) {
            return `Workflow transitioned from ${fromState} to ${toState}`;
          }
        }

        if (eventType === "workflow_reconciled") {
          const toState = formatState(payload?.toState);
          return toState
            ? `Workflow reconciled to ${toState}`
            : "Workflow reconciled";
        }

        if (eventType === "materials_reserved") {
          return "Materials reserved for production";
        }

        if (eventType === "materials_rebalanced") {
          return "Material reservations rebalanced";
        }

        if (eventType === "material_override") {
          return "Material override applied";
        }

        if (type === "routing_override") {
          const fromStation = String(payload?.from?.stationKey || payload?.previousStationKey || "").trim();
          const toStation = String(payload?.to?.stationKey || payload?.stationKey || "").trim();
          if (fromStation && toStation) {
            return `Ownership moved from ${fromStation} to ${toStation}`;
          }
        }

        if (typeof payload?.text === "string" && payload.text.trim().length > 0) {
          return payload.text;
        }

        if (eventType) {
          return eventType.replace(/_/g, " ");
        }

        return `${type}`;
      };

      const timeline = [
        ...sessions.map((s) => ({
          at: s.updatedAt || s.startedAt,
          source: "prepress_session",
          type: s.status,
          description: s.status === "complete"
            ? "Prepress session completed"
            : s.notesText
              ? `Session notes updated: ${s.notesText}`
              : "Prepress session active",
        })),
        ...events.map((e) => ({
          at: e.createdAt,
          source: "production_event",
          type: e.type,
          description: describeProductionEvent(String(e.type || "note"), e.payload),
        })),
        ...audits.map((a) => ({
          at: a.createdAt,
          source: "audit_log",
          type: `${a.entityType}:${a.actionType}`,
          description: a.description,
        })),
      ]
        .filter((entry) => !!entry.at)
        .sort((a, b) => new Date(b.at as any).getTime() - new Date(a.at as any).getTime());

      res.json({ success: true, data: timeline });
    } catch (error: any) {
      console.error("[Prepress] Error fetching history:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch prepress history" });
    }
  });

  // GET /api/prepress/line-item/:lineItemId/spec-sheet - Printable prepress spec payload
  app.get("/api/prepress/line-item/:lineItemId/spec-sheet", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const { lineItemId } = req.params;

      const rows = await db
        .select({
          lineItem: orderLineItems,
          orderNumber: orders.orderNumber,
          priority: orders.priority,
          customerName: customers.companyName,
          materialName: materials.name,
          productFormalName: products.name,
          productPrimaryMaterialId: products.primaryMaterialId,
          productShopName: products.shopName,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(materials, eq(orderLineItems.materialId, materials.id))
        .leftJoin(products, eq(orderLineItems.productId, products.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!rows[0]) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const row = rows[0];
      const li = row.lineItem;
      const [treeVersion] = li.pbv2TreeVersionId
        ? await db
            .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
            .from(pbv2TreeVersions)
            .where(and(eq(pbv2TreeVersions.id, li.pbv2TreeVersionId), eq(pbv2TreeVersions.organizationId, organizationId)))
            .limit(1)
        : [];
      const [primaryMaterial] = row.productPrimaryMaterialId
        ? await db
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(and(eq(materials.id, row.productPrimaryMaterialId), eq(materials.organizationId, organizationId)))
            .limit(1)
        : [];
      const displayData = resolveLineItemProductionDisplayData({
        lineItem: { ...li, priority: row.priority },
        treeJson: treeVersion?.treeJson,
        materialName: row.materialName ?? null,
        productShopName: row.productShopName ?? null,
        primaryMaterialName: primaryMaterial?.name ?? null,
      });
      const specificationsDisplay = resolvePrepressJobSpecificationsDisplay({
        productName: row.productFormalName ?? li.description,
        productShopName: row.productShopName ?? null,
        optionRows: displayData.optionRows,
      });
      const printSides = resolveProductionSides(li);
      const artworkSideIntent = resolveArtworkSideIntent(li);
      const finishingBullets = specificationsDisplay.optionRows
        .filter((option) => /(finish|laminat|grommet|hem|trim|weld|mount|sew|pocket|tape|edge|contour|cut)/i.test(option.optionLabel))
        .map((option) => `${option.optionLabel}: ${option.selectedLabel}`);
      const filesGrouped = await prepressFileService.getLineItemFiles(lineItemId, organizationId);
      const namingPolicy = await prepressFileService.getFileUploadNamingPolicy(organizationId);
      const allFiles = [...filesGrouped.originals, ...filesGrouped.finals, ...filesGrouped.references].map((f) => ({
        ...f,
        computedDisplayFilename: prepressFileService.buildComputedDisplayFilename({
          role: f.role,
          originalFilename: f.originalFilename,
          tag: f.tag,
          fullJobNumber: row.orderNumber,
          namingPolicy,
        }),
      }));

      const computedSqFt = computeTotalSqFt({
        width: li.width,
        height: li.height,
        quantity: li.quantity,
        description: li.description,
      });
      const suggestedRoute = await resolvePostPrepressProductionRoute({
        organizationId,
        productTypeId: null,
        productTypeNameSnapshot: li.productType,
      });
      const suggestedDestination = normalizeProductionStationKey(suggestedRoute.stationKey) ?? "flatbed";
      const selectedDestination = readPrepressProductionDestinationOverride(li.specsJson)?.selectedStationKey ?? suggestedDestination;

      const parsedDimensions = parseDimensionsFromDescription(li.description);
      const width = li.width != null ? Number(li.width) : parsedDimensions.widthIn;
      const height = li.height != null ? Number(li.height) : parsedDimensions.heightIn;

      res.json({
        success: true,
        data: {
          lineItemId: li.id,
          jobNumber: row.orderNumber,
          customerName: row.customerName,
          productName: specificationsDisplay.productLabel,
          quantity: li.quantity,
          width,
          height,
          sqFootage: computedSqFt ?? (li.sqft != null ? Number(li.sqft) : null),
          media: row.productShopName ? specificationsDisplay.productLabel : displayData.mediaLabel,
          printType: li.productType,
          productionDestination: getProductionStationLabel(selectedDestination),
          suggestedProductionDestination: getProductionStationLabel(suggestedDestination),
          bleed: null,
          finishingBullets,
          optionsRows: specificationsDisplay.optionRows,
          printSides,
          useSameArtworkBothSides: artworkSideIntent.useSameArtworkBothSides,
          sameArtworkFileId: artworkSideIntent.sameArtworkFileId,
          lineItemNotes: displayData.lineItemNotes,
          priorityLabel: displayData.priorityLabel,
          originals: allFiles.filter((f) => f.role === "original"),
          finals: allFiles.filter((f) => f.role === "final"),
          references: allFiles.filter((f) => f.role === "reference"),
          proofs: filesGrouped.proofs,
        },
      });
    } catch (error: any) {
      console.error("[Prepress] Error building spec sheet:", error);
      res.status(500).json({ error: error?.message || "Failed to build spec sheet" });
    }
  });

  async function updatePrepressProductionDestination(req: any, res: any) {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const schema = z.object({
        destination: z.string().optional().nullable(),
        printType: z.string().optional().nullable(),
        reason: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const { lineItemId } = req.params;
      const rawDestination = parsed.data.destination ?? parsed.data.printType ?? null;
      const selectedDestination = String(rawDestination || "").toLowerCase() === "auto"
        ? null
        : normalizeProductionStationKey(rawDestination);

      if (rawDestination && String(rawDestination).toLowerCase() !== "auto" && !selectedDestination) {
        return res.status(400).json({ error: "Production destination must be Auto, Roll, or Flatbed" });
      }

      const rows = await db
        .select({
          id: orderLineItems.id,
          specsJson: orderLineItems.specsJson,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!rows[0]) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const previous = readPrepressProductionDestinationOverride(rows[0].specsJson);
      const nextSpecsJson = writePrepressProductionDestinationOverride({
        specsJson: rows[0].specsJson,
        selectedStationKey: selectedDestination,
        actorUserId: userId,
        reason: parsed.data.reason ?? null,
      });

      await db
        .update(orderLineItems)
        .set({ specsJson: nextSpecsJson as any, updatedAt: new Date() })
        .where(eq(orderLineItems.id, lineItemId));

      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName: req.user?.email || req.user?.name || null,
        actionType: "UPDATE",
        entityType: "order_line_item",
        entityId: lineItemId,
        entityName: `Line item ${lineItemId}`,
        description: "Updated prepress production destination",
        oldValues: { productionDestination: previous?.selectedStationKey ?? "auto" },
        newValues: { productionDestination: selectedDestination ?? "auto", reason: parsed.data.reason ?? null },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      } as any);

      res.json({
        success: true,
        data: {
          lineItemId,
          selectedProductionDestination: selectedDestination,
          destinationOverrideActive: Boolean(selectedDestination),
        },
      });
    } catch (error: any) {
      console.error("[Prepress] Error updating production destination:", error);
      res.status(500).json({ error: error?.message || "Failed to update production destination" });
    }
  }

  app.patch("/api/prepress/line-item/:lineItemId/production-destination", isAuthenticated, tenantContext, updatePrepressProductionDestination);
  app.patch("/api/prepress/line-item/:lineItemId/print-type", isAuthenticated, tenantContext, updatePrepressProductionDestination);

  // POST /api/prepress/session/start - Start prepress session
  app.post("/api/prepress/session/start", isAuthenticated, tenantContext, async (req: any, res) => {
    let organizationId: string | null = null;
    let lineItemId = "";
    let startFailureStage = "request_validation";

    try {
      if (!assertInternalUser(req, res)) return;
      organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const orgId = organizationId;
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const schema = z.object({ lineItemId: z.string() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      lineItemId = parsed.data.lineItemId;

      const result = await db.transaction(async (tx) => {
        startFailureStage = "load_line_item";
        // Get line item
        const lineItems = await tx
          .select({
            lineItem: orderLineItems,
            order: orders,
          })
          .from(orderLineItems)
          .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
          .where(
            and(
              eq(orderLineItems.id, lineItemId),
              eq(orders.organizationId, orgId)
            )
          )
          .limit(1);

        if (!lineItems[0]) {
          throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
        }

        const lineItem = lineItems[0].lineItem;
        const order = lineItems[0].order;

        await assertParentOrderInProduction(tx, {
          organizationId: orgId,
          orderId: order.id,
          lineItemId,
          action: "start prepress",
        });

        startFailureStage = "resolve_active_owner";
        const activeOwner = await findActiveJobForLineItem(tx, {
          organizationId: orgId,
          lineItemId,
        });

        if (!activeOwner || !isPrepressOwnershipJob(activeOwner)) {
          console.warn("[Prepress] Start session blocked: line item not actively owned by prepress", {
            organizationId,
            lineItemId,
            activeOwnerJobId: activeOwner?.id ?? null,
            activeOwnerStationKey: activeOwner?.stationKey ?? null,
            activeOwnerStepKey: activeOwner?.stepKey ?? null,
          });
          throw Object.assign(new Error("Line item is not actively owned by prepress"), { statusCode: 409 });
        }

        startFailureStage = "load_active_sessions";
        const activeSessions = await tx
          .select({
            id: prepressSessions.id,
            orderId: prepressSessions.orderId,
            lineItemId: prepressSessions.lineItemId,
            status: prepressSessions.status,
            startedAt: prepressSessions.startedAt,
            startedByUserId: prepressSessions.startedByUserId,
            notesText: prepressSessions.notesText,
            issueFlag: prepressSessions.issueFlag,
            issueType: prepressSessions.issueType,
          })
          .from(prepressSessions)
          .where(
            and(
              eq(prepressSessions.organizationId, orgId),
              eq(prepressSessions.lineItemId, lineItemId),
              eq(prepressSessions.status, "active"),
            ),
          )
          .orderBy(desc(prepressSessions.startedAt))
          .limit(1);

        startFailureStage = "load_completed_sessions";
        const completedSessions = await tx
          .select({ id: prepressSessions.id })
          .from(prepressSessions)
          .where(
            and(
              eq(prepressSessions.organizationId, orgId),
              eq(prepressSessions.lineItemId, lineItemId),
              eq(prepressSessions.status, "complete"),
            ),
          )
          .limit(1);

        const existingActiveSession = activeSessions[0] ?? null;

        if (existingActiveSession) {
          startFailureStage = "resume_existing_session";
          await transitionLineItemWorkflowState(tx, {
            organizationId: orgId,
            lineItemId,
            toState: "in_prepress",
            actorUserId: userId,
            metadata: { source: "prepress_session_resume" },
          });

          return {
            ...existingActiveSession,
            lineItemId,
            lineItemStatus: "in_production",
            lineItemWorkflowState: "in_prepress",
            resumed: true,
          };
        }

        if (String(lineItem.workflowState || "").toLowerCase() !== "ready_for_prepress") {
          throw Object.assign(new Error("Line item must be ready_for_prepress before starting prepress"), { statusCode: 400 });
        }

        startFailureStage = "create_session";
        // Create new session
        const [session] = await tx
          .insert(prepressSessions)
          .values({
            organizationId: orgId,
            orderId: order.id,
            lineItemId,
            status: "active",
            startedByUserId: userId,
            lockOwnerUserId: userId,
            issueFlag: false,
          })
          .returning();

        await transitionLineItemWorkflowState(tx, {
          organizationId: orgId,
          lineItemId,
          toState: "in_prepress",
          actorUserId: userId,
          metadata: { source: "prepress_session_start" },
        });

        startFailureStage = "write_audit_log";
        // Audit log
        await tx.insert(auditLogs).values({
          organizationId: orgId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "prepress_session",
          entityId: session.id,
          entityName: `Session for line item ${lineItemId}`,
          description: "Started prepress session",
          newValues: { status: "active", lineItemId },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        await insertPrepressTimelineLog({
          orderId: order.id,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "prepress_started",
          previousStatus: lineItem.workflowState,
          newStatus: "in_prepress",
          previousStation: activeOwner?.stationKey ?? null,
          newStation: activeOwner?.stationKey ?? "prepress",
          sessionId: session.id,
        });

        return {
          ...session,
          lineItemId,
          lineItemStatus: "in_production",
          lineItemWorkflowState: "in_prepress",
          resumed: false,
        };
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      if (
        error?.code === "23505" &&
        error?.constraint === "uq_prepress_active_session_per_line_item"
      ) {
        try {
          if (!organizationId) {
            throw new Error("Missing organization context");
          }
          const existingActiveSession = await db
            .select({
              id: prepressSessions.id,
              orderId: prepressSessions.orderId,
              lineItemId: prepressSessions.lineItemId,
              status: prepressSessions.status,
              startedAt: prepressSessions.startedAt,
              startedByUserId: prepressSessions.startedByUserId,
              notesText: prepressSessions.notesText,
              issueFlag: prepressSessions.issueFlag,
              issueType: prepressSessions.issueType,
            })
            .from(prepressSessions)
            .where(
              and(
                eq(prepressSessions.organizationId, organizationId),
                eq(prepressSessions.lineItemId, lineItemId),
                eq(prepressSessions.status, "active"),
              ),
            )
            .orderBy(desc(prepressSessions.startedAt))
            .limit(1);

          if (existingActiveSession[0]) {
            const recoveryOrganizationId = organizationId;
            await db.transaction(async (tx) => {
              await transitionLineItemWorkflowState(tx, {
                organizationId: recoveryOrganizationId,
                lineItemId,
                toState: "in_prepress",
                actorUserId: getUserId(req.user) ?? null,
                metadata: { source: "prepress_session_collision_recovery" },
              });
            });

            return res.json({ success: true, data: existingActiveSession[0] });
          }
        } catch (collisionRecoveryError) {
          console.error("[Prepress] Error recovering from active-session uniqueness collision:", collisionRecoveryError);
        }
      }

      const status = error?.statusCode || 500;
      console.error("[Prepress] Error starting session:", {
        stage: startFailureStage,
        organizationId,
        lineItemId,
        message: error?.message || "Unknown error",
      });
      res.status(status).json({ error: error?.message || "Failed to start session" });
    }
  });

  // POST /api/prepress/session/:id/note - Update session notes
  app.post("/api/prepress/session/:id/note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const sessionId = req.params.id;
      const schema = z.object({
        note: z.string().optional(),
        notesText: z.string().optional(),
        flaggedForQc: z.boolean().optional(),
        issueFlag: z.boolean().optional(),
        issueType: z.string().optional().nullable(),
        ifMatchUpdatedAt: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const [existingSession] = await db
        .select({ updatedAt: prepressSessions.updatedAt })
        .from(prepressSessions)
        .where(
          and(
            eq(prepressSessions.id, sessionId),
            eq(prepressSessions.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!existingSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (parsed.data.ifMatchUpdatedAt) {
        const expected = new Date(parsed.data.ifMatchUpdatedAt).getTime();
        const actual = existingSession.updatedAt ? new Date(existingSession.updatedAt).getTime() : NaN;
        if (Number.isFinite(expected) && Number.isFinite(actual) && expected !== actual) {
          return res.status(409).json({ error: "Notes changed by another user; reload before saving." });
        }
      }

      const updates: any = {};
      if (parsed.data.note !== undefined) updates.notesText = parsed.data.note;
      if (parsed.data.notesText !== undefined) updates.notesText = parsed.data.notesText;
      if (parsed.data.flaggedForQc !== undefined) updates.issueFlag = parsed.data.flaggedForQc;
      if (parsed.data.issueFlag !== undefined) updates.issueFlag = parsed.data.issueFlag;
      if (parsed.data.issueType !== undefined) updates.issueType = parsed.data.issueType;
      updates.updatedAt = new Date();

      await db
        .update(prepressSessions)
        .set(updates)
        .where(
          and(
            eq(prepressSessions.id, sessionId),
            eq(prepressSessions.organizationId, organizationId)
          )
        );

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Prepress] Error updating notes:", error);
      res.status(500).json({ error: error?.message || "Failed to update notes" });
    }
  });

  // POST /api/prepress/session/:id/complete - Mark prepress complete
  app.post("/api/prepress/session/:id/complete", isAuthenticated, tenantContext, async (req: any, res) => {
    let completeFailureStage = "request_validation";
    let sessionLineItemId: string | null = null;

    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const orgId = organizationId;
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const sessionId = req.params.id;

      const result = await db.transaction(async (tx) => {
        completeFailureStage = "load_session";
        // Get session
        const sessions = await tx
          .select()
          .from(prepressSessions)
          .where(
            and(
              eq(prepressSessions.id, sessionId),
              eq(prepressSessions.organizationId, orgId)
            )
          )
          .limit(1);

        if (!sessions[0]) {
          throw Object.assign(new Error("Session not found"), { statusCode: 404 });
        }

        const session = sessions[0];
        sessionLineItemId = session.lineItemId;

        await assertParentOrderInProduction(tx, {
          organizationId: orgId,
          orderId: session.orderId,
          lineItemId: session.lineItemId,
          action: "complete prepress",
        });

        // Completion remains idempotent after the prepress owner hands the line
        // downstream. Repeating it can retry the soft-failing bridge enqueue.
        if (session.status === "complete") {
          const finalArtworkFiles = await tx
            .select()
            .from(lineItemFiles)
            .where(and(
              eq(lineItemFiles.organizationId, orgId),
              eq(lineItemFiles.lineItemId, session.lineItemId),
              eq(lineItemFiles.role, "final"),
              eq(lineItemFiles.status, "active"),
            ));
          return {
            ...session,
            lineItemId: session.lineItemId,
            status: "complete",
            finalArtworkFiles,
            alreadyCompleted: true,
          };
        }

        completeFailureStage = "resolve_active_owner";
        const activeOwner = await findActiveJobForLineItem(tx, {
          organizationId: orgId,
          lineItemId: session.lineItemId,
        });

        if (!activeOwner || !isPrepressOwnershipJob(activeOwner)) {
          console.warn("[Prepress] Complete session blocked: line item not actively owned by prepress", {
            organizationId,
            sessionId,
            lineItemId: session.lineItemId,
            activeOwnerJobId: activeOwner?.id ?? null,
            activeOwnerStationKey: activeOwner?.stationKey ?? null,
            activeOwnerStepKey: activeOwner?.stepKey ?? null,
          });
          throw Object.assign(new Error("Line item is not actively owned by prepress"), { statusCode: 409 });
        }

        completeFailureStage = "validate_proof_gate";
        const proofGate = await resolveLineItemProofReleaseGate(tx, {
          organizationId: orgId,
          lineItemId: session.lineItemId,
        });
        if (!proofGate.allowed) {
          throw Object.assign(
            new Error(proofGate.blockedReason || "Cannot complete prepress until proof approved"),
            { statusCode: 409, code: "PROOF_APPROVAL_REQUIRED" },
          );
        }

        completeFailureStage = "validate_artwork_sides";
        const artworkReadiness = await loadPrepressArtworkSideReadiness(tx, {
          organizationId: orgId,
          lineItemId: session.lineItemId,
        });
        if (artworkReadiness && !artworkReadiness.complete) {
          throw Object.assign(
            new Error(artworkReadiness.warning || "Complete the Front/Back artwork assignment before completing prepress."),
            { statusCode: 409, code: "ARTWORK_SIDE_ASSIGNMENT_INCOMPLETE" },
          );
        }

        // Drafts may be incomplete, but a multi-artwork line cannot become
        // production-ready until its explicit output quantities match the
        // billable line quantity. Reference attachments do not participate.
        completeFailureStage = "validate_artwork_allocation";
        const [allocationLine] = await tx.select({ quantity: orderLineItems.quantity })
          .from(orderLineItems).where(eq(orderLineItems.id, session.lineItemId)).limit(1);
        const attachmentAllocationMembers = await tx.select({
          id: orderAttachments.id,
          role: orderAttachments.role,
          side: orderAttachments.side,
          productionQuantity: orderAttachments.productionQuantity,
          productionGroupId: orderAttachments.productionGroupId,
        }).from(orderAttachments).where(and(eq(orderAttachments.orderId, session.orderId), eq(orderAttachments.orderLineItemId, session.lineItemId)));
        const finalAllocationMembers = await tx.select({
          id: lineItemFiles.id,
          role: lineItemFiles.role,
          side: lineItemFiles.sourceArtworkSide,
          productionQuantity: lineItemFiles.productionQuantity,
          productionGroupId: lineItemFiles.productionGroupId,
        }).from(lineItemFiles).where(and(
          eq(lineItemFiles.organizationId, orgId),
          eq(lineItemFiles.orderId, session.orderId),
          eq(lineItemFiles.lineItemId, session.lineItemId),
          eq(lineItemFiles.role, "final"),
          eq(lineItemFiles.status, "active"),
        ));
        const allocationMembers = finalAllocationMembers.length > 0 ? finalAllocationMembers : attachmentAllocationMembers;
        const productionMemberCount = allocationMembers.filter((member) => member.role === "artwork" || member.role === "output" || member.role === "final").length;
        const allocation = buildArtworkAllocationStatus({ lineQuantity: allocationLine?.quantity ?? null, members: allocationMembers });
        if (productionMemberCount > 0 && !allocation.valid) {
          throw Object.assign(new Error(allocation.issue || "Resolve production artwork allocation before completing prepress."), {
            statusCode: 409,
            code: "ARTWORK_ALLOCATION_INCOMPLETE",
          });
        }

        completeFailureStage = "ensure_final_artwork";
        const finalArtwork = await prepressFileService.ensureFinalArtworkForLineItem({
          organizationId: orgId,
          orderId: session.orderId,
          lineItemId: session.lineItemId,
          prepressSessionId: session.id,
          createdByUserId: userId,
          forcePromoteArtwork: req.body?.useExistingArtworkAsPrintFile === true,
        });

        if (!finalArtwork) {
          throw Object.assign(
            new Error("Cannot complete prepress without usable artwork. Upload a replacement file or keep an existing linked artwork file."),
            { statusCode: 400 }
          );
        }

        completeFailureStage = "mark_session_complete";
        // Mark session complete
        await tx
          .update(prepressSessions)
          .set({
            status: "complete",
            completedAt: new Date(),
            completedByUserId: userId,
          })
          .where(eq(prepressSessions.id, sessionId));

        completeFailureStage = "route_downstream_production";
        const workflowTransition = await transitionLineItemWorkflowState(tx, {
          organizationId: orgId,
          lineItemId: session.lineItemId,
          toState: "ready_for_production",
          actorUserId: userId,
          metadata: {
            source: "prepress_complete",
            finalFileIds: finalArtwork.files.map((file) => file.id),
          },
        });
        if (!workflowTransition.activeOwnerJobId) {
          throw new Error("Prepress completion did not establish downstream production ownership");
        }

        completeFailureStage = "write_audit_log";
        // Audit log
        await tx.insert(auditLogs).values({
          organizationId: orgId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "prepress_session",
          entityId: sessionId,
          entityName: `Session for line item ${session.lineItemId}`,
          description: "Completed prepress session",
          oldValues: { status: "active" },
          newValues: {
            status: "complete",
            workflowState: workflowTransition.toState,
            productionJobId: workflowTransition.activeOwnerJobId,
            stationKey: workflowTransition.activeOwnerStationKey,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        await insertPrepressTimelineLog({
          orderId: session.orderId,
          orderLineItemId: session.lineItemId,
          actorUserId: userId,
          actionType: "prepress_completed",
          previousStatus: "in_prepress",
          newStatus: workflowTransition.toState,
          previousStation: activeOwner?.stationKey ?? "prepress",
          newStation: workflowTransition.activeOwnerStationKey ?? "production",
          sessionId,
          metadata: {
            finalArtworkSource: finalArtwork.source,
            finalFileId: finalArtwork.file.id,
            finalFileIds: finalArtwork.files.map((file) => file.id),
            createdFinalFile: finalArtwork.created,
            productionJobId: workflowTransition.activeOwnerJobId,
            stationKey: workflowTransition.activeOwnerStationKey,
            stepKey: workflowTransition.activeOwnerStepKey,
          },
        });

        if (finalArtwork.created) {
          await insertPrepressTimelineLog({
            orderId: session.orderId,
            orderLineItemId: session.lineItemId,
            actorUserId: userId,
            actionType: "prepress_file_prepared",
            previousStatus: "in_prepress",
            newStatus: "in_prepress",
            previousStation: activeOwner?.stationKey ?? "prepress",
            newStation: activeOwner?.stationKey ?? "prepress",
            sessionId,
            metadata: {
              finalArtworkSource: finalArtwork.source,
              finalFileId: finalArtwork.file.id,
            },
          });
        }

        return {
          ...session,
          lineItemId: session.lineItemId,
          status: "complete",
          completedAt: new Date(),
          finalArtworkSource: finalArtwork.source,
          finalFileId: finalArtwork.file.id,
          finalFileIds: finalArtwork.files.map((file) => file.id),
          createdFinalFile: finalArtwork.created,
          finalArtworkFiles: finalArtwork.files,
          productionJobId: workflowTransition.activeOwnerJobId,
          stationKey: workflowTransition.activeOwnerStationKey,
          stepKey: workflowTransition.activeOwnerStepKey,
        };
      });

      const bridgeResults = await Promise.all(result.finalArtworkFiles.map(async (file) => {
        try {
          return await prepressFileService.enqueueFinalProductionFileCopy({ organizationId: orgId, file });
        } catch (error) {
          console.error("[LocalBridge] Failed to enqueue finalized production file", {
            organizationId: orgId,
            lineItemId: result.lineItemId,
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return { enqueued: false, copyJobId: null, failed: true };
        }
      }));

      res.json({ success: true, data: {
        ...result,
        finalArtworkFiles: undefined,
        bridgeCopyJobIds: bridgeResults.map((entry) => entry.copyJobId).filter(Boolean),
      } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Prepress] Error completing session:", {
        stage: completeFailureStage,
        sessionId: req.params.id,
        lineItemId: sessionLineItemId,
        message: error?.message || "Unknown error",
      });
      res.status(status).json({ error: error?.message || "Failed to complete session" });
    }
  });

  // POST /api/prepress/line-item/:lineItemId/use-artwork-as-print-file
  // Compatibility acknowledgement for the old action. Side assignment records
  // the production-art candidate; only Complete Prepress may finalize it.
  app.post("/api/prepress/line-item/:lineItemId/use-artwork-as-print-file", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });
      const lineItemId = String(req.params.lineItemId || "");

      const [lineItem] = await db
        .select({ id: orderLineItems.id, orderId: orderLineItems.orderId })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      return res.json({
        success: true,
        data: {
          lineItemId,
          finalized: false,
          message: "Production artwork is finalized when Complete Prepress succeeds.",
        },
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Prepress] Error promoting assigned artwork:", {
        lineItemId: req.params.lineItemId,
        message: error?.message || "Unknown error",
      });
      return res.status(status).json({ error: error?.message || "Failed to use artwork as the print file" });
    }
  });

  // POST /api/prepress/line-item/:lineItemId/send-to-print
  // Hands off from prepress to downstream production (board ownership via production_jobs)
  app.post("/api/prepress/line-item/:lineItemId/send-to-print", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const { lineItemId } = req.params;

      // 1. Verify line item exists and belongs to org
      const [lineItem] = await db.select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          productId: orderLineItems.productId,
          productType: orderLineItems.productType,
          requiresPrepress: orderLineItems.requiresPrepress,
          requiresProofApproval: orderLineItems.requiresProofApproval,
          approvedProofVersionId: orderLineItems.approvedProofVersionId,
          productTypeId: products.productTypeId,
          proofApprovalPolicyOverride: orders.proofApprovalPolicyOverride,
          proofApprovalOverrideReason: orders.proofApprovalOverrideReason,
          proofApprovalOverrideAt: orders.proofApprovalOverrideAt,
        })
        .from(orderLineItems)
        .leftJoin(products, eq(orderLineItems.productId, products.id))
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(
          eq(orderLineItems.id, lineItemId),
          eq(orders.organizationId, organizationId)
        ))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const item = lineItem;
      await assertParentOrderInProduction(db, {
        organizationId,
        orderId: item.orderId,
        lineItemId,
        action: "send prepress to production",
      });

      // 2. Canonical prepress gate: active owner must currently be prepress.
      const activeJob = await findActiveJobForLineItem(db, {
        organizationId,
        lineItemId,
      });

      if (!activeJob) {
        return res.status(409).json({ error: "No active production owner found for this line item" });
      }

      if (!isPrepressOwnershipJob(activeJob)) {
        return res.status(409).json({
          error: "Active owner is not prepress",
          activeJobId: activeJob.id,
          stationKey: activeJob.stationKey,
          stepKey: activeJob.stepKey,
        });
      }

      if (String(item.workflowState || '').toLowerCase() !== 'in_prepress') {
        return res.status(400).json({ error: "Line item must be in_prepress before send to production" });
      }


      const artworkReadiness = await loadPrepressArtworkSideReadiness(db, {
        organizationId,
        lineItemId,
      });
      if (artworkReadiness && !artworkReadiness.complete) {
        return res.status(409).json({
          error: artworkReadiness.warning || "Complete the Front/Back artwork assignment before sending to production",
          code: "ARTWORK_SIDE_ASSIGNMENT_INCOMPLETE",
        });
      }

      // 3. Verify at least one FINAL file exists
      const finalFiles = await db.select()
        .from(lineItemFiles)
        .where(and(
          eq(lineItemFiles.lineItemId, lineItemId),
          eq(lineItemFiles.role, 'final'),
          eq(lineItemFiles.status, 'active')
        ))
        .limit(1);

      if (finalFiles.length === 0) {
        return res.status(400).json({ error: "At least one final file is required before sending to print" });
      }

      const downstreamRoute = await resolvePostPrepressProductionRoute({
        organizationId,
        productTypeId: item.productTypeId ?? null,
        productTypeNameSnapshot: item.productType,
      });

      const completedSessions = await db
        .select({ id: prepressSessions.id })
        .from(prepressSessions)
        .where(
          and(
            eq(prepressSessions.organizationId, organizationId),
            eq(prepressSessions.lineItemId, lineItemId),
            eq(prepressSessions.status, "complete"),
          ),
        )
        .limit(1);

      if (item.requiresPrepress && completedSessions.length === 0) {
        return res.status(400).json({ error: "Line item must complete prepress first" });
      }

      const proofGate = await resolveLineItemProofReleaseGate(db, {
        organizationId,
        lineItemId,
      });

      if (!proofGate.allowed) {
        return res.status(409).json({
          error: proofGate.blockedReason || "Cannot release to production until proof approved",
          code: "PROOF_APPROVAL_REQUIRED",
          proofGate,
        });
      }

      const materialContext = await getPrepressMaterialContext(organizationId, lineItemId);
      const effectivePayload = materialContext
        ? await buildPrepressMaterialsEffectivePayload({
            organizationId,
            lineItem: materialContext.lineItem,
            treeJson: materialContext.treeJson,
          })
        : null;

      const effectiveMaterials = effectivePayload?.effectiveMaterials || [];
      const effectiveFingerprint = effectivePayload?.effectiveFingerprint || buildEffectiveMaterialsFingerprint([]);

      // 5. Close prepress owner and create the downstream owner in one transaction.
      const handoffResult = await db.transaction(async (tx) => {
        const workflowTransition = await transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId,
          toState: "ready_for_production",
          actorUserId: userId,
          metadata: {
            source: "prepress_send_to_print",
            routingReason: downstreamRoute.reason,
            targetStationKey: downstreamRoute.stationKey,
            targetStepKey: downstreamRoute.stepKey,
          },
        });

        const productionJobId = workflowTransition.activeOwnerJobId;
        if (!productionJobId) {
          throw new Error("Workflow transition did not create downstream production ownership");
        }

        if (materialContext?.lineItem?.orderId) {
          const alreadyReserved = await wasMaterialsLifecycleEventProcessed(tx, {
            organizationId,
            productionJobId,
            eventType: "materials_reserved",
            fingerprint: effectiveFingerprint,
          });

          if (!alreadyReserved) {
            const reserveSync = await syncReservedMaterialsForLineItem(tx, {
              organizationId,
              orderId: materialContext.lineItem.orderId,
              lineItemId,
              createdByUserId: userId ?? null,
              effectiveMaterials,
              flatSheet: resolveFlatSheetReservationContext(materialContext.lineItem, materialContext.treeJson),
              rollMedia: resolveRollMediaReservationContext(materialContext.lineItem, materialContext.treeJson),
            });

            await tx.insert(productionEvents).values({
              organizationId,
              productionJobId,
              orderId: materialContext.lineItem.orderId,
              orderLineItemId: lineItemId,
              actorUserId: userId ?? null,
              type: "note",
              payload: {
                eventType: "materials_reserved",
                lineItemId,
                orderId: materialContext.lineItem.orderId,
                previousFingerprint: reserveSync.previousFingerprint,
                requestedMaterialFingerprint: effectiveFingerprint,
                materialFingerprint: reserveSync.nextFingerprint,
                changed: reserveSync.changed,
                reservationCount: reserveSync.nextCount,
              },
            });
          }
        }

        // 6. Create audit log
        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "order_line_item",
          entityId: lineItemId,
          entityName: `Line item ${lineItemId}`,
          description: "Sent to print queue from prepress",
          oldValues: { workflowState: item.workflowState, status: item.status },
          newValues: {
            workflowState: 'ready_for_production',
            status: workflowTransition.lifecycleStatus,
            materialFingerprint: effectiveFingerprint,
            productionJobId,
            stationKey: workflowTransition.activeOwnerStationKey,
            stepKey: workflowTransition.activeOwnerStepKey,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        await insertPrepressTimelineLog({
          orderId: item.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "prepress_routed",
          previousStatus: item.workflowState,
          newStatus: workflowTransition.toState,
          previousStation: activeJob.stationKey,
          newStation: workflowTransition.activeOwnerStationKey ?? downstreamRoute.stationKey,
          reason: downstreamRoute.reason,
          metadata: {
            targetStation: downstreamRoute.stationKey,
            targetStepKey: downstreamRoute.stepKey,
            productionJobId,
          },
        });

        return workflowTransition;
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(`[DEV][Send to Print] lineItemId=${lineItemId} productionJobId=${handoffResult.activeOwnerJobId} station=${handoffResult.activeOwnerStationKey} step=${handoffResult.activeOwnerStepKey}`);
      }

      const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
      await applyWorkflowStatusPillFailSoft({
        organizationId,
        orderId: item.orderId,
        triggerKey: "sent_to_production",
        actorUserId: userId,
        source: "system",
        reason: "Prepress released the line item to production",
        metadata: {
          workflowEvent: "sent_to_production",
          lineItemId,
          productionJobId: handoffResult.activeOwnerJobId,
          stationKey: handoffResult.activeOwnerStationKey,
          stepKey: handoffResult.activeOwnerStepKey,
        },
      });

      res.json({
        success: true,
        message: "Sent to print queue successfully",
        workflowState: 'ready_for_production',
        productionJobId: handoffResult.activeOwnerJobId,
        materialFingerprint: effectiveFingerprint,
      });

    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Send to Print] Error:", error);
      res.status(status).json({ error: error?.message || "Failed to send to print queue" });
    }
  });

  // POST /api/production/line-item/:lineItemId/send-to-prepress
  // Kickback from production board to prepress with a required edit-request note.
  // Canonical: completes active downstream job, creates new prepress job, all in one transaction.
  app.post("/api/production/line-item/:lineItemId/send-to-prepress", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const { lineItemId } = req.params;
      const { note, noPrintsCompletedYet } = req.body;

      // Validate note (required)
      if (!note || typeof note !== 'string' || !note.trim()) {
        return res.status(400).json({ error: "Note is required" });
      }

      // Verify line item belongs to org
      const [lineItem] = await db.select({
          id: orderLineItems.id,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          orderId: orderLineItems.orderId,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(
          eq(orderLineItems.id, lineItemId),
          eq(orders.organizationId, organizationId)
        ))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const result = await db.transaction(async (tx) => {
        // 1. Check for active downstream job and complete it, creating prepress job
        const activeJob = await findActiveJobForLineItem(tx, {
          organizationId,
          lineItemId,
        });

        const workflowTransition = await transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId,
          toState: "in_prepress",
          actorUserId: userId,
          note: note.trim(),
          metadata: {
            source: "production_send_to_prepress",
            noPrintsCompletedYet: noPrintsCompletedYet || false,
          },
        });

        const prepressJobId = workflowTransition.activeOwnerJobId;
        if (!prepressJobId) {
          throw new Error("Workflow transition did not create prepress ownership");
        }

        // 2. Create or reuse the active prepress session for this edit request.
        //    DB uniqueness now guarantees one active session per org + line item,
        //    so returning to prepress must not blindly insert a second active row.
        const editNote = `[EDIT REQUEST FROM PRODUCTION]\n${note.trim()}`;
        const existingActiveSessions = await tx
          .select({
            id: prepressSessions.id,
            notesText: prepressSessions.notesText,
          })
          .from(prepressSessions)
          .where(
            and(
              eq(prepressSessions.organizationId, organizationId),
              eq(prepressSessions.lineItemId, lineItemId),
              eq(prepressSessions.status, "active"),
            ),
          )
          .orderBy(desc(prepressSessions.updatedAt), desc(prepressSessions.startedAt))
          .limit(1);

        let sessionId: string;

        if (existingActiveSessions[0]) {
          const existingSession = existingActiveSessions[0];
          const nextNotesText = (() => {
            const current = String(existingSession.notesText || "").trim();
            if (!current) return editNote;
            if (current.includes(editNote)) return current;
            return `${current}\n\n${editNote}`;
          })();

          await tx
            .update(prepressSessions)
            .set({
              lockOwnerUserId: userId,
              issueFlag: true,
              issueType: "production_edit_request",
              notesText: nextNotesText,
              updatedAt: new Date(),
            })
            .where(eq(prepressSessions.id, existingSession.id));

          sessionId = existingSession.id;
        } else {
          const [session] = await tx.insert(prepressSessions).values({
            organizationId,
            orderId: lineItem.orderId,
            lineItemId,
            status: "active",
            startedByUserId: userId,
            lockOwnerUserId: userId,
            issueFlag: true,
            issueType: "production_edit_request",
            notesText: editNote,
          }).returning({ id: prepressSessions.id });

          sessionId = session.id;
        }

        // 3. Audit log
        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "order_line_item",
          entityId: lineItemId,
          entityName: `Line item ${lineItemId}`,
          description: "Sent to prepress for editing from production board",
          oldValues: { status: lineItem.status, workflowState: lineItem.workflowState },
          newValues: {
            note: note.trim(),
            noPrintsCompletedYet: noPrintsCompletedYet || false,
            prepressJobId,
            workflowState: "in_prepress",
            status: workflowTransition.lifecycleStatus,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        await insertPrepressTimelineLog({
          orderId: lineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "prepress_sent_back_for_correction",
          previousStatus: lineItem.workflowState,
          newStatus: "in_prepress",
          previousStation: activeJob?.stationKey ?? null,
          newStation: workflowTransition.activeOwnerStationKey ?? "prepress",
          note: note.trim(),
          metadata: {
            noPrintsCompletedYet: noPrintsCompletedYet || false,
            prepressJobId,
            sessionId,
          },
        });

        return { sessionId, prepressJobId };
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(`[DEV][Send to Prepress] lineItemId=${lineItemId} prepressJobId=${result.prepressJobId} userId=${userId}`);
      }

      res.json({ success: true, message: "Sent to prepress for editing", sessionId: result.sessionId, prepressJobId: result.prepressJobId });

    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Send to Prepress] Error:", error);
      res.status(status).json({ error: error?.message || "Failed to send to prepress" });
    }
  });
}
