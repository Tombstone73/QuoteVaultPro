import { Router, type Request, type Response } from "express";
import type { Principal } from "../../authorization/principals.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { OperationContext } from "../../application/operation.js";
import type { CustomerCatalogItem, CustomerWorkspaceRead } from "../../../infrastructure/compatibility/postgresCustomerWorkspaceRead.js";

export type CustomerHttpDependencies = Readonly<{
  customers: Readonly<{
    list(organizationId: string, query?: string): Promise<readonly CustomerCatalogItem[]>;
    read(organizationId: string, customerId: string): Promise<CustomerWorkspaceRead | null>;
  }>;
  creation?: Readonly<{
    create(context: OperationContext, input: CustomerCreateInput): Promise<CustomerWorkspaceRead>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

export type CustomerCreateInput = Readonly<{
  companyName: string;
  displayName?: string;
  email?: string;
  phone?: string;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });

const fail = (response: Response, error: unknown) => {
  const known = error instanceof V2ApplicationError ? error : null;
  const status = known?.code === "VALIDATION_ERROR" ? 400 : known?.code === "FORBIDDEN" ? 403 : 500;
  return response.status(status).json({
    ok: false,
    error: {
      code: known?.code ?? "INTERNAL_ERROR",
      message: known?.publicMessage ?? "Customer creation is unavailable.",
    },
  });
};

const optionalText = (value: unknown, field: string, limit: number): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${field} must be text.`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > limit) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is too long.`);
  return normalized;
};

const createInput = (value: unknown): CustomerCreateInput => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", "A Customer creation object is required.");
  const body = value as Record<string, unknown>;
  const companyName = optionalText(body.companyName, "Company name", 255);
  if (!companyName) throw new V2ApplicationError("VALIDATION_ERROR", "Company name is required.");
  const displayName = optionalText(body.displayName, "Display name", 255);
  const email = optionalText(body.email, "Email", 255);
  const phone = optionalText(body.phone, "Phone", 50);
  return { companyName, ...(displayName ? { displayName } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
};

export const createCustomerRouter = (dependencies: CustomerHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    const allowed = new AuthorityPolicy().decide(principal, {
      capability: "customer.view",
      resource: { organizationId },
    }).allowed;
    return { organizationId, principal, allowed };
  };
  router.get("/", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      const query = typeof request.query.q === "string" ? request.query.q : "";
      return response.status(200).json({ ok: true, data: { items: await dependencies.customers.list(organizationId, query) } });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.get("/:customerId", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.params.customerId))
        return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      const customerId = brandedId<"CustomerId">(request.params.customerId);
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), customerId);
      if (!customer) return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.post("/", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed)
        return deny(response, 403, "FORBIDDEN", "Customer creation is unavailable.");
      if (!dependencies.creation)
        throw new V2ApplicationError("INTERNAL_ERROR", "Customer creation runtime is unavailable.");
      const customer = await dependencies.creation.create({ organizationId, principal, operationId: "customers.create" }, createInput(request.body));
      return response.status(201).json({ ok: true, data: customer });
    } catch (error) {
      return fail(response, error);
    }
  });
  return router;
};
