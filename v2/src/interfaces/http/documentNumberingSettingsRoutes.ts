import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { numberingSettingsInput, type NumberingSettings, type SaveNumberingSettings } from "../../modules/organization/documentNumbering.js";

export type DocumentNumberingSettingsHttpDependencies = Readonly<{
  settings: Readonly<{
    read(organizationId: string): Promise<NumberingSettings>;
    save(organizationId: string, input: SaveNumberingSettings, principal: Principal, businessRequestId: string): Promise<NumberingSettings>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

const fail = (response: Response, cause: unknown) => {
  const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Document numbering settings are unavailable.");
  const status = error.code === "VALIDATION_ERROR" ? 400 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "STALE_STATE" || error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
  response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
};

const businessRequestId = (body: unknown): string => body && typeof body === "object" && typeof (body as { businessRequestId?: unknown }).businessRequestId === "string" ? (body as { businessRequestId: string }).businessRequestId.trim() : "";

export const createDocumentNumberingSettingsRouter = (dependencies: DocumentNumberingSettingsHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const operator = async (request: Request) => {
    const organizationId = request.params.organizationId;
    if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
    const principal = await dependencies.principals.principal(request, organizationId);
    if (!new AuthorityPolicy().decide(principal, { capability: "numbering.configure", resource: { organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to configure document numbering.");
    return { organizationId, principal };
  };
  router.get("/", async (request, response) => {
    try { const { organizationId } = await operator(request); response.json({ ok: true, data: await dependencies.settings.read(organizationId) }); } catch (cause) { fail(response, cause); }
  });
  router.get("/readiness", async (request, response) => {
    try { const { organizationId } = await operator(request); response.json({ ok: true, data: (await dependencies.settings.read(organizationId)).readiness }); } catch (cause) { fail(response, cause); }
  });
  router.put("/", async (request, response) => {
    try {
      const { organizationId, principal } = await operator(request);
      const requestId = businessRequestId(request.body);
      if (!requestId) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      response.json({ ok: true, data: await dependencies.settings.save(organizationId, numberingSettingsInput(request.body), principal, requestId) });
    } catch (cause) { fail(response, cause); }
  });
  return router;
};
