export type FinanceRequestBase = Readonly<{
  organizationId: string;
  verifiedUserId?: string;
  submittedSessionScope: string;
  invoiceId: string;
  businessRequestId: string;
}>;

export type ManualPaymentRequest = FinanceRequestBase & Readonly<{
  kind: "payment";
  input: Readonly<{ amountCents: number; currency: string; method: "cash" | "check" | "external"; occurredAt: string }>;
}>;

export type ManualRefundRequest = FinanceRequestBase & Readonly<{
  kind: "refund";
  input: Readonly<{ paymentId: string; amountCents: number; currency: string; occurredAt: string }>;
}>;

export type StripePaymentRequest = FinanceRequestBase & Readonly<{
  kind: "stripePayment";
  input: Readonly<{ amountCents: number; currency: string }>;
  submitted: boolean;
}>;

export type StripeRefundRequest = FinanceRequestBase & Readonly<{
  kind: "stripeRefund";
  input: Readonly<{ paymentId: string; amountCents: number; currency: string }>;
  submitted: boolean;
}>;

export type PendingFinanceRequest = ManualPaymentRequest | ManualRefundRequest | StripePaymentRequest | StripeRefundRequest;
export type FinanceRequestRecoveryIdentity = Readonly<{ organizationId: string; verifiedUserId?: string; sessionScope: string }>;
export type FinanceRequestRecovery = Readonly<
  | { status: "empty"; requests: readonly [] }
  | { status: "stored"; requests: readonly PendingFinanceRequest[] }
  | { status: "blocked" | "unavailable"; reason: string }
>;
export type FinanceRequestStorage = Readonly<Pick<Storage, "getItem" | "setItem" | "removeItem">>;

export const sameFinanceRequest = (left: PendingFinanceRequest | undefined, right: PendingFinanceRequest | undefined) =>
  Boolean(left && right && left.kind === right.kind && left.organizationId === right.organizationId
    && left.verifiedUserId === right.verifiedUserId && left.invoiceId === right.invoiceId
    && left.businessRequestId === right.businessRequestId);

const requestForStorage = (request: PendingFinanceRequest): PendingFinanceRequest =>
  request.kind === "stripePayment" || request.kind === "stripeRefund" ? { ...request, submitted: false } : request;

export const sameFinanceRequestBody = (left: PendingFinanceRequest, right: PendingFinanceRequest) =>
  JSON.stringify(requestForStorage(left)) === JSON.stringify(requestForStorage(right));

export const financeRequestSlotKey = (request: PendingFinanceRequest) => JSON.stringify([
  request.kind === "refund" || request.kind === "stripeRefund" ? "refund" : request.kind,
  request.invoiceId,
  request.kind === "refund" || request.kind === "stripeRefund" ? request.input.paymentId : "",
]);

const keyFor = (identity: FinanceRequestRecoveryIdentity) => {
  const scope = identity.verifiedUserId
    ? `actor:${encodeURIComponent(identity.verifiedUserId)}`
    : `session:${encodeURIComponent(identity.sessionScope)}`;
  return `printershero:v2:finance-request:v1:${encodeURIComponent(identity.organizationId)}:${scope}`;
};

const storageFor = (storage?: FinanceRequestStorage): FinanceRequestStorage | undefined => {
  if (storage) return storage;
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const hasOnlyKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
};

const validMoney = (value: Record<string, unknown>) => Number.isSafeInteger(value.amountCents)
  && (value.amountCents as number) > 0 && typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency);

const validOccurredAt = (value: unknown) => typeof value === "string"
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const parseRequest = (value: unknown, identity: FinanceRequestRecoveryIdentity): PendingFinanceRequest | undefined => {
  const request = objectRecord(value);
  if (!request || !hasOnlyKeys(request, ["kind", "organizationId", "submittedSessionScope", "invoiceId", "businessRequestId", "input"], ["verifiedUserId", "submitted"])) return undefined;
  if (request.organizationId !== identity.organizationId || typeof request.submittedSessionScope !== "string"
    || !request.submittedSessionScope || typeof request.invoiceId !== "string" || !request.invoiceId
    || typeof request.businessRequestId !== "string" || !request.businessRequestId
    || request.verifiedUserId !== identity.verifiedUserId
    || (identity.verifiedUserId === undefined && request.submittedSessionScope !== identity.sessionScope)) return undefined;
  const input = objectRecord(request.input);
  if (!input) return undefined;

  if (request.kind === "payment") {
    if (request.submitted !== undefined || !hasOnlyKeys(input, ["amountCents", "currency", "method", "occurredAt"])
      || !validMoney(input) || !validOccurredAt(input.occurredAt)
      || !["cash", "check", "external"].includes(String(input.method))) return undefined;
    return request as unknown as ManualPaymentRequest;
  }
  if (request.kind === "refund") {
    if (request.submitted !== undefined || !hasOnlyKeys(input, ["paymentId", "amountCents", "currency", "occurredAt"])
      || typeof input.paymentId !== "string" || !input.paymentId || !validMoney(input) || !validOccurredAt(input.occurredAt)) return undefined;
    return request as unknown as ManualRefundRequest;
  }
  if (request.kind === "stripePayment") {
    if (!hasOnlyKeys(request, ["kind", "organizationId", "submittedSessionScope", "invoiceId", "businessRequestId", "input", "submitted"], ["verifiedUserId"])
      || typeof request.submitted !== "boolean" || !hasOnlyKeys(input, ["amountCents", "currency"]) || !validMoney(input)) return undefined;
    return request as unknown as StripePaymentRequest;
  }
  if (request.kind === "stripeRefund") {
    if (!hasOnlyKeys(request, ["kind", "organizationId", "submittedSessionScope", "invoiceId", "businessRequestId", "input", "submitted"], ["verifiedUserId"])
      || typeof request.submitted !== "boolean" || !hasOnlyKeys(input, ["paymentId", "amountCents", "currency"])
      || typeof input.paymentId !== "string" || !input.paymentId || !validMoney(input)) return undefined;
    return request as unknown as StripeRefundRequest;
  }
  return undefined;
};

const identityMatches = (stored: Record<string, unknown>, identity: FinanceRequestRecoveryIdentity) => {
  const serializedActor = stored.verifiedUserId === null ? undefined : stored.verifiedUserId;
  return stored.organizationId === identity.organizationId && serializedActor === identity.verifiedUserId
    && typeof stored.sessionScope === "string" && stored.sessionScope.length > 0
    && (identity.verifiedUserId !== undefined || stored.sessionScope === identity.sessionScope);
};

const readEnvelope = (raw: string | null, identity: FinanceRequestRecoveryIdentity): FinanceRequestRecovery => {
  if (raw === null) return { status: "empty", requests: [] };
  let decoded: unknown;
  try { decoded = JSON.parse(raw) as unknown; }
  catch { return { status: "blocked", reason: "A saved finance request is corrupt; new financial requests are disabled." }; }
  const envelope = objectRecord(decoded), scope = objectRecord(envelope?.scope);
  if (!envelope || !scope || !Array.isArray(envelope.requests) || !hasOnlyKeys(envelope, ["version", "scope", "requests"]) || envelope.version !== 1
    || !hasOnlyKeys(scope, ["organizationId", "verifiedUserId", "sessionScope"]) || !identityMatches(scope, identity))
    return { status: "blocked", reason: "A saved finance request does not match this verified tenant and actor; new financial requests are disabled." };
  const requests = envelope.requests.map((value) => parseRequest(value, identity));
  if (requests.length === 0 || requests.some((request) => !request)
    || new Set(requests.map((request) => financeRequestSlotKey(request!))).size !== requests.length)
    return { status: "blocked", reason: "Saved finance requests are incomplete, duplicated, or mismatched; new financial requests are disabled." };
  return { status: "stored", requests: requests as PendingFinanceRequest[] };
};

export const readFinanceRequestRecovery = (
  identity: FinanceRequestRecoveryIdentity,
  storage?: FinanceRequestStorage,
): FinanceRequestRecovery => {
  const target = storageFor(storage);
  if (!target) return { status: "unavailable", reason: "Session recovery storage is unavailable; financial requests are disabled." };
  try { return readEnvelope(target.getItem(keyFor(identity)), identity); }
  catch { return { status: "unavailable", reason: "Session recovery storage could not be read; financial requests are disabled." }; }
};

export const persistFinanceRequestRecovery = (
  identity: FinanceRequestRecoveryIdentity,
  request: PendingFinanceRequest,
  storage?: FinanceRequestStorage,
): FinanceRequestRecovery => {
  const target = storageFor(storage);
  if (!target) return { status: "unavailable", reason: "Session recovery storage is unavailable; no financial request was submitted." };
  const normalizedRequest = requestForStorage(request);
  if (!parseRequest(normalizedRequest, identity)) return { status: "blocked", reason: "The submitted finance request does not match this verified tenant and actor." };
  const envelope = {
    version: 1,
    scope: { organizationId: identity.organizationId, verifiedUserId: identity.verifiedUserId ?? null, sessionScope: identity.sessionScope },
  };
  try {
    const key = keyFor(identity);
    const existing = readEnvelope(target.getItem(key), identity);
    if (existing.status === "blocked" || existing.status === "unavailable") return existing;
    const priorRequests = existing.status === "stored" ? [...existing.requests] : [];
    const slot = financeRequestSlotKey(normalizedRequest);
    const priorIndex = priorRequests.findIndex((prior) => financeRequestSlotKey(prior) === slot);
    if (priorIndex >= 0) {
      if (!sameFinanceRequest(priorRequests[priorIndex], normalizedRequest) || !sameFinanceRequestBody(priorRequests[priorIndex]!, normalizedRequest))
        return { status: "blocked", reason: "A different request already reserves this financial action; the stored body was not replaced." };
      priorRequests[priorIndex] = normalizedRequest;
    } else priorRequests.push(normalizedRequest);
    const nextEnvelope = { ...envelope, requests: priorRequests };
    target.setItem(key, JSON.stringify(nextEnvelope));
    const roundTrip = readEnvelope(target.getItem(key), identity);
    if (roundTrip.status !== "stored" || JSON.stringify(roundTrip.requests) !== JSON.stringify(priorRequests))
      return { status: "blocked", reason: "The finance request could not be verified in session recovery storage; no financial request was submitted." };
    return roundTrip;
  } catch {
    return { status: "unavailable", reason: "Session recovery storage could not save the request; no financial request was submitted." };
  }
};

export const clearFinanceRequestRecovery = (
  identity: FinanceRequestRecoveryIdentity,
  request: PendingFinanceRequest,
  storage?: FinanceRequestStorage,
): boolean => {
  const target = storageFor(storage);
  if (!target) return false;
  try {
    const key = keyFor(identity), current = readEnvelope(target.getItem(key), identity), expected = requestForStorage(request);
    if (current.status !== "stored") return false;
    const index = current.requests.findIndex((entry) => sameFinanceRequest(entry, request) && JSON.stringify(entry) === JSON.stringify(expected));
    if (index < 0) return false;
    const remaining = current.requests.filter((_entry, entryIndex) => entryIndex !== index);
    if (!remaining.length) {
      target.removeItem(key);
      return target.getItem(key) === null;
    }
    const envelope = { version: 1, scope: { organizationId: identity.organizationId, verifiedUserId: identity.verifiedUserId ?? null, sessionScope: identity.sessionScope }, requests: remaining };
    target.setItem(key, JSON.stringify(envelope));
    const roundTrip = readEnvelope(target.getItem(key), identity);
    return roundTrip.status === "stored" && JSON.stringify(roundTrip.requests) === JSON.stringify(remaining);
  } catch { return false; }
};
