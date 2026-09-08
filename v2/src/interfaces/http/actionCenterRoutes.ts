import { Router } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Capability } from "../../authorization/capabilities.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";
import { actionCenterKinds, type ActionCenterKind } from "../../../infrastructure/compatibility/postgresActionCenterRead.js";

export type ActionCenterHttpDependencies = Readonly<{
  reader: Readonly<{ summary(organizationId: string, visible: readonly ActionCenterKind[]): Promise<unknown> }>;
  principals: VerifiedV2PrincipalProvider;
}>;

const requiredCapability: Readonly<Record<ActionCenterKind, Capability>> = {
  inbound: "inbound.view",
  proofs: "proof.view",
  prepress: "prepress.view",
  production: "production.view",
  invoices: "invoice.view",
};

/** The shell receives only counts for capabilities the authenticated principal already has. */
export const createActionCenterRouter = (dependencies: ActionCenterHttpDependencies) => {
  const router = Router({ mergeParams: true });
  router.get("/", async (request, response) => {
    try {
      const organizationId = (request.params as Readonly<{ organizationId?: string }>).organizationId;
      if (!organizationId) return response.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Organization is unavailable." } });
      const principal = await dependencies.principals.principal(request, organizationId);
      if (principal.organizationId !== organizationId)
        return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } });
      const policy = new AuthorityPolicy();
      const visible = actionCenterKinds.filter((kind) => policy.decide(principal, {
        capability: requiredCapability[kind], resource: { organizationId },
      }).allowed);
      return response.status(200).json({ ok: true, data: { items: await dependencies.reader.summary(organizationId, visible) } });
    } catch {
      return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } });
    }
  });
  return router;
};
