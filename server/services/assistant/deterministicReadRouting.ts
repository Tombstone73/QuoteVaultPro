import { assistantContextEnvelopeSchema, assistantProviderPlanSchema, type AssistantContextEnvelope, type AssistantProviderPlan } from "@shared/assistantContracts";
import { canonicalOrderNumberLookup } from "@shared/documentNumbering";
import { resolveExplicitReportingScope } from "./reportingScope";

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
  return /^(?:what(?:'s| is) blocking this order|why is this order blocked|why can(?:'t|not) this order be invoiced|what still needs to happen on this order|what is preventing (?:fulfillment|billing)|summari[sz]e (?:this|the current) order|give me (?:a )?summary of (?:this|the current) order|tell me about (?:this|the current) order|give me (?:an )?overview of (?:this|the current) order|what(?:'s| is) (?:this|the current) order|what is the production status|what is the artwork status)$/i.test(message);
}

function currentOrderBlockingQuestion(message: string): boolean {
  return /^(?:what(?:'s| is) blocking this order|why is this order blocked|why can(?:'t|not) this order be invoiced|what still needs to happen on this order|what is preventing (?:fulfillment|billing))\??$/i.test(message);
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

function stationReference(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}$/.test(normalized) ? normalized : null;
}

function requestedResultLimit(value: string | undefined): number {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const parsed = value && /^\d+$/.test(value) ? Number(value) : words[value?.toLowerCase() ?? ""] ?? 10;
  return Math.min(20, Math.max(1, parsed));
}

/** Explicit order scope is resolved before the production shortcut. The words
 * "overdue" and "due today" alone are not enough to choose a job queue. */
function orderDueReadPlan(message: string): AssistantProviderPlan | null {
  const customerWeekRange = /\b(?:report|summary)\s+for\s+(.+?)\s+for\s+(?:all\s+)?(?:production\s+)?(?:jobs?|orders?)\s+(?:that\s+are\s+)?due\s+(?:in\s+|during\s+)?(?:last|previous)\s+week\s+or\s+(?:this|current)\s+week\b/i.exec(message);
  if (customerWeekRange) {
    const customerName = customerWeekRange[1]!.trim().replace(/[.?!]+$/, "");
    if (/^[A-Za-z0-9][A-Za-z0-9 &'.,_-]{0,239}$/.test(customerName)) return plan({
      intent: "analytical_reporting",
      selectedSkill: "deterministic_customer_order_due_summary",
      toolCalls: [{
        toolName: "orders.get_due_summary",
        arguments: {
          due: "last_week_through_current_week",
          customer: { name: customerName },
          limit: 10,
          includeOperationalSummary: true,
        },
      }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }
  if (resolveExplicitReportingScope(message) !== "order") return null;
  const due = /\bdue\s+today\b/i.test(message) ? "due_today"
    : /\bdue\s+tomorrow\b/i.test(message) ? "due_tomorrow"
      : /\boverdue\b/i.test(message) ? "overdue" : null;
  if (!due) return null;
  const requested = /\b(?:show|list)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(message);
  return plan({
    intent: "operational_summary",
    selectedSkill: "deterministic_order_due_summary",
    toolCalls: [{ toolName: "orders.get_due_summary", arguments: { due, limit: requestedResultLimit(requested?.[1]), includeOperationalSummary: true } }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });
}

/** A customer explicitly asking what was "done" is asking for completed
 * production jobs, not due work or financial/billing state. This route runs
 * before provider planning so the narrow, tenant-resolved report cannot fall
 * through to the uninvoiced-order tool. */
function completedJobsReadPlan(message: string): AssistantProviderPlan | null {
  const match = /\b(?:report|summary)\s+(?:of\s+)?(?:all\s+)?(?:production\s+)?jobs?\s+for\s+(.+?)\s+(?:that\s+)?(?:were\s+)?(?:done|completed)\s+(?:in\s+|during\s+)?(?:last|previous)\s+week\s+(?:and|or|through)\s+(?:this|current)\s+week\b/i.exec(message);
  if (!match) return null;
  const customerName = match[1]!.trim().replace(/[.?!]+$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'.,_-]{0,239}$/.test(customerName)) return null;
  return plan({
    intent: "production_reporting",
    selectedSkill: "deterministic_customer_completed_job_report",
    toolCalls: [{
      toolName: "production.get_completed_jobs",
      arguments: {
        completed: "last_week_through_current_week",
        customer: { name: customerName },
        limit: 10,
      },
    }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });
}

function productionReadPlan(message: string): AssistantProviderPlan | null {
  const remainingAtStation = /\b(?:how many|what)\s+(?:prints?|units?)\s+(?:are\s+)?(?:left|remaining|remain)\s+(?:in|at)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 _-]{0,99})\??$/i.exec(message);
  if (remainingAtStation) {
    const stationKey = stationReference(remainingAtStation[1]!);
    if (stationKey) return plan({
      intent: "production_reporting",
      selectedSkill: "deterministic_production_station_progress",
      toolCalls: [{ toolName: "production.get_queue_summary", arguments: { stationKey, limit: 5 } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }

  if (/\b(?:what is still left to print|what(?:'s| is) left to print|remaining production work)\b/i.test(message)) return plan({
    intent: "production_reporting",
    selectedSkill: "deterministic_production_remaining_work",
    toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "all_attention", limit: 10 } }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });

  if (/\b(?:which station has the largest backlog|which station is busiest|largest backlog|station comparison|compare\s+.+\s+and\s+.+|which board should i work on first|bottleneck)\b/i.test(message)) return plan({
    intent: "production_reporting",
    selectedSkill: "deterministic_production_station_comparison",
    toolCalls: [{ toolName: "production.get_queue_summary", arguments: { limit: 10 } }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });

  const urgent = /\bshow(?: me)?(?: the)?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:most )?urgent production jobs?\b/i.exec(message);
  if (urgent) return plan({
    intent: "production_reporting",
    selectedSkill: "deterministic_production_urgent_jobs",
    toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter: "urgent", limit: requestedResultLimit(urgent[1]) } }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });

  if (/\b(?:what needs attention|are any (?:production )?jobs overdue|overdue (?:production )?jobs?|due today|due tomorrow|waiting on (?:artwork|proof|prepress)|ready for fulfillment)\b/i.test(message)) {
    const filter = /\bdue today\b/i.test(message) ? "due_today"
      : /\bdue tomorrow\b/i.test(message) ? "due_tomorrow"
        : /\boverdue\b/i.test(message) ? "overdue"
          : /\bwaiting on artwork\b/i.test(message) ? "waiting_artwork"
            : /\bwaiting on proof\b/i.test(message) ? "waiting_proof"
              : /\bwaiting on prepress\b/i.test(message) ? "waiting_prepress"
                : /\bready for fulfillment\b/i.test(message) ? "ready_for_fulfillment" : "all_attention";
    return plan({
      intent: "production_reporting",
      selectedSkill: "deterministic_production_attention",
      toolCalls: [{ toolName: "operations.get_attention_summary", arguments: { filter, limit: 10 } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }

  const stationQueue = /\b(?:how many jobs? are in|what is due next on|first due in|when is the first)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 _-]*?)(?=\s+(?:job|jobs|queue|station)\b|\s+and\b|,|[?.!]|$)/i.exec(message);
  if (stationQueue) {
    const stationKey = stationReference(stationQueue[1]!);
    if (stationKey) return plan({
      intent: "production_reporting",
      selectedSkill: "deterministic_production_station_queue",
      toolCalls: [{ toolName: "production.get_queue_summary", arguments: { stationKey, limit: 5 } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }
  return null;
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

/** A deliberately bounded natural-language form for one order summary.  This
 * must not become a generic number extractor: it requires both an order noun
 * and a summary/lookup verb, accepts one numeric identifier, and permits only
 * the short trailing summary clauses we can execute without provider planning. */
function explicitOrderSummaryLookup(message: string): string | null {
  const match = /^(?:please\s+)?(?:show(?:\s+me)?|find|look\s*up|get|search\s+for|summari[sz]e|tell\s+me\s+about|give\s+me\s+(?:(?:a|an)\s+)?(?:summary|overview)\s+of|what\s+is)\s+(?:the\s+)?order(?:\s+number)?\s*(?:[:#]\s*)?((?:ord[-\s]?)?\d{1,18})(?:\s+and\s+(?:summari[sz]e(?:\s+it)?|tell\s+me\s+about\s+it|give\s+me\s+(?:a\s+)?summary(?:\s+of\s+it)?))?[.?!]*$/i.exec(message.trim());
  return match?.[1] ?? null;
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

  const explicitOrderNumber = explicitOrderSummaryLookup(normalized);
  if (explicitOrderNumber) {
    const orderNumber = canonicalOrderNumberLookup(explicitOrderNumber);
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

  const completedJobs = completedJobsReadPlan(normalized);
  if (completedJobs) return completedJobs;

  const orderDue = orderDueReadPlan(normalized);
  if (orderDue) return orderDue;

  const production = productionReadPlan(normalized);
  if (production) return production;

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
