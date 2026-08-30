import { Router } from "express";
import type { Request, Response } from "express";
import { stripeRuntimeReadiness } from "../../../../server/lib/stripe.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { VerifiedV2PrincipalProvider } from "./quoteRoutes.js";

export type StripeSettingsHttpDependencies = Readonly<{ principals: VerifiedV2PrincipalProvider }>;
const fail = (response: Response, cause: unknown) => { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Stripe readiness is unavailable."); response.status(error.code === "FORBIDDEN" ? 403 : 400).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); };
const operator = async (request: Request, dependencies: StripeSettingsHttpDependencies): Promise<{ organizationId: string; principal: Principal }> => { const organizationId = request.params.organizationId; if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required."); const principal = await dependencies.principals.principal(request, organizationId); if (!new AuthorityPolicy().decide(principal, { capability: "organization.configure", resource: { organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to view Stripe configuration readiness."); return { organizationId, principal }; };

/** Platform-managed Stripe credentials are readable only as non-secret V2 readiness. */
export const createStripeSettingsRouter = (dependencies: StripeSettingsHttpDependencies) => {
  const router = Router({ mergeParams: true });
  router.get("/", async (request, response) => { try { await operator(request, dependencies); response.json({ ok: true, data: stripeRuntimeReadiness() }); } catch (cause) { fail(response, cause); } });
  return router;
};
