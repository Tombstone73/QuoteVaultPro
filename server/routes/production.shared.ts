import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { organizations, productionEvents } from "@shared/schema";

import { db } from "../db";

export const productionStatusSchema = z.enum(["queued", "in_progress", "done"]);
export const productionViewKeySchema = z.string().min(1);
export const productionEventTypeSchema = z.enum([
  "intake",
  "routing_override",
  "timer_started",
  "timer_stopped",
  "note",
  "reprint_incremented",
  "media_used_set",
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
  return {
    enabledViews: Array.isArray(enabledViews) && enabledViews.length > 0 ? enabledViews : ["flatbed", "roll"],
    defaultView: typeof defaultView === "string" && defaultView.trim() ? defaultView : "flatbed",
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
  payload?: any;
}) => {
  const payload = args.payload ?? {};
  await args.tx.insert(productionEvents).values({
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    type: args.type,
    payload,
  });
};