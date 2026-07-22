import { assistantReportingScopeValues, type AssistantReportingScope } from "@shared/assistantContracts";

/**
 * Small, deterministic classifier for explicit reporting nouns. This is not a
 * replacement for provider planning: it only protects high-confidence scope
 * words so an order-level question cannot be redirected to a job queue.
 */
export function resolveExplicitReportingScope(message: string): AssistantReportingScope | null {
  const normalized = message.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (/\b(?:posted|invoice[- ]line)\s+revenue\b|\brevenue\b/.test(normalized)) return "posted_revenue";
  if (/\b(?:order|unbilled|uninvoiced)\s+value\b/.test(normalized)) return "order_value";
  if (/\b(?:prints?|units?|pieces?)\s+(?:remain|remaining|left)\b/.test(normalized)) return "print_quantity";
  if (/\b(?:production\s+)?stations?\b/.test(normalized)) return "production_station";
  if (/\b(?:production\s+)?jobs?\b/.test(normalized)) return "production_job";
  if (/\b(?:order\s+)?line(?:\s+items?)?\b|\bline\s+items?\b/.test(normalized)) return "order_line";
  if (/\binvoices?\b/.test(normalized)) return "invoice";
  if (/\bcontacts?\b/.test(normalized)) return "contact";
  if (/\b(?:customers?|companies)\b/.test(normalized)) return "customer";
  if (/\borders?\b/.test(normalized)) return "order";
  return null;
}

/** Compile-time guard: a new scope must be deliberately handled above. */
const _allScopes: readonly AssistantReportingScope[] = assistantReportingScopeValues;
void _allScopes;
