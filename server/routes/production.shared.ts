import crypto from "crypto";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  inventoryAdjustments,
  inventoryReservations,
  materials,
  orderMaterialUsage,
  organizations,
  productionEvents,
  productionJobs,
} from "@shared/schema";

import { db } from "../db";
import { canAutoDeductMaterialStock } from "../lib/materialStockDeductionGuard";

export const productionStatusSchema = z.enum(["queued", "in_progress", "paused", "done", "canceled"]);
export const productionViewKeySchema = z.string().min(1);
export const productionEventTypeSchema = z.enum([
  "intake",
  "routing_override",
  "status_changed",
  "timer_started",
  "timer_stopped",
  "note",
  "reprint_incremented",
  "media_used_set",
  "ticket_printed",
  "printer_assigned",
]);

const productionLineItemStatusRuleSchema = z
  .object({
    id: z.string().optional().nullable(),
    key: z.string().optional().nullable(),
    label: z.string().min(1),
    color: z.string().optional().nullable(),
    sendToProduction: z.boolean().optional().default(false),
    stationKey: z.string().optional().nullable(),
    stepKey: z.string().optional().nullable(),
    defaultStepKey: z.string().optional().nullable(),
    sortOrder: z.number().int().optional().nullable(),
  })
  .strict();

export const productionLineItemStatusRulesSchema = z.array(productionLineItemStatusRuleSchema);
export const productionManagedStepTriggerSchema = z
  .object({
    type: z.string().min(1),
    config: z.record(z.unknown()).optional().default({}),
  })
  .strict();

export const normalizeProductionStepKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-");

export const normalizeProductionStepLabel = (value: unknown) => String(value ?? "").trim();

const normalizeProductionStepTriggers = (value: unknown) => {
  const parsed = z.array(productionManagedStepTriggerSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
};

const SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES = [
  {
    id: "prepress",
    label: "Sent to Prepress",
    color: "blue",
    sendToProduction: true,
    stationKey: "flatbed",
    stepKey: "prepress",
    sortOrder: 10,
  },
  {
    id: "print",
    label: "Sent to Print",
    color: "purple",
    sendToProduction: true,
    stationKey: "flatbed",
    stepKey: "print",
    sortOrder: 20,
  },
  {
    id: "done",
    label: "Done",
    color: "green",
    sendToProduction: false,
    stationKey: null,
    stepKey: null,
    sortOrder: 90,
  },
];

const DEFAULT_PRODUCTION_MANAGED_STEP = {
  key: "queued",
  label: "Queued",
  sortOrder: 10,
  active: true,
  triggers: [],
} as const;

export const getProductionConfigForOrganization = async (organizationId: string) => {
  const rows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const settings = rows[0]?.settings as any;
  const enabledViews =
    (settings?.preferences?.production?.enabledViews as string[] | undefined) ?? ["flatbed", "roll"];
  const defaultView =
    (settings?.preferences?.production?.defaultView as string | undefined) ?? "flatbed";
  const finishingModeRaw = settings?.preferences?.production?.finishingMode;
  const finishingMode =
    finishingModeRaw === "dedicated_finishing_queue"
      ? "dedicated_finishing_queue"
      : "integrated_with_print";
  const printerOptionsByStationRaw = settings?.preferences?.production?.printerOptionsByStation;
  const printerOptionsByStation =
    printerOptionsByStationRaw && typeof printerOptionsByStationRaw === "object"
      ? printerOptionsByStationRaw
      : {
          roll: ["S40", "S60", "Canon"],
          wide_roll: ["S40", "S60", "Canon"],
          flatbed: ["Jetson"],
        };
  return {
    enabledViews: Array.isArray(enabledViews) && enabledViews.length > 0 ? enabledViews : ["flatbed", "roll"],
    defaultView: typeof defaultView === "string" && defaultView.trim() ? defaultView : "flatbed",
    finishingMode,
    printerOptionsByStation,
  };
};

export const loadProductionLineItemStatusRulesForOrganization = async (organizationId: string) => {
  const rows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const settings = (rows[0]?.settings as any) ?? {};
  const raw = settings?.preferences?.production?.lineItemStatuses;

  if (raw == null) {
    return {
      source: "missing" as const,
      rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES,
    };
  }

  const parsed = productionLineItemStatusRulesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      source: "invalid" as const,
      rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES,
    };
  }

  const items = parsed.data;
  if (items.length === 0) {
    return {
      source: "empty" as const,
      rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES,
    };
  }

  const normalized = items
    .map((rule) => ({
      ...rule,
      id: String((rule as any).id ?? (rule as any).key ?? "").trim(),
      stepKey: ((rule as any).stepKey ?? (rule as any).defaultStepKey ?? null) as any,
    }))
    .filter((rule) => !!rule.id);

  const sorted = [...normalized].sort((left, right) => {
    const leftOrder = Number(left.sortOrder ?? 0);
    const rightOrder = Number(right.sortOrder ?? 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label);
  });

  return {
    source: "org" as const,
    rules: sorted,
  };
};

export const getProductionLineItemStatusRulesForOrganization = async (organizationId: string) => {
  const loaded = await loadProductionLineItemStatusRulesForOrganization(organizationId);
  return loaded.rules;
};

export const getProductionStationStepsForOrganization = async (organizationId: string) => {
  await db.execute(sql`
    insert into production_station_steps (
      organization_id,
      station_key,
      key,
      label,
      sort_order,
      active,
      triggers
    )
    select
      s.organization_id,
      s.key,
      ${DEFAULT_PRODUCTION_MANAGED_STEP.key},
      ${DEFAULT_PRODUCTION_MANAGED_STEP.label},
      ${DEFAULT_PRODUCTION_MANAGED_STEP.sortOrder},
      ${DEFAULT_PRODUCTION_MANAGED_STEP.active},
      '[]'::jsonb
    from stations s
    left join production_station_steps p
      on p.organization_id = s.organization_id
     and p.station_key = s.key
    where s.organization_id = ${organizationId}
      and s.active = true
      and p.id is null
    on conflict (organization_id, station_key, key) do nothing
  `);

  const result = await db.execute(sql`
    select
      station_key as "stationKey",
      key as "key",
      label as "label",
      sort_order as "sortOrder",
      active as "active",
      triggers as "triggers"
    from production_station_steps
    where organization_id = ${organizationId}
    order by station_key asc, sort_order asc, created_at asc, label asc
  `);

  const grouped: Record<
    string,
    Array<{
      key: string;
      label: string;
      sortOrder: number;
      active: boolean;
      triggers: Array<{ type: string; config: Record<string, unknown> }>;
    }>
  > = {};

  for (const row of result.rows ?? []) {
    const stationKey = String((row as any).stationKey ?? "").trim();
    const key = normalizeProductionStepKey((row as any).key);
    const label = normalizeProductionStepLabel((row as any).label);
    if (!stationKey || !key || !label) continue;
    if (!grouped[stationKey]) grouped[stationKey] = [];
    grouped[stationKey].push({
      key,
      label,
      sortOrder: Number((row as any).sortOrder ?? 0),
      active: (row as any).active !== false,
      triggers: normalizeProductionStepTriggers((row as any).triggers),
    });
  }

  const activeStations = await getActiveProductionStationsForOrganization(organizationId);
  const stationsMissingUsableSteps = activeStations
    .map((station) => station.key)
    .filter((stationKey) => !Array.isArray(grouped[stationKey]) || grouped[stationKey].length === 0);

  for (const stationKey of stationsMissingUsableSteps) {
    await db.execute(sql`
      insert into production_station_steps (
        organization_id,
        station_key,
        key,
        label,
        sort_order,
        active,
        triggers
      )
      values (
        ${organizationId},
        ${stationKey},
        ${DEFAULT_PRODUCTION_MANAGED_STEP.key},
        ${DEFAULT_PRODUCTION_MANAGED_STEP.label},
        ${DEFAULT_PRODUCTION_MANAGED_STEP.sortOrder},
        ${DEFAULT_PRODUCTION_MANAGED_STEP.active},
        '[]'::jsonb
      )
      on conflict (organization_id, station_key, key) do nothing
    `);

    grouped[stationKey] = [
      {
        key: DEFAULT_PRODUCTION_MANAGED_STEP.key,
        label: DEFAULT_PRODUCTION_MANAGED_STEP.label,
        sortOrder: DEFAULT_PRODUCTION_MANAGED_STEP.sortOrder,
        active: DEFAULT_PRODUCTION_MANAGED_STEP.active,
        triggers: [],
      },
    ];
  }

  return grouped;
};

export const getActiveProductionStationsForOrganization = async (organizationId: string) => {
  const result = await db.execute(sql`
    select
      key as "key",
      name as "name",
      sort as "sort"
    from stations
    where organization_id = ${organizationId}
      and active = true
    order by sort asc, name asc
  `);

  return (result.rows ?? [])
    .map((row: any) => ({
      key: String(row.key ?? "").trim(),
      name: String(row.name ?? row.key ?? "").trim(),
      sort: Number(row.sort ?? 0),
    }))
    .filter((row: any) => row.key.length > 0);
};

export const ensureActiveStationExists = async (organizationId: string, stationKey: string) => {
  const result = await db.execute(sql`
    select 1
    from stations
    where organization_id = ${organizationId}
      and key = ${stationKey}
      and active = true
    limit 1
  `);

  return (result.rows ?? []).length > 0;
};

export const getProductionStationStepKeysForStation = async (organizationId: string, stationKey: string) => {
  const result = await db.execute(sql`
    select key
    from production_station_steps
    where organization_id = ${organizationId}
      and station_key = ${stationKey}
    order by sort_order asc, created_at asc, label asc
  `);

  return (result.rows ?? []).map((row: any) => normalizeProductionStepKey(row.key)).filter(Boolean);
};

export const getProductionStationStepState = async (organizationId: string, stationKey: string, stepKey: string) => {
  const normalizedStationKey = String(stationKey ?? "").trim();
  const normalizedStepKey = normalizeProductionStepKey(stepKey);
  if (!normalizedStationKey || !normalizedStepKey) return "missing" as const;

  const result = await db.execute(sql`
    select active
    from production_station_steps
    where organization_id = ${organizationId}
      and station_key = ${normalizedStationKey}
      and key = ${normalizedStepKey}
    limit 1
  `);

  const row = result.rows?.[0] as { active?: boolean } | undefined;
  if (!row) {
    return normalizedStepKey === DEFAULT_PRODUCTION_MANAGED_STEP.key ? ("fallback" as const) : ("missing" as const);
  }

  return row.active === false ? ("inactive" as const) : ("active" as const);
};

export const createProductionStationStep = async (args: {
  organizationId: string;
  stationKey: string;
  key: string;
  label: string;
}) => {
  const maxSortResult = await db.execute(sql`
    select coalesce(max(sort_order), 0) as "maxSortOrder"
    from production_station_steps
    where organization_id = ${args.organizationId}
      and station_key = ${args.stationKey}
  `);
  const nextSortOrder = Number((maxSortResult.rows?.[0] as any)?.maxSortOrder ?? 0) + 10;

  await db.execute(sql`
    insert into production_station_steps (
      organization_id,
      station_key,
      key,
      label,
      sort_order,
      active,
      triggers
    )
    values (
      ${args.organizationId},
      ${args.stationKey},
      ${args.key},
      ${args.label},
      ${nextSortOrder},
      true,
      '[]'::jsonb
    )
  `);
};

export const updateProductionStationStep = async (args: {
  organizationId: string;
  stationKey: string;
  key: string;
  label?: string;
  active?: boolean;
  triggers?: Array<{ type: string; config: Record<string, unknown> }>;
}) => {
  const updates = [] as Array<ReturnType<typeof sql>>;
  if (typeof args.label !== "undefined") updates.push(sql`label = ${args.label}`);
  if (typeof args.active === "boolean") updates.push(sql`active = ${args.active}`);
  if (typeof args.triggers !== "undefined") updates.push(sql`triggers = ${JSON.stringify(args.triggers)}::jsonb`);
  updates.push(sql`updated_at = now()`);

  await db.execute(sql`
    update production_station_steps
    set ${sql.join(updates, sql`, `)}
    where organization_id = ${args.organizationId}
      and station_key = ${args.stationKey}
      and key = ${args.key}
  `);
};

export const reorderProductionStationSteps = async (args: {
  organizationId: string;
  stationKey: string;
  keys: string[];
}) => {
  await db.transaction(async (tx) => {
    const existingResult = await tx.execute(sql`
      select key
      from production_station_steps
      where organization_id = ${args.organizationId}
        and station_key = ${args.stationKey}
      order by sort_order asc, created_at asc, label asc
    `);
    const existingKeys = (existingResult.rows ?? []).map((row: any) => normalizeProductionStepKey(row.key)).filter(Boolean);
    const requestedKeys = args.keys.map((key) => normalizeProductionStepKey(key)).filter(Boolean);

    if (requestedKeys.length === 0 || requestedKeys.length !== existingKeys.length) {
      throw new Error("Reorder payload must include every step key for the station");
    }

    const requestedSet = new Set(requestedKeys);
    if (existingKeys.some((key) => !requestedSet.has(key)) || requestedSet.size !== existingKeys.length) {
      throw new Error("Reorder payload does not match current station steps");
    }

    for (let index = 0; index < requestedKeys.length; index += 1) {
      const key = requestedKeys[index];
      await tx.execute(sql`
        update production_station_steps
        set sort_order = ${(index + 1) * 10},
            updated_at = now()
        where organization_id = ${args.organizationId}
          and station_key = ${args.stationKey}
          and key = ${key}
      `);
    }
  });
};

export const setProductionLineItemStatusRulesForOrganization = async (
  organizationId: string,
  rules: z.infer<typeof productionLineItemStatusRulesSchema>,
) => {
  const rows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const settings = (rows[0]?.settings as any) ?? {};
  const next = {
    ...settings,
    preferences: {
      ...(settings.preferences ?? {}),
      production: {
        ...(settings.preferences?.production ?? {}),
        lineItemStatuses: rules,
      },
    },
  };

  await db.update(organizations).set({ settings: next }).where(eq(organizations.id, organizationId));
  return next;
};

export const toSeconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

export const getTimerStateForJob = async (
  organizationId: string,
  productionJobId: string,
  tx: any = db,
) => {
  const rows = await tx
    .select({
      type: productionEvents.type,
      createdAt: productionEvents.createdAt,
    })
    .from(productionEvents)
    .where(
      and(
        eq(productionEvents.organizationId, organizationId),
        eq(productionEvents.productionJobId, productionJobId),
        inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
      ),
    )
    .orderBy(desc(productionEvents.createdAt))
    .limit(1);

  const last = rows[0];
  const isRunning = last?.type === "timer_started";
  return {
    isRunning,
    runningSince: isRunning ? (last!.createdAt as any) : null,
  };
};

export const appendEvent = async (args: {
  tx: any;
  organizationId: string;
  productionJobId: string;
  type: z.infer<typeof productionEventTypeSchema>;
  orderId?: string | null;
  orderLineItemId?: string | null;
  actorUserId?: string | null;
  payload?: any;
}) => {
  const payload = args.payload ?? {};
  let orderId = args.orderId ?? payload.orderId ?? null;
  let orderLineItemId = args.orderLineItemId ?? payload.orderLineItemId ?? payload.lineItemId ?? null;
  const actorUserId = args.actorUserId ?? payload.actorUserId ?? null;

  if (!orderId || !orderLineItemId) {
    const [job] = await args.tx
      .select({
        orderId: productionJobs.orderId,
        lineItemId: productionJobs.lineItemId,
      })
      .from(productionJobs)
      .where(
        and(
          eq(productionJobs.organizationId, args.organizationId),
          eq(productionJobs.id, args.productionJobId),
        ),
      )
      .limit(1);

    orderId = orderId ?? job?.orderId ?? null;
    orderLineItemId = orderLineItemId ?? job?.lineItemId ?? null;
  }

  await args.tx.insert(productionEvents).values({
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    orderId,
    orderLineItemId,
    actorUserId,
    type: args.type,
    payload,
  });
};

// ---------------------------------------------------------------------------
// Inventory consumption helpers (used by production job complete/status routes)
// ---------------------------------------------------------------------------

const normalizeQty2dp = (value: unknown): string => {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(2);
  return (Math.round(n * 100) / 100).toFixed(2);
};

const toQtyNumber2dp = (value: unknown): number => Number(normalizeQty2dp(value));

const buildEffectiveMaterialsFingerprint = (
  materialsInput: Array<{ materialId: string; uom: string; qty: number }>
): string => {
  const canonical = (materialsInput || [])
    .map((m) => ({
      materialId: String(m.materialId || "").trim(),
      uom: String(m.uom || "").trim(),
      qty: normalizeQty2dp(m.qty),
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
      qty: toQtyNumber2dp(r.qty),
    }))
  );
};

const listReservedMaterialsForLineItem = async (tx: any, args: { organizationId: string; orderId: string; lineItemId: string }) => {
  return tx
    .select({
      id: inventoryReservations.id,
      sourceKey: inventoryReservations.sourceKey,
      uom: inventoryReservations.uom,
      qty: inventoryReservations.qty,
      materialType: materials.type,
      materialUnitOfMeasure: materials.unitOfMeasure,
      materialInventoryUnit: materials.inventoryUnit,
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
      String(payload.materialFingerprint || "") === args.fingerprint
    );
  });
};

export const consumeReservedMaterialsForLineItem = async (
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    lineItemId: string;
    productionJobId: string;
    userId: string;
  }
) => {
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
    const qty = toQtyNumber2dp(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const usageUom = String(row.uom || "each");
    const deductionDecision = canAutoDeductMaterialStock(
      {
        type: (row as any).materialType,
        unitOfMeasure: (row as any).materialUnitOfMeasure,
        inventoryUnit: (row as any).materialInventoryUnit,
      },
      usageUom,
    );

    await tx.insert(orderMaterialUsage).values({
      orderId: args.orderId,
      orderLineItemId: args.lineItemId,
      materialId,
      quantityUsed: normalizeQty2dp(qty),
      unitOfMeasure: usageUom,
      calculatedBy: "auto",
    } as any);

    if (deductionDecision.allowed) {
      await tx.insert(inventoryAdjustments).values({
        materialId,
        type: "job_usage",
        quantityChange: normalizeQty2dp(-qty),
        reason: `Auto-consumed from reservation for line item ${args.lineItemId}`,
        orderId: args.orderId,
        userId: args.userId,
      } as any);

      await tx
        .update(materials)
        .set({
          stockQuantity: sql`${materials.stockQuantity} - ${normalizeQty2dp(qty)}`,
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
