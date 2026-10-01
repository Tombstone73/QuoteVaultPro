import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { OperationContext } from "../../application/operation.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { PaymentWorkspaceApplicationService } from "../../modules/billing/paymentWorkspace.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";

export type PaymentWorkspaceHttpDependencies = Readonly<{
  service: Pick<PaymentWorkspaceApplicationService, "page" | "summary" | "customers" | "invoices" | "record">;
  principals: VerifiedV2PrincipalProvider;
  /** Required trusted session CSRF middleware; do not replace with a UI flag. */
  requireCsrf: RequestHandler;
}>;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pagination = { page: z.coerce.number().int().min(1).max(100_000).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() };
const query = z.object({ period: z.enum(["today", "month", "custom"]).default("today"), fromDate: z.string().optional(), toDate: z.string().optional(), customerId: id.optional(), method: z.enum(["cash", "check", "external", "other", "card", "ach"]).optional(), ...pagination }).strict();
const amount = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const record = z.object({ businessRequestId: id, occurredAt: z.string().max(40), method: z.enum(["cash", "check", "external", "other"]), allocations: z.array(z.object({ invoiceId: id, amount }).strict()).min(1).max(25), tender: z.object({ tendered: amount, expectedBalances: z.array(z.object({ invoiceId: id, collectibleBalance: amount }).strict()).min(1).max(25) }).strict() }).strict();
function parse<Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid payment workspace request.");
  return parsed.data;
}
const fail = (response: Response, cause: unknown) => {
  const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Payment workspace request could not be completed.");
  const status = error.code === "FORBIDDEN" ? 403 : ["NOT_FOUND", "WRONG_TENANT"].includes(error.code) ? 404 : error.code === "VALIDATION_ERROR" ? 400 : ["CONFLICT", "STALE_STATE", "IDEMPOTENCY_CONFLICT"].includes(error.code) ? 409 : error.code === "RETRYABLE_FAILURE" ? 503 : 500;
  return response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
};

/** Mount at /v2/organizations/:organizationId/payment-workspace. No global/runtime wiring here. */
export function createPaymentWorkspaceRouter(dependencies: PaymentWorkspaceHttpDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use((_request, response, next) => { response.setHeader("cache-control", "private, no-store"); next(); });
  const context = async (request: Request, businessRequestId?: string): Promise<OperationContext> => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    return { principal, organizationId, operationId: `http:${request.method}:${request.path}`, ...(businessRequestId ? { businessRequest: { id: businessRequestId, payloadFingerprint: "canonical-billing-derives-fingerprint" } } : {}) };
  };
  router.get("/", async (request, response) => {
    try { const result = await dependencies.service.page(await context(request), parse(query, request.query)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch (error) { return fail(response, error); }
  });
  router.get("/summary", async (request, response) => {
    try { const result = await dependencies.service.summary(await context(request), parse(query, request.query)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch (error) { return fail(response, error); }
  });
  router.get("/customers", async (request, response) => {
    try { const input = parse(z.object({ q: z.string().max(120).optional() }).strict(), request.query); const result = await dependencies.service.customers(await context(request), input.q); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch (error) { return fail(response, error); }
  });
  router.get("/invoices", async (request, response) => {
    try { const result = await dependencies.service.invoices(await context(request), parse(z.object({ customerId: id, ...pagination }).strict(), request.query)); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch (error) { return fail(response, error); }
  });
  router.post("/manual", dependencies.requireCsrf, async (request, response) => {
    try { const input = parse(record, request.body); const result = await dependencies.service.record(await context(request, input.businessRequestId), input); if (!result.ok) return fail(response, result.error); return response.json({ ok: true, data: result.value }); }
    catch (error) { return fail(response, error); }
  });
  return router;
}
