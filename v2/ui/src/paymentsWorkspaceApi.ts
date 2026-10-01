import type { ManualPaymentAllocationsResult } from "../../src/modules/billing/contracts";
import type { PaymentWorkspaceCustomer, PaymentWorkspaceInvoicePage, PaymentWorkspaceInvoiceQuery, PaymentWorkspacePage, PaymentWorkspaceQuery, PaymentWorkspaceRecordInput, PaymentWorkspaceSummaryRead } from "../../src/modules/billing/paymentWorkspace";

type PaymentJson<T> = T extends { readonly __brand: string } ? T extends string ? string : T extends number ? number : never
  : T extends readonly (infer Item)[] ? readonly PaymentJson<Item>[]
    : T extends object ? { readonly [Key in keyof T]: PaymentJson<T[Key]> } : T;
export type PaymentsRecordResult = PaymentJson<ManualPaymentAllocationsResult>;
export interface PaymentsWorkspaceClient {
  page(organizationId: string, query: PaymentWorkspaceQuery): Promise<PaymentWorkspacePage>;
  summary(organizationId: string, query: PaymentWorkspaceQuery): Promise<PaymentWorkspaceSummaryRead>;
  customers(organizationId: string, search: string): Promise<readonly PaymentWorkspaceCustomer[]>;
  invoices(organizationId: string, query: PaymentWorkspaceInvoiceQuery): Promise<PaymentWorkspaceInvoicePage>;
  record(organizationId: string, input: PaymentWorkspaceRecordInput): Promise<PaymentsRecordResult>;
}
export type PaymentsWorkspaceTransport = Readonly<{
  /** Existing authenticated transport unwraps {ok,data} and enforces session changes. */
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
  commandHeaders: (organizationId: string) => Readonly<Record<string, string>>;
}>;
export function createPaymentsWorkspaceClient(transport: PaymentsWorkspaceTransport): PaymentsWorkspaceClient {
  const endpoint = (org: string) => `/v2/organizations/${encodeURIComponent(org)}/payment-workspace`;
  const search = (input: object) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") query.set(key, String(value));
    return query.toString();
  };
  return {
    page: (org, query) => transport.request(`${endpoint(org)}?${search(query)}`),
    summary: (org, query) => transport.request(`${endpoint(org)}/summary?${search(query)}`),
    customers: (org, q) => transport.request(`${endpoint(org)}/customers?${search({ q })}`),
    invoices: (org, query) => transport.request(`${endpoint(org)}/invoices?${search(query)}`),
    record: (org, input) => transport.request(`${endpoint(org)}/manual`, { method: "POST", headers: transport.commandHeaders(org), body: JSON.stringify(input) }),
  };
}
