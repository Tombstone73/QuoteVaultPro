/**
 * Production Helpers - Shared utilities for production scheduling
 * 
 * This file exists to avoid circular dependencies between routes.ts and services.
 */

import { db } from "./db";
import { organizations, productionEvents, productionJobs } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

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

const productionLineItemStatusRulesSchema = z.array(productionLineItemStatusRuleSchema);

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

export async function loadProductionLineItemStatusRulesForOrganization(organizationId: string) {
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
    .map((r) => ({
      ...r,
      id: String((r as any).id ?? (r as any).key ?? "").trim(),
      stepKey: ((r as any).stepKey ?? (r as any).defaultStepKey ?? null) as any,
    }))
    .filter((r) => !!r.id);

  const sorted = [...normalized].sort((a, b) => {
    const ao = Number(a.sortOrder ?? 0);
    const bo = Number(b.sortOrder ?? 0);
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label);
  });

  return {
    source: "org" as const,
    rules: sorted,
  };
}

type ProductionEventType = "intake" | "routing_override" | "status_changed" | "timer_started" | "timer_stopped" | "note" | "reprint_incremented" | "media_used_set";

export async function appendEvent(args: {
  tx: any;
  organizationId: string;
  productionJobId: string;
  type: ProductionEventType;
  orderId?: string | null;
  orderLineItemId?: string | null;
  actorUserId?: string | null;
  payload?: any;
}) {
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
}
