import type { Request, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { BillingApplicationService } from "../../modules/billing/billingApplication.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

const fail = (response: import("express").Response, error: V2ApplicationError) => {
  const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "CONFLICT" || error.code === "STALE_STATE" ? 409 : 500;
  return response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
};

export type InvoiceHttpDependencies = Readonly<{
  service: BillingApplicationService;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
  documents?: Readonly<{ pdf(organizationId: import("../../modules/shared/commercialValues.js").OrganizationId, invoiceId: import("../../modules/shared/commercialValues.js").InvoiceId): Promise<Uint8Array>; filename(organizationId: import("../../modules/shared/commercialValues.js").OrganizationId, invoiceId: import("../../modules/shared/commercialValues.js").InvoiceId): Promise<string> }>;
  emailDelivery?: Readonly<{ admit(input: Readonly<{ organizationId:string; principal:Principal; businessRequestId:string; invoiceIds:readonly string[] }>): Promise<Readonly<{ batchId:string; selected:number; queuedInvoices:number; queuedMessages:number; skipped:number; replayed:boolean }>>; preview(input:Readonly<{organizationId:string;principal:Principal;invoiceIds:readonly string[]}>):Promise<Readonly<{selected:number;deliverableInvoices:number;recipientCount:number;skipped:number}>>; retry(input:Readonly<{organizationId:string;principal:Principal;jobId:string}>):Promise<Readonly<{state:"queued";attemptCount:number}>> }>;
}>;
export const createInvoiceRouter = (dependencies: InvoiceHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  router.get("/", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const lifecycle = typeof request.query.lifecycle === "string" && ["draft", "issued", "void"].includes(request.query.lifecycle) ? request.query.lifecycle as "draft" | "issued" | "void" : undefined;
      const requestedLimit = typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;
      const result = await dependencies.service.listInvoices({ principal, organizationId, operationId: `http:GET:${request.path}` }, { query: typeof request.query.q === "string" ? request.query.q : undefined, lifecycle, limit: Number.isInteger(requestedLimit) ? requestedLimit : undefined });
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: { items: result.value } });
    } catch {
      return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated access is required."));
    }
  });
  router.get("/orders/:orderId", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.service.readInvoiceForOrder({ principal, organizationId, operationId: `http:GET:${request.path}` }, brandedId<"OrderId">(request.params.orderId));
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: result.value });
    } catch { return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated access is required.")); }
  });
  router.get("/:invoiceId", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const context: OperationContext = { principal, organizationId, operationId: `http:GET:${request.path}` };
      const result = await dependencies.service.readInvoice(context, brandedId<"InvoiceId">(request.params.invoiceId));
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: result.value });
    } catch {
      const error = new V2ApplicationError("FORBIDDEN", "Authenticated access is required.");
      return response.status(403).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    }
  });
  router.get("/:invoiceId/document.pdf", async (request, response) => {
    try {
      if (!dependencies.documents) throw new V2ApplicationError("INTERNAL_ERROR", "Invoice document runtime is unavailable.");
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const invoiceId = brandedId<"InvoiceId">(request.params.invoiceId);
      const result = await dependencies.service.readInvoice({ principal, organizationId, operationId: `http:GET:${request.path}` }, invoiceId);
      if (!result.ok) return fail(response, result.error);
      const [bytes, filename] = await Promise.all([dependencies.documents.pdf(brandedId<"OrganizationId">(organizationId), invoiceId), dependencies.documents.filename(brandedId<"OrganizationId">(organizationId), invoiceId)]);
      response.status(200).setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", `inline; filename=\"${filename}\"`);
      response.setHeader("cache-control", "private, no-store");
      return response.send(Buffer.from(bytes));
    } catch (cause) { return fail(response, cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Invoice document is unavailable.")); }
  });
  router.post("/:invoiceId/issue", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const businessRequestId = typeof request.body?.businessRequestId === "string" ? request.body.businessRequestId.trim() : "";
      if (!businessRequestId) return fail(response, new V2ApplicationError("VALIDATION_ERROR", "A business request identity is required."));
      const principal = await dependencies.principals.principal(request, organizationId);
      const result = await dependencies.service.issueInvoice({ principal, organizationId, operationId: `http:POST:${request.path}`, businessRequest: { id: businessRequestId, payloadFingerprint: "http-boundary" } }, { organizationId: brandedId<"OrganizationId">(organizationId), invoiceId: brandedId<"InvoiceId">(request.params.invoiceId), businessRequestId: brandedId<"BusinessRequestId">(businessRequestId) });
      if (!result.ok) return fail(response, result.error);
      return response.status(200).json({ ok: true, data: result.value });
    } catch {
      return fail(response, new V2ApplicationError("FORBIDDEN", "Authenticated access is required."));
    }
  });
  /** Admission only: provider delivery is deliberately performed by the
   * durable V2 worker, never on the operator HTTP request. */
  router.post("/email-delivery/batch", async (request, response) => {
    try {
      if (!dependencies.emailDelivery) throw new V2ApplicationError("INTERNAL_ERROR", "Invoice email delivery runtime is unavailable.");
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const businessRequestId = typeof request.body?.businessRequestId === "string" ? request.body.businessRequestId.trim() : "";
      const invoiceIds = Array.isArray(request.body?.invoiceIds) ? request.body.invoiceIds.filter((value: unknown): value is string => typeof value === "string") : [];
      const result = await dependencies.emailDelivery.admit({ organizationId, principal, businessRequestId, invoiceIds });
      return response.status(202).json({ ok: true, data: result });
    } catch (cause) { return fail(response, cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Invoice email delivery could not be queued.")); }
  });
  router.post("/email-delivery/preview", async (request, response) => {
    try {
      if (!dependencies.emailDelivery) throw new V2ApplicationError("INTERNAL_ERROR", "Invoice email delivery runtime is unavailable.");
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const invoiceIds = Array.isArray(request.body?.invoiceIds) ? request.body.invoiceIds.filter((value: unknown): value is string => typeof value === "string") : [];
      return response.status(200).json({ ok: true, data: await dependencies.emailDelivery.preview({ organizationId, principal, invoiceIds }) });
    } catch (cause) { return fail(response, cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Invoice email recipients could not be previewed.")); }
  });
  router.post("/email-delivery/jobs/:jobId/retry", async (request, response) => {
    try {
      if (!dependencies.emailDelivery) throw new V2ApplicationError("INTERNAL_ERROR", "Invoice email delivery runtime is unavailable.");
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      return response.status(202).json({ ok: true, data: await dependencies.emailDelivery.retry({ organizationId, principal, jobId: request.params.jobId }) });
    } catch (cause) { return fail(response, cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Invoice email delivery could not be retried.")); }
  });
  return router;
};
