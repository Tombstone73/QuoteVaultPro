export type ApiError = Readonly<{ code: string; message: string }>;
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
  sellingPriceDecision: { kind: string; reason?: string };
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
  capabilities: Readonly<{ quoteOverridePrice: boolean }>;
}>;
const csrfTokens = new Map<string, string>();
export const newBusinessRequestId = () => crypto.randomUUID();
const endpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/quotes${suffix}`;
const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok)
    throw (body.error ?? {
      code: "INTERNAL_ERROR",
      message: "The Quote service is unavailable.",
    }) as ApiError;
  return body.data as T;
};
export const quoteApi = {
  bootstrap: async (organizationId: string) => {
    const value = await request<UiBootstrap>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/ui-bootstrap`,
    );
    csrfTokens.set(organizationId, value.csrfToken);
    return value;
  },
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
      headers: { "x-v2-csrf-token": csrfTokens.get(organizationId) ?? "" },
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
        headers: { "x-v2-csrf-token": csrfTokens.get(organizationId) ?? "" },
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
        headers: { "x-v2-csrf-token": csrfTokens.get(organizationId) ?? "" },
        body: JSON.stringify({ businessRequestId, expectedRevision }),
      },
    ),
};
export const money = (value: { cents: number; currency: string }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.cents / 100);
