import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  productDraftIntentSchema,
  productDraftIntentFingerprint,
  productIntentCompilerResultSchema,
  unresolvedQuestionSetSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
} from "@shared/productDraftIntent";
import {
  applyProductIntentSessionPatch,
  bindProductIntentConfirmation,
  createProductIntentSession,
  currentProductIntent,
  markProductIntentExecuted,
  abandonProductIntent,
  productIntentSessionEnvelopeSchema,
  type ProductIntentSessionEnvelope,
} from "./productIntentStateMachine";
import {
  canonicalProductIntentStateFromV1Draft,
  canonicalProductIntentStateSchema,
  projectCanonicalProductIntentStateToV1Draft,
  type CanonicalProductIntentState,
} from "./productIntentCanonicalProposal";

/** This discriminator deliberately distinguishes canonical sessions from every
 * legacy payload that shares ai_configurable_product_proposals.specification. */
export const PRODUCT_INTENT_PROPOSAL_KIND = "product_draft_intent_session" as const;
export const PRODUCT_INTENT_PROPOSAL_VERSION = 1 as const;

export const canonicalProductIntentProposalSpecificationSchema = z.object({
  kind: z.literal(PRODUCT_INTENT_PROPOSAL_KIND),
  version: z.literal(PRODUCT_INTENT_PROPOSAL_VERSION),
  session: productIntentSessionEnvelopeSchema,
  canonicalProposalState: canonicalProductIntentStateSchema.optional(),
  latestCompilerResult: productIntentCompilerResultSchema.optional(),
  latestUnresolvedQuestions: unresolvedQuestionSetSchema.optional(),
  resolutionMetadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.session.kind !== PRODUCT_INTENT_PROPOSAL_KIND || value.session.version !== PRODUCT_INTENT_PROPOSAL_VERSION) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["session"], message: "Canonical session discriminator mismatch." });
  }
});
export type CanonicalProductIntentProposalSpecification = z.infer<typeof canonicalProductIntentProposalSpecificationSchema>;

export type CanonicalProductIntentProposalRow = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  conversationId: string | null;
  specification: Record<string, unknown>;
  fingerprint: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/** A deliberately small repository boundary makes the authoritative revision
 * rules unit-testable without importing a database or requiring DATABASE_URL. */
export interface CanonicalProductIntentProposalStore {
  insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">): Promise<CanonicalProductIntentProposalRow>;
  getById(input: { organizationId: string; proposalId: string }): Promise<CanonicalProductIntentProposalRow | null>;
  getByConversation(input: { organizationId: string; conversationId: string }): Promise<CanonicalProductIntentProposalRow | null>;
  compareAndSet(input: {
    organizationId: string;
    proposalId: string;
    actorUserId: string;
    expectedRevision: number;
    expectedFingerprint: string;
    specification: Record<string, unknown>;
    fingerprint: string;
    status: string;
  }): Promise<CanonicalProductIntentProposalRow | null>;
}

export class ProductIntentPersistenceError extends Error {
  constructor(public readonly code: "PRODUCT_INTENT_NOT_FOUND" | "PRODUCT_INTENT_ACTOR_MISMATCH" | "PRODUCT_INTENT_STALE_REVISION" | "PRODUCT_INTENT_CREATE_CONFLICT" | "PRODUCT_INTENT_SESSION_ID_MISMATCH", message: string) {
    super(message);
    this.name = "ProductIntentPersistenceError";
  }
}

export function isCanonicalProductIntentSpecification(value: unknown): value is CanonicalProductIntentProposalSpecification {
  return canonicalProductIntentProposalSpecificationSchema.safeParse(value).success;
}

function specificationFor(input: {
  session: ProductIntentSessionEnvelope;
  canonicalProposalState?: CanonicalProductIntentState;
  latestCompilerResult?: ProductIntentCompilerResult;
  latestUnresolvedQuestions?: z.infer<typeof unresolvedQuestionSetSchema>;
  resolutionMetadata?: Record<string, unknown>;
}): CanonicalProductIntentProposalSpecification {
  const canonicalProposalState = input.canonicalProposalState
    ?? canonicalProductIntentStateFromV1Draft(currentProductIntent(input.session));
  return canonicalProductIntentProposalSpecificationSchema.parse({
    kind: PRODUCT_INTENT_PROPOSAL_KIND,
    version: PRODUCT_INTENT_PROPOSAL_VERSION,
    session: input.session,
    canonicalProposalState,
    ...(input.latestCompilerResult ? { latestCompilerResult: input.latestCompilerResult } : {}),
    ...(input.latestUnresolvedQuestions ? { latestUnresolvedQuestions: input.latestUnresolvedQuestions } : {}),
    resolutionMetadata: input.resolutionMetadata ?? {},
  });
}

function parsedCanonicalRow(row: CanonicalProductIntentProposalRow): CanonicalProductIntentProposalSpecification | null {
  const parsed = canonicalProductIntentProposalSpecificationSchema.safeParse(row.specification);
  return parsed.success ? parsed.data : null;
}

function ensureActor(row: CanonicalProductIntentProposalRow, actorUserId: string): void {
  if (!row.actorUserId || row.actorUserId !== actorUserId) {
    throw new ProductIntentPersistenceError("PRODUCT_INTENT_ACTOR_MISMATCH", "This product-intent session belongs to another actor.");
  }
}

export type CanonicalProductIntentSession = {
  proposalId: string;
  organizationId: string;
  actorUserId: string;
  conversationId: string | null;
  fingerprint: string;
  status: string;
  specification: CanonicalProductIntentProposalSpecification;
};

/** Persists the state-machine envelope in the existing flexible JSONB proposal
 * column. The row is one session identity; its revisions array is append-only. */
export class ProductIntentPersistenceService {
  constructor(private readonly store: CanonicalProductIntentProposalStore) {}

  async create(input: {
    organizationId: string;
    actorUserId: string;
    conversationId?: string | null;
    intent: ProductDraftIntent;
    canonicalProposalState?: CanonicalProductIntentState;
    compilerResult?: ProductIntentCompilerResult;
    unresolvedQuestions?: z.infer<typeof unresolvedQuestionSetSchema>;
    resolutionMetadata?: Record<string, unknown>;
    now?: Date;
  }): Promise<CanonicalProductIntentSession> {
    const parsedIntent = productDraftIntentSchema.parse(input.intent);
    if (parsedIntent.organizationId !== input.organizationId) throw new ProductIntentPersistenceError("PRODUCT_INTENT_ACTOR_MISMATCH", "Product intent organization does not match the persistence scope.");
    const proposalId = randomUUID();
    const canonicalProposalState = canonicalProductIntentStateSchema.parse(input.canonicalProposalState ?? canonicalProductIntentStateFromV1Draft(parsedIntent));
    const authoritativeIntent = projectCanonicalProductIntentStateToV1Draft(parsedIntent, canonicalProposalState);
    const actorBoundIntent = productDraftIntentSchema.parse({ ...authoritativeIntent, revisionMetadata: { ...authoritativeIntent.revisionMetadata, actorUserId: input.actorUserId } });
    const session = createProductIntentSession({ organizationId: input.organizationId, sessionId: proposalId, intent: actorBoundIntent, now: input.now });
    const specification = specificationFor({ session, canonicalProposalState, latestCompilerResult: input.compilerResult, latestUnresolvedQuestions: input.unresolvedQuestions, resolutionMetadata: input.resolutionMetadata });
    let row: CanonicalProductIntentProposalRow;
    try {
      row = await this.store.insert({
        id: proposalId, organizationId: input.organizationId, actorUserId: input.actorUserId, conversationId: input.conversationId ?? null,
        specification, fingerprint: productDraftIntentFingerprint(currentProductIntent(session)), status: session.state,
      });
    } catch (error) {
      if (error instanceof ProductIntentPersistenceError) throw error;
      throw new ProductIntentPersistenceError("PRODUCT_INTENT_CREATE_CONFLICT", "A product-intent session already exists for this conversation.");
    }
    return this.toSession(row, input.actorUserId);
  }

  async load(input: { organizationId: string; actorUserId: string; proposalId: string }): Promise<CanonicalProductIntentSession> {
    const row = await this.store.getById(input);
    if (!row) throw new ProductIntentPersistenceError("PRODUCT_INTENT_NOT_FOUND", "The product-intent session was not found.");
    return this.toSession(row, input.actorUserId);
  }

  /** Returns null only when the conversation has no proposal. A legacy payload
   * raises a typed discriminator error so callers cannot silently fall back. */
  async loadForConversation(input: { organizationId: string; actorUserId: string; conversationId: string }): Promise<CanonicalProductIntentSession | null> {
    const row = await this.store.getByConversation(input);
    if (!row) return null;
    return this.toSession(row, input.actorUserId);
  }

  async appendPatch(input: {
    organizationId: string;
    actorUserId: string;
    proposalId: string;
    expectedRevision: number;
    expectedFingerprint: string;
    patch: unknown;
    reason: "answer" | "correction" | "server_resolution";
    compilerResult?: ProductIntentCompilerResult;
    unresolvedQuestions?: z.infer<typeof unresolvedQuestionSetSchema>;
    resolutionMetadata?: Record<string, unknown>;
    canonicalProposalState?: CanonicalProductIntentState;
    now?: Date;
  }): Promise<CanonicalProductIntentSession> {
    const current = await this.load(input);
    const session = current.specification.session;
    if (session.currentRevision !== input.expectedRevision || current.fingerprint !== input.expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    const patchedSession = applyProductIntentSessionPatch({ envelope: session, patch: input.patch, reason: input.reason, actorUserId: input.actorUserId, now: input.now });
    const patchedIntent = currentProductIntent(patchedSession);
    const canonicalProposalState = canonicalProductIntentStateSchema.parse(input.canonicalProposalState ?? canonicalProductIntentStateFromV1Draft(patchedIntent));
    const authoritativeIntent = projectCanonicalProductIntentStateToV1Draft(patchedIntent, canonicalProposalState);
    const nextSession = productIntentSessionEnvelopeSchema.parse({
      ...patchedSession,
      revisions: patchedSession.revisions.map((revision, index) => index === patchedSession.revisions.length - 1 ? { ...revision, intent: authoritativeIntent } : revision),
    });
    return this.persistTransition({ current, expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, session: nextSession, canonicalProposalState, actorUserId: input.actorUserId, latestCompilerResult: input.compilerResult, latestUnresolvedQuestions: input.unresolvedQuestions, resolutionMetadata: input.resolutionMetadata });
  }

  async bindConfirmation(input: { organizationId: string; actorUserId: string; proposalId: string; expectedRevision: number; expectedFingerprint: string }): Promise<CanonicalProductIntentSession> {
    const current = await this.load(input);
    const session = current.specification.session;
    if (session.currentRevision !== input.expectedRevision || current.fingerprint !== input.expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    return this.persistTransition({ current, expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, session: bindProductIntentConfirmation(session, input.expectedFingerprint), actorUserId: input.actorUserId });
  }

  /** Presentation-only state uses the same CAS binding but does not append a
   * product revision or alter confirmation readiness. */
  async updateResolutionMetadata(input: { organizationId: string; actorUserId: string; proposalId: string; expectedRevision: number; expectedFingerprint: string; resolutionMetadata: Record<string, unknown> }): Promise<CanonicalProductIntentSession> {
    const current = await this.load(input);
    if (current.specification.session.currentRevision !== input.expectedRevision || current.fingerprint !== input.expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    return this.persistTransition({ current, expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, session: current.specification.session, actorUserId: input.actorUserId, resolutionMetadata: input.resolutionMetadata });
  }

  async markExecuted(input: { organizationId: string; actorUserId: string; proposalId: string; expectedRevision: number; expectedFingerprint: string }): Promise<CanonicalProductIntentSession> {
    const current = await this.load(input);
    const session = current.specification.session;
    if (session.currentRevision !== input.expectedRevision || current.fingerprint !== input.expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    return this.persistTransition({ current, expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, session: markProductIntentExecuted(session, input.expectedRevision), actorUserId: input.actorUserId });
  }

  async abandon(input: { organizationId: string; actorUserId: string; proposalId: string; expectedRevision: number; expectedFingerprint: string }): Promise<CanonicalProductIntentSession> {
    const current = await this.load(input);
    if (current.specification.session.currentRevision !== input.expectedRevision || current.fingerprint !== input.expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    return this.persistTransition({ current, expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, session: abandonProductIntent(current.specification.session), actorUserId: input.actorUserId });
  }

  private async persistTransition(input: {
    current: CanonicalProductIntentSession;
    expectedRevision: number;
    expectedFingerprint: string;
    session: ProductIntentSessionEnvelope;
    canonicalProposalState?: CanonicalProductIntentState;
    actorUserId: string;
    latestCompilerResult?: ProductIntentCompilerResult;
    latestUnresolvedQuestions?: z.infer<typeof unresolvedQuestionSetSchema>;
    resolutionMetadata?: Record<string, unknown>;
  }): Promise<CanonicalProductIntentSession> {
    const specification = specificationFor({
      session: input.session,
      canonicalProposalState: input.canonicalProposalState ?? input.current.specification.canonicalProposalState,
      latestCompilerResult: input.latestCompilerResult ?? input.current.specification.latestCompilerResult,
      latestUnresolvedQuestions: input.latestUnresolvedQuestions ?? input.current.specification.latestUnresolvedQuestions,
      resolutionMetadata: input.resolutionMetadata ?? input.current.specification.resolutionMetadata,
    });
    const fingerprint = productDraftIntentFingerprint(currentProductIntent(input.session));
    const row = await this.store.compareAndSet({
      organizationId: input.current.organizationId, proposalId: input.current.proposalId, actorUserId: input.actorUserId,
      expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint,
      specification, fingerprint, status: input.session.state,
    });
    if (!row) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The product intent changed; review the latest revision.");
    return this.toSession(row, input.actorUserId);
  }

  private toSession(row: CanonicalProductIntentProposalRow, actorUserId: string): CanonicalProductIntentSession {
    ensureActor(row, actorUserId);
    const specification = parsedCanonicalRow(row);
    if (!specification) throw new ProductIntentPersistenceError("PRODUCT_INTENT_NOT_FOUND", "The product-intent session is unavailable.");
    if (specification.session.organizationId !== row.organizationId || specification.session.sessionId !== row.id) throw new ProductIntentPersistenceError("PRODUCT_INTENT_SESSION_ID_MISMATCH", "The canonical product-intent session binding is invalid.");
    const expectedFingerprint = productDraftIntentFingerprint(currentProductIntent(specification.session));
    if (row.fingerprint !== expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The canonical product-intent fingerprint is invalid.");
    if (specification.canonicalProposalState) {
      const projected = projectCanonicalProductIntentStateToV1Draft(currentProductIntent(specification.session), specification.canonicalProposalState);
      if (productDraftIntentFingerprint(projected) !== expectedFingerprint) throw new ProductIntentPersistenceError("PRODUCT_INTENT_STALE_REVISION", "The canonical proposal state and compatibility projection are inconsistent.");
    }
    return { proposalId: row.id, organizationId: row.organizationId, actorUserId, conversationId: row.conversationId, fingerprint: row.fingerprint, status: row.status, specification };
  }
}

/** Production adapter. It is instantiated lazily, so pure tests only use the
 * in-memory store and never load the database module. */
export class DrizzleCanonicalProductIntentProposalStore implements CanonicalProductIntentProposalStore {
  private async dependencies() {
    const [{ aiConfigurableProductProposals }, { db }] = await Promise.all([import("@shared/schema"), import("../../db")]);
    return { aiConfigurableProductProposals, db };
  }

  async insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">): Promise<CanonicalProductIntentProposalRow> {
    const { aiConfigurableProductProposals, db } = await this.dependencies();
    const [row] = await db.insert(aiConfigurableProductProposals).values({ id: input.id, orgId: input.organizationId, actorUserId: input.actorUserId, conversationId: input.conversationId, specification: input.specification, fingerprint: input.fingerprint, status: input.status }).returning();
    if (!row) throw new Error("Canonical proposal insert returned no row.");
    return toRow(row);
  }
  async getById(input: { organizationId: string; proposalId: string }): Promise<CanonicalProductIntentProposalRow | null> {
    const { aiConfigurableProductProposals, db } = await this.dependencies();
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId))).limit(1);
    return row ? toRow(row) : null;
  }
  async getByConversation(input: { organizationId: string; conversationId: string }): Promise<CanonicalProductIntentProposalRow | null> {
    const { aiConfigurableProductProposals, db } = await this.dependencies();
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId))).limit(1);
    return row ? toRow(row) : null;
  }
  async compareAndSet(input: Parameters<CanonicalProductIntentProposalStore["compareAndSet"]>[0]): Promise<CanonicalProductIntentProposalRow | null> {
    const { aiConfigurableProductProposals, db } = await this.dependencies();
    const [row] = await db.update(aiConfigurableProductProposals).set({ specification: input.specification, fingerprint: input.fingerprint, status: input.status, updatedAt: new Date() }).where(and(
      eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId), eq(aiConfigurableProductProposals.actorUserId, input.actorUserId), eq(aiConfigurableProductProposals.fingerprint, input.expectedFingerprint),
      sql`(${aiConfigurableProductProposals.specification} -> 'session' ->> 'currentRevision')::integer = ${input.expectedRevision}`,
    )).returning();
    return row ? toRow(row) : null;
  }
}

function toRow(row: any): CanonicalProductIntentProposalRow {
  return { id: row.id, organizationId: row.orgId, actorUserId: row.actorUserId, conversationId: row.conversationId, specification: row.specification, fingerprint: row.fingerprint, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
