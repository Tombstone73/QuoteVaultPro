import { assistantContextEnvelopeSchema, assistantProviderPlanSchema, type AssistantContextEnvelope, type AssistantProviderPlan } from "@shared/assistantContracts";
import { canonicalOrderNumberLookup } from "@shared/documentNumbering";

type DeterministicLookupKind = "order" | "quote" | "product" | "customer";

export interface DeterministicSearchTarget {
  entityType: Exclude<DeterministicLookupKind, "order">;
  query: string;
}

export interface DeterministicOrderLookupTarget {
  orderNumber: string;
  displayNumber: string;
}

/**
 * Handles only requests whose intent and bounded arguments can be established
 * without a provider.  The returned plan still flows through the normal
 * registry, authorization, adapter, audit, timeout, and result-validation
 * path; this is deliberately not a second execution mechanism.
 */
function plan(input: unknown): AssistantProviderPlan {
  return assistantProviderPlanSchema.parse(input);
}

function normalizedMessage(message: string): string {
  return message.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim().replace(/[.?!]+$/g, "");
}

function readNavigationQuestion(message: string): boolean {
  return /\b(?:what|which)\s+(?:page|screen|record)\s+(?:am\s+i|are\s+we)\s+(?:currently\s+)?(?:viewing|on)\b/i.test(message)
    || /\bwhat(?:'s| is)\s+(?:the\s+)?current(?:ly)?\s+(?:open\s+)?(?:page|screen|record)\b/i.test(message)
    || /^(?:please\s+)?summari[sz]e\s+(?:this|the current)\s+(?:order|product|customer)\??$/i.test(message);
}

function currentOrderQuestion(message: string): boolean {
  return /^(?:what(?:'s| is) blocking this order|why is this order blocked|what still needs to happen on this order|what is preventing (?:fulfillment|billing)|summari[sz]e (?:this|the current) order|give me (?:a )?summary of (?:this|the current) order|tell me about (?:this|the current) order|give me (?:an )?overview of (?:this|the current) order|what(?:'s| is) (?:this|the current) order|what is the production status|what is the artwork status)$/i.test(message);
}

function currentOrderBlockingQuestion(message: string): boolean {
  return /^(?:what(?:'s| is) blocking this order|why is this order blocked|what still needs to happen on this order|what is preventing (?:fulfillment|billing))\??$/i.test(message);
}

function currentOrderId(context: AssistantContextEnvelope | undefined): string | null {
  if (!context || context.entityType !== "order" || !context.entityId) return null;
  if (!/^\/orders\/[A-Za-z0-9_-]{1,128}$/.test(context.route)) return null;
  return context.entityId;
}

function currentEntityId(context: AssistantContextEnvelope | undefined, entityType: "customer" | "product"): string | null {
  if (!context || context.entityType !== entityType || !context.entityId) return null;
  const route = entityType === "customer"
    ? /^\/customers\/[A-Za-z0-9_-]{1,128}$/
    : /^\/products\/[A-Za-z0-9_-]{1,128}\/edit$/;
  return route.test(context.route) ? context.entityId : null;
}

function currentEntitySummaryQuestion(message: string, entityType: "customer" | "product"): boolean {
  const subject = `(?:this|the current) ${entityType}`;
  return new RegExp(`^(?:summari[sz]e ${subject}|give me (?:a )?summary of ${subject}|tell me about ${subject}|give me (?:an )?overview of ${subject}|what(?:'s| is) ${subject})$`, "i").test(message);
}

/**
 * Identifiers and names are capped before they ever become tool arguments.
 * This makes a deterministic path no more permissive than the registry's
 * normal Zod validation while avoiding fragile provider parsing for common
 * exact lookups.
 */
function exactLookup(message: string): { kind: DeterministicLookupKind; value: string } | null {
  const match = /^(?:please\s+)?(?:find|show|look\s*up|get|search\s+for)\s+(?:the\s+)?(order|quote|product|customer)\s*(?:number|named|called)?\s*(?:[:#-]\s*)?(?:"([^"]{1,160})"|'([^']{1,160})'|([A-Za-z0-9][A-Za-z0-9 &'.,_-]{0,159}))\??$/i.exec(message.trim());
  if (!match) return null;
  const kind = match[1]!.toLowerCase() as DeterministicLookupKind;
  const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  if (!value) return null;
  return { kind, value };
}

/**
 * Lets the service apply an exact-match response policy after the registered
 * bounded search tool returns. The tool remains responsible for tenant
 * filtering, authorization, limits, timeouts, result validation, and audit.
 */
export function deterministicSearchTarget(planValue: AssistantProviderPlan): DeterministicSearchTarget | null {
  const selectedSkill = planValue.selectedSkill;
  const match = typeof selectedSkill === "string" ? /^deterministic_(quote|product|customer)_lookup$/.exec(selectedSkill) : null;
  const toolCall = planValue.toolCalls[0];
  const query = toolCall?.toolName === "search.global" && typeof toolCall.arguments.query === "string"
    ? toolCall.arguments.query.trim()
    : "";
  if (!match || !query) return null;
  return { entityType: match[1]! as DeterministicSearchTarget["entityType"], query };
}

export function deterministicOrderLookupTarget(planValue: AssistantProviderPlan): DeterministicOrderLookupTarget | null {
  const call = planValue.selectedSkill === "deterministic_order_lookup" ? planValue.toolCalls[0] : null;
  if (call?.toolName !== "orders.get_summary" || typeof call.arguments.orderNumber !== "string") return null;
  const normalized = canonicalOrderNumberLookup(call.arguments.orderNumber);
  return normalized ? { orderNumber: normalized.lookupValue, displayNumber: normalized.displayValue } : null;
}

export function resolveDeterministicReadPlan(message: string, rawContext?: AssistantContextEnvelope): AssistantProviderPlan | null {
  const normalized = normalizedMessage(message);
  const context = rawContext ? assistantContextEnvelopeSchema.parse(rawContext) : undefined;
  const orderId = currentOrderQuestion(normalized) ? currentOrderId(context) : null;
  if (orderId) {
    return plan({
      intent: "lookup",
      selectedSkill: currentOrderBlockingQuestion(normalized) ? "deterministic_current_order_blocking" : "deterministic_current_order_summary",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderId } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }
  const customerId = currentEntitySummaryQuestion(normalized, "customer") ? currentEntityId(context, "customer") : null;
  if (customerId) {
    return plan({
      intent: "lookup",
      selectedSkill: "deterministic_current_customer_summary",
      toolCalls: [{ toolName: "customers.get_summary", arguments: { customerId } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }
  const productId = currentEntitySummaryQuestion(normalized, "product") ? currentEntityId(context, "product") : null;
  if (productId) {
    return plan({
      intent: "lookup",
      selectedSkill: "deterministic_current_product_summary",
      toolCalls: [{ toolName: "products.get_summary", arguments: { productId } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }
  if (readNavigationQuestion(normalized)) {
    return plan({
      intent: "navigation",
      selectedSkill: "deterministic_navigation",
      toolCalls: [{ toolName: "navigation.get_current_context", arguments: {} }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }

  const lookup = exactLookup(normalized);
  if (!lookup) return null;
  if (lookup.kind === "order") {
    // An order number is a deliberately narrow identifier and the adapter
    // re-fetches it under the trusted tenant scope.
    const orderNumber = canonicalOrderNumberLookup(lookup.value);
    if (!orderNumber) {
      return plan({
        intent: "clarification",
        selectedSkill: "deterministic_invalid_order_lookup",
        toolCalls: [],
        clarificationRequired: true,
        clarificationQuestion: "I couldn't recognize that order number. Try something like ORD-20002.",
        responseStyle: "concise",
      });
    }
    return plan({
      intent: "lookup",
      selectedSkill: "deterministic_order_lookup",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: orderNumber.lookupValue } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }

  if (lookup.kind === "quote" && !/^[A-Za-z0-9_-]{1,64}$/.test(lookup.value)) return null;

  if (!/^[A-Za-z0-9][A-Za-z0-9 &'.,_-]{0,159}$/.test(lookup.value)) return null;

  // The static Stage 2 registry intentionally has no quote-summary tool.
  // A bounded tenant-scoped search is its registered read-only lookup path for
  // quotes, customer names, and product names.  It retains links, limits, and
  // normal audit records without inventing a new tool.
  return plan({
    intent: "lookup",
    selectedSkill: `deterministic_${lookup.kind}_lookup`,
    toolCalls: [{
      toolName: "search.global",
      arguments: {
        query: lookup.value,
        limit: 5,
        ...(lookup.kind === "customer" || lookup.kind === "product" ? { entityType: lookup.kind } : {}),
      },
    }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });
}
