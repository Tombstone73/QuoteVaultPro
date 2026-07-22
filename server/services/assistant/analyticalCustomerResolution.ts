import {
  assistantProviderPlanSchema,
  type AssistantContextEnvelope,
  type AssistantProviderPlan,
} from "@shared/assistantContracts";
import type { AssistantAnalyticsCustomerRecord } from "../../storage/assistantAnalyticsReporting.repo";

/**
 * The reporting resolution boundary deliberately lives ahead of orchestration.
 * It is the only component that may inspect a customer reference before a
 * financial tool is invoked.  The durable repository is injected so this code
 * remains usable by the migration-backed implementation without allowing a
 * browser company id to become trusted input.
 */
export type AnalyticalCustomerResolutionState =
  | "awaiting_entity_resolution"
  | "resolved"
  | "resuming"
  | "resumed"
  | "expired"
  | "cancelled"
  | "failed";

export interface AnalyticalResolutionScope {
  organizationId: string;
  userId: string;
  conversationId: string;
}

export interface AnalyticalResolutionCandidate {
  /** Internal canonical purchasing-company id. Never returned to the browser. */
  companyId: string;
  companyName: string;
  resolutionType: "company" | "contact";
  contactName: string | null;
  matchReason: string;
  companyStatus?: string | null;
  location?: string | null;
  companyLink: string;
}

export interface PersistedAnalyticalResolution {
  id: string;
  conversationId: string;
  /** Created by the atomic pause transaction; used only to return the already
   * persisted same-conversation turn, never accepted from the browser. */
  sourceTurnId?: string;
  sourceCorrelationId?: string;
  version: number;
  status: AnalyticalCustomerResolutionState;
  plan: AssistantProviderPlan;
  context: AssistantContextEnvelope;
  originalUserRequest: string;
  unresolvedReference: string;
  candidates: Array<AnalyticalResolutionCandidate & { candidateId: string }>;
  continuationResult?: unknown;
}

export interface AnalyticalResolutionPersistence {
  /**
   * Must atomically save the paused turn/message, validated plan, context and
   * candidate set. A successful return is the authority for rendering a card.
   */
  pause(input: {
    scope: AnalyticalResolutionScope;
    sourceTurnId?: string;
    originalUserRequest: string;
    plan: AssistantProviderPlan;
    context: AssistantContextEnvelope;
    unresolvedReference: string;
    candidates: AnalyticalResolutionCandidate[];
    assistantResponse: string;
  }): Promise<PersistedAnalyticalResolution | null>;
  load(scope: AnalyticalResolutionScope & { resolutionId: string }): Promise<PersistedAnalyticalResolution | null>;
  /** Resolves the server-owned conversation scope from an opaque resolution
   * id after tenant/user filtering. The browser never supplies it. */
  findSelection?(scope: Omit<AnalyticalResolutionScope, "conversationId"> & { resolutionId: string }): Promise<PersistedAnalyticalResolution | null>;
  /** Atomically transitions awaiting -> resuming, or returns prior result. */
  claim(input: AnalyticalResolutionScope & {
    resolutionId: string;
    candidateId: string;
    expectedVersion: number;
    now: Date;
  }): Promise<
    | { kind: "claimed"; resolution: PersistedAnalyticalResolution }
    | { kind: "completed"; continuationResult: unknown }
    | { kind: "rejected"; code: "not_found" | "expired" | "cancelled" | "stale_version" | "invalid_candidate" | "not_pending" }
  >;
  finish?(input: AnalyticalResolutionScope & { resolutionId: string; continuationResult: unknown }): Promise<void>;
  fail?(input: AnalyticalResolutionScope & { resolutionId: string; failureCode: string }): Promise<void>;
  cancel?(input: AnalyticalResolutionScope & { resolutionId: string; expectedVersion: number }): Promise<unknown>;
}

export interface AnalyticalCustomerResolver {
  resolveCustomer(organizationId: string, query: string): Promise<{
    customer: AssistantAnalyticsCustomerRecord | null;
    alternatives: AssistantAnalyticsCustomerRecord[];
    confidence: "exact" | "ambiguous" | "none";
  }>;
  /** Reload is required after a selection to defend against deleted/archived
   * companies or contact relationship changes while the choice was pending. */
  reloadReportingCompany?(organizationId: string, companyId: string): Promise<AssistantAnalyticsCustomerRecord | null>;
}

export type AnalyticalPreflightResult =
  | { kind: "not_applicable"; plan: AssistantProviderPlan }
  | { kind: "continue"; plan: AssistantProviderPlan }
  | { kind: "no_match"; plan: AssistantProviderPlan; message: string }
  | { kind: "awaiting_entity_resolution"; resolution: PersistedAnalyticalResolution; message: string }
  | { kind: "persistence_failed"; message: string };

const financialToolNames = new Set(["analytics.customer_product_sales", "analytics.customer_uninvoiced_orders"]);

function financialCustomerReference(plan: AssistantProviderPlan): string | null {
  for (const call of plan.toolCalls) {
    if (!financialToolNames.has(call.toolName)) continue;
    const customer = call.arguments.customer;
    if (!customer || typeof customer !== "object" || Array.isArray(customer)) continue;
    const reference = customer as { id?: unknown; name?: unknown };
    if (typeof reference.id === "string" && reference.id.trim()) return reference.id.trim();
    if (typeof reference.name === "string" && reference.name.trim()) return reference.name.trim();
  }
  return null;
}

function toCandidate(customer: AssistantAnalyticsCustomerRecord): AnalyticalResolutionCandidate {
  return {
    companyId: customer.id,
    companyName: customer.displayName,
    resolutionType: customer.resolutionType,
    contactName: customer.contactName,
    matchReason: customer.explanation,
    companyLink: `/customers/${encodeURIComponent(customer.id)}`,
  };
}

/** Patches only customer references in financial calls. All report dimensions,
 * periods, financial source and presentation requests stay byte-for-byte as
 * they appeared in the validated plan. */
export function patchAnalyticalPlanCustomer(
  rawPlan: unknown,
  unresolvedReference: string,
  customer: Pick<AssistantAnalyticsCustomerRecord, "id" | "displayName">,
): AssistantProviderPlan {
  const plan = assistantProviderPlanSchema.parse(rawPlan);
  return assistantProviderPlanSchema.parse({
    ...plan,
    toolCalls: plan.toolCalls.map((call) => {
      if (!financialToolNames.has(call.toolName)) return call;
      const current = call.arguments.customer;
      if (!current || typeof current !== "object" || Array.isArray(current)) return call;
      const reference = current as { id?: unknown; name?: unknown };
      const value = typeof reference.id === "string" ? reference.id : typeof reference.name === "string" ? reference.name : null;
      if (value !== unresolvedReference) return call;
      return { ...call, arguments: { ...call.arguments, customer: { id: customer.id, name: customer.displayName } } };
    }),
  });
}

export class AnalyticalCustomerResolutionService {
  constructor(
    private readonly resolver: AnalyticalCustomerResolver,
    private readonly persistence: AnalyticalResolutionPersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async preflight(input: {
    scope: AnalyticalResolutionScope;
    sourceTurnId?: string;
    originalUserRequest: string;
    plan: unknown;
    context: AssistantContextEnvelope;
  }): Promise<AnalyticalPreflightResult> {
    const plan = assistantProviderPlanSchema.parse(input.plan);
    const reference = financialCustomerReference(plan);
    if (!reference) return { kind: "not_applicable", plan };

    const resolved = await this.resolver.resolveCustomer(input.scope.organizationId, reference);
    if (resolved.confidence === "exact" && resolved.customer) {
      return { kind: "continue", plan: patchAnalyticalPlanCustomer(plan, reference, resolved.customer) };
    }
    if (resolved.confidence === "none") {
      return { kind: "no_match", plan, message: `I couldn't find a purchasing company matching ${reference}.` };
    }

    // No financial tool has run yet. The durable store owns candidate ids and
    // only a non-null transaction result is allowed to produce a selection UI.
    const message = "I found multiple matching companies. Choose the one you want me to use for this report.";
    const resolution = await this.persistence.pause({
      ...input,
      plan,
      unresolvedReference: reference,
      candidates: resolved.alternatives.map(toCandidate),
      assistantResponse: message,
    });
    return resolution
      ? { kind: "awaiting_entity_resolution", resolution, message }
      : { kind: "persistence_failed", message: "I couldn't safely save the company choice for this report. Please try again." };
  }

  async findSelection(scope: Omit<AnalyticalResolutionScope, "conversationId"> & { resolutionId: string }) {
    return this.persistence.findSelection ? this.persistence.findSelection(scope) : null;
  }

  async cancelPersistedResolution(input: Omit<AnalyticalResolutionScope, "conversationId"> & { resolutionId: string; expectedVersion: number }) {
    const resolution = await this.findSelection(input);
    if (!resolution || !this.persistence.cancel) return null;
    return this.persistence.cancel({ ...input, conversationId: resolution.conversationId });
  }

  async continuePersistedPlan(input: AnalyticalResolutionScope & {
    resolutionId: string;
    candidateId: string;
    expectedVersion: number;
    execute: (plan: AssistantProviderPlan, resolution: PersistedAnalyticalResolution) => Promise<unknown>;
  }): Promise<
    | { kind: "resumed"; result: unknown; replayed: boolean }
    | { kind: "rejected"; code: "not_found" | "expired" | "cancelled" | "stale_version" | "invalid_candidate" | "not_pending" }
    | { kind: "failed"; message: string }
  > {
    const claimed = await this.persistence.claim({ ...input, now: this.now() });
    if (claimed.kind === "completed") return { kind: "resumed", result: claimed.continuationResult, replayed: true };
    if (claimed.kind === "rejected") return claimed;

    const resolution = claimed.resolution;
    const selected = resolution.candidates.find((candidate) => candidate.candidateId === input.candidateId);
    // Defense in depth: a repository must reject this, and this service must
    // not execute even if a faulty implementation accidentally claimed it.
    if (!selected) return { kind: "rejected", code: "invalid_candidate" };
    try {
      const current = this.resolver.reloadReportingCompany
        ? await this.resolver.reloadReportingCompany(input.organizationId, selected.companyId)
        : await this.resolver.resolveCustomer(input.organizationId, selected.companyId).then((value) => value.customer);
      if (!current) {
        await this.persistence.fail?.({ ...input, failureCode: "company_unavailable" });
        return { kind: "failed", message: "That company is no longer available for reporting." };
      }
      const plan = patchAnalyticalPlanCustomer(resolution.plan, resolution.unresolvedReference, current);
      const result = await input.execute(plan, resolution);
      await this.persistence.finish?.({ ...input, continuationResult: result });
      return { kind: "resumed", result, replayed: false };
    } catch {
      await this.persistence.fail?.({ ...input, failureCode: "continuation_failed" });
      return { kind: "failed", message: "The report could not be continued safely." };
    }
  }
}
