/**
 * Bounded, server-derived continuity state for one Operator task. It is not
 * an authority to read or mutate: every later tool still receives the current
 * tenant, principal, and permissions at its normal server boundary.
 */
export const operatorConversationResourceTypes = [
  "customer", "contact", "order", "order_line", "production_job",
  "fulfillment", "pickup_activity", "shipment", "quote", "product", "invoice",
] as const;

export type OperatorConversationResourceType = (typeof operatorConversationResourceTypes)[number];
export type OperatorConversationResource = {
  type: OperatorConversationResourceType;
  id: string;
  label?: string;
};
export type OperatorConversationResourceContext = {
  resources: OperatorConversationResource[];
  capturedAt: string;
};
export type PendingOperatorActionContext = {
  action: "fulfillment_pickup";
  order: OperatorConversationResource | null;
  orderLine: OperatorConversationResource | null;
  fulfillment: OperatorConversationResource | null;
  quantity: number | null;
  timing: "today" | null;
  confirmation: "none" | "awaiting_binary_confirmation" | "confirmed";
};

type Observation = {
  toolName: string;
  status: string;
  result?: { data?: unknown; provenance?: { sourceLinks?: unknown[] } };
};

const resourceTypeSet = new Set<string>(operatorConversationResourceTypes);
const maxResources = 20;
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const safeLabel = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : undefined;

function resource(value: unknown): OperatorConversationResource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = record.type ?? record.entityType;
  const id = record.id ?? record.entityId;
  if (typeof type !== "string" || !resourceTypeSet.has(type) || !safeId(id)) return null;
  return { type: type as OperatorConversationResourceType, id, ...(safeLabel(record.label) ? { label: safeLabel(record.label) } : {}) };
}

function collectResources(value: unknown, output: OperatorConversationResource[], visited = new Set<unknown>(), depth = 0) {
  if (depth > 8 || output.length >= maxResources || !value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  const found = resource(value);
  if (found && !output.some((item) => item.type === found.type && item.id === found.id)) output.push(found);
  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, output, visited, depth + 1);
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) collectResources(child, output, visited, depth + 1);
}

function isAmbiguousOrderLookup(observation: Observation): boolean {
  if (observation.toolName !== "investigation.search" || observation.status !== "succeeded") return false;
  const data = observation.result?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const matches = (data as { matches?: unknown }).matches;
  return Array.isArray(matches)
    && matches.filter((match) => resource(match && typeof match === "object" ? (match as { resource?: unknown }).resource : null)?.type === "order").length > 1;
}

/** Extract only canonical resource references from validated tool output. */
export function resourcesFromOperatorObservations(observations: readonly Observation[]): OperatorConversationResource[] {
  const output: OperatorConversationResource[] = [];
  for (const observation of observations) {
    if (observation.status !== "succeeded" && observation.status !== "partial") continue;
    collectResources(observation.result?.data, output);
    collectResources(observation.result?.provenance?.sourceLinks, output);
  }
  return output.slice(-maxResources);
}

function contextBoundResource(resourceValue: OperatorConversationResource) {
  return ["order", "order_line", "production_job", "fulfillment", "pickup_activity", "shipment"].includes(resourceValue.type);
}

/** A new unambiguous Order begins a new subject; an ambiguous Order search
 * clears subject context rather than accidentally retaining the old Order. */
export function mergeOperatorConversationResourceContext(
  prior: OperatorConversationResourceContext | null,
  observations: readonly Observation[],
  capturedAt: string,
): OperatorConversationResourceContext | null {
  if (observations.some(isAmbiguousOrderLookup)) return null;
  const additions = resourcesFromOperatorObservations(observations);
  if (!additions.length) return prior;
  const incomingOrders = additions.filter((item) => item.type === "order");
  const distinctOrders = Array.from(new Set(incomingOrders.map((item) => item.id)));
  if (distinctOrders.length > 1) return null;
  const priorOrder = uniqueResource(prior, "order");
  const changedOrder = distinctOrders.length === 1 && priorOrder?.id !== distinctOrders[0];
  const retained = changedOrder ? (prior?.resources ?? []).filter((item) => !contextBoundResource(item)) : (prior?.resources ?? []);
  const values = new Map<string, OperatorConversationResource>();
  for (const item of [...retained, ...additions]) values.set(`${item.type}:${item.id}`, item);
  return { resources: Array.from(values.values()).slice(-maxResources), capturedAt };
}

export function uniqueResource(context: OperatorConversationResourceContext | null | undefined, type: OperatorConversationResourceType): OperatorConversationResource | null {
  const matches = (context?.resources ?? []).filter((item) => item.type === type);
  return matches.length === 1 ? matches[0]! : null;
}

function positiveQuantity(message: string): number | null {
  const candidates = [...message.matchAll(/\b(\d{1,7})\s*(?:pieces?|signs?|items?)?\b/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return candidates.at(-1) ?? null;
}

function requestsPickup(message: string): boolean {
  return /\b(?:add|record|enter|log)\b[\s\S]{0,80}\bpickup\b|\banother\s+pickup\b/i.test(message);
}

export function isAffirmativeAssistantReply(message: string): boolean {
  return /^\s*(?:yes|yep|yeah|confirm|confirmed|correct)\b[\s.!]*$/i.test(message);
}

/**
 * This is intentionally a non-executable intent. It retains only explicit
 * user language plus already-resolved canonical references so a later turn
 * can prepare the right action without inventing fulfillment behavior.
 */
export function derivePendingOperatorActionContext(input: {
  message: string;
  resources: OperatorConversationResourceContext | null;
  prior: PendingOperatorActionContext | null;
}): PendingOperatorActionContext | null {
  const { message, resources, prior } = input;
  if (isAffirmativeAssistantReply(message) && prior?.confirmation === "awaiting_binary_confirmation") {
    return { ...prior, confirmation: "confirmed" };
  }
  if (!requestsPickup(message)) return prior;
  return {
    action: "fulfillment_pickup",
    order: uniqueResource(resources, "order"),
    orderLine: uniqueResource(resources, "order_line"),
    fulfillment: uniqueResource(resources, "fulfillment"),
    quantity: positiveQuantity(message),
    timing: /\btoday\b/i.test(message) ? "today" : null,
    confirmation: "none",
  };
}

export function pendingActionWithClarification(
  action: PendingOperatorActionContext | null,
  clarification: "binary_confirmation" | "single_field" | null | undefined,
): PendingOperatorActionContext | null {
  if (!action) return null;
  return clarification === "binary_confirmation" ? { ...action, confirmation: "awaiting_binary_confirmation" } : action;
}

export function pendingActionForCurrentResources(
  action: PendingOperatorActionContext | null,
  resources: OperatorConversationResourceContext | null,
): PendingOperatorActionContext | null {
  if (!action) return null;
  const order = uniqueResource(resources, "order");
  return action.order && order && action.order.id !== order.id ? null : action;
}
