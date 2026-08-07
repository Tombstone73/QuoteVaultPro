import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { aiOperatorTasks } from "@shared/schema";

export type AssistantOperatorTaskStatus = "active" | "awaiting_input" | "awaiting_confirmation" | "completed" | "blocked" | "abandoned";
export type AssistantOperatorTask = {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  domain: string | null;
  goal: string;
  workingSummary: string | null;
  entityReferences: Array<{ type: string; id: string; label?: string }>;
  missingInformation: string[];
  semanticChanges: Record<string, unknown>;
  confirmationState: string;
  status: AssistantOperatorTaskStatus;
  canonicalProductIntentProposalId: string | null;
  lastObservationSummary: string | null;
};

export interface AssistantOperatorTaskStore {
  getActive(input: { organizationId: string; userId: string; conversationId: string }): Promise<AssistantOperatorTask | null>;
  create(input: { organizationId: string; userId: string; conversationId: string; goal: string; domain?: string | null }): Promise<AssistantOperatorTask>;
  update(input: { organizationId: string; userId: string; taskId: string; patch: Partial<Pick<AssistantOperatorTask, "domain" | "workingSummary" | "entityReferences" | "missingInformation" | "semanticChanges" | "confirmationState" | "status" | "canonicalProductIntentProposalId" | "lastObservationSummary">> }): Promise<AssistantOperatorTask | null>;
}

function rowToTask(row: typeof aiOperatorTasks.$inferSelect): AssistantOperatorTask {
  return {
    id: row.id, organizationId: row.orgId, userId: row.userId, conversationId: row.conversationId, domain: row.domain,
    goal: row.goal, workingSummary: row.workingSummary, entityReferences: row.entityReferences, missingInformation: row.missingInformation,
    semanticChanges: row.semanticChanges, confirmationState: row.confirmationState, status: row.status as AssistantOperatorTaskStatus,
    canonicalProductIntentProposalId: row.canonicalProductIntentProposalId, lastObservationSummary: row.lastObservationSummary,
  };
}

/** Durable safe context only. Product Intent and execution plans remain the
 * canonical state for product configuration and protected mutations. */
export class DrizzleAssistantOperatorTaskStore implements AssistantOperatorTaskStore {
  async getActive(input: { organizationId: string; userId: string; conversationId: string }) {
    const [row] = await db.select().from(aiOperatorTasks).where(and(
      eq(aiOperatorTasks.orgId, input.organizationId), eq(aiOperatorTasks.userId, input.userId), eq(aiOperatorTasks.conversationId, input.conversationId),
      eq(aiOperatorTasks.status, "active"),
    )).orderBy(desc(aiOperatorTasks.updatedAt)).limit(1);
    return row ? rowToTask(row) : null;
  }

  async create(input: { organizationId: string; userId: string; conversationId: string; goal: string; domain?: string | null }) {
    const [row] = await db.insert(aiOperatorTasks).values({ orgId: input.organizationId, userId: input.userId, conversationId: input.conversationId, goal: input.goal, domain: input.domain ?? null }).returning();
    if (!row) throw new Error("ASSISTANT_OPERATOR_TASK_CREATE_FAILED");
    return rowToTask(row);
  }

  async update(input: { organizationId: string; userId: string; taskId: string; patch: Partial<Pick<AssistantOperatorTask, "domain" | "workingSummary" | "entityReferences" | "missingInformation" | "semanticChanges" | "confirmationState" | "status" | "canonicalProductIntentProposalId" | "lastObservationSummary">> }) {
    const [row] = await db.update(aiOperatorTasks).set({
      ...input.patch,
      ...(input.patch.status === "completed" || input.patch.status === "abandoned" ? { completedAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(and(eq(aiOperatorTasks.id, input.taskId), eq(aiOperatorTasks.orgId, input.organizationId), eq(aiOperatorTasks.userId, input.userId))).returning();
    return row ? rowToTask(row) : null;
  }
}
