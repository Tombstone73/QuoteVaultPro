import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Capability } from "../../authorization/capabilities.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import { brandedId, currencyCode, money } from "../shared/commercialValues.js";
import { validateReportingWindow, type ReportingWindow, type ReportingWindowRequest } from "../shared/reportingWindow.js";
import type { ManualPaymentTender, ManualPaymentTenderReceipt, PaymentMethod, RecordManualPaymentAllocationsInput, ManualPaymentAllocationsResult } from "./contracts.js";
import type { BillingPaymentsApplicationService } from "./paymentApplication.js";

export type PaymentWorkspaceAmount = Readonly<{ currency: string; cents: number }>;
export type PaymentWorkspaceQuery = ReportingWindowRequest & Readonly<{ customerId?: string; method?: PaymentMethod; page?: number; pageSize?: number }>;
export type PaymentWorkspaceAllocation = Readonly<{
  allocationId: string; invoiceId: string; invoiceNumber?: string; orderId?: string; orderNumber?: string;
  customerId?: string; customerName?: string; amount: PaymentWorkspaceAmount; refundedAmount: PaymentWorkspaceAmount;
}>;
export type PaymentWorkspaceFact = Readonly<{
  paymentId: string; occurredAt: string; recordedAt: string; amount: PaymentWorkspaceAmount;
  appliedAmount: PaymentWorkspaceAmount; refundedAmount: PaymentWorkspaceAmount; netAmount: PaymentWorkspaceAmount;
  method: PaymentMethod; source: "manual" | "provider";
  actor: Readonly<{ kind: "staff" | "delegated_ai" | "portal" | "service" | "unknown"; subjectId?: string; staffActorUserId?: string }>;
  refundState: "not_refunded" | "partially_refunded" | "fully_refunded";
  allocations: readonly PaymentWorkspaceAllocation[];
}>;
export type PaymentWorkspaceSummary = Readonly<{
  paymentCount: number;
  /** Lifetime successful refunds of the selected Payment cohort, known at window.asOf. Not refunds occurring in the window. */
  byCurrency: readonly Readonly<{ currency: string; paymentCount: number; amountCents: number; appliedCents: number; refundedCents: number; netCents: number }>[];
}>;
export type PaymentWorkspaceSummaryRead = Readonly<{ scope: "v2_payment_facts"; window: ReportingWindow; summary: PaymentWorkspaceSummary }>;
export type PaymentWorkspacePage = PaymentWorkspaceSummaryRead & Readonly<{ items: readonly PaymentWorkspaceFact[]; page: number; pageSize: number; totalMatching: number; hasNextPage: boolean }>;
export type PaymentWorkspaceCustomer = Readonly<{ customerId: string; customerName: string }>;
export type PaymentWorkspaceInvoice = PaymentWorkspaceCustomer & Readonly<{ invoiceId: string; invoiceNumber?: string; orderId: string; orderNumber: string; collectibleBalance: PaymentWorkspaceAmount }>;
export type PaymentWorkspaceInvoiceQuery = Readonly<{ customerId: string; page?: number; pageSize?: number }>;
export type PaymentWorkspaceInvoicePage = Readonly<{ items: readonly PaymentWorkspaceInvoice[]; page: number; pageSize: number; hasNextPage: boolean }>;
export interface PaymentWorkspaceReadPort {
  readWindow(organizationId: string, request: ReportingWindowRequest, asOf: Date): Promise<ReportingWindow>;
  pagePayments(organizationId: string, query: PaymentWorkspaceQuery, window: ReportingWindow): Promise<PaymentWorkspacePage>;
  summarizePayments(organizationId: string, query: PaymentWorkspaceQuery, window: ReportingWindow): Promise<PaymentWorkspaceSummaryRead>;
  listCustomers(organizationId: string, search: string): Promise<readonly PaymentWorkspaceCustomer[]>;
  pageCollectibleInvoices(organizationId: string, query: PaymentWorkspaceInvoiceQuery): Promise<PaymentWorkspaceInvoicePage>;
}
export interface PaymentWorkspaceReadRunner { read<T>(action: (port: PaymentWorkspaceReadPort) => Promise<T>): Promise<T> }

export const manualPaymentMethods = ["cash", "check", "external", "other"] as const;
export function paymentWorkspacePagination(query: Readonly<{ page?: number; pageSize?: number }>): Readonly<{ page: number; pageSize: number }> {
  const page = query.page ?? 1, pageSize = query.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new V2ApplicationError("VALIDATION_ERROR", "Payment pagination is outside the supported range.");
  return { page, pageSize };
}

/** Shared Billing rule: change is an operational cash receipt, never credit or a Refund. */
export function previewPaymentTender(allocations: readonly Readonly<{ invoiceId: string; amount: PaymentWorkspaceAmount }>[], method: string, tender: Readonly<{ tendered: PaymentWorkspaceAmount; expectedBalances: readonly Readonly<{ invoiceId: string; collectibleBalance: PaymentWorkspaceAmount }>[] }>): ManualPaymentTenderReceipt {
  const invalid = (message: string): never => { throw new V2ApplicationError("VALIDATION_ERROR", message); };
  if (!manualPaymentMethods.some((allowed) => allowed === method)) invalid("Choose an existing manual payment method. Card and ACH are not manual tenders.");
  if (!Array.isArray(allocations) || allocations.length < 1 || allocations.length > 25 || !tender || !Array.isArray(tender.expectedBalances) || tender.expectedBalances.length !== allocations.length) invalid("Select between one and 25 Invoice allocations and their current balances.");
  const currency = allocations[0]?.amount?.currency;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) invalid("A valid payment currency is required.");
  const exact = (amount: PaymentWorkspaceAmount | undefined) => {
    if (!amount || amount.currency !== currency || !Number.isSafeInteger(amount.cents) || amount.cents <= 0) invalid("Tender, allocations and selected balances must use positive exact cents in one currency.");
    return amount!.cents;
  };
  const balances = new Map(tender.expectedBalances.map((entry) => [entry.invoiceId, exact(entry.collectibleBalance)]));
  const seen = new Set<string>();
  let applied = 0, selectedBalance = 0;
  for (const allocation of allocations) {
    if (!allocation.invoiceId || seen.has(allocation.invoiceId) || !balances.has(allocation.invoiceId)) invalid("Each selected Invoice must have exactly one allocation and current balance.");
    seen.add(allocation.invoiceId);
    const cents = exact(allocation.amount), balance = balances.get(allocation.invoiceId)!;
    if (cents > balance) invalid("Applied amount exceeds a selected Invoice balance.");
    applied += cents;
    selectedBalance += balance;
  }
  const tendered = exact(tender.tendered);
  if (!Number.isSafeInteger(applied) || !Number.isSafeInteger(selectedBalance)) invalid("Payment totals exceed the exact cent range.");
  if (tendered < applied) invalid("Tendered amount is below Applied. Adjust the explicit Invoice allocations.");
  if (method !== "cash" && tendered !== applied) invalid("Noncash tender must equal Applied. Excess cannot be treated as cash change or customer credit.");
  const code = currencyCode(currency!);
  return { selectedBalance: money(code, selectedBalance), tendered: money(code, tendered), applied: money(code, applied), changeDue: money(code, tendered - applied) };
}

export type PaymentWorkspaceRecordInput = Readonly<{
  businessRequestId: string; occurredAt: string; method: RecordManualPaymentAllocationsInput["method"];
  allocations: readonly Readonly<{ invoiceId: string; amount: PaymentWorkspaceAmount }>[];
  tender: Readonly<{ tendered: PaymentWorkspaceAmount; expectedBalances: readonly Readonly<{ invoiceId: string; collectibleBalance: PaymentWorkspaceAmount }>[] }>;
}>;

/** Staff workspace over Billing facts and the existing canonical recording owner. */
export class PaymentWorkspaceApplicationService {
  constructor(private readonly runner: PaymentWorkspaceReadRunner, private readonly payments: Pick<BillingPaymentsApplicationService, "recordManualPaymentAllocations">, private readonly authority = new AuthorityPolicy(), private readonly now: () => Date = () => new Date()) {}

  async page(context: OperationContext, query: PaymentWorkspaceQuery): Promise<ApplicationResult<PaymentWorkspacePage>> {
    return this.read(context, ["payment.view"], async (port) => {
      this.validateQuery(query);
      const window = await port.readWindow(context.organizationId, query, this.now());
      return port.pagePayments(context.organizationId, query, window);
    });
  }
  async summary(context: OperationContext, query: PaymentWorkspaceQuery): Promise<ApplicationResult<PaymentWorkspaceSummaryRead>> {
    return this.read(context, ["payment.view"], async (port) => {
      this.validateQuery(query);
      const window = await port.readWindow(context.organizationId, query, this.now());
      return port.summarizePayments(context.organizationId, query, window);
    });
  }
  async customers(context: OperationContext, search = ""): Promise<ApplicationResult<readonly PaymentWorkspaceCustomer[]>> {
    return this.read(context, ["payment.view"], (port) => {
      if (typeof search !== "string" || search.length > 120) throw new V2ApplicationError("VALIDATION_ERROR", "Customer search is too long.");
      return port.listCustomers(context.organizationId, search.trim());
    });
  }
  async invoices(context: OperationContext, query: PaymentWorkspaceInvoiceQuery): Promise<ApplicationResult<PaymentWorkspaceInvoicePage>> {
    return this.read(context, ["invoice.view", "payment.record"], (port) => {
      if (!query.customerId || query.customerId.length > 200) throw new V2ApplicationError("VALIDATION_ERROR", "Choose a Customer for Invoice selection.");
      paymentWorkspacePagination(query);
      return port.pageCollectibleInvoices(context.organizationId, query);
    });
  }
  async record(context: OperationContext, input: PaymentWorkspaceRecordInput): Promise<ApplicationResult<ManualPaymentAllocationsResult>> {
    try {
      this.authorize(context, ["invoice.view", "payment.record"]);
      previewPaymentTender(input.allocations, input.method, input.tender);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId || !input.businessRequestId.trim() || input.businessRequestId.length > 200) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (typeof input.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt)) || new Date(input.occurredAt).toISOString().slice(0, 10) !== input.occurredAt.slice(0, 10)) throw new V2ApplicationError("VALIDATION_ERROR", "Payment occurred time must be a valid UTC timestamp.");
      const amount = (value: PaymentWorkspaceAmount) => money(currencyCode(value.currency), value.cents);
      const tender: ManualPaymentTender = { tendered: amount(input.tender.tendered), expectedBalances: input.tender.expectedBalances.map((entry) => ({ invoiceId: brandedId<"InvoiceId">(entry.invoiceId), collectibleBalance: amount(entry.collectibleBalance) })) };
      return await this.payments.recordManualPaymentAllocations(context, { organizationId: brandedId<"OrganizationId">(context.organizationId), businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId), method: input.method, occurredAt: input.occurredAt, allocations: input.allocations.map((entry) => ({ invoiceId: brandedId<"InvoiceId">(entry.invoiceId), amount: amount(entry.amount) })), tender });
    } catch (error) { return this.failed(error); }
  }
  private validateQuery(query: PaymentWorkspaceQuery) {
    validateReportingWindow(query);
    paymentWorkspacePagination(query);
    if (query.method !== undefined && ![...manualPaymentMethods, "card", "ach"].includes(query.method)) throw new V2ApplicationError("VALIDATION_ERROR", "Unknown payment method filter.");
    if (query.customerId !== undefined && (!query.customerId || query.customerId.length > 200)) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Customer filter.");
  }
  private authorize(context: OperationContext, capabilities: readonly Capability[]) {
    requireOperationPrincipalScope(context);
    if (context.principal.kind !== "staff" || capabilities.some((capability) => !this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed)) throw new V2ApplicationError("FORBIDDEN", "The Staff principal is not authorized for this payment workspace operation.");
  }
  private async read<T>(context: OperationContext, capabilities: readonly Capability[], action: (port: PaymentWorkspaceReadPort) => Promise<T>): Promise<ApplicationResult<T>> {
    try { this.authorize(context, capabilities); return success(await this.runner.read(action)); }
    catch (error) { return this.failed(error); }
  }
  private failed(error: unknown) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "The payment workspace operation could not be completed.")); }
}
