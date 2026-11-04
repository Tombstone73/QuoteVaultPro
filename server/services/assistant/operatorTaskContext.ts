import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { aiOperatorTasks } from "@shared/schema";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";

export class AssistantOperatorTaskPersistenceError extends Error {
  constructor(readonly category: "capacity_mismatch" | "storage_unavailable") {
    super("Assistant task storage could not accept this request. Your full message and attachments are retained. Retry after the server is updated or contact support with the request reference.");
    this.name = "AssistantOperatorTaskPersistenceError";
  }
}

function taskStorageFailure(error: unknown): AssistantOperatorTaskPersistenceError {
  if (error instanceof AssistantOperatorTaskPersistenceError) return error;
  // Drizzle errors may contain SQL parameters, including the full Order text.
  // Retain only the PostgreSQL classification; never forward/log the raw error.
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "22001") return new AssistantOperatorTaskPersistenceError("capacity_mismatch");
    current = "cause" in current ? current.cause : null;
  }
  return new AssistantOperatorTaskPersistenceError("storage_unavailable");
}

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

/** Applied with the corresponding Material question/proposal turn, never as a
 * separate task-store write. null means no Material question was pending. */
export type MaterialTaskTransition = {
  taskId: string;
  expectedQuestion: { questionId: string; version: number; content: string; correlationId: string } | null;
  patch: Partial<Pick<AssistantOperatorTask, "domain" | "workingSummary" | "entityReferences" | "missingInformation" | "semanticChanges" | "confirmationState" | "status" | "canonicalProductIntentProposalId" | "lastObservationSummary">>;
};

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
    if (input.goal.length > ASSISTANT_MESSAGE_MAX_CONTENT_CHARS) throw new AssistantOperatorTaskPersistenceError("capacity_mismatch");
    try {
      const [row] = await db.insert(aiOperatorTasks).values({ orgId: input.organizationId, userId: input.userId, conversationId: input.conversationId, goal: input.goal, domain: input.domain ?? null }).returning();
      if (!row) throw new AssistantOperatorTaskPersistenceError("storage_unavailable");
      return rowToTask(row);
    } catch (error) { throw taskStorageFailure(error); }
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
