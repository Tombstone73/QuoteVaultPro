import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  orderStatusPills,
  orders,
  workflowStatusPillMappings,
  type WorkflowStatusPillMapping,
} from "@shared/schema";
import {
  DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS,
  workflowStatusPillAssignmentSourceSchema,
  workflowStatusPillTriggerSchema,
  type WorkflowStatusPillAssignmentSource,
  type WorkflowStatusPillTrigger,
} from "@shared/orderStatusWorkflowAutomation";
import { assignOrderStatusPill } from "./orderStatusPillService";

type DbExecutor = any;

const PROTECTED_EXCEPTION_STATUS_KEYS = new Set(["on_hold", "problem"]);

export type WorkflowStatusPillSkipReason =
  | "mapping_missing"
  | "mapping_disabled"
  | "target_missing"
  | "target_disabled"
  | "protected_exception_status"
  | "already_assigned";

export type WorkflowStatusPillApplicationResult =
  | {
      status: "applied";
      triggerKey: WorkflowStatusPillTrigger;
      targetStatusKey: string;
      statusPillId: string;
      eventId: string;
      source: WorkflowStatusPillAssignmentSource;
    }
  | {
      status: "skipped";
      triggerKey: WorkflowStatusPillTrigger;
      targetStatusKey: string | null;
      reason: WorkflowStatusPillSkipReason;
    };

type ExistingMappingIdentity = Pick<WorkflowStatusPillMapping, "triggerKey">;
type WorkflowStatusTarget = {
  id: string;
  key: string;
  name: string;
  stateScope: string;
  isActive: boolean;
};

export function evaluateWorkflowStatusPillTarget(args: {
  mapping: Pick<WorkflowStatusPillMapping, "isActive" | "targetStatusKey" | "overwriteExceptionStatus"> | null;
  currentStatusPillId: string | null;
  currentStatusKey: string | null;
  targetPill: WorkflowStatusTarget | null;
}): WorkflowStatusPillSkipReason | null {
  if (!args.mapping) return "mapping_missing";
  if (!args.mapping.isActive) return "mapping_disabled";
  if (!args.targetPill) return "target_missing";
  if (!args.targetPill.isActive) return "target_disabled";
  if (args.currentStatusPillId === args.targetPill.id) return "already_assigned";
  if (
    !args.mapping.overwriteExceptionStatus &&
    args.currentStatusKey &&
    PROTECTED_EXCEPTION_STATUS_KEYS.has(args.currentStatusKey)
  ) {
    return "protected_exception_status";
  }
  return null;
}

export function planDefaultWorkflowStatusPillMappings(existing: ReadonlyArray<ExistingMappingIdentity>) {
  const existingTriggers = new Set(existing.map((mapping) => mapping.triggerKey));
  return DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS.filter(
    (mapping) => !existingTriggers.has(mapping.triggerKey),
  );
}

export async function seedDefaultWorkflowStatusPillMappingsForOrg(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<{ created: number; skipped: boolean }> {
  const existing = await executor
    .select({ triggerKey: workflowStatusPillMappings.triggerKey })
    .from(workflowStatusPillMappings)
    .where(eq(workflowStatusPillMappings.organizationId, organizationId));
  const missing = planDefaultWorkflowStatusPillMappings(existing);
  if (missing.length === 0) return { created: 0, skipped: true };

  const inserted = await executor
    .insert(workflowStatusPillMappings)
    .values(missing.map((mapping) => ({ ...mapping, organizationId, isActive: true })))
    .onConflictDoNothing()
    .returning({ id: workflowStatusPillMappings.id });

  return { created: inserted.length, skipped: inserted.length === 0 };
}

export async function listWorkflowStatusPillMappings(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<WorkflowStatusPillMapping[]> {
  return executor
    .select()
    .from(workflowStatusPillMappings)
    .where(eq(workflowStatusPillMappings.organizationId, organizationId))
    .orderBy(workflowStatusPillMappings.triggerKey);
}

/**
 * Backend settings hook for a future UI. Existing rows are updated in place so
 * disabling a mapping is durable and defaults do not recreate it.
 */
export async function upsertWorkflowStatusPillMapping(args: {
  organizationId: string;
  triggerKey: WorkflowStatusPillTrigger;
  targetStatusKey: string;
  source?: WorkflowStatusPillAssignmentSource;
  isActive?: boolean;
  overwriteExceptionStatus?: boolean;
}) {
  const triggerKey = workflowStatusPillTriggerSchema.parse(args.triggerKey);
  const source = workflowStatusPillAssignmentSourceSchema.parse(args.source ?? "system");
  const [target] = await db
    .select({ key: orderStatusPills.key, isActive: orderStatusPills.isActive })
    .from(orderStatusPills)
    .where(and(
      eq(orderStatusPills.organizationId, args.organizationId),
      eq(orderStatusPills.key, args.targetStatusKey),
    ))
    .limit(1);
  if (!target) throw new Error("Target status pill key does not exist in this organization");
  if (!target.isActive && (args.isActive ?? true)) {
    throw new Error("Enabled workflow automation can only target an active status pill");
  }

  const [mapping] = await db
    .insert(workflowStatusPillMappings)
    .values({
      organizationId: args.organizationId,
      triggerKey,
      targetStatusKey: args.targetStatusKey,
      source,
      isActive: args.isActive ?? true,
      overwriteExceptionStatus: args.overwriteExceptionStatus ?? false,
    })
    .onConflictDoUpdate({
      target: [workflowStatusPillMappings.organizationId, workflowStatusPillMappings.triggerKey],
      set: {
        targetStatusKey: args.targetStatusKey,
        source,
        isActive: args.isActive ?? true,
        overwriteExceptionStatus: args.overwriteExceptionStatus ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();
  return mapping;
}

export async function assignResolvedWorkflowStatusPill(args: {
  organizationId: string;
  orderId: string;
  triggerKey: WorkflowStatusPillTrigger;
  mapping: Pick<WorkflowStatusPillMapping, "id" | "source">;
  targetPill: WorkflowStatusTarget;
  actorUserId: string;
  actorUserName?: string;
  source?: WorkflowStatusPillAssignmentSource;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  assignFn?: typeof assignOrderStatusPill;
}): Promise<WorkflowStatusPillApplicationResult> {
  const source = workflowStatusPillAssignmentSourceSchema.parse(args.source ?? args.mapping.source);
  const assignment = await (args.assignFn ?? assignOrderStatusPill)({
    organizationId: args.organizationId,
    orderId: args.orderId,
    statusPillKey: args.targetPill.key,
    actorUserId: args.actorUserId,
    actorUserName: args.actorUserName,
    source,
    reason: args.reason ?? `Workflow trigger: ${args.triggerKey}`,
    metadata: {
      ...args.metadata,
      workflowTriggerKey: args.triggerKey,
      workflowStatusPillMappingId: args.mapping.id,
      targetStatusKey: args.targetPill.key,
    },
    scheduleProductionJobs: false,
  });

  if (!assignment.eventId || !assignment.statusPill) {
    return {
      status: "skipped",
      triggerKey: args.triggerKey,
      targetStatusKey: args.targetPill.key,
      reason: "already_assigned",
    };
  }

  return {
    status: "applied",
    triggerKey: args.triggerKey,
    targetStatusKey: assignment.statusPill.key,
    statusPillId: assignment.statusPill.id,
    eventId: assignment.eventId,
    source,
  };
}

function logSkip(args: {
  organizationId: string;
  orderId: string;
  triggerKey: WorkflowStatusPillTrigger;
  targetStatusKey: string | null;
  reason: WorkflowStatusPillSkipReason;
}) {
  console.warn("[WorkflowStatusPill] Automatic assignment skipped", args);
}

/**
 * Applies a workflow signal through the exact same assignment/event service as
 * manual pill changes. Mapping and target problems are intentionally fail-soft;
 * the canonical workflow transition remains authoritative.
 */
export async function applyWorkflowStatusPill(args: {
  organizationId: string;
  orderId: string;
  triggerKey: WorkflowStatusPillTrigger;
  actorUserId: string;
  actorUserName?: string;
  source?: WorkflowStatusPillAssignmentSource;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowStatusPillApplicationResult> {
  const triggerKey = workflowStatusPillTriggerSchema.parse(args.triggerKey);
  const [mapping] = await db
    .select()
    .from(workflowStatusPillMappings)
    .where(and(
      eq(workflowStatusPillMappings.organizationId, args.organizationId),
      eq(workflowStatusPillMappings.triggerKey, triggerKey),
    ))
    .limit(1);

  if (!mapping) {
    const result = { status: "skipped", triggerKey, targetStatusKey: null, reason: "mapping_missing" } as const;
    logSkip({ organizationId: args.organizationId, orderId: args.orderId, ...result });
    return result;
  }
  const [[order], [targetPill]] = await Promise.all([
    db.select({ statusPillId: orders.statusPillId })
      .from(orders)
      .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, args.orderId)))
      .limit(1),
    db.select()
      .from(orderStatusPills)
      .where(and(
        eq(orderStatusPills.organizationId, args.organizationId),
        eq(orderStatusPills.key, mapping.targetStatusKey),
      ))
      .limit(1),
  ]);
  if (!order) throw new Error("Order not found");

  const skip = (reason: WorkflowStatusPillSkipReason): WorkflowStatusPillApplicationResult => {
    const result = { status: "skipped", triggerKey, targetStatusKey: mapping.targetStatusKey, reason } as const;
    logSkip({ organizationId: args.organizationId, orderId: args.orderId, ...result });
    return result;
  };

  const [currentPill] = order.statusPillId
    ? await db
      .select({ key: orderStatusPills.key })
      .from(orderStatusPills)
      .where(and(
        eq(orderStatusPills.organizationId, args.organizationId),
        eq(orderStatusPills.id, order.statusPillId),
      ))
      .limit(1)
    : [];

  const skipReason = evaluateWorkflowStatusPillTarget({
    mapping,
    currentStatusPillId: order.statusPillId,
    currentStatusKey: currentPill?.key ?? null,
    targetPill: targetPill ?? null,
  });
  if (skipReason) return skip(skipReason);

  return assignResolvedWorkflowStatusPill({
    organizationId: args.organizationId,
    orderId: args.orderId,
    triggerKey,
    mapping,
    targetPill: targetPill!,
    actorUserId: args.actorUserId,
    actorUserName: args.actorUserName,
    source: args.source,
    reason: args.reason,
    metadata: args.metadata,
  });
}

/** Fire-and-report wrapper for canonical workflow routes. */
export async function applyWorkflowStatusPillFailSoft(
  args: Parameters<typeof applyWorkflowStatusPill>[0],
): Promise<WorkflowStatusPillApplicationResult | null> {
  try {
    return await applyWorkflowStatusPill(args);
  } catch (error) {
    console.error("[WorkflowStatusPill] Automatic assignment failed", {
      organizationId: args.organizationId,
      orderId: args.orderId,
      triggerKey: args.triggerKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
