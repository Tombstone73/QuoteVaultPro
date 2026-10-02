import { Router } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Capability } from "../../authorization/capabilities.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
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
    const organizationId = (request.params as Readonly<{ organizationId?: string }>).organizationId;
    if (!organizationId) return response.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Organization is unavailable." } });
    let principal: Principal;
    try {
      principal = await dependencies.principals.principal(request, organizationId);
    } catch (error) {
      // Issuance uses NOT_FOUND for unavailable tenant authority, not a failed summary read.
      if (error instanceof V2ApplicationError && (error.code === "FORBIDDEN" || error.code === "WRONG_TENANT" || error.code === "NOT_FOUND"))
        return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } });
      return response.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "The action summary is unavailable." } });
    }
    if (principal.organizationId !== organizationId)
      return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } });
    try {
      const policy = new AuthorityPolicy();
      const visible = actionCenterKinds.filter((kind) => policy.decide(principal, {
        capability: requiredCapability[kind], resource: { organizationId },
      }).allowed);
      return response.status(200).json({ ok: true, data: { items: await dependencies.reader.summary(organizationId, visible) } });
    } catch {
      return response.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "The action summary is unavailable." } });
    }
  });
  return router;
};
