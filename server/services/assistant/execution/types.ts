import type { AssistantContextEnvelope } from "@shared/assistantContracts";

/**
 * Stage 3's service boundary deliberately models commands, not repositories or
 * routes.  A future command must call a canonical business service behind this
 * interface; assistant orchestration never receives a database handle.
 */
export const executionPlanStates = [
  "draft",
  "resolving",
  "awaiting_input",
  "preview_ready",
  "awaiting_confirmation",
  "confirmed",
  "revalidating",
  "executing",
  "succeeded",
  "partially_failed",
  "failed",
  "cancelled",
  "expired",
  "invalidated",
] as const;
export type ExecutionPlanState = (typeof executionPlanStates)[number];

export interface ExecutionActorScope {
  organizationId: string;
  userId: string;
  permissions: readonly string[];
  environment: "development" | "test" | "production" | string;
}

export interface ExecutionAffectedRecord {
  entityType: string;
  entityId: string;
  fingerprint: string;
}

export interface ExecutionPlanPreview {
  title: string;
  summary: string;
  sideEffects: readonly string[];
  affectedRecords: readonly ExecutionAffectedRecord[];
  missingInformation?: readonly string[];
  /** Safe presentation details for the sole Stage 4 quote-note command. */
  quoteInternalNote?: {
    quoteId: string;
    quoteNumber: string;
    customerName: string | null;
    noteText: string;
    sourceLink: { label: string; href: string; entityType: "quote"; entityId: string };
    unchanged: readonly string[];
  };
}

export interface ExecutionPlanRecord {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  turnId?: string;
  commandName: string;
  commandVersion: string;
  normalizedAction: string;
  sanitizedArguments: Record<string, unknown>;
  contextHash: string;
  permissionSnapshot: readonly string[];
  environment: string;
  preview: ExecutionPlanPreview;
  affectedRecords: readonly ExecutionAffectedRecord[];
  riskLevel: "low" | "moderate" | "high" | "critical";
  status: ExecutionPlanState;
  version: number;
  idempotencyKey: string;
  correlationId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  failureCode?: string;
  failureSummary?: string;
}

export interface ExecutionConfirmationRecord {
  id: string;
  planId: string;
  organizationId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  confirmedAt?: Date;
  usedAt?: Date;
  invalidatedAt?: Date;
  invalidatedReason?: string;
}

export interface ExecutionStepResult {
  commandName: string;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  domainAuditReference?: string;
}

export interface ExecutionCommandResult {
  status: "succeeded" | "partially_failed" | "failed";
  summary: string;
  steps: readonly ExecutionStepResult[];
}

export interface ExecutionCommandDefinition {
  name: string;
  version: string;
  testOnly: boolean;
  riskLevel: "low" | "moderate" | "high" | "critical";
  confirmationTtlMs: number;
  maxAffectedRecords: number;
  requiredPermissions: readonly string[];
  /** Validate and normalize model/user supplied arguments before any plan exists. */
  buildPreview(input: {
    scope: ExecutionActorScope;
    context: AssistantContextEnvelope;
    arguments: Record<string, unknown>;
  }): Promise<{ arguments: Record<string, unknown>; preview: ExecutionPlanPreview }>;
  /** Reload domain state and compare fingerprints immediately before execution. */
  revalidate(input: { plan: ExecutionPlanRecord; scope: ExecutionActorScope }): Promise<{ valid: true } | { valid: false; code: string; summary: string }>;
  /** May only call canonical domain services. Never expose repository functions here. */
  execute(input: { plan: ExecutionPlanRecord; scope: ExecutionActorScope }): Promise<ExecutionCommandResult>;
}

export interface ExecutionCommandRegistry {
  get(name: string): ExecutionCommandDefinition | undefined;
  list(): readonly ExecutionCommandDefinition[];
}

export interface ExecutionPlanRepository {
  create(plan: ExecutionPlanRecord): Promise<ExecutionPlanRecord>;
  get(scope: Pick<ExecutionActorScope, "organizationId" | "userId">, planId: string): Promise<ExecutionPlanRecord | null>;
  /** Implement as a compare-and-swap update on plan version in durable storage. */
  update(plan: ExecutionPlanRecord, expectedVersion: number): Promise<ExecutionPlanRecord | null>;
  createConfirmation(confirmation: ExecutionConfirmationRecord): Promise<void>;
  /** Atomically check user/org/plan/token/expiry and mark the token used. */
  consumeConfirmation(input: {
    planId: string;
    organizationId: string;
    userId: string;
    tokenHash: string;
    now: Date;
  }): Promise<"consumed" | "already_used" | "invalid">;
  acquireIdempotency(input: {
    plan: ExecutionPlanRecord;
    requestHash: string;
    now: Date;
  }): Promise<{ kind: "acquired" } | { kind: "completed"; result: ExecutionCommandResult } | { kind: "in_progress" } | { kind: "conflict" }>;
  completeIdempotency(input: { plan: ExecutionPlanRecord; result: ExecutionCommandResult; now: Date }): Promise<void>;
  recordAudit(input: { planId: string; correlationId: string; event: string; detail?: string }): Promise<void>;
  recordSteps(input: { planId: string; steps: readonly ExecutionStepResult[] }): Promise<void>;
}

export class ExecutionPlanError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
