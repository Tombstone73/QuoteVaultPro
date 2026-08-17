import { Router, type Request, type Response } from "express";
import type { Principal } from "../../authorization/principals.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import type { PostgresCustomerWorkspaceReader } from "../../../infrastructure/compatibility/postgresCustomerWorkspaceRead.js";

export type CustomerHttpDependencies = Readonly<{
  customers: PostgresCustomerWorkspaceReader;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });

export const createCustomerRouter = (dependencies: CustomerHttpDependencies) => {
  const router = Router({ mergeParams: true });
  router.get("/:customerId", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const customerId = brandedId<"CustomerId">(request.params.customerId);
      const principal = await dependencies.principals.principal(request, organizationId);
      const allowed = new AuthorityPolicy().decide(principal, {
        capability: "customer.view",
        resource: { organizationId, customerId },
      }).allowed;
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), customerId);
      if (!customer) return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  return router;
};
