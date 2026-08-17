import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import {
  failure,
  success,
  type ApplicationResult,
  V2ApplicationError,
} from "../../errors/applicationError.js";
import {
  brandedId,
  type InvoiceId,
  type Money,
  type OrganizationId,
  type PaymentId,
  type RefundId,
} from "../shared/commercialValues.js";
import type { DraftInvoiceReadModel, PaymentMethod } from "./contracts.js";

export type FinancialHistoryEntry = Readonly<{
  kind: "payment" | "refund";
  id: PaymentId | RefundId;
  paymentId?: PaymentId;
  amount: Money;
  method?: PaymentMethod;
  source: "manual" | "provider" | "legacy";
  occurredAt: string;
  recordedAt: string;
  /** Derived by the read model from immutable allocation facts, never supplied by the browser. */
  balanceAfter: Money;
}>;
export type FinancialInvoiceRead = Readonly<{
  invoice: DraftInvoiceReadModel;
  settlement: Readonly<{
    gross: Money;
    paid: Money;
    refunded: Money;
    balance: Money;
  }>;
  history: readonly FinancialHistoryEntry[];
}>;
export type FinancialInvoiceListItem = Readonly<{
  source: "v2" | "legacy";
  recordId: string;
  invoiceId: InvoiceId;
  sourceOrderId: string;
  sourceOrderNumber: string;
  customerId?: string;
  customerName?: string;
  lifecycle: "draft" | "issued" | "void";
  currency: string;
  gross: Money;
  paid: Money;
  refunded: Money;
  balance: Money;
  /** Settlement is derived from immutable allocations; it is never an Invoice lifecycle. */
  settlement?: "unpaid" | "partially_paid" | "paid";
  issuedAt?: string;
  updatedAt: string;
}>;
export type FinancialLedgerEntry = FinancialHistoryEntry &
  Readonly<{
    recordSource: "v2" | "legacy";
    recordId: string;
    invoiceId: InvoiceId;
    sourceOrderId: string;
    sourceOrderNumber: string;
    customerId?: string;
    customerName?: string;
  }>;

export interface FinancialReadPort {
  readFinancialInvoice(
    organizationId: OrganizationId,
    invoiceId: InvoiceId,
  ): Promise<FinancialInvoiceRead | null>;
  readLegacyFinancialInvoice(
    organizationId: OrganizationId,
    invoiceId: InvoiceId,
  ): Promise<FinancialInvoiceRead | null>;
  listFinancialInvoices(
    organizationId: OrganizationId,
  ): Promise<readonly FinancialInvoiceListItem[]>;
  listLedger(
    organizationId: OrganizationId,
  ): Promise<readonly FinancialLedgerEntry[]>;
}
export interface FinancialReadRunner {
  read<T>(action: (port: FinancialReadPort) => Promise<T>): Promise<T>;
}

/** Authenticated financial projections. This is deliberately read-only and cannot materialize a financial fact. */
export class FinancialReadApplicationService {
  constructor(
    private readonly runner: FinancialReadRunner,
    private readonly authority = new AuthorityPolicy(),
  ) {}

  async readInvoice(
    context: OperationContext,
    invoiceId: InvoiceId,
  ): Promise<ApplicationResult<FinancialInvoiceRead>> {
    try {
      requireOperationPrincipalScope(context);
      const value = await this.runner.read((port) =>
        port.readFinancialInvoice(
          brandedId<"OrganizationId">(context.organizationId),
          invoiceId,
        ),
      );
      if (!value)
        throw new V2ApplicationError(
          "NOT_FOUND",
          "Invoice financial history was not found.",
        );
      this.assertFinancialView(context, value.invoice.customerId);
      return success(value);
    } catch (error) {
      return failure(
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "INTERNAL_ERROR",
              "Invoice financial history could not be read.",
            ),
      );
    }
  }

  async readLegacyInvoice(context: OperationContext, invoiceId: InvoiceId): Promise<ApplicationResult<FinancialInvoiceRead>> {
    try {
      requireOperationPrincipalScope(context);
      const value = await this.runner.read((port) => port.readLegacyFinancialInvoice(brandedId<"OrganizationId">(context.organizationId), invoiceId));
      if (!value) throw new V2ApplicationError("NOT_FOUND", "Legacy invoice financial history was not found.");
      this.assertFinancialView(context, value.invoice.customerId);
      return success(value);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Legacy invoice financial history could not be read.")); }
  }

  async listInvoices(
    context: OperationContext,
  ): Promise<ApplicationResult<readonly FinancialInvoiceListItem[]>> {
    try {
      requireOperationPrincipalScope(context);
      const items = await this.runner.read((port) =>
        port.listFinancialInvoices(
          brandedId<"OrganizationId">(context.organizationId),
        ),
      );
      const visible = items.filter(
        (item) =>
          this.authority.decide(context.principal, {
            capability: "payment.view",
            resource: {
              organizationId: context.organizationId,
              customerId: item.customerId,
            },
          }).allowed,
      );
      if (!visible.length)
        this.assertFinancialView(
          context,
          context.principal.kind === "portal"
            ? context.principal.customerId
            : undefined,
        );
      return success(visible);
    } catch (error) {
      return failure(
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "INTERNAL_ERROR",
              "Financial invoice summaries could not be read.",
            ),
      );
    }
  }

  async ledger(
    context: OperationContext,
  ): Promise<ApplicationResult<readonly FinancialLedgerEntry[]>> {
    try {
      requireOperationPrincipalScope(context);
      const entries = await this.runner.read((port) =>
        port.listLedger(brandedId<"OrganizationId">(context.organizationId)),
      );
      const visible = entries.filter(
        (entry) =>
          this.authority.decide(context.principal, {
            capability: "payment.view",
            resource: {
              organizationId: context.organizationId,
              customerId: entry.customerId,
            },
          }).allowed,
      );
      if (!visible.length)
        this.assertFinancialView(
          context,
          context.principal.kind === "portal"
            ? context.principal.customerId
            : undefined,
        );
      return success(visible);
    } catch (error) {
      return failure(
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "INTERNAL_ERROR",
              "Financial ledger could not be read.",
            ),
      );
    }
  }

  private assertFinancialView(context: OperationContext, customerId?: string) {
    const decision = this.authority.decide(context.principal, {
      capability: "payment.view",
      resource: { organizationId: context.organizationId, customerId },
    });
    if (!decision.allowed)
      throw new V2ApplicationError(
        "FORBIDDEN",
        "The principal cannot view financial history.",
      );
  }
}
