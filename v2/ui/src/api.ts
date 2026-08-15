export type ApiError = Readonly<{ code: string; message: string }>;
export type QuoteSellingInstruction = Readonly<
  | { kind: "calculated" }
  | { kind: "unit_override"; unitCents: number; reason: string }
  | { kind: "total_override"; totalCents: number; reason: string }
  | { kind: "discount"; discountBasisPoints: number; reason: string }
>;
export type QuoteSellingPriceDecision = Readonly<{
  kind: "calculated" | "unit_override" | "total_override" | "discount" | "locked";
  reason?: string;
  discountBasisPoints?: number;
}>;
export type QuoteLine = Readonly<{
  lineId: string;
  position: number;
  productId: string;
  description: string;
  quantity: number;
  resolvedConfiguration: Readonly<Record<string, unknown>>;
  calculatedUnitAmount: { cents: number; currency: string };
  calculatedLineAmount: { cents: number; currency: string };
  sellingUnitAmount: { cents: number; currency: string };
  sellingLineAmount: { cents: number; currency: string };
  sellingPriceDecision: QuoteSellingPriceDecision;
}>;
export type QuoteRead = Readonly<{
  quote: {
    quoteId: string;
    customerContact: { organizationId: string; customerId: string; contactId?: string };
    purchaseOrderNumber?: string;
    requestedDueDate?: string;
    terms: { commercialNotes?: string };
    currency: string;
    deliveryState: "not_sent" | "sent";
    acceptanceState: "not_accepted" | "accepted";
    lines: QuoteLine[];
  };
  number: { display: string; core: string };
  revision: string;
  checkpoints: readonly { checkpointId: string; kind: string; occurredAt: string }[];
  totals: {
    currency: string;
    calculatedLineAmount: { cents: number; currency: string };
    sellingLineAmount: { cents: number; currency: string };
  };
}>;
export type QuoteResult = Readonly<{ quote: QuoteRead; checkpointId?: string }>;
export type UiBootstrap = Readonly<{
  organizationId: string;
  csrfToken: string;
  /** Opaque session epoch, never a user/principal/capability claim. */
  sessionScope: string;
  capabilities: Readonly<{ quoteOverridePrice: boolean }>;
}>;
export type Selection = Readonly<{ customerId?: string; contactId?: string; productId?: string; displayName: string; measurementMode?: "dimensions_required" | "quantity_only"; requiresDimensions?: boolean }>;
export type ProductConfiguration = Readonly<{ productId: string; displayName: string; measurementMode: "dimensions_required" | "quantity_only"; requiresDimensions: boolean; supportedDimensionUnits: readonly ("in" | "ft" | "mm")[]; effectiveSelections: Record<string, unknown>; fields: readonly Readonly<{ selectionKey: string; label: string; inputType: string; required: boolean; defaultValue?: unknown; choices: readonly Readonly<{ value: string | number | boolean; label: string }>[] }>[] }>;
const csrfTokens = new Map<string, string>();
let sessionScope: string | undefined;
const csrfKey = (organizationId: string) => `${sessionScope ?? "unscoped"}:${organizationId}`;
export const newBusinessRequestId = () => crypto.randomUUID();
const endpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/quotes${suffix}`;
const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
    // init may carry only the CSRF header. Apply merged headers after init so
    // a mutation is still parsed as JSON by the V2 HTTP boundary.
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  // Every authenticated Quote/form response carries the trusted host's opaque
  // session epoch. Detect a replacement before its body can update the old
  // session's React Query namespace.
  const responseSessionScope = response.headers.get("x-v2-session-scope");
  if (responseSessionScope) adoptSessionScope(responseSessionScope);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok)
    throw (body.error ?? {
      code: "INTERNAL_ERROR",
      message: "The Quote service is unavailable.",
    }) as ApiError;
  return body.data as T;
};
export const clearV2ApiSessionState = (): void => {
  csrfTokens.clear();
  sessionScope = undefined;
};
const adoptSessionScope = (nextScope: string): void => {
  if (sessionScope && sessionScope !== nextScope) {
    csrfTokens.clear();
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("v2:session-context-changed"));
  }
  sessionScope = nextScope;
};
export const quoteApi = {
  bootstrap: async (organizationId: string) => {
    const value = await request<UiBootstrap>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/ui-bootstrap`,
    );
    adoptSessionScope(value.sessionScope);
    csrfTokens.set(csrfKey(organizationId), value.csrfToken);
    return value;
  },
  customers: (organizationId: string) => request<readonly Selection[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/customers`),
  contacts: (organizationId: string, customerId: string) => request<readonly Selection[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/customers/${encodeURIComponent(customerId)}/contacts`),
  products: (organizationId: string) => request<readonly Selection[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products`),
  configuration: (organizationId: string, productId: string) => request<ProductConfiguration>(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products/${encodeURIComponent(productId)}/configuration`),
  resolveConfiguration: (organizationId: string, productId: string, selections: Record<string, unknown>) => request<ProductConfiguration>(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products/${encodeURIComponent(productId)}/configuration/resolve`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ selections }) }),
  get: (organizationId: string, quoteId: string) =>
    request<QuoteRead>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}`),
    ),
  create: (
    organizationId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ) =>
    request<QuoteResult>(endpoint(organizationId), {
      method: "POST",
      headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
      body: JSON.stringify({ ...input, businessRequestId }),
    }),
  patch: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}`),
      {
        method: "PATCH",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify({
          ...input,
          businessRequestId,
          expectedRevision: input.expectedRevision,
        }),
      },
    ),
  action: (
    organizationId: string,
    quoteId: string,
    action: "send" | "accept",
    businessRequestId: string,
    expectedRevision: string,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/${action}`),
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify({ businessRequestId, expectedRevision }),
      },
    ),
};
export const money = (value: { cents: number; currency: string }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.cents / 100);
