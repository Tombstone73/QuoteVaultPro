import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiReportEntityResolutions,
  aiContextSnapshots,
  aiConversations,
  aiMessages,
  aiTurns,
  type AiReportEntityResolutionStatus,
} from "@shared/schema";
import type { AssistantContextEnvelope, AssistantProviderPlan, AssistantStructuredCard } from "@shared/assistantContracts";
import type {
  AnalyticalResolutionCandidate,
  AnalyticalResolutionPersistence,
  AnalyticalResolutionScope,
  PersistedAnalyticalResolution,
} from "../services/assistant/analyticalCustomerResolution";

type JsonRecord = Record<string, unknown>;

/** This is deliberately a server persistence shape. `canonicalCompanyId` is
 * never a browser input: the selection API receives `candidateId` only and
 * maps it back through the immutable stored set. */
export interface StoredReportResolutionCandidate {
  candidateId: string;
  canonicalCompanyId: string;
  companyName: string;
  companyStatus: string | null;
  location: string | null;
  matchReason: string;
  relatedContactNames: string[];
  companyPath: string | null;
  resolutionType?: "company" | "contact";
  contactName?: string | null;
}

export interface AssistantReportEntityResolutionRecord {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  sourceTurnId: string;
  sourceMessageId: string | null;
  contextSnapshotId: string | null;
  resolverVersion: string;
  analyticalPlanVersion: string;
  originalUserRequest: string;
  unresolvedCustomerReference: string;
  validatedPlan: JsonRecord;
  originalContext: JsonRecord;
  candidates: StoredReportResolutionCandidate[];
  selectedCandidateId: string | null;
  selectedCompanyId: string | null;
  status: AiReportEntityResolutionStatus;
  version: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resumedAt: Date | null;
  cancelledAt: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  continuationResultReference: string | null;
  continuationResult: unknown | null;
}

export interface CreateReportEntityResolutionInput {
  id?: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  sourceTurnId: string;
  sourceMessageId?: string | null;
  contextSnapshotId?: string | null;
  resolverVersion: string;
  analyticalPlanVersion: string;
  originalUserRequest: string;
  unresolvedCustomerReference: string;
  validatedPlan: JsonRecord;
  originalContext: JsonRecord;
  candidates: readonly StoredReportResolutionCandidate[];
  expiresAt: Date;
  createdAt?: Date;
}

export interface ReportEntityResolutionScope {
  organizationId: string;
  userId: string;
  conversationId: string;
}

export type ReportEntityResolutionClaim =
  | { kind: "claimed"; resolution: AssistantReportEntityResolutionRecord; candidate: StoredReportResolutionCandidate }
  | { kind: "replay"; resolution: AssistantReportEntityResolutionRecord }
  | { kind: "in_progress"; resolution: AssistantReportEntityResolutionRecord }
  | { kind: "expired"; resolution: AssistantReportEntityResolutionRecord }
  | { kind: "cancelled" | "failed" | "stale" | "not_found" | "candidate_invalid" | "candidate_conflict"; resolution?: AssistantReportEntityResolutionRecord };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asCandidate(value: unknown): StoredReportResolutionCandidate | null {
  const candidate = asRecord(value);
  if (typeof candidate.candidateId !== "string" || !candidate.candidateId
    || typeof candidate.canonicalCompanyId !== "string" || !candidate.canonicalCompanyId
    || typeof candidate.companyName !== "string" || typeof candidate.matchReason !== "string") return null;
  return {
    candidateId: candidate.candidateId,
    canonicalCompanyId: candidate.canonicalCompanyId,
    companyName: candidate.companyName,
    companyStatus: typeof candidate.companyStatus === "string" ? candidate.companyStatus : null,
    location: typeof candidate.location === "string" ? candidate.location : null,
    matchReason: candidate.matchReason,
    relatedContactNames: Array.isArray(candidate.relatedContactNames)
      ? candidate.relatedContactNames.filter((name): name is string => typeof name === "string")
      : [],
    companyPath: typeof candidate.companyPath === "string" ? candidate.companyPath : null,
    ...(candidate.resolutionType === "company" || candidate.resolutionType === "contact" ? { resolutionType: candidate.resolutionType } : {}),
    ...(typeof candidate.contactName === "string" ? { contactName: candidate.contactName } : {}),
  };
}

function resolutionStatus(value: string): AiReportEntityResolutionStatus {
  const statuses: readonly AiReportEntityResolutionStatus[] = [
    "awaiting_entity_resolution", "resolved", "resuming", "resumed", "expired", "cancelled", "failed",
  ];
  if (!statuses.includes(value as AiReportEntityResolutionStatus)) {
    throw new Error(`Unexpected report entity resolution status: ${value}`);
  }
  return value as AiReportEntityResolutionStatus;
}

function toResolution(row: typeof aiReportEntityResolutions.$inferSelect): AssistantReportEntityResolutionRecord {
  const candidates = Array.isArray(row.candidateSetJson)
    ? row.candidateSetJson.map(asCandidate).filter((candidate): candidate is StoredReportResolutionCandidate => candidate !== null)
    : [];
  return {
    id: row.id, organizationId: row.organizationId, userId: row.userId, conversationId: row.conversationId,
    sourceTurnId: row.sourceTurnId, sourceMessageId: row.sourceMessageId, contextSnapshotId: row.contextSnapshotId,
    resolverVersion: row.resolverVersion, analyticalPlanVersion: row.analyticalPlanVersion,
    originalUserRequest: row.originalUserRequest, unresolvedCustomerReference: row.unresolvedCustomerReference,
    validatedPlan: asRecord(row.validatedPlanJson),
    originalContext: asRecord(row.originalContextJson), candidates, selectedCandidateId: row.selectedCandidateId,
    selectedCompanyId: row.selectedCompanyId, status: resolutionStatus(row.status), version: row.version,
    expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt, resolvedAt: row.resolvedAt,
    resumedAt: row.resumedAt, cancelledAt: row.cancelledAt, failedAt: row.failedAt,
    failureCode: row.failureCode, continuationResultReference: row.continuationResultReference,
    continuationResult: row.continuationResultJson,
  };
}

function scoped(scope: ReportEntityResolutionScope, resolutionId: string) {
  return and(
    eq(aiReportEntityResolutions.id, resolutionId),
    eq(aiReportEntityResolutions.organizationId, scope.organizationId),
    eq(aiReportEntityResolutions.userId, scope.userId),
    eq(aiReportEntityResolutions.conversationId, scope.conversationId),
  );
}

function assertCandidates(candidates: readonly StoredReportResolutionCandidate[]): void {
  if (candidates.length < 2) throw new Error("A persisted report entity resolution requires multiple candidates.");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.candidateId || !candidate.canonicalCompanyId || !candidate.companyName || !candidate.matchReason) {
      throw new Error("A persisted report entity resolution candidate is incomplete.");
    }
    if (ids.has(candidate.candidateId)) throw new Error("A persisted report entity resolution candidate ID must be unique.");
    ids.add(candidate.candidateId);
  }
}

/**
 * Durable server-only state for Stage 8.2. Every read is tenant, user, and
 * conversation scoped. Candidate and plan JSON are inserted once and never
 * included in update paths, preserving the exact preflight plan for replay.
 */
export class AssistantReportEntityResolutionsRepository implements AnalyticalResolutionPersistence {
  constructor(private readonly dbInstance = db) {}

  async createAwaiting(input: CreateReportEntityResolutionInput): Promise<AssistantReportEntityResolutionRecord> {
    assertCandidates(input.candidates);
    const now = input.createdAt ?? new Date();
    const [row] = await this.dbInstance.insert(aiReportEntityResolutions).values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId,
      sourceTurnId: input.sourceTurnId, sourceMessageId: input.sourceMessageId ?? null,
      contextSnapshotId: input.contextSnapshotId ?? null, resolverVersion: input.resolverVersion,
      analyticalPlanVersion: input.analyticalPlanVersion, originalUserRequest: input.originalUserRequest,
      unresolvedCustomerReference: input.unresolvedCustomerReference,
      validatedPlanJson: input.validatedPlan, originalContextJson: input.originalContext,
      candidateSetJson: input.candidates.map((candidate) => ({ ...candidate, relatedContactNames: [...candidate.relatedContactNames] })),
      status: "awaiting_entity_resolution", version: 1, expiresAt: input.expiresAt,
      createdAt: now, updatedAt: now,
    }).returning();
    if (!row) throw new Error("Failed to persist report entity resolution.");
    return toResolution(row);
  }

  async get(scope: ReportEntityResolutionScope, resolutionId: string): Promise<AssistantReportEntityResolutionRecord | null> {
    const [row] = await this.dbInstance.select().from(aiReportEntityResolutions).where(scoped(scope, resolutionId)).limit(1);
    return row ? toResolution(row) : null;
  }

  /** Route-layer lookup used only to recover the server-owned conversation
   * scope. All mutation methods remain conversation scoped. */
  async getForOwner(input: { organizationId: string; userId: string; resolutionId: string }): Promise<AssistantReportEntityResolutionRecord | null> {
    const [row] = await this.dbInstance.select().from(aiReportEntityResolutions).where(and(
      eq(aiReportEntityResolutions.id, input.resolutionId),
      eq(aiReportEntityResolutions.organizationId, input.organizationId),
      eq(aiReportEntityResolutions.userId, input.userId),
    )).limit(1);
    return row ? toResolution(row) : null;
  }

  async getAwaitingForConversation(scope: ReportEntityResolutionScope, now = new Date()): Promise<AssistantReportEntityResolutionRecord | null> {
    const [row] = await this.dbInstance.select().from(aiReportEntityResolutions).where(and(
      eq(aiReportEntityResolutions.organizationId, scope.organizationId),
      eq(aiReportEntityResolutions.userId, scope.userId),
      eq(aiReportEntityResolutions.conversationId, scope.conversationId),
      eq(aiReportEntityResolutions.status, "awaiting_entity_resolution"),
      gt(aiReportEntityResolutions.expiresAt, now),
    )).orderBy(asc(aiReportEntityResolutions.createdAt)).limit(1);
    return row ? toResolution(row) : null;
  }

  /** Atomically transitions one immutable candidate set into a server-owned
   * continuation. Concurrent callers either receive the stored replay state or
   * an in-progress result; they cannot substitute a different company. */
  async claimSelection(input: ReportEntityResolutionScope & { resolutionId: string; candidateId: string; expectedVersion: number; now?: Date }): Promise<ReportEntityResolutionClaim> {
    const now = input.now ?? new Date();
    return this.dbInstance.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.resolutionId}))`);
      const [stored] = await tx.select().from(aiReportEntityResolutions).where(scoped(input, input.resolutionId)).limit(1);
      if (!stored) return { kind: "not_found" };
      const resolution = toResolution(stored);
      if (resolution.expiresAt <= now && resolution.status === "awaiting_entity_resolution") {
        const [expired] = await tx.update(aiReportEntityResolutions).set({
          status: "expired", version: resolution.version + 1, updatedAt: now,
        }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "awaiting_entity_resolution"), eq(aiReportEntityResolutions.version, resolution.version))).returning();
        return { kind: "expired", resolution: toResolution(expired ?? stored) };
      }
      if (resolution.status === "expired") return { kind: "expired", resolution };
      if (resolution.status === "cancelled") return { kind: "cancelled", resolution };
      if (resolution.status === "failed") return { kind: "failed", resolution };
      const candidate = resolution.candidates.find((item) => item.candidateId === input.candidateId);
      if (!candidate) return { kind: "candidate_invalid", resolution };
      if (resolution.selectedCandidateId && resolution.selectedCandidateId !== candidate.candidateId) {
        return { kind: "candidate_conflict", resolution };
      }
      if (resolution.status === "resumed") return { kind: "replay", resolution };
      if (resolution.version !== input.expectedVersion) return { kind: "stale", resolution };
      if (resolution.status === "resuming" || resolution.status === "resolved") return { kind: "in_progress", resolution };
      const [claimed] = await tx.update(aiReportEntityResolutions).set({
        status: "resuming", selectedCandidateId: candidate.candidateId, selectedCompanyId: candidate.canonicalCompanyId,
        version: resolution.version + 1, resolvedAt: now, updatedAt: now,
      }).where(and(
        scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "awaiting_entity_resolution"),
        eq(aiReportEntityResolutions.version, input.expectedVersion),
      )).returning();
      if (!claimed) return { kind: "stale", resolution };
      return { kind: "claimed", resolution: toResolution(claimed), candidate };
    });
  }

  async completeContinuation(input: ReportEntityResolutionScope & { resolutionId: string; expectedVersion: number; continuationResultReference: string; now?: Date }): Promise<AssistantReportEntityResolutionRecord | null> {
    const now = input.now ?? new Date();
    const [row] = await this.dbInstance.update(aiReportEntityResolutions).set({
      status: "resumed", continuationResultReference: input.continuationResultReference,
      version: input.expectedVersion + 1, resumedAt: now, updatedAt: now,
    }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "resuming"),
      eq(aiReportEntityResolutions.version, input.expectedVersion))).returning();
    return row ? toResolution(row) : null;
  }

  async failContinuation(input: ReportEntityResolutionScope & { resolutionId: string; expectedVersion: number; failureCode: string; now?: Date }): Promise<AssistantReportEntityResolutionRecord | null> {
    const now = input.now ?? new Date();
    const [row] = await this.dbInstance.update(aiReportEntityResolutions).set({
      status: "failed", failureCode: input.failureCode.slice(0, 120), version: input.expectedVersion + 1,
      failedAt: now, updatedAt: now,
    }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "resuming"),
      eq(aiReportEntityResolutions.version, input.expectedVersion))).returning();
    return row ? toResolution(row) : null;
  }

  async cancel(input: ReportEntityResolutionScope & { resolutionId: string; expectedVersion: number; now?: Date }): Promise<AssistantReportEntityResolutionRecord | null> {
    const now = input.now ?? new Date();
    const [row] = await this.dbInstance.update(aiReportEntityResolutions).set({
      status: "cancelled", version: input.expectedVersion + 1, cancelledAt: now, updatedAt: now,
    }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "awaiting_entity_resolution"),
      eq(aiReportEntityResolutions.version, input.expectedVersion))).returning();
    return row ? toResolution(row) : null;
  }

  private toPersisted(
    record: AssistantReportEntityResolutionRecord,
    sourceCorrelationId?: string,
  ): PersistedAnalyticalResolution {
    return {
      id: record.id, conversationId: record.conversationId, version: record.version, status: record.status,
      plan: record.validatedPlan as AssistantProviderPlan,
      context: record.originalContext as unknown as AssistantContextEnvelope,
      originalUserRequest: record.originalUserRequest,
      unresolvedReference: record.unresolvedCustomerReference,
      candidates: record.candidates.map((candidate) => ({
        candidateId: candidate.candidateId, companyId: candidate.canonicalCompanyId,
        companyName: candidate.companyName, resolutionType: candidate.resolutionType ?? "company",
        contactName: candidate.contactName ?? null, matchReason: candidate.matchReason,
        companyStatus: candidate.companyStatus, location: candidate.location,
        companyLink: candidate.companyPath ?? `/customers/${encodeURIComponent(candidate.canonicalCompanyId)}`,
      })),
      ...(record.continuationResult !== null ? { continuationResult: record.continuationResult } : {}),
      // Stage 8.2 consumers may use these optional fields to locate the
      // atomically-created pending messages without trusting browser state.
      sourceTurnId: record.sourceTurnId,
      ...(sourceCorrelationId ? { sourceCorrelationId } : {}),
    } as PersistedAnalyticalResolution;
  }

  /** Creates the waiting turn, both conversation messages, snapshot, and
   * immutable candidate set in one transaction. No UI card exists unless this
   * method returns a committed resolution. */
  async pause(input: {
    scope: AnalyticalResolutionScope;
    sourceTurnId?: string;
    originalUserRequest: string;
    plan: AssistantProviderPlan;
    context: AssistantContextEnvelope;
    unresolvedReference: string;
    candidates: AnalyticalResolutionCandidate[];
    assistantResponse: string;
  }): Promise<PersistedAnalyticalResolution | null> {
    if (input.candidates.length < 2) return null;
    const candidates: StoredReportResolutionCandidate[] = input.candidates.map((candidate) => ({
      candidateId: randomUUID(), canonicalCompanyId: candidate.companyId, companyName: candidate.companyName,
      companyStatus: candidate.companyStatus ?? null, location: candidate.location ?? null,
      matchReason: candidate.matchReason, relatedContactNames: candidate.contactName ? [candidate.contactName] : [],
      companyPath: candidate.companyLink, resolutionType: candidate.resolutionType, contactName: candidate.contactName,
    }));
    try {
      return await this.dbInstance.transaction(async (tx) => {
        const scope = input.scope;
        const [conversation] = await tx.select().from(aiConversations).where(and(
          eq(aiConversations.id, scope.conversationId), eq(aiConversations.orgId, scope.organizationId),
          eq(aiConversations.userId, scope.userId), eq(aiConversations.status, "active"),
        )).limit(1);
        if (!conversation) return null;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${conversation.id}))`);
        const now = new Date();
        const correlationId = randomUUID();
        const [turn] = await tx.insert(aiTurns).values({
          orgId: scope.organizationId, conversationId: scope.conversationId, userId: scope.userId,
          status: "responded", correlationId, mode: "stage_8_2_entity_resolution",
          promptVersion: "assistant-stage-8.2-resolution-v1", startedAt: now, completedAt: now,
        }).returning();
        if (!turn) throw new Error("Failed to create paused assistant turn.");
        const [sequence] = await tx.select({ value: sql<number>`coalesce(max(${aiMessages.sequence}), 0)` })
          .from(aiMessages).where(and(eq(aiMessages.orgId, scope.organizationId), eq(aiMessages.conversationId, scope.conversationId)));
        const next = Number(sequence?.value ?? 0) + 1;
        await tx.insert(aiMessages).values({
          orgId: scope.organizationId, conversationId: scope.conversationId, turnId: turn.id, actorUserId: scope.userId,
          role: "user", sequence: next, content: input.originalUserRequest, correlationId,
        });
        const card: AssistantStructuredCard = {
          kind: "customer_resolution", title: "Choose a company", summary: input.assistantResponse, sourceLinks: [],
          cancellationAvailable: true,
          details: {
            resolution: {
              resolutionId: "pending", version: 1, status: "awaiting_entity_resolution",
              candidates: candidates.map(({ candidateId, companyName, companyStatus, location, matchReason, relatedContactNames, companyPath }) => ({
                candidateId, companyName, companyStatus, location, matchReason, relatedContactNames, companyLink: companyPath,
              })),
            },
          },
        };
        const [assistantMessage] = await tx.insert(aiMessages).values({
          orgId: scope.organizationId, conversationId: scope.conversationId, turnId: turn.id, actorUserId: scope.userId,
          role: "assistant", sequence: next + 1, content: input.assistantResponse, structuredCards: [card], correlationId,
        }).returning();
        if (!assistantMessage) throw new Error("Failed to create pending resolution message.");
        const contextHash = createHash("sha256").update(JSON.stringify(input.context)).digest("hex");
        const [snapshot] = await tx.insert(aiContextSnapshots).values({
          orgId: scope.organizationId, conversationId: scope.conversationId, turnId: turn.id, userId: scope.userId,
          contextVersion: input.context.contextVersion, sanitizedContext: input.context, contextHash,
          capturedAt: new Date(input.context.capturedAt),
        }).returning();
        if (!snapshot) throw new Error("Failed to create pending resolution context.");
        const [resolution] = await tx.insert(aiReportEntityResolutions).values({
          organizationId: scope.organizationId, userId: scope.userId, conversationId: scope.conversationId,
          sourceTurnId: turn.id, sourceMessageId: assistantMessage.id, contextSnapshotId: snapshot.id,
          resolverVersion: "assistant-analytics-customer-v1", analyticalPlanVersion: "assistant-provider-plan-v1",
          originalUserRequest: input.originalUserRequest, unresolvedCustomerReference: input.unresolvedReference,
          validatedPlanJson: input.plan as unknown as JsonRecord, originalContextJson: input.context as unknown as JsonRecord,
          candidateSetJson: candidates as unknown as JsonRecord[], expiresAt: new Date(now.getTime() + 15 * 60_000),
        }).returning();
        if (!resolution) throw new Error("Failed to create pending report entity resolution.");
        // The resolution id is generated by the database, so patch only the
        // presentation card inside this same transaction, never the candidates.
        await tx.update(aiMessages).set({ structuredCards: [{ ...card, details: {
          resolution: { ...(card.details as { resolution: Record<string, unknown> }).resolution, resolutionId: resolution.id },
        } }] })
          .where(eq(aiMessages.id, assistantMessage.id));
        await tx.update(aiConversations).set({ lastMessagePreview: input.assistantResponse.slice(0, 240), lastActivityAt: now, updatedAt: now })
          .where(eq(aiConversations.id, scope.conversationId));
        return this.toPersisted(toResolution(resolution), correlationId);
      });
    } catch {
      return null;
    }
  }

  async load(scope: AnalyticalResolutionScope & { resolutionId: string }): Promise<PersistedAnalyticalResolution | null> {
    const record = await this.get(scope, scope.resolutionId);
    return record ? this.toPersisted(record) : null;
  }

  async findSelection(scope: Omit<AnalyticalResolutionScope, "conversationId"> & { resolutionId: string }): Promise<PersistedAnalyticalResolution | null> {
    const [row] = await this.dbInstance.select().from(aiReportEntityResolutions).where(and(
      eq(aiReportEntityResolutions.id, scope.resolutionId),
      eq(aiReportEntityResolutions.organizationId, scope.organizationId),
      eq(aiReportEntityResolutions.userId, scope.userId),
    )).limit(1);
    return row ? this.toPersisted(toResolution(row)) : null;
  }

  async claim(input: AnalyticalResolutionScope & { resolutionId: string; candidateId: string; expectedVersion: number; now: Date }): Promise<
    | { kind: "claimed"; resolution: PersistedAnalyticalResolution }
    | { kind: "completed"; continuationResult: unknown }
    | { kind: "rejected"; code: "not_found" | "expired" | "cancelled" | "stale_version" | "invalid_candidate" | "not_pending" }
  > {
    const result = await this.claimSelection(input);
    if (result.kind === "claimed") return { kind: "claimed", resolution: this.toPersisted(result.resolution) };
    if (result.kind === "replay" && result.resolution.continuationResult !== null) return { kind: "completed", continuationResult: result.resolution.continuationResult };
    if (result.kind === "not_found") return { kind: "rejected", code: "not_found" };
    if (result.kind === "expired") return { kind: "rejected", code: "expired" };
    if (result.kind === "cancelled") return { kind: "rejected", code: "cancelled" };
    if (result.kind === "candidate_invalid") return { kind: "rejected", code: "invalid_candidate" };
    if (result.kind === "stale") return { kind: "rejected", code: "stale_version" };
    return { kind: "rejected", code: "not_pending" };
  }

  async finish(input: AnalyticalResolutionScope & { resolutionId: string; continuationResult: unknown }): Promise<void> {
    const current = await this.get(input, input.resolutionId);
    if (!current) return;
    const now = new Date();
    const result = asRecord(input.continuationResult);
    if (current.status === "resumed") {
      await this.dbInstance.update(aiReportEntityResolutions).set({
        continuationResultJson: result, updatedAt: now,
      }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "resumed"),
        eq(aiReportEntityResolutions.version, current.version)));
      return;
    }
    await this.dbInstance.update(aiReportEntityResolutions).set({
      status: "resumed", continuationResultJson: result,
      continuationResultReference: typeof result.turnId === "string" ? result.turnId : current.continuationResultReference,
      version: current.version + 1, resumedAt: now, updatedAt: now,
    }).where(and(scoped(input, input.resolutionId), eq(aiReportEntityResolutions.status, "resuming"), eq(aiReportEntityResolutions.version, current.version)));
  }

  async fail(input: AnalyticalResolutionScope & { resolutionId: string; failureCode: string }): Promise<void> {
    const current = await this.get(input, input.resolutionId);
    if (current?.status !== "resuming") return;
    await this.failContinuation({ ...input, expectedVersion: current.version, failureCode: input.failureCode });
  }
}

export const assistantReportEntityResolutionsRepository = new AssistantReportEntityResolutionsRepository();
