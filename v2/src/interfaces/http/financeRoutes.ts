import { Router } from "express";
import type { Request, Response } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../modules/billing/paymentApplication.js";
import type { FinancialReadApplicationService } from "../../modules/billing/financialReadApplication.js";
import type { FinancialInvoicePageRequest, FinancialLedgerPageRequest, FinancialSettlement } from "../../modules/billing/financialReadApplication.js";
import { brandedId, currencyCode, money } from "../../modules/shared/commercialValues.js";
import type { StripePaymentInitiation } from "../../../infrastructure/billing/stripePaymentInitiation.js";
import { stripeRuntimeReadiness } from "../../../../server/lib/stripe.js";

const fail = (response: Response, error: V2ApplicationError) => response.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "CONFLICT" || error.code === "STALE_STATE" ? 409 : 500).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
const requestId = (value: unknown) => typeof value === "string" ? value.trim() : "";
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const occurredAt = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
const context = (principal: Principal, organizationId: string, operationId: string, businessRequestId?: string): OperationContext => ({ principal, organizationId, operationId, ...(businessRequestId ? { businessRequest: { id: businessRequestId, payloadFingerprint: "http-boundary" } } : {}) });
const organization = (request: Request) => (request.params as Record<string, string>).organizationId!;
const positiveInt = (value: unknown, fallback: number) => typeof value === "string" && /^\d+$/.test(value) ? Math.max(1, Number(value)) : fallback;
const pageRequest = (request: Request): FinancialInvoicePageRequest => {
  const lifecycle = typeof request.query.lifecycle === "string" && ["draft", "issued", "void"].includes(request.query.lifecycle) ? request.query.lifecycle as "draft" | "issued" | "void" : undefined;
  const settlement = typeof request.query.settlement === "string" && ["unpaid", "partially_paid", "paid", "credit_due"].includes(request.query.settlement) ? request.query.settlement as FinancialSettlement : undefined;
  const sort = typeof request.query.sort === "string" && ["updated", "invoice_number", "customer", "issued_at", "total", "balance"].includes(request.query.sort) ? request.query.sort as FinancialInvoicePageRequest["sort"] : undefined;
  const direction = request.query.direction === "asc" || request.query.direction === "desc" ? request.query.direction : undefined;
  return { page: positiveInt(request.query.page, 1), pageSize: Math.min(100, positiveInt(request.query.pageSize, 25)), ...(typeof request.query.q === "string" ? { search: request.query.q } : {}), ...(lifecycle ? { lifecycle } : {}), ...(settlement ? { settlement } : {}), ...(sort ? { sort } : {}), ...(direction ? { direction } : {}) };
};
const ledgerPageRequest = (request: Request): FinancialLedgerPageRequest => {
  const kind = request.query.kind === "payment" || request.query.kind === "refund" ? request.query.kind : undefined;
  const recordSource = request.query.recordSource === "v2" || request.query.recordSource === "legacy" ? request.query.recordSource : undefined;
  const sort = typeof request.query.sort === "string" && ["occurred_at", "recorded_at", "source", "kind", "invoice_number", "customer", "method", "amount", "balance"].includes(request.query.sort) ? request.query.sort as FinancialLedgerPageRequest["sort"] : undefined;
  const direction = request.query.direction === "asc" || request.query.direction === "desc" ? request.query.direction : undefined;
  return { page: positiveInt(request.query.page, 1), pageSize: Math.min(100, positiveInt(request.query.pageSize, 25)), ...(typeof request.query.q === "string" ? { search: request.query.q } : {}), ...(kind ? { kind } : {}), ...(recordSource ? { recordSource } : {}), ...(sort ? { sort } : {}), ...(direction ? { direction } : {}) };
};

export type FinanceHttpDependencies = Readonly<{
  financialRead: FinancialReadApplicationService;
  payments: BillingPaymentsApplicationService;
  stripePayments: StripePaymentInitiation;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;
export const createFinanceRouter = (dependencies: FinanceHttpDependencies) => {
  const router = Router({ mergeParams: true });
  router.get("/overview", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.pageInvoices(context(principal, organizationId, `http:GET:${request.path}`), pageRequest(request)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.get("/summary", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const { page: _page, pageSize: _pageSize, sort: _sort, direction: _direction, ...query } = pageRequest(request); const result = await dependencies.financialRead.summarizeInvoices(context(principal, organizationId, `http:GET:${request.path}`), query); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.get("/ledger", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.pageLedger(context(principal, organizationId, `http:GET:${request.path}`), ledgerPageRequest(request)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.get("/invoices/:invoiceId", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.readInvoice(context(principal, organizationId, `http:GET:${request.path}`), brandedId<"InvoiceId">(request.params.invoiceId)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.get("/invoices/legacy/:invoiceId", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.readLegacyInvoice(context(principal, organizationId, `http:GET:${request.path}`), brandedId<"InvoiceId">(request.params.invoiceId)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.post("/invoices/:invoiceId/payments", async (request, response) => {
    try {
      const organizationId = organization(request), businessRequestId = requestId(request.body?.businessRequestId), amountCents = cents(request.body?.amountCents), code = currency(request.body?.currency), when = occurredAt(request.body?.occurredAt), method = request.body?.method;
      if (!businessRequestId || !amountCents || !code || !when || !["cash", "check", "external"].includes(method)) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "A positive exact-cent amount, approved manual method, time, currency, and business request identity are required."));
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.payments.recordManualPayment(context(principal, organizationId, `http:POST:${request.path}`, businessRequestId), { organizationId: brandedId<"OrganizationId">(organizationId), invoiceId: brandedId<"InvoiceId">(request.params.invoiceId), amount: money(currencyCode(code), amountCents), method, occurredAt: when, businessRequestId: brandedId<"BusinessRequestId">(businessRequestId) });
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: result.value });
    } catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated payment access is required.")); }
  });
  router.post("/invoices/:invoiceId/refunds", async (request, response) => {
    try {
      const organizationId = organization(request), businessRequestId = requestId(request.body?.businessRequestId), amountCents = cents(request.body?.amountCents), code = currency(request.body?.currency), when = occurredAt(request.body?.occurredAt), paymentId = requestId(request.body?.paymentId);
      if (!businessRequestId || !amountCents || !code || !when || !paymentId) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "A payment, positive exact-cent amount, time, currency, and business request identity are required."));
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.payments.recordRefund(context(principal, organizationId, `http:POST:${request.path}`, businessRequestId), { organizationId: brandedId<"OrganizationId">(organizationId), invoiceId: brandedId<"InvoiceId">(request.params.invoiceId), paymentId: brandedId<"PaymentId">(paymentId), amount: money(currencyCode(code), amountCents), occurredAt: when, businessRequestId: brandedId<"BusinessRequestId">(businessRequestId) });
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: result.value });
    } catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated refund access is required.")); }
  });
  router.post("/invoices/:invoiceId/stripe/payment-intents", async (request, response) => {
    try {
      const organizationId = organization(request), businessRequestId = requestId(request.body?.businessRequestId), amountCents = cents(request.body?.amountCents), code = currency(request.body?.currency);
      if (!businessRequestId || !amountCents || !code) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "A positive exact-cent amount, currency, and business request identity are required."));
      const readiness = stripeRuntimeReadiness();
      if (readiness.status !== "ready" || !readiness.publishableKey) return fail(response, new V2ApplicationError("CONFLICT", "Stripe payment initiation is not ready in this environment."));
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.stripePayments.beginPayment(context(principal, organizationId, `http:POST:${request.path}`, businessRequestId), { organizationId, invoiceId: request.params.invoiceId, amountCents, currency: code, businessRequestId });
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: { ...result.value, publishableKey: readiness.publishableKey } });
    } catch (error) { return fail(response, error instanceof V2ApplicationError ? error : new V2ApplicationError("RETRYABLE_FAILURE", "Stripe payment initiation could not be completed.")); }
  });
  router.post("/invoices/:invoiceId/stripe/refunds", async (request, response) => {
    try {
      const organizationId = organization(request), businessRequestId = requestId(request.body?.businessRequestId), amountCents = cents(request.body?.amountCents), code = currency(request.body?.currency), paymentId = requestId(request.body?.paymentId);
      if (!businessRequestId || !amountCents || !code || !paymentId) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "An original Payment, positive exact-cent amount, currency, and business request identity are required."));
      if (stripeRuntimeReadiness().status !== "ready") return fail(response, new V2ApplicationError("CONFLICT", "Stripe refund initiation is not ready in this environment."));
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.stripePayments.beginRefund(context(principal, organizationId, `http:POST:${request.path}`, businessRequestId), { organizationId, invoiceId: request.params.invoiceId, paymentId, amountCents, currency: code, businessRequestId });
      if (!result.ok) return fail(response, result.error);
      return response.status(202).json({ ok: true, data: result.value });
    } catch (error) { return fail(response, error instanceof V2ApplicationError ? error : new V2ApplicationError("RETRYABLE_FAILURE", "Stripe refund initiation could not be completed.")); }
  });
  return router;
};
