import React, { useEffect, useMemo, useState } from "react";
import { fulfillmentApi, newBusinessRequestId, shipmentEconomicsApi, shippingPricingApi, type ApiError, type FulfillmentShipmentCarrierInput, type FulfillmentShipmentContainer, type FulfillmentShipmentDetail, type FulfillmentWorkspaceOrder, type ReplacementObligationProjection, type ShippingPricingPolicyRead, type StaffShipmentEconomics } from "./api";

type IntentEnvelope<O extends string, P> = Readonly<{ version: 1; organizationId: string; sessionScope: string; businessRequestId: string; operation: O; payload: P; bodyCanonical: string; recovery: "retry" | "stale" }>;
export type FulfillmentIntent =
  | IntentEnvelope<"fulfillment-pickup", { orderId: string; method: "pickup" | "shipment"; orderLineId: string; quantity: number }>
  | IntentEnvelope<"replacement-create", { orderId: string; input: Parameters<typeof fulfillmentApi.createReplacement>[3] }>
  | IntentEnvelope<"replacement-cancel", { replacementObligationId: string }>
  | IntentEnvelope<"replacement-pickup", { orderId: string; input: Parameters<typeof fulfillmentApi.pickupReplacement>[3] }>
  | IntentEnvelope<"shipment-create", { input: Parameters<typeof fulfillmentApi.createShipment>[2] }>
  | IntentEnvelope<"shipment-correct", { shipmentId: string; input: Parameters<typeof fulfillmentApi.correctShipment>[3] }>
  | IntentEnvelope<"shipment-cancel", { shipmentId: string; reason: string }>
  | IntentEnvelope<"shipment-finalize", { shipmentId: string; expectedPreparedRevisionId: string }>;
type FulfillmentIntentDraft = FulfillmentIntent extends infer T ? T extends FulfillmentIntent ? Omit<T, "version" | "organizationId" | "sessionScope" | "businessRequestId" | "bodyCanonical" | "recovery"> : never : never;
type FulfillmentIntentState =
  | Readonly<{ kind: "checking" | "ready"; command?: never; message?: never }>
  | Readonly<{ kind: "blocked"; reason: "invalid" | "scope" | "storage" | "authentication"; command?: never; message: string }>
  | Readonly<{ kind: "pending"; command: FulfillmentIntent; message?: string }>;
const intentEvent = "v2:fulfillment-intent-changed";
const intentKey = (organizationId: string) => `ph.v2.fulfillment.intent.v1:${encodeURIComponent(organizationId)}`;
const intentOperations = ["fulfillment-pickup", "replacement-create", "replacement-cancel", "replacement-pickup", "shipment-create", "shipment-correct", "shipment-cancel", "shipment-finalize"] as const;
const reloadRequiredByKey = new Map<string, Readonly<{ sessionScope: string; businessRequestId: string }>>();
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value as JsonRecord : undefined;
const hasExactKeys = (value: JsonRecord, required: readonly string[], optional: readonly string[] = []) => {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => allowed.has(key));
};
const text = (value: unknown, max = 1000) => typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= max;
const optionalText = (value: JsonRecord, key: string, max = 1000) => !Object.prototype.hasOwnProperty.call(value, key) || text(value[key], max);
const positiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const id = (value: unknown) => text(value, 500);
const isCanonicalJson = (value: unknown, depth = 0): string | undefined => {
  if (depth > 24) return undefined;
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (Array.isArray(value)) {
    const items = value.map(item => isCanonicalJson(item, depth + 1));
    return items.some(item => item === undefined) ? undefined : `[${items.join(",")}]`;
  }
  const object = record(value);
  if (!object) return undefined;
  const entries: string[] = [];
  for (const key of Object.keys(object).sort()) {
    const item = isCanonicalJson(object[key], depth + 1);
    if (item === undefined) return undefined;
    entries.push(`${JSON.stringify(key)}:${item}`);
  }
  return `{${entries.join(",")}}`;
};
const canonicalIntentBody = (organizationId: string, sessionScope: string, operation: string, businessRequestId: string, payload: unknown) => isCanonicalJson({ organizationId, sessionScope, operation, businessRequestId, payload });
const validCarrier = (value: unknown) => {
  const carrier = record(value);
  if (!carrier || !hasExactKeys(carrier, [], ["carrierName", "carrierService", "trackingNumber", "notes", "packageCount"])) return false;
  if (!["carrierName", "carrierService", "trackingNumber", "notes"].every(key => optionalText(carrier, key, 5000))) return false;
  return !Object.prototype.hasOwnProperty.call(carrier, "packageCount") || positiveInteger(carrier.packageCount);
};
const validDestination = (value: unknown) => {
  const destination = record(value);
  const fields = ["recipient", "company", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "phone"] as const;
  if (!destination || !hasExactKeys(destination, ["addressLine1", "city"], fields.filter(field => field !== "addressLine1" && field !== "city"))) return false;
  return text(destination.addressLine1, 500) && text(destination.city, 500) && fields.filter(field => field !== "addressLine1" && field !== "city").every(field => optionalText(destination, field, 500));
};
const validAllocations = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) return false;
  const seen = new Set<string>();
  for (const item of value) {
    const allocation = record(item);
    if (!allocation || !hasExactKeys(allocation, ["orderId", "orderLineId", "quantity"], ["replacementObligationId"]) || !id(allocation.orderId) || !id(allocation.orderLineId) || !positiveInteger(allocation.quantity) || !optionalText(allocation, "replacementObligationId", 500)) return false;
    const key = `${allocation.orderId}\u0000${allocation.orderLineId}\u0000${allocation.replacementObligationId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};
const replacementReasons = new Set(["production_delay", "print_defect", "finishing_defect", "wrong_material", "transit_damage", "lost_in_transit", "customer_rejection", "customer_change", "internal_shipping_error", "carrier_issue", "other"]);
const validPayload = (operation: string, value: unknown): boolean => {
  const payload = record(value);
  if (!payload) return false;
  switch (operation) {
    case "fulfillment-pickup":
      return hasExactKeys(payload, ["orderId", "method", "orderLineId", "quantity"]) && id(payload.orderId) && (payload.method === "pickup" || payload.method === "shipment") && id(payload.orderLineId) && positiveInteger(payload.quantity);
    case "replacement-create": {
      const input = record(payload.input);
      return hasExactKeys(payload, ["orderId", "input"]) && id(payload.orderId) && Boolean(input) && hasExactKeys(input!, ["orderLineId", "replacementQuantity", "reason", "responsibility", "billingTreatment"], ["note"]) && id(input!.orderLineId) && positiveInteger(input!.replacementQuantity) && typeof input!.reason === "string" && replacementReasons.has(input!.reason) && ["titan", "customer", "carrier", "pending"].includes(String(input!.responsibility)) && ["no_charge", "billable"].includes(String(input!.billingTreatment)) && optionalText(input!, "note", 5000);
    }
    case "replacement-cancel":
      return hasExactKeys(payload, ["replacementObligationId"]) && id(payload.replacementObligationId);
    case "replacement-pickup": {
      const input = record(payload.input);
      return hasExactKeys(payload, ["orderId", "input"]) && id(payload.orderId) && Boolean(input) && hasExactKeys(input!, ["replacementObligationId", "orderLineId", "quantity"]) && id(input!.replacementObligationId) && id(input!.orderLineId) && positiveInteger(input!.quantity);
    }
    case "shipment-create": {
      const input = record(payload.input);
      if (!hasExactKeys(payload, ["input"]) || !input || !hasExactKeys(input, ["allocations"], ["customerId", "destination", "carrier"]) || !validAllocations(input.allocations)) return false;
      return optionalText(input, "customerId", 500) && (!Object.prototype.hasOwnProperty.call(input, "destination") || validDestination(input.destination)) && (!Object.prototype.hasOwnProperty.call(input, "carrier") || validCarrier(input.carrier));
    }
    case "shipment-correct": {
      const input = record(payload.input);
      return hasExactKeys(payload, ["shipmentId", "input"]) && id(payload.shipmentId) && Boolean(input) && hasExactKeys(input!, ["allocations", "reason"], ["carrier"]) && validAllocations(input!.allocations) && text(input!.reason, 5000) && (!Object.prototype.hasOwnProperty.call(input!, "carrier") || validCarrier(input!.carrier));
    }
    case "shipment-cancel":
      return hasExactKeys(payload, ["shipmentId", "reason"]) && id(payload.shipmentId) && text(payload.reason, 5000);
    case "shipment-finalize":
      return hasExactKeys(payload, ["shipmentId", "expectedPreparedRevisionId"]) && id(payload.shipmentId) && id(payload.expectedPreparedRevisionId);
    default:
      return false;
  }
};
const isFulfillmentIntentRecord = (value: unknown, organizationId: string, sessionScope: string): value is FulfillmentIntent => {
  const command = record(value);
  if (!command || !hasExactKeys(command, ["version", "organizationId", "sessionScope", "businessRequestId", "operation", "payload", "bodyCanonical", "recovery"])) return false;
  if (command.version !== 1 || command.organizationId !== organizationId || command.sessionScope !== sessionScope || typeof command.businessRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.businessRequestId)) return false;
  if (typeof command.operation !== "string" || !intentOperations.includes(command.operation as typeof intentOperations[number]) || (command.recovery !== "retry" && command.recovery !== "stale")) return false;
  if (command.recovery === "stale" && command.operation !== "shipment-finalize") return false;
  const bodyCanonical = canonicalIntentBody(organizationId, sessionScope, command.operation, command.businessRequestId, command.payload);
  return bodyCanonical !== undefined && bodyCanonical.length <= 100_000 && command.bodyCanonical === bodyCanonical && validPayload(command.operation, command.payload);
};

export const validateFulfillmentIntentRecord = (value: unknown, organizationId: string, sessionScope: string): value is FulfillmentIntent => isFulfillmentIntentRecord(value, organizationId, sessionScope);
export const canonicalFulfillmentIntentBody = canonicalIntentBody;

const readIntent = (organizationId: string, sessionScope: string): FulfillmentIntentState => {
  if (typeof window === "undefined") return { kind: "ready" };
  const key = intentKey(organizationId);
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored === null) return reloadRequiredByKey.has(key) ? { kind: "blocked", reason: "storage", message: "A stale shipment request is guarded in this tab but its recovery marker is unavailable. Do not start another physical operation." } : { kind: "ready" };
    let value: unknown;
    try { value = JSON.parse(stored); } catch { return { kind: "blocked", reason: "invalid", message: "Saved fulfillment recovery data is invalid. No retry or new physical operation is available until an operator resolves it." }; }
    const envelope = record(value);
    if (envelope?.organizationId === organizationId && typeof envelope.sessionScope === "string" && envelope.sessionScope !== sessionScope) return { kind: "blocked", reason: "scope", message: "An unresolved fulfillment operation belongs to a different authenticated session. No saved details are shown and no new operation will be submitted." };
    if (!isFulfillmentIntentRecord(value, organizationId, sessionScope)) return { kind: "blocked", reason: "invalid", message: "Saved fulfillment recovery data failed operation-specific validation. No retry or new physical operation is available until an operator resolves it." };
    const command = value;
    const localGuard = reloadRequiredByKey.get(key);
    const guarded = localGuard?.sessionScope === sessionScope && localGuard.businessRequestId === command.businessRequestId ? { ...command, recovery: "stale" as const } : command;
    return { kind: "pending", command: guarded };
  } catch {
    return { kind: "blocked", reason: "storage", message: "Fulfillment recovery storage is unavailable. No new physical operation will be submitted." };
  }
};

/** Retains one exact tenant/session-bound command in this tab until its owner returns a receipt. */
export const useFulfillmentIntent = (organizationId: string, sessionScope: string) => {
  const key = organizationId ? intentKey(organizationId) : "";
  const [saved, setSaved] = useState<Readonly<{ key: string; sessionScope: string; state: FulfillmentIntentState }>>(() => ({ key, sessionScope, state: typeof window === "undefined" ? { kind: "ready" } : organizationId && sessionScope ? readIntent(organizationId, sessionScope) : { kind: "blocked", reason: "authentication", message: "An authenticated fulfillment session is required." } }));
  useEffect(() => {
    const reload = () => setSaved({ key, sessionScope, state: organizationId && sessionScope ? readIntent(organizationId, sessionScope) : { kind: "blocked", reason: "authentication", message: "An authenticated fulfillment session is required." } });
    reload();
    window.addEventListener(intentEvent, reload);
    return () => window.removeEventListener(intentEvent, reload);
  }, [key, organizationId, sessionScope]);
  const state = saved.key === key && saved.sessionScope === sessionScope ? saved.state : { kind: "checking" as const };
  const begin = (draft: FulfillmentIntentDraft): FulfillmentIntent | undefined => {
    if (!organizationId || !sessionScope || state.kind !== "ready" || typeof window === "undefined") return undefined;
    const current = readIntent(organizationId, sessionScope);
    if (current.kind !== "ready") { setSaved({ key, sessionScope, state: current }); return undefined; }
    try {
      const draftRecord = record(draft);
      if (!draftRecord || !hasExactKeys(draftRecord, ["operation", "payload"]) || typeof draftRecord.operation !== "string" || !intentOperations.includes(draftRecord.operation as typeof intentOperations[number])) return undefined;
      const serializedPayload = JSON.stringify(draft.payload);
      if (!serializedPayload || serializedPayload.length > 100_000) return undefined;
      const payload = JSON.parse(serializedPayload) as unknown;
      if (!isCanonicalJson(payload) || !validPayload(draft.operation, payload)) return undefined;
      const businessRequestId = newBusinessRequestId();
      const commandBodyCanonical = canonicalIntentBody(organizationId, sessionScope, draft.operation, businessRequestId, payload);
      if (!commandBodyCanonical || commandBodyCanonical.length > 100_000) return undefined;
      const candidate = { version: 1, organizationId, sessionScope, businessRequestId, ...draft, payload, bodyCanonical: commandBodyCanonical, recovery: "retry" };
      if (!isFulfillmentIntentRecord(candidate, organizationId, sessionScope)) return undefined;
      const command: FulfillmentIntent = candidate;
      const serialized = JSON.stringify(command);
      window.sessionStorage.setItem(key, serialized);
      setSaved({ key, sessionScope, state: { kind: "pending", command } });
      window.dispatchEvent(new window.Event(intentEvent));
      return command;
    } catch {
      setSaved({ key, sessionScope, state: { kind: "blocked", reason: "storage", message: "Fulfillment recovery storage is unavailable. The operation was not submitted." } });
      return undefined;
    }
  };
  const isSendable = (command: FulfillmentIntent): boolean => {
    if (command.recovery !== "retry" || command.organizationId !== organizationId || command.sessionScope !== sessionScope) return false;
    const current = readIntent(organizationId, sessionScope);
    if (current.kind === "pending" && current.command.recovery === "retry" && current.command.businessRequestId === command.businessRequestId && current.command.operation === command.operation && current.command.bodyCanonical === command.bodyCanonical && isFulfillmentIntentRecord(command, organizationId, sessionScope)) return true;
    setSaved({ key, sessionScope, state: current.kind === "ready" ? { kind: "blocked", reason: "invalid", message: "The saved request no longer matches this operation. No request was sent; recover the owner state before continuing." } : current });
    return false;
  };
  const requireAuthoritativeReload = (command: FulfillmentIntent): FulfillmentIntent | undefined => {
    if (command.operation !== "shipment-finalize" || command.recovery !== "retry" || command.organizationId !== organizationId || command.sessionScope !== sessionScope) return undefined;
    const current = readIntent(organizationId, sessionScope);
    if (current.kind !== "pending" || current.command.recovery !== "retry" || current.command.businessRequestId !== command.businessRequestId || current.command.bodyCanonical !== command.bodyCanonical) return undefined;
    const guarded = { ...current.command, recovery: "stale" as const };
    reloadRequiredByKey.set(key, { sessionScope, businessRequestId: command.businessRequestId });
    setSaved({ key, sessionScope, state: { kind: "pending", command: guarded, message: "A stale revision requires an authoritative reload before any physical command can run." } });
    try {
      window.sessionStorage.setItem(key, JSON.stringify(guarded));
      window.dispatchEvent(new window.Event(intentEvent));
    } catch {
      setSaved({ key, sessionScope, state: { kind: "pending", command: guarded, message: "The stale-revision reload guard could not be persisted. Keep this tab open and retry the authoritative reload; no side-effect command is enabled." } });
    }
    return guarded;
  };
  const isReloadRequired = (command: FulfillmentIntent): boolean => {
    if (command.operation !== "shipment-finalize" || command.recovery !== "stale" || command.organizationId !== organizationId || command.sessionScope !== sessionScope) return false;
    const current = readIntent(organizationId, sessionScope);
    return current.kind === "pending" && current.command.recovery === "stale" && current.command.businessRequestId === command.businessRequestId && current.command.bodyCanonical === command.bodyCanonical;
  };
  const invalidStorageSnapshot = (): string | undefined => {
    if (state.kind !== "blocked" || state.reason !== "invalid" || typeof window === "undefined") return undefined;
    try { return window.sessionStorage.getItem(key) ?? undefined; } catch { return undefined; }
  };
  const resolveInvalidAfterOperatorRecovery = (expectedStoredValue: string): boolean => {
    if (!organizationId || typeof window === "undefined") return false;
    try {
      if (window.sessionStorage.getItem(key) !== expectedStoredValue) return false;
      const current = readIntent(organizationId, sessionScope);
      if (current.kind !== "blocked" || current.reason !== "invalid") return false;
      window.sessionStorage.removeItem(key);
      reloadRequiredByKey.delete(key);
      setSaved({ key, sessionScope, state: { kind: "ready" } });
      window.dispatchEvent(new window.Event(intentEvent));
      return true;
    } catch {
      setSaved({ key, sessionScope, state: { kind: "blocked", reason: "storage", message: "The invalid recovery marker could not be cleared. No new operation is allowed." } });
      return false;
    }
  };
  const settle = (command: FulfillmentIntent): boolean => {
    if (!organizationId || typeof window === "undefined" || command.recovery !== "retry" || command.organizationId !== organizationId || command.sessionScope !== sessionScope) return false;
    try {
      const current = readIntent(organizationId, sessionScope);
      if (current.kind !== "pending" || current.command.recovery !== "retry" || current.command.businessRequestId !== command.businessRequestId || current.command.bodyCanonical !== command.bodyCanonical) return false;
      window.sessionStorage.removeItem(key);
      setSaved({ key, sessionScope, state: { kind: "ready" } });
      window.dispatchEvent(new window.Event(intentEvent));
      return true;
    } catch {
      setSaved({ key, sessionScope, state: { kind: "blocked", reason: "storage", message: "The owner returned a result, but fulfillment recovery storage could not be cleared. Retry the same intent before starting another operation." } });
      return false;
    }
  };
  const settleAfterReload = (command: FulfillmentIntent, currentRevisionId: string): boolean => {
    if (!organizationId || typeof window === "undefined" || command.operation !== "shipment-finalize" || command.recovery !== "stale" || command.organizationId !== organizationId || command.sessionScope !== sessionScope || !id(currentRevisionId) || currentRevisionId === command.payload.expectedPreparedRevisionId) return false;
    try {
      const current = readIntent(organizationId, sessionScope);
      if (current.kind !== "pending" || current.command.recovery !== "stale" || current.command.businessRequestId !== command.businessRequestId || current.command.bodyCanonical !== command.bodyCanonical) return false;
      window.sessionStorage.removeItem(key);
      reloadRequiredByKey.delete(key);
      setSaved({ key, sessionScope, state: { kind: "ready" } });
      window.dispatchEvent(new window.Event(intentEvent));
      return true;
    } catch {
      setSaved({ key, sessionScope, state: { kind: "pending", command, message: "A newer revision was loaded, but the guard could not be cleared. Reload or resolve this intent before sending another command." } });
      return false;
    }
  };
  return { state, begin, isSendable, requireAuthoritativeReload, isReloadRequired, invalidStorageSnapshot, resolveInvalidAfterOperatorRecovery, settle, settleAfterReload };
};

type Selection = Readonly<{ orderId: string; orderNumber: string; orderLineId: string; description: string; available: number; unresolved?: boolean; replacementObligationId?: string; customerId?: string; destination?: unknown; quantity: string }>;
type SelectionByKey = Readonly<Record<string, Selection>>;
const keyOf = (orderId: string, lineId: string, replacementObligationId?: string) => `${orderId}:${lineId}:${replacementObligationId ?? "original"}`;
const message = (error: unknown) => (error as ApiError | undefined)?.message ?? "The shipment operation could not be completed.";
export const shipmentQuantityValid = (quantity: string, available: number) => Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= available;
export const groupShipmentAllocations = (items: readonly Readonly<{ orderId: string; orderLineId: string; quantity: string; replacementObligationId?: string }>[]) => items.map(item => ({ orderId: item.orderId, orderLineId: item.orderLineId, quantity: Number(item.quantity), ...(item.replacementObligationId ? { replacementObligationId:item.replacementObligationId } : {}) }));
const carrierInput = (carrierName: string, carrierService: string, trackingNumber: string, notes: string, packageCount: string): FulfillmentShipmentCarrierInput => ({
  ...(carrierName.trim() ? { carrierName: carrierName.trim() } : {}),
  ...(carrierService.trim() ? { carrierService: carrierService.trim() } : {}),
  ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
  ...(notes.trim() ? { notes: notes.trim() } : {}),
  ...(packageCount.trim() ? { packageCount: Number(packageCount) } : {}),
});

/**
 * Bounded shipment composer. It collects operator intent only: the server
 * persists prepared allocations and validates quantity atomically. It never
 * represents a customer handoff or a shipment until canonical finalization
 * can create both facts in one server-owned transaction.
 */
export const ShipmentBuilder = ({ organizationId, sessionScope, csrfReady, canShip, canReplace = false, canManageShippingCost = false, canManageShippingPrice = false, orders, replacementCandidates = [], refresh }: { organizationId: string; sessionScope: string; csrfReady: boolean; canShip: boolean; canReplace?: boolean; canManageShippingCost?:boolean; canManageShippingPrice?:boolean; orders: readonly FulfillmentWorkspaceOrder[]; replacementCandidates?: readonly ReplacementObligationProjection[]; refresh: () => Promise<void> }) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<SelectionByKey>({});
  const [shipment, setShipment] = useState<FulfillmentShipmentDetail>();
  const [shipments, setShipments] = useState<readonly FulfillmentShipmentContainer[]>([]);
  const [carrierName, setCarrierName] = useState(""); const [carrierService, setCarrierService] = useState(""); const [trackingNumber, setTrackingNumber] = useState(""); const [notes, setNotes] = useState(""); const [packageCount, setPackageCount] = useState(""); const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"create" | "correct" | "cancel" | "finalize" | "load" | undefined>();
  const [dirty, setDirty] = useState(false);
  const [revisionDirty, setRevisionDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const intent = useFulfillmentIntent(organizationId, sessionScope);
  const identityKey = JSON.stringify([organizationId, sessionScope]);
  const [ownerRefresh, setOwnerRefresh] = useState<Readonly<{ identityKey: string; storedValue?: string }>>({ identityKey: "" });
  const ownerRefreshMatchesCurrent = ownerRefresh.identityKey === identityKey && ownerRefresh.storedValue !== undefined;
  const selections = useMemo(() => Object.values(selected), [selected]);
  const prepared = shipment?.status === "prepared";
  const readOnly = Boolean(shipment && !prepared);
  const hasReplacement = selections.some(selection=>Boolean(selection.replacementObligationId));
  const intentLocked = intent.state.kind !== "ready";
  const editable = canShip && csrfReady && !pending && !readOnly && !intentLocked && (!hasReplacement || canReplace);
  const metadata = () => carrierInput(carrierName, carrierService, trackingNumber, notes, packageCount);
  const allocations = () => groupShipmentAllocations(selections);
  const valid = selections.length > 0 && selections.every(item => shipmentQuantityValid(item.quantity, item.available));
  const resetForm = () => { setShipment(undefined); setSelected({}); setCarrierName(""); setCarrierService(""); setTrackingNumber(""); setNotes(""); setPackageCount(""); setReason(""); setDirty(false); setRevisionDirty(false); setNotice(""); };
  const restore = (detail: FulfillmentShipmentDetail) => {
    const restored: Record<string, Selection> = {};
    for (const allocation of detail.currentPreparedRevision?.allocations ?? []) {
      const order = orders.find(item => item.orderId === allocation.orderId); const line = order?.lines.find(item => item.orderLineId === allocation.orderLineId);
      const key = keyOf(allocation.orderId, allocation.orderLineId, allocation.replacementObligationId);
      // Prepared allocations are proposed work, not completed fulfillment.
      // Current availability is a UI guard only; correction validation is
      // repeated atomically by the server at save/finalization time.
      const replacement = allocation.replacementObligationId ? replacementCandidates.find(candidate=>candidate.obligation.replacementObligationId===allocation.replacementObligationId) : undefined;
      const unresolved = !order || !line || Boolean(allocation.replacementObligationId && !replacement);
      restored[key] = { orderId: allocation.orderId, orderNumber: order?.number ?? allocation.orderId, orderLineId: allocation.orderLineId, description: line?.description ?? "Order line unavailable in the current workspace", available: unresolved ? 0 : replacement?.remainingFulfillmentQuantity ?? line!.availableFulfillmentQuantity, ...(unresolved ? { unresolved: true } : {}), ...(allocation.replacementObligationId ? {replacementObligationId:allocation.replacementObligationId}:{}), ...(order?.customerId ? { customerId: order.customerId } : {}), ...(order?.requestedFulfillment?.destination ? { destination: order.requestedFulfillment.destination } : {}), quantity: String(allocation.quantity) };
    }
    const carrier = detail.currentPreparedRevision?.carrier ?? detail.carrier;
    setShipment(detail); setSelected(restored); setCarrierName(carrier.carrierName ?? ""); setCarrierService(carrier.carrierService ?? ""); setTrackingNumber(carrier.trackingNumber ?? ""); setNotes(carrier.notes ?? ""); setPackageCount(carrier.packageCount === undefined ? "" : String(carrier.packageCount)); setReason(""); setDirty(false); setRevisionDirty(false);
  };
  const loadShipments = async () => { setPending("load"); try { setShipments(await fulfillmentApi.listShipments(organizationId)); const storedValue = intent.invalidStorageSnapshot(); if (storedValue !== undefined) { setOwnerRefresh({ identityKey, storedValue }); setNotice("Owner shipment records refreshed. Verify the affected operation with its authoritative owner before explicitly resolving the invalid local marker."); } } catch (error) { setNotice(message(error)); } finally { setPending(undefined); } };
  const resolveInvalidIntent = () => {
    if (!ownerRefreshMatchesCurrent || ownerRefresh.storedValue === undefined || intent.state.kind !== "blocked" || intent.state.reason !== "invalid") return;
    if (!window.confirm("Only continue after verifying the affected Pickup, replacement, or shipment with its authoritative owner. This clears the unusable local request marker but does not change server state.")) return;
    if (intent.resolveInvalidAfterOperatorRecovery(ownerRefresh.storedValue)) {
      setOwnerRefresh({ identityKey });
      setNotice("The invalid local marker was cleared after explicit operator resolution. No operation was submitted; review current owner state before starting a new intent.");
    }
  };
  useEffect(() => { if (expanded && intent.state.kind !== "blocked" && intent.state.kind !== "checking") void loadShipments(); }, [expanded, organizationId, intent.state.kind]);
  const setQuantity = (key: string, quantity: string) => { if (pending || intent.state.kind !== "ready" || readOnly) return; setSelected(current => current[key] ? { ...current, [key]: { ...current[key]!, quantity } } : current); if (prepared) { setDirty(true); setRevisionDirty(true); } };
   const toggle = (order: FulfillmentWorkspaceOrder, line: FulfillmentWorkspaceOrder["lines"][number], replacement?: ReplacementObligationProjection) => {
      if (readOnly || pending || intent.state.kind !== "ready") return; const key = keyOf(order.orderId, line.orderLineId,replacement?.obligation.replacementObligationId),available=replacement?.remainingFulfillmentQuantity??line.availableFulfillmentQuantity;
      setSelected(current => { if (current[key]) { const { [key]: _removed, ...rest } = current; return rest; } return { ...current, [key]: { orderId: order.orderId, orderNumber: order.number, orderLineId: line.orderLineId, description: line.description, available, ...(replacement ? {replacementObligationId:replacement.obligation.replacementObligationId}:{}), ...(order.customerId ? { customerId: order.customerId } : {}), ...(order.requestedFulfillment?.destination ? { destination: order.requestedFulfillment.destination } : {}), quantity: String(available) } }; }); if (prepared) { setDirty(true); setRevisionDirty(true); }
  };
  const refreshAll = async () => { await Promise.all([refresh(), loadShipments()]); };
  const refreshStaleSnapshot = async (command: FulfillmentIntent) => {
    if (!intent.isReloadRequired(command) || command.operation !== "shipment-finalize") return;
    setPending("load");
    setNotice("The finalize CAS was stale. Side-effect commands remain blocked until this shipment reloads with a different prepared revision.");
    try {
      const latest = await fulfillmentApi.getShipment(organizationId, command.payload.shipmentId);
      if (latest.shipmentId !== command.payload.shipmentId) throw new Error("The owner returned a different shipment identity.");
      const revision = latest.currentPreparedRevision;
      if (!revision || !id(revision.revisionId) || !Number.isSafeInteger(revision.revisionNumber) || revision.revisionNumber < 1 || !validAllocations(revision.allocations)) throw new Error("The owner response did not contain a valid prepared revision.");
      restore(latest);
      const latestRevisionId = revision.revisionId;
      if (latestRevisionId === command.payload.expectedPreparedRevisionId) {
        setNotice(`The authoritative read still reports revision ${latestRevisionId}; the stale request remains guarded. Retry this refresh after the owner state changes.`);
        return;
      }
      const cleared = intent.settleAfterReload(command, latestRevisionId);
      const resolution = cleared ? `Prepared revision ${revision.revisionNumber} (${latestRevisionId}) is loaded. Review it before starting another command.` : `Prepared revision ${revision.revisionNumber} (${latestRevisionId}) is loaded, but the recovery guard remains; resolve it before starting another command.`;
      setNotice(resolution);
      if (cleared) {
        try { await refreshAll(); } catch (refreshError) { setNotice(`${resolution} Shipment lists could not be refreshed: ${message(refreshError)}`); }
      }
    } catch (reloadError) {
      setNotice(`The stale prepared revision is still guarded. Latest shipment detail could not be loaded: ${message(reloadError)} Use the reload action to retry; no correction, void, finalize, Pickup, replacement, or new shipment command is available.`);
    } finally { setPending(undefined); }
  };
  const executeIntent = async (command: FulfillmentIntent) => {
    if (!intent.isSendable(command)) {
      setNotice("This saved command is invalid, mismatched, or requires an authoritative reload. No request was sent.");
      return;
    }
    const action = command.operation === "shipment-create" ? "create" : command.operation === "shipment-correct" ? "correct" : command.operation === "shipment-cancel" ? "cancel" : command.operation === "shipment-finalize" ? "finalize" : undefined;
    if (!action) return;
    setPending(action); setNotice("");
    try {
      let result: FulfillmentShipmentDetail;
      let confirmation: string;
      switch (command.operation) {
        case "shipment-create":
          result = await fulfillmentApi.createShipment(organizationId, command.businessRequestId, command.payload.input);
          confirmation = `Prepared shipment ${result.shipmentId}. Its allocations are server-owned and remain correctable until it is shipped.`;
          break;
        case "shipment-correct":
          result = await fulfillmentApi.correctShipment(organizationId, command.payload.shipmentId, command.businessRequestId, command.payload.input);
          confirmation = "Prepared shipment correction was saved with an immutable recovery reason.";
          break;
        case "shipment-cancel":
          result = await fulfillmentApi.cancelShipment(organizationId, command.payload.shipmentId, command.businessRequestId, command.payload.reason);
          confirmation = "Prepared shipment voided. Server-authoritative allocations were released and the void remains in history.";
          break;
        case "shipment-finalize":
          result = await fulfillmentApi.finalizeShipment(organizationId, command.payload.shipmentId, command.businessRequestId, command.payload.expectedPreparedRevisionId);
          confirmation = "Shipment finalized. The server atomically created its immutable handoffs, allocations, document snapshots, and shipment history.";
          break;
        default:
          return;
      }
      restore(result);
      const cleared = intent.settle(command);
      setNotice(cleared ? confirmation : `${confirmation} The owner returned a receipt, but the saved recovery marker remains; retry the same request before starting another operation.`);
      try { await refreshAll(); } catch (refreshError) { setNotice(`${confirmation} The owner result is confirmed, but shipment lists could not be refreshed: ${message(refreshError)}`); }
    } catch (error) {
      const staleRevision = command.operation === "shipment-finalize" && message(error).toLowerCase().includes("prepared shipment revision is stale");
      if (staleRevision) {
        const reloadCommand = intent.requireAuthoritativeReload(command);
        if (reloadCommand) await refreshStaleSnapshot(reloadCommand);
        else setNotice(`${message(error)} The stale request remains unresolved and side-effect commands are blocked. Reopen the shipment through an authorized owner recovery path.`);
      } else {
        setNotice(`${message(error)} The exact request identity and body remain saved. Retry this request before editing or submitting another operation.`);
      }
    } finally { setPending(undefined); }
  };
  const create = () => {
    if (!valid || !editable) return;
    const first = selections[0]!;
    const input = { ...(first.customerId ? { customerId: first.customerId } : {}), ...(first.destination ? { destination: first.destination } : {}), carrier: metadata(), allocations: allocations() };
    const command = intent.begin({ operation: "shipment-create", payload: { input } });
    if (command) void executeIntent(command);
  };
  const correct = () => {
    if (!shipment || !prepared || !valid || !reason.trim() || !editable) return;
    const input = { allocations: allocations(), reason: reason.trim(), carrier: metadata() };
    const command = intent.begin({ operation: "shipment-correct", payload: { shipmentId: shipment.shipmentId, input } });
    if (command) void executeIntent(command);
  };
  const cancel = () => {
    if (!shipment || !prepared || !reason.trim() || !editable || revisionDirty) return;
    const command = intent.begin({ operation: "shipment-cancel", payload: { shipmentId: shipment.shipmentId, reason: reason.trim() } });
    if (command) void executeIntent(command);
  };
  const finalize = () => {
    const revisionId = shipment?.currentPreparedRevision?.revisionId;
    if (!shipment || !prepared || !revisionId || !editable || dirty) return;
    const command = intent.begin({ operation: "shipment-finalize", payload: { shipmentId: shipment.shipmentId, expectedPreparedRevisionId: revisionId } });
    if (command) void executeIntent(command);
  };
  const unavailableSelections = selections.filter(selection => selection.unresolved || !orders.some(order => order.orderId === selection.orderId && order.lines.some(line => line.orderLineId === selection.orderLineId)));
  const retryShipment = intent.state.kind === "pending" && intent.state.command.operation.startsWith("shipment-") ? intent.state.command : undefined;
  const staleSnapshotRequiresReload = retryShipment?.operation === "shipment-finalize" && retryShipment.recovery === "stale";
  return <section className="v2-fulfillment-shipment-builder">
    <header><div><small>Shipping</small><h2>Shipment container</h2><p>Prepare one physical shipment from a bounded set of currently loaded fulfillment lines. The server owns allocations, compatibility, and quantity validation; preparing a shipment does not fulfill or mark it shipped.</p></div><button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Close shipment builder" : "Create shipment"}</button></header>
    {expanded && <div className="v2-fulfillment-shipment-body">
      <section className="v2-fulfillment-shipment-history"><header><h3>Prepared shipment recovery</h3><button type="button" disabled={Boolean(pending) || (intentLocked && !(intent.state.kind === "blocked" && intent.state.reason === "invalid"))} onClick={() => void loadShipments()}>{pending === "load" ? "Refreshing…" : intent.state.kind === "blocked" && intent.state.reason === "invalid" ? "Refresh owner shipment records" : "Refresh shipments"}</button></header>{shipments.length ? <div>{shipments.map(item => <button key={item.shipmentId} type="button" className={shipment?.shipmentId === item.shipmentId ? "active" : ""} disabled={Boolean(pending) || intentLocked || dirty} onClick={() => void fulfillmentApi.getShipment(organizationId, item.shipmentId).then(restore).catch(error => setNotice(message(error)))}><b>{item.shipmentId}</b><small>{item.status}{item.carrier.trackingNumber ? ` · ${item.carrier.trackingNumber}` : ""}</small></button>)}</div> : <p>No persisted shipment containers are available in this bounded workspace.</p>}<button type="button" disabled={Boolean(pending) || intentLocked || dirty} onClick={resetForm}>Start a new prepared shipment</button></section>
       <div className="v2-fulfillment-shipment-selection"><h3>{shipment ? "Shipment allocations" : "1. Select fulfillment quantities"}</h3>{readOnly && <p>This {shipment?.status} shipment is historical and read-only. A shipped shipment cannot be edited, cancelled, or turned back into prepared work.</p>}{orders.map(order => <article key={order.orderId}><b>{order.number} · {order.customerName}</b>{order.lines.filter(line => line.availableFulfillmentQuantity > 0 && !line.physicalIntegrityAnomaly || Boolean(selected[keyOf(order.orderId, line.orderLineId)])).map(line => { const key = keyOf(order.orderId, line.orderLineId); const active = selected[key]; return <label key={line.orderLineId} className="v2-fulfillment-shipment-line"><input type="checkbox" checked={Boolean(active)} disabled={readOnly || !canShip} onChange={() => toggle(order, line)} /><span><b>{line.description}</b><small>{line.availableFulfillmentQuantity} currently available · {line.completedFulfillmentQuantity} previously fulfilled</small></span>{active && <input aria-label={`${order.number} ${line.description} shipment quantity`} type="number" min="1" max={active.available} step="1" value={active.quantity} disabled={readOnly} onChange={event => setQuantity(key, event.target.value)} />}</label>; })}{replacementCandidates.filter(candidate=>candidate.obligation.orderId===order.orderId&&candidate.obligation.status!=="cancelled"&&candidate.remainingProductionQuantity===0&&candidate.remainingFulfillmentQuantity>0).map(candidate=>{const line=order.lines.find(value=>value.orderLineId===candidate.obligation.orderLineId);if(!line)return null;const key=keyOf(order.orderId,line.orderLineId,candidate.obligation.replacementObligationId),active=selected[key];return <label key={candidate.obligation.replacementObligationId} className="v2-fulfillment-shipment-line"><input type="checkbox" checked={Boolean(active)} disabled={readOnly||!canShip||!canReplace} onChange={()=>toggle(order,line,candidate)} /><span><b>Replacement · {line.description}</b><small>{candidate.remainingFulfillmentQuantity} replacement unit(s) available · original fulfillment remains historical</small></span>{active&&<input aria-label={`${order.number} replacement ${line.description} shipment quantity`} type="number" min="1" max={active.available} step="1" value={active.quantity} disabled={readOnly} onChange={event=>setQuantity(key,event.target.value)} />}</label>;})}</article>)}</div>
      <div className="v2-fulfillment-shipment-details"><h3>{shipment ? "Shipment details" : "2. Manual shipment details"}</h3><label>Carrier<input value={carrierName} disabled={readOnly || pending !== undefined || intentLocked} onChange={event => { setCarrierName(event.target.value); if (prepared) { setDirty(true); setRevisionDirty(true); } }} placeholder="Manual carrier" /></label><label>Service<input value={carrierService} disabled={readOnly || pending !== undefined || intentLocked} onChange={event => { setCarrierService(event.target.value); if (prepared) { setDirty(true); setRevisionDirty(true); } }} placeholder="Service" /></label><label>Tracking<input value={trackingNumber} disabled={readOnly || pending !== undefined || intentLocked} onChange={event => { setTrackingNumber(event.target.value); if (prepared) { setDirty(true); setRevisionDirty(true); } }} placeholder="Tracking number" /></label><label>Package count<input type="number" min="1" step="1" value={packageCount} disabled={readOnly || pending !== undefined || intentLocked} onChange={event => { setPackageCount(event.target.value); if (prepared) { setDirty(true); setRevisionDirty(true); } }} placeholder="Optional" /></label><label>Notes<textarea value={notes} disabled={readOnly || pending !== undefined || intentLocked} onChange={event => { setNotes(event.target.value); if (prepared) { setDirty(true); setRevisionDirty(true); } }} /></label>{prepared && <label>Correction or void reason<textarea value={reason} disabled={pending !== undefined || intentLocked} onChange={event => { setReason(event.target.value); setDirty(true); }} placeholder="Required before correcting or voiding a prepared shipment" /></label>}<p>Carrier, service, tracking, notes, and package count are manual operator facts, not provider events.</p></div>
       {shipment&&(canManageShippingCost||canManageShippingPrice)&&<ShipmentEconomicsPanel organizationId={organizationId} shipmentId={shipment.shipmentId} customerId={shipment.customerId} csrfReady={csrfReady} commandsBlocked={intentLocked} canManageCost={canManageShippingCost} canManagePrice={canManageShippingPrice} />}
      <footer className="v2-fulfillment-shipment-actions"><p>{selections.length ? `${selections.length} line${selections.length === 1 ? "" : "s"} selected` : "Select one or more available lines."}</p>{!shipment ? <button type="button" className="primary" disabled={!editable || !valid} onClick={create}>{pending === "create" ? "Creating…" : "Create prepared shipment"}</button> : prepared ? <><button type="button" disabled={!editable || !valid || !reason.trim()} onClick={correct}>{pending === "correct" ? "Saving…" : "Save correction"}</button><button type="button" disabled={!editable || !reason.trim() || revisionDirty} onClick={cancel}>{pending === "cancel" ? "Voiding…" : "Void prepared shipment"}</button><button type="button" className="primary" disabled={!editable || !shipment.currentPreparedRevision || dirty} onClick={finalize}>{pending === "finalize" ? "Finalizing…" : "Mark shipped"}</button><p className="v2-fulfillment-notice">Mark shipped invokes one server transaction: it revalidates the frozen prepared revision, creates immutable handoffs, allocations, snapshots and attachments, then transitions the container to shipped. A conflict leaves this draft prepared.</p>{dirty && <p role="alert">Unsaved shipment edits are visible. Save correction or discard local edits before finalizing the stored revision or voiding changed shipment facts.</p>}</> : <p>{shipment.status === "shipped" ? "This shipment is shipped. Any physical correction must use a future explicit post-shipment correction workflow; this record remains immutable." : "This prepared shipment was voided. Its historical evidence remains available, but it cannot be edited or shipped."}</p>}<p>Pickup remains a separate handoff action and never requires carrier or tracking data.</p>{notice && <p className="v2-fulfillment-notice">{notice}</p>}</footer>
      {shipment?.currentPreparedRevision && <section className="v2-fulfillment-history" data-testid="persisted-shipment-revision"><h3>Persisted prepared revision</h3><p>Revision {shipment.currentPreparedRevision.revisionNumber} · {shipment.currentPreparedRevision.revisionId} · {shipment.currentPreparedRevision.allocations.length} saved allocations.</p>{unavailableSelections.map(selection => <p key={keyOf(selection.orderId, selection.orderLineId, selection.replacementObligationId)}>Unavailable in the current Order list: {selection.orderNumber} / {selection.orderLineId} · quantity {selection.quantity}{selection.replacementObligationId ? ` · replacement ${selection.replacementObligationId}` : " · original"}</p>)}</section>}
      {dirty && shipment && prepared && <p role="alert">Unsaved shipment edits are not part of the persisted revision. <button type="button" disabled={Boolean(pending) || intentLocked} onClick={() => restore(shipment)}>Discard local edits</button></p>}
      {retryShipment && <section role="alert" className="v2-fulfillment-notice"><p>{staleSnapshotRequiresReload ? `Finalize returned a stale CAS for revision ${retryShipment.payload.expectedPreparedRevisionId}. The command remains retained; no side effect is allowed until a different authoritative revision loads.` : `The ${retryShipment.operation.replace("shipment-", "")} request has an unresolved outcome. Its validated exact request identity and body are retained; retry it to obtain the existing owner result.`}</p><button type="button" disabled={!canShip || Boolean(pending) || (!staleSnapshotRequiresReload && !csrfReady) || !staleSnapshotRequiresReload && (retryShipment.operation === "shipment-create" || retryShipment.operation === "shipment-correct") && !canReplace && retryShipment.payload.input.allocations.some(allocation => Boolean(allocation.replacementObligationId))} onClick={() => void (staleSnapshotRequiresReload ? refreshStaleSnapshot(retryShipment) : executeIntent(retryShipment))}>{staleSnapshotRequiresReload ? "Retry authoritative shipment reload" : "Retry exact saved shipment request"}</button></section>}
      {intent.state.kind === "pending" && !retryShipment && <p role="alert">An unresolved {intent.state.command.operation.replaceAll("-", " ")} request is retained. Resolve it in its owning Fulfillment or Shipping control before starting another operation.</p>}
      {intent.state.kind === "blocked" && <p role="alert">{intent.state.message}{intent.state.reason === "invalid" && <>{ownerRefreshMatchesCurrent && <button type="button" onClick={resolveInvalidIntent}>Resolve after authoritative owner verification</button>}{!ownerRefreshMatchesCurrent && <small>Expand the shipment builder and explicitly refresh owner shipment records before operator resolution.</small>}</>}</p>}
    </div>}
  </section>;
};

const cents=(value:number|undefined)=>value===undefined?"Not recorded":`${value.toLocaleString()} cents`;
const policyLabel=(policy:ShippingPricingPolicyRead|undefined)=>{const value=policy?.customerOverride??policy?.organizationDefault;if(!value)return "No organization policy configured";return `${value.mode.replaceAll("_"," ")} · ${policy?.customerOverride?"customer override":"organization default"}`;};
/** The only UI consumer of staff-only shipment economics. */
const ShipmentEconomicsPanel=({organizationId,shipmentId,customerId,csrfReady,commandsBlocked,canManageCost,canManagePrice}:{organizationId:string;shipmentId:string;customerId?:string;csrfReady:boolean;commandsBlocked:boolean;canManageCost:boolean;canManagePrice:boolean})=>{
 const [economics,setEconomics]=useState<StaffShipmentEconomics>();const [policy,setPolicy]=useState<ShippingPricingPolicyRead>();const [estimate,setEstimate]=useState("");const [actual,setActual]=useState("");const [actualReason,setActualReason]=useState("");const [manualPrice,setManualPrice]=useState("");const [notice,setNotice]=useState("");const [saving,setBusy]=useState(false);const busy=saving||commandsBlocked;
 const load=async()=>{try{const values=await Promise.all([canManageCost?shipmentEconomicsApi.read(organizationId,shipmentId):Promise.resolve(undefined),canManagePrice?(customerId?shippingPricingApi.getCustomerPolicy(organizationId,customerId):shippingPricingApi.getOrganizationPolicy(organizationId)):Promise.resolve(undefined)]);setEconomics(values[0]);setPolicy(values[1]);}catch(error){setNotice(message(error));}};
 useEffect(()=>{void load();},[organizationId,shipmentId,customerId,canManageCost,canManagePrice]);
  const submit=async(work:()=>Promise<StaffShipmentEconomics>)=>{if(commandsBlocked)return;setBusy(true);setNotice("");try{setEconomics(await work());await load();}catch(error){setNotice(message(error));}finally{setBusy(false);}};
 const frozen=economics?.customerPriceFrozen===true;const manual=(policy?.customerOverride??policy?.organizationDefault)?.mode==="manual";
 return <section className="v2-fulfillment-history" data-testid="shipment-economics"><header><h3>Internal shipping economics</h3><p>Staff-only. Costs, policy evidence, and customer price are not included in customer or portal shipment records.</p></header>{canManageCost&&<><dl><div><dt>Estimated carrier cost</dt><dd>{cents(economics?.estimatedCarrierCostCents)}</dd></div><div><dt>Actual carrier cost</dt><dd>{cents(economics?.actualCarrierCostCents)}</dd></div></dl><div className="v2-sales-inline-grid"><label>Estimated carrier cost (cents)<input value={estimate} inputMode="numeric" onChange={event=>setEstimate(event.target.value)} /></label><button type="button" disabled={!csrfReady||busy||!Number.isSafeInteger(Number(estimate))||Number(estimate)<0} onClick={()=>void submit(()=>shipmentEconomicsApi.setEstimated(organizationId,shipmentId,newBusinessRequestId(),Number(estimate)))}>Save estimate</button><label>Actual carrier cost (cents)<input value={actual} inputMode="numeric" onChange={event=>setActual(event.target.value)} /></label><label>Actual-cost reason<input value={actualReason} onChange={event=>setActualReason(event.target.value)} /></label><button type="button" disabled={!csrfReady||busy||!Number.isSafeInteger(Number(actual))||Number(actual)<0||!actualReason.trim()} onClick={()=>void submit(()=>shipmentEconomicsApi.setActual(organizationId,shipmentId,newBusinessRequestId(),{actualCarrierCostCents:Number(actual),responsibility:"titan",reason:actualReason.trim()}))}>Save actual cost</button></div></>}{canManagePrice&&<><dl><div><dt>Effective policy</dt><dd>{economics?.pricingPolicySnapshot?`${economics.pricingPolicySnapshot.policy.mode.replaceAll("_"," ")} · ${economics.pricingPolicySnapshot.source.replaceAll("_"," ")} (frozen)`:policyLabel(policy)}</dd></div><div><dt>Customer shipping price</dt><dd>{cents(economics?.customerShippingPriceCents)}</dd></div><div><dt>Customer price state</dt><dd>{frozen?"Frozen":"Not established"}</dd></div></dl>{!frozen&&<div className="v2-sales-inline-grid">{manual&&<label>Manual customer price (cents)<input value={manualPrice} inputMode="numeric" onChange={event=>setManualPrice(event.target.value)} /></label>}<button type="button" disabled={!csrfReady||busy||(manual&&(!Number.isSafeInteger(Number(manualPrice))||Number(manualPrice)<0))} onClick={()=>void submit(()=>shipmentEconomicsApi.establishPrice(organizationId,shipmentId,newBusinessRequestId(),manual?Number(manualPrice):undefined))}>{manual?"Freeze manual customer price":"Establish and freeze customer price"}</button></div>}<p>Actual cost and later policy changes do not automatically reprice a frozen shipment.</p></>}{notice&&<p className="v2-fulfillment-notice">{notice}</p>}</section>;
};
