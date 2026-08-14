import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  orderWorkflowStatuses,
  orderWorkflowTransitions,
  orderWorkflowVersions,
  orderStatusEvents,
  orders,
} from "@shared/schema";

export const WORKFLOW_CATEGORIES = ["new", "active", "ready", "completed", "canceled", "on_hold"] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

type WorkflowStatusInput = {
  key: string;
  label: string;
  category: WorkflowCategory;
  color?: string | null;
  sortOrder?: number;
  isDefaultForNew?: boolean;
  isActive?: boolean;
};

function normalizeKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "status";
}

function toLabelFromKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ") || "Status";
}

export function mapLegacyStatusToCategory(status: string): WorkflowCategory {
  const s = String(status || "").trim().toLowerCase();
  switch (s) {
    case "new":
      return "new";
    case "in_production":
      return "active";
    case "on_hold":
      return "on_hold";
    case "ready_for_pickup":
    case "ready_for_shipment":
      return "ready";
    case "completed":
      return "completed";
    case "canceled":
      return "canceled";
    default:
      if (process.env.NODE_ENV !== "production") {
        console.warn("[order-workflow] Unknown legacy status mapped to active:", s);
      }
      return "active";
  }
}

async function getActiveVersion(organizationId: string) {
  const [active] = await db
    .select()
    .from(orderWorkflowVersions)
    .where(and(eq(orderWorkflowVersions.organizationId, organizationId), eq(orderWorkflowVersions.isActive, true)))
    .orderBy(desc(orderWorkflowVersions.createdAt))
    .limit(1);
  return active ?? null;
}

async function createInitialActiveWorkflow(organizationId: string, createdByUserId?: string | null) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orderWorkflowVersions)
      .values({
        organizationId,
        name: "Default Workflow",
        isActive: true,
        createdByUserId: createdByUserId ?? null,
        publishedAt: new Date(),
      })
      .returning();

    const distinctStatuses = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.organizationId, organizationId))
      .groupBy(orders.status);

    const rawValues = distinctStatuses
      .map((r) => String(r.status || "").trim())
      .filter(Boolean);

    const seedValues = rawValues.length > 0 ? rawValues : ["new", "in_production", "on_hold"];

    const statusValues: Array<WorkflowStatusInput> = seedValues.map((raw, idx) => {
      const key = normalizeKey(raw);
      return {
        key,
        label: toLabelFromKey(key),
        category: mapLegacyStatusToCategory(raw),
        sortOrder: (idx + 1) * 10,
        isDefaultForNew: key === "new",
        isActive: true,
      };
    });

    if (!statusValues.some((s) => s.isDefaultForNew)) {
      statusValues[0].isDefaultForNew = true;
    }

    for (const s of statusValues) {
      await tx.insert(orderWorkflowStatuses).values({
        organizationId,
        workflowVersionId: created.id,
        key: s.key,
        label: s.label,
        category: s.category,
        color: s.color ?? null,
        sortOrder: s.sortOrder ?? 0,
        isDefaultForNew: !!s.isDefaultForNew,
        isActive: s.isActive ?? true,
      });
    }

    const statuses = await tx
      .select()
      .from(orderWorkflowStatuses)
      .where(eq(orderWorkflowStatuses.workflowVersionId, created.id));

    const byKey = new Map(statuses.map((s) => [s.key, s]));

    const orderRows = await tx
      .select({ id: orders.id, status: orders.status, workflowStatusId: orders.workflowStatusId, canonicalState: orders.canonicalState })
      .from(orders)
      .where(eq(orders.organizationId, organizationId));

    for (const o of orderRows) {
      if (o.workflowStatusId) continue;
      const key = normalizeKey(String(o.status || "active"));
      const matched = byKey.get(key);
      if (!matched) continue;
      await tx
        .update(orders)
        .set({ workflowStatusId: matched.id, canonicalState: matched.category, status: matched.key })
        .where(eq(orders.id, o.id));
    }

    return created;
  });
}

async function ensureActiveWorkflow(organizationId: string, createdByUserId?: string | null) {
  let active = await getActiveVersion(organizationId);
  if (!active) {
    active = await createInitialActiveWorkflow(organizationId, createdByUserId);
  }
  return active;
}

export async function getOrderWorkflow(organizationId: string, createdByUserId?: string | null) {
  const active = await ensureActiveWorkflow(organizationId, createdByUserId);

  const [statuses, transitions] = await Promise.all([
    db
      .select()
      .from(orderWorkflowStatuses)
      .where(eq(orderWorkflowStatuses.workflowVersionId, active.id))
      .orderBy(asc(orderWorkflowStatuses.sortOrder), asc(orderWorkflowStatuses.createdAt)),
    db
      .select()
      .from(orderWorkflowTransitions)
      .where(eq(orderWorkflowTransitions.workflowVersionId, active.id)),
  ]);

  return {
    version: active,
    statuses,
    transitions,
  };
}

export async function upsertOrderWorkflowDraft(
  organizationId: string,
  createdByUserId?: string | null,
  payload?: { name?: string; statuses?: WorkflowStatusInput[] },
) {
  return db.transaction(async (tx) => {
    const [existingDraft] = await tx
      .select()
      .from(orderWorkflowVersions)
      .where(
        and(
          eq(orderWorkflowVersions.organizationId, organizationId),
          eq(orderWorkflowVersions.isActive, false),
          sql`${orderWorkflowVersions.publishedAt} IS NULL`,
        ),
      )
      .orderBy(desc(orderWorkflowVersions.createdAt))
      .limit(1);

    let draft = existingDraft;

    if (!draft) {
      const active = await ensureActiveWorkflow(organizationId, createdByUserId);
      const [createdDraft] = await tx
        .insert(orderWorkflowVersions)
        .values({
          organizationId,
          name: payload?.name || `${active.name} (Draft)`,
          isActive: false,
          createdByUserId: createdByUserId ?? null,
        })
        .returning();
      draft = createdDraft;

      const activeStatuses = await tx
        .select()
        .from(orderWorkflowStatuses)
        .where(eq(orderWorkflowStatuses.workflowVersionId, active.id))
        .orderBy(asc(orderWorkflowStatuses.sortOrder), asc(orderWorkflowStatuses.createdAt));

      for (const s of activeStatuses) {
        await tx.insert(orderWorkflowStatuses).values({
          organizationId,
          workflowVersionId: draft.id,
          key: s.key,
          label: s.label,
          category: s.category,
          color: s.color,
          sortOrder: s.sortOrder,
          isDefaultForNew: s.isDefaultForNew,
          isActive: s.isActive,
        });
      }
    }

    if (payload?.statuses) {
      await tx.delete(orderWorkflowTransitions).where(eq(orderWorkflowTransitions.workflowVersionId, draft.id));
      await tx.delete(orderWorkflowStatuses).where(eq(orderWorkflowStatuses.workflowVersionId, draft.id));

      const cleaned = payload.statuses.map((s, idx) => ({
        key: normalizeKey(s.key || s.label),
        label: String(s.label || toLabelFromKey(s.key || "status")),
        category: WORKFLOW_CATEGORIES.includes(s.category as WorkflowCategory) ? s.category : "active",
        color: s.color ?? null,
        sortOrder: Number.isFinite(s.sortOrder as number) ? Number(s.sortOrder) : (idx + 1) * 10,
        isDefaultForNew: !!s.isDefaultForNew,
        isActive: s.isActive ?? true,
      }));

      if (!cleaned.some((s) => s.isDefaultForNew) && cleaned.length > 0) {
        const preferred = cleaned.find((s) => s.category === "new") ?? cleaned[0];
        preferred.isDefaultForNew = true;
      }

      for (const s of cleaned) {
        await tx.insert(orderWorkflowStatuses).values({
          organizationId,
          workflowVersionId: draft.id,
          key: s.key,
          label: s.label,
          category: s.category,
          color: s.color,
          sortOrder: s.sortOrder,
          isDefaultForNew: s.isDefaultForNew,
          isActive: s.isActive,
        });
      }
    }

    const statuses = await tx
      .select()
      .from(orderWorkflowStatuses)
      .where(eq(orderWorkflowStatuses.workflowVersionId, draft.id))
      .orderBy(asc(orderWorkflowStatuses.sortOrder), asc(orderWorkflowStatuses.createdAt));

    const transitions = await tx
      .select()
      .from(orderWorkflowTransitions)
      .where(eq(orderWorkflowTransitions.workflowVersionId, draft.id));

    return { version: draft, statuses, transitions };
  });
}

export async function publishOrderWorkflowDraft(organizationId: string) {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(orderWorkflowVersions)
      .where(
        and(
          eq(orderWorkflowVersions.organizationId, organizationId),
          eq(orderWorkflowVersions.isActive, false),
          sql`${orderWorkflowVersions.publishedAt} IS NULL`,
        ),
      )
      .orderBy(desc(orderWorkflowVersions.createdAt))
      .limit(1);

    if (!draft) {
      throw new Error("No draft workflow found to publish");
    }

    await tx
      .update(orderWorkflowVersions)
      .set({ isActive: false })
      .where(and(eq(orderWorkflowVersions.organizationId, organizationId), eq(orderWorkflowVersions.isActive, true)));

    const [active] = await tx
      .update(orderWorkflowVersions)
      .set({ isActive: true, publishedAt: new Date() })
      .where(eq(orderWorkflowVersions.id, draft.id))
      .returning();

    const statuses = await tx
      .select()
      .from(orderWorkflowStatuses)
      .where(eq(orderWorkflowStatuses.workflowVersionId, active.id))
      .orderBy(asc(orderWorkflowStatuses.sortOrder), asc(orderWorkflowStatuses.createdAt));

    return { version: active, statuses };
  });
}

export async function updateOrderWorkflowStatus(args: {
  organizationId: string;
  orderId: string;
  workflowStatusId: string;
  changedByUserId?: string | null;
  note?: string | null;
}) {
  const { organizationId, orderId, workflowStatusId, changedByUserId, note } = args;

  return db.transaction(async (tx) => {
    const active = await ensureActiveWorkflow(organizationId, changedByUserId ?? null);

    const [targetStatus] = await tx
      .select()
      .from(orderWorkflowStatuses)
      .where(
        and(
          eq(orderWorkflowStatuses.id, workflowStatusId),
          eq(orderWorkflowStatuses.organizationId, organizationId),
          eq(orderWorkflowStatuses.workflowVersionId, active.id),
          eq(orderWorkflowStatuses.isActive, true),
        ),
      )
      .limit(1);

    if (!targetStatus) {
      throw new Error("Invalid workflowStatusId for active workflow");
    }

    const [orderRow] = await tx
      .select({
        id: orders.id,
        workflowStatusId: orders.workflowStatusId,
        status: orders.status,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
      .limit(1);

    if (!orderRow) {
      throw new Error("Order not found");
    }

    let fromStatusLabel: string | null = null;
    let fromStatusId: string | null = orderRow.workflowStatusId ?? null;

    if (orderRow.workflowStatusId) {
      const [fromStatus] = await tx
        .select({ id: orderWorkflowStatuses.id, label: orderWorkflowStatuses.label })
        .from(orderWorkflowStatuses)
        .where(eq(orderWorkflowStatuses.id, orderRow.workflowStatusId))
        .limit(1);
      fromStatusLabel = fromStatus?.label ?? null;
      fromStatusId = fromStatus?.id ?? fromStatusId;
    }

    const transitions = await tx
      .select()
      .from(orderWorkflowTransitions)
      .where(eq(orderWorkflowTransitions.workflowVersionId, active.id));

    if (transitions.length > 0 && fromStatusId) {
      const allowed = transitions.some((t) => t.fromStatusId === fromStatusId && t.toStatusId === targetStatus.id);
      if (!allowed) {
        throw new Error("Transition not allowed by workflow rules");
      }
    } else if (process.env.NODE_ENV !== "production") {
      console.warn("[order-workflow] No transitions configured; fallback allow-any-active-status is in effect");
    }

    if (['canceled', 'cancelled'].includes(String(targetStatus.category || '').toLowerCase()) || ['canceled', 'cancelled'].includes(String(targetStatus.key || '').toLowerCase())) throw new Error('USE_CANONICAL_CANCELLATION');

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        workflowStatusId: targetStatus.id,
        canonicalState: targetStatus.category,
        status: targetStatus.key,
      })
      .where(eq(orders.id, orderId))
      .returning();

    await tx.insert(orderStatusEvents).values({
      organizationId,
      orderId,
      fromStatusId,
      toStatusId: targetStatus.id,
      fromStatusLabel,
      toStatusLabel: targetStatus.label,
      changedByUserId: changedByUserId ?? null,
      changedAt: new Date(),
      note: note ?? null,
    });

    return {
      order: updatedOrder,
      fromStatusId,
      fromStatusLabel,
      toStatusId: targetStatus.id,
      toStatusLabel: targetStatus.label,
      canonicalState: targetStatus.category,
    };
  });
}
