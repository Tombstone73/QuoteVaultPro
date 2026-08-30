import { Router } from "express";
import type { Request, Response } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../modules/billing/paymentApplication.js";
import type { FinancialReadApplicationService } from "../../modules/billing/financialReadApplication.js";
import { brandedId, currencyCode, money } from "../../modules/shared/commercialValues.js";

const fail = (response: Response, error: V2ApplicationError) => response.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "CONFLICT" || error.code === "STALE_STATE" ? 409 : 500).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
const requestId = (value: unknown) => typeof value === "string" ? value.trim() : "";
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const occurredAt = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
const context = (principal: Principal, organizationId: string, operationId: string, businessRequestId?: string): OperationContext => ({ principal, organizationId, operationId, ...(businessRequestId ? { businessRequest: { id: businessRequestId, payloadFingerprint: "http-boundary" } } : {}) });
const organization = (request: Request) => (request.params as Record<string, string>).organizationId!;

export type FinanceHttpDependencies = Readonly<{
  financialRead: FinancialReadApplicationService;
  payments: BillingPaymentsApplicationService;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
  quickBooksSync?: Readonly<{ enqueueInvoice(organizationId: string, invoiceId: string): Promise<void>; enqueueInvoices(organizationId: string, invoiceIds: readonly string[]): Promise<string[]>; retryPayment(organizationId: string, invoiceId: string, paymentId: string): Promise<{ state: "queued"; attemptCount: number }> }>;
}>;
export const createFinanceRouter = (dependencies: FinanceHttpDependencies) => {
  const router = Router({ mergeParams: true });
  router.get("/overview", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.listInvoices(context(principal, organizationId, `http:GET:${request.path}`)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: { items: result.value } }); }
    catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated finance access is required.")); }
  });
  router.get("/ledger", async (request, response) => {
    try { const organizationId = organization(request); const principal = await dependencies.principals.principal(request, organizationId); const result = await dependencies.financialRead.ledger(context(principal, organizationId, `http:GET:${request.path}`)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: { items: result.value } }); }
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
  router.post("/invoices/:invoiceId/quickbooks-sync", async (request, response) => {
    try {
      if (!dependencies.quickBooksSync) throw new V2ApplicationError("INTERNAL_ERROR", "QuickBooks synchronization is unavailable.");
      const organizationId = organization(request), principal = await dependencies.principals.principal(request, organizationId);
      const invoice = await dependencies.financialRead.readInvoice(context(principal, organizationId, `http:POST:${request.path}`), brandedId<"InvoiceId">(request.params.invoiceId));
      if (!invoice.ok) return fail(response, invoice.error);
      await dependencies.quickBooksSync.enqueueInvoice(organizationId, request.params.invoiceId);
      return response.status(202).json({ ok: true, data: { invoiceId: request.params.invoiceId, state: "queued" } });
    } catch (error) { return fail(response, error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "QuickBooks sync could not be queued.")); }
  });
  router.post("/invoices/quickbooks-sync-selected", async (request, response) => {
    try {
      if (!dependencies.quickBooksSync) throw new V2ApplicationError("INTERNAL_ERROR", "QuickBooks synchronization is unavailable.");
      const organizationId = organization(request);
      const supplied: unknown[] = Array.isArray(request.body?.invoiceIds) ? request.body.invoiceIds : [];
      const invoiceIds = [...new Set<string>(supplied.map((value): string => typeof value === "string" ? value.trim() : "").filter((value): value is string => value.length > 0))];
      if (!invoiceIds.length || invoiceIds.length > 100) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "Select between 1 and 100 V2 Invoice records."));
      const principal = await dependencies.principals.principal(request, organizationId);
      for (const invoiceId of invoiceIds) {
        const invoice = await dependencies.financialRead.readInvoice(context(principal, organizationId, `http:POST:${request.path}`), brandedId<"InvoiceId">(invoiceId));
        if (!invoice.ok) return fail(response, invoice.error);
      }
      const queued = await dependencies.quickBooksSync.enqueueInvoices(organizationId, invoiceIds);
      return response.status(202).json({ ok: true, data: { invoiceIds: queued, state: "queued" } });
    } catch (error) { return fail(response, error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "QuickBooks sync could not be queued.")); }
  });
  router.post("/invoices/:invoiceId/payments/:paymentId/quickbooks-retry", async (request, response) => {
    try {
      if (!dependencies.quickBooksSync) throw new V2ApplicationError("INTERNAL_ERROR", "QuickBooks synchronization is unavailable.");
      const organizationId = organization(request), principal = await dependencies.principals.principal(request, organizationId);
      const invoice = await dependencies.financialRead.readInvoice(context(principal, organizationId, `http:POST:${request.path}`), brandedId<"InvoiceId">(request.params.invoiceId));
      if (!invoice.ok) return fail(response, invoice.error);
      if (!invoice.value.history.some((entry) => entry.kind === "payment" && entry.id === request.params.paymentId && entry.source !== "legacy")) return fail(response, new V2ApplicationError("NOT_FOUND", "The V2 Payment was not found on this Invoice."));
      const result = await dependencies.quickBooksSync.retryPayment(organizationId, request.params.invoiceId, request.params.paymentId);
      return response.status(202).json({ ok: true, data: { paymentId: request.params.paymentId, ...result } });
    } catch (error) { return fail(response, error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "QuickBooks Payment recovery is unavailable.")); }
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
  return router;
};
