import { Router, type Request, type Response } from "express";
import type { Principal } from "../../authorization/principals.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import type { ContactCatalogRead, ContactWorkspaceRead } from "../../../infrastructure/compatibility/postgresContactWorkspaceRead.js";

export type ContactHttpDependencies = Readonly<{
  contacts: Readonly<{
    list(organizationId: string, query?: string): Promise<ContactCatalogRead>;
    read(organizationId: string, contactId: string): Promise<ContactWorkspaceRead | null>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });

export const createContactRouter = (dependencies: ContactHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    const allowed = new AuthorityPolicy().decide(principal, { capability: "customer.view", resource: { organizationId } }).allowed;
    return { organizationId, allowed };
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
  return router;
};
