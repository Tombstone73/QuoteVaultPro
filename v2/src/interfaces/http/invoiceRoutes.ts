import type { Request, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { BillingApplicationService } from "../../modules/billing/billingApplication.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

export type InvoiceHttpDependencies = Readonly<{
  service: BillingApplicationService;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;
export const createInvoiceRouter = (dependencies: InvoiceHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  router.get("/:invoiceId", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      const context: OperationContext = { principal, organizationId, operationId: `http:GET:${request.path}` };
      const result = await dependencies.service.readInvoice(context, brandedId<"InvoiceId">(request.params.invoiceId));
      if (!result.ok) {
        const status = result.error.code === "FORBIDDEN" ? 403 : result.error.code === "NOT_FOUND" || result.error.code === "WRONG_TENANT" ? 404 : 500;
        return response.status(status).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
      }
      return response.status(200).json({ ok: true, data: result.value });
    } catch {
      const error = new V2ApplicationError("FORBIDDEN", "Authenticated access is required.");
      return response.status(403).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    }
  });
  return router;
};
