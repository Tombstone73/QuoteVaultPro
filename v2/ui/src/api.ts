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
export type SalesLine = Readonly<{
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
export type QuoteLine = SalesLine;
export type OrderLine = SalesLine;
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
    convertedOrderId?: string;
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
  capabilities: Readonly<{
    quoteOverridePrice: boolean; quoteCreate?: boolean; quoteEdit?: boolean;
    quoteSend?: boolean; quoteConvert?: boolean; orderView?: boolean;
    orderEdit?: boolean; orderOverridePrice?: boolean; invoiceView?: boolean;
  }>;
}>;
export type SalesListPage<T> = Readonly<{ items: readonly T[]; nextCursor?: string }>;
export type QuoteListItem = Readonly<{
  quoteId: string; number: string; customerDisplayName: string;
  lifecycle: "draft" | "sent" | "accepted" | "converted";
  sellingTotalCents: number; currency: string; requestedDueDate?: string; updatedAt: string;
  convertedOrderId?: string; convertedOrderNumber?: string;
}>;
export type OrderListItem = Readonly<{
  orderId: string; number: string; customerDisplayName: string;
  lifecycle: "open" | "cancelled"; sellingTotalCents: number; currency: string;
  requestedDueDate?: string; updatedAt: string;
  draftInvoice?: { invoiceId: string; lifecycle: "draft"; totalCents: number };
  routing: "routed" | "no_route";
}>;
export type OrderRead = Readonly<{
  order: Readonly<{
    organizationId: string; orderId: string;
    customerContact: { organizationId: string; customerId: string; contactId?: string };
    purchaseOrderNumber?: string; requestedDueDate?: string;
    terms: { commercialNotes?: string }; currency: string;
    commercialState: "open" | "cancelled"; sourceQuoteId?: string; billingInvoiceReference?: string;
    lines: readonly OrderLine[];
  }>;
  number: { display: string; core: string };
  revision: string;
  totals: { calculated: { cents: number; currency: string }; selling: { cents: number; currency: string } };
  draftInvoice?: { invoiceId: string; lifecycle: "draft"; synchronizationVersion: string; lineCount: number; total: { cents: number; currency: string } };
  routes: readonly Readonly<{ routeInstanceId?: string; work: { orderLineId: string }; state: string; currentStepId?: string; steps: readonly Readonly<{ routeInstanceStepId: string; position: number; kind: string }>[] }> [];
}>;
export type OrderResult = Readonly<{ order: OrderRead; draftInvoiceId: string }>;
export type InvoiceRead = Readonly<{
  invoiceId: string; organizationId: string; sourceOrderId: string; lifecycle: "draft" | "issued" | "void";
  currency: string; lines: readonly Readonly<{ sourceOrderLineId: string; productId: string; description: string; quantity: number; sellingUnitAmount: { cents: number; currency: string }; lineAmount: { cents: number; currency: string } }>[];
  subtotal: { cents: number; currency: string }; taxTotal: { cents: number; currency: string }; total: { cents: number; currency: string };
}>;
export type Selection = Readonly<{ customerId?: string; contactId?: string; productId?: string; displayName: string; measurementMode?: "dimensions_required" | "quantity_only"; requiresDimensions?: boolean }>;
export type ProductConfiguration = Readonly<{ productId: string; displayName: string; measurementMode: "dimensions_required" | "quantity_only"; requiresDimensions: boolean; supportedDimensionUnits: readonly ("in" | "ft" | "mm")[]; effectiveSelections: Record<string, unknown>; fields: readonly Readonly<{ selectionKey: string; label: string; inputType: string; required: boolean; defaultValue?: unknown; choices: readonly Readonly<{ value: string | number | boolean; label: string }>[] }>[] }>;
const csrfTokens = new Map<string, string>();
let sessionScope: string | undefined;
const csrfKey = (organizationId: string) => `${sessionScope ?? "unscoped"}:${organizationId}`;
export const newBusinessRequestId = () => crypto.randomUUID();
const endpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/quotes${suffix}`;
const orderEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/orders${suffix}`;
const withSearch = (url: string, query: Readonly<{ q?: string; lifecycle?: string; cursor?: string; limit?: number }> = {}) => {
  const value = new URLSearchParams();
  if (query.q) value.set("q", query.q);
  if (query.lifecycle) value.set("lifecycle", query.lifecycle);
  if (query.cursor) value.set("cursor", query.cursor);
  if (query.limit) value.set("limit", String(query.limit));
  const text = value.toString();
  return text ? `${url}?${text}` : url;
};
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
  list: (organizationId: string, query?: Readonly<{ q?: string; lifecycle?: string; cursor?: string; limit?: number }>) =>
    request<SalesListPage<QuoteListItem>>(withSearch(endpoint(organizationId), query)),
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
  convert: (organizationId: string, quoteId: string, businessRequestId: string, sourceCheckpointId: string, expectedRevision: string) =>
    request<Readonly<{ quoteId: string; sourceCheckpointId: string; conversionCheckpointId: string; orderId: string; draftInvoiceId: string; orderNumber: string }>>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/convert`),
      { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, sourceCheckpointId, expectedRevision }) },
    ),
};

type RawOrderLine = Readonly<{
  lineId: string; productId: string; description: string; quantity: number; resolvedConfiguration: Record<string, unknown>;
  pricingResult: { calculatedUnitAmount: { cents: number; currency: string } };
  calculatedLineAmount: { cents: number; currency: string };
  sellingPriceDecision: QuoteSellingPriceDecision & { resultingUnitAmount: { cents: number; currency: string }; resultingLineAmount: { cents: number; currency: string } };
  sellingLineAmount: { cents: number; currency: string };
}>;
type RawOrderRead = Omit<OrderRead, "order"> & { order: Omit<OrderRead["order"], "lines"> & { lines: readonly RawOrderLine[] } };
const orderForUi = (value: RawOrderRead): OrderRead => ({
  ...value,
  order: {
    ...value.order,
    lines: value.order.lines.map((line, index) => ({
      lineId: line.lineId, position: index + 1, productId: line.productId, description: line.description, quantity: line.quantity,
      resolvedConfiguration: line.resolvedConfiguration,
      calculatedUnitAmount: line.pricingResult.calculatedUnitAmount,
      calculatedLineAmount: line.calculatedLineAmount,
      sellingUnitAmount: line.sellingPriceDecision.resultingUnitAmount,
      sellingLineAmount: line.sellingLineAmount,
      sellingPriceDecision: line.sellingPriceDecision,
    })),
  },
});
export const orderApi = {
  list: (organizationId: string, query?: Readonly<{ q?: string; lifecycle?: string; cursor?: string; limit?: number }>) =>
    request<SalesListPage<OrderListItem>>(withSearch(orderEndpoint(organizationId), query)),
  get: async (organizationId: string, orderId: string) =>
    orderForUi(await request<RawOrderRead>(orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}`))),
  patch: async (organizationId: string, orderId: string, businessRequestId: string, input: Record<string, unknown>): Promise<OrderResult> => {
    const raw = await request<{ order: RawOrderRead; draftInvoiceId: string }>(orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}`), {
      method: "PATCH", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
      body: JSON.stringify({ ...input, businessRequestId }),
    });
    return { ...raw, order: orderForUi(raw.order) };
  },
};
export const invoiceApi = {
  get: (organizationId: string, invoiceId: string) =>
    request<InvoiceRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}`),
};
export const money = (value: { cents: number; currency: string }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.cents / 100);
