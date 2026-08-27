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
  return router;
};
