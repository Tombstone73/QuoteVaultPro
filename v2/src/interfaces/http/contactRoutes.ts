import { Router, type Request, type Response } from "express";
import type { Principal } from "../../authorization/principals.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { OperationContext } from "../../application/operation.js";
import type { ContactCatalogRead, ContactWorkspaceRead } from "../../../infrastructure/compatibility/postgresContactWorkspaceRead.js";

export type ContactHttpDependencies = Readonly<{
  contacts: Readonly<{
    list(organizationId: string, query?: string): Promise<ContactCatalogRead>;
    read(organizationId: string, contactId: string): Promise<ContactWorkspaceRead | null>;
  }>;
  creation?: Readonly<{
    create(context: OperationContext, input: ContactCreateInput): Promise<ContactWorkspaceRead>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

export type ContactCreateInput = Readonly<{
  customerId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });

const fail = (response: Response, error: unknown) => {
  const known = error instanceof V2ApplicationError ? error : null;
  const status = known?.code === "VALIDATION_ERROR" ? 400 : known?.code === "NOT_FOUND" ? 404 : known?.code === "FORBIDDEN" ? 403 : 500;
  return response.status(status).json({
    ok: false,
    error: {
      code: known?.code ?? "INTERNAL_ERROR",
      message: known?.publicMessage ?? "Contact creation is unavailable.",
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

const createInput = (value: unknown): ContactCreateInput => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", "A Contact creation object is required.");
  const body = value as Record<string, unknown>;
  const customerId = optionalText(body.customerId, "Customer", 200);
  if (!customerId) throw new V2ApplicationError("VALIDATION_ERROR", "Customer is required.");
  const firstName = optionalText(body.firstName, "First name", 100);
  if (!firstName) throw new V2ApplicationError("VALIDATION_ERROR", "First name is required.");
  const lastName = optionalText(body.lastName, "Last name", 100);
  if (!lastName) throw new V2ApplicationError("VALIDATION_ERROR", "Last name is required.");
  const email = optionalText(body.email, "Email", 255);
  const phone = optionalText(body.phone, "Phone", 50);
  const title = optionalText(body.title, "Title", 100);
  return { customerId, firstName, lastName, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(title ? { title } : {}) };
};

export const createContactRouter = (dependencies: ContactHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    const allowed = new AuthorityPolicy().decide(principal, { capability: "customer.view", resource: { organizationId } }).allowed;
    return { organizationId, principal, allowed };
  };
  router.get("/", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Contact access is unavailable.");
      const query = typeof request.query.q === "string" ? request.query.q : "";
      return response.status(200).json({ ok: true, data: await dependencies.contacts.list(organizationId, query) });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.get("/:contactId", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Contact access is unavailable.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.params.contactId))
        return deny(response, 404, "NOT_FOUND", "Contact is unavailable in this organization.");
      const contact = await dependencies.contacts.read(brandedId<"OrganizationId">(organizationId), brandedId<"ContactId">(request.params.contactId));
      if (!contact) return deny(response, 404, "NOT_FOUND", "Contact is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: contact });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.post("/", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed)
        return deny(response, 403, "FORBIDDEN", "Contact creation is unavailable.");
      if (!dependencies.creation)
        throw new V2ApplicationError("INTERNAL_ERROR", "Contact creation runtime is unavailable.");
      const contact = await dependencies.creation.create(
        { organizationId, principal, operationId: "contacts.create" },
        createInput(request.body),
      );
      return response.status(201).json({ ok: true, data: contact });
    } catch (error) {
      return fail(response, error);
    }
  });
  return router;
};
