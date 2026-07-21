import { assistantProviderPlanSchema, type AssistantProviderPlan } from "@shared/assistantContracts";

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
  return message.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
}

function readNavigationQuestion(message: string): boolean {
  return /\bwhat\s+(?:page|screen|record)\s+(?:am\s+i|are\s+we)\s+(?:currently\s+)?viewing\b/i.test(message)
    || /\bwhat(?:'s| is)\s+(?:the\s+)?current(?:ly)?\s+(?:open\s+)?(?:page|screen|record)\b/i.test(message);
}

/**
 * Identifiers and names are capped before they ever become tool arguments.
 * This makes a deterministic path no more permissive than the registry's
 * normal Zod validation while avoiding fragile provider parsing for common
 * exact lookups.
 */
function exactLookup(message: string): { kind: "order" | "quote" | "product" | "customer"; value: string } | null {
  const match = /^(?:please\s+)?(?:find|show|look\s*up|get|search\s+for)\s+(?:the\s+)?(order|quote|product|customer)\s*(?:number|named|called)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,159})\??$/i.exec(message.trim());
  if (!match) return null;
  const kind = match[1]!.toLowerCase() as "order" | "quote" | "product" | "customer";
  const value = match[2]!.trim();
  if (!value) return null;
  return { kind, value };
}

export function resolveDeterministicReadPlan(message: string): AssistantProviderPlan | null {
  const normalized = normalizedMessage(message);
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
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(lookup.value)) return null;
    return plan({
      intent: "lookup",
      selectedSkill: "deterministic_order_lookup",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: lookup.value } }],
      clarificationRequired: false,
      clarificationQuestion: null,
      responseStyle: "concise",
    });
  }

  // The static Stage 2 registry intentionally has no quote-summary tool.
  // A bounded tenant-scoped search is its registered read-only lookup path for
  // quotes, customer names, and product names.  It retains links, limits, and
  // normal audit records without inventing a new tool.
  return plan({
    intent: "lookup",
    selectedSkill: `deterministic_${lookup.kind}_lookup`,
    toolCalls: [{ toolName: "search.global", arguments: { query: lookup.value, limit: 5 } }],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });
}
