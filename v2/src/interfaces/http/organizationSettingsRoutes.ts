import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { businessProfileInput, documentsBrandingInput, type OrganizationSettings, type OrganizationSettingsSaveTrace } from "../../modules/organization/businessProfile.js";
import type { V2Logger } from "../../observability/logger.js";
import { principalLogContext } from "../../observability/operationContext.js";
import busboy from "busboy";
import type { OrganizationLogoAdoptionService } from "../../../infrastructure/organization/organizationLogoAdoption.js";

export type OrganizationSettingsHttpDependencies = Readonly<{
  settings: Readonly<{
    read(organizationId: string): Promise<OrganizationSettings>;
    saveBusinessProfile(organizationId: string, input: ReturnType<typeof businessProfileInput>, principal: Principal, requestId: string, trace?: OrganizationSettingsSaveTrace): Promise<OrganizationSettings>;
    saveDocumentsBranding(organizationId: string, input: ReturnType<typeof documentsBrandingInput>, principal: Principal, requestId: string, trace?: OrganizationSettingsSaveTrace): Promise<OrganizationSettings>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
  logger: V2Logger;
  logoAdoption?: OrganizationLogoAdoptionService;
}>;

const failure = (response: Response, cause: unknown) => { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Organization settings are unavailable."); const status = error.code === "VALIDATION_ERROR" ? 400 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "STALE_STATE" || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 500; response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); };
const requestId = (body: unknown) => body && typeof body === "object" && typeof (body as { businessRequestId?: unknown }).businessRequestId === "string" ? (body as { businessRequestId: string }).businessRequestId.trim() : "";
const logoMultipart = (request: Request): Promise<Readonly<{ businessRequestId: string; expectedRevision: string; filename: string; contentType: "image/png" | "image/jpeg"; bytes: Buffer }>> => new Promise((resolve, reject) => {
  if (!request.headers["content-type"]?.startsWith("multipart/form-data")) return reject(new V2ApplicationError("VALIDATION_ERROR", "Logo upload must use multipart/form-data."));
  const fields: Record<string, string> = {};
  let file: Readonly<{ filename: string; contentType: "image/png" | "image/jpeg"; bytes: Buffer }> | undefined;
  let failure: V2ApplicationError | undefined;
  const parser = busboy({ headers: request.headers, limits: { files: 1, fileSize: 2 * 1024 * 1024 } });
  parser.on("field", (name: string, value: string) => { fields[name] = value; });
  parser.on("file", (name: string, stream: any, info: Readonly<{ filename: string; mimeType: string }>) => {
    if (name !== "file" || file) { failure ??= new V2ApplicationError("VALIDATION_ERROR", "Exactly one logo file is required."); stream.resume(); return; }
    if (info.mimeType !== "image/png" && info.mimeType !== "image/jpeg") { failure ??= new V2ApplicationError("VALIDATION_ERROR", "Logo must be a PNG or JPG file."); stream.resume(); return; }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("limit", () => { failure = new V2ApplicationError("VALIDATION_ERROR", "Logo file exceeds the 2 MB limit."); });
    stream.on("end", () => { if (!failure) file = { filename: info.filename, contentType: info.mimeType as "image/png" | "image/jpeg", bytes: Buffer.concat(chunks) }; });
  });
  parser.on("error", () => reject(new V2ApplicationError("VALIDATION_ERROR", "Logo upload could not be read.")));
  parser.on("finish", () => { if (failure) return reject(failure); if (!file) return reject(new V2ApplicationError("VALIDATION_ERROR", "Exactly one logo file is required.")); resolve({ businessRequestId: fields.businessRequestId ?? "", expectedRevision: fields.expectedRevision ?? "", ...file }); });
  request.pipe(parser);
});

export const createOrganizationSettingsRouter = (dependencies: OrganizationSettingsHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const operator = async (request: Request) => { const organizationId = request.params.organizationId; if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required."); const principal = await dependencies.principals.principal(request, organizationId); if (!new AuthorityPolicy().decide(principal, { capability: "organization.configure", resource: { organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to configure Organization settings."); return { organizationId, principal }; };
  router.get("/", async (request, response) => { try { const { organizationId } = await operator(request); response.json({ ok: true, data: await dependencies.settings.read(organizationId) }); } catch (cause) { failure(response, cause); } });
  const save = (kind: "business_profile" | "documents_branding") => async (request: Request, response: Response) => {
    const businessRequestId = requestId(request.body); const operation = `organization.${kind}.configure.v1`;
    try {
      const { organizationId, principal } = await operator(request);
      if (!businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      const input = kind === "business_profile" ? businessProfileInput(request.body) : documentsBrandingInput(request.body);
      const trace: OrganizationSettingsSaveTrace = (stage, context = {}) => dependencies.logger.log(stage.endsWith("failed") || stage.endsWith("rolled_back") ? "warn" : "info", `v2.organization_settings.${kind}.${stage}`, { operationId: operation, organizationId, businessRequestId, ...principalLogContext(principal), ...context });
      dependencies.logger.log("info", `v2.organization_settings.${kind}.request_received`, { operationId: operation, organizationId, businessRequestId, ...principalLogContext(principal) });
      const data = kind === "business_profile" ? await dependencies.settings.saveBusinessProfile(organizationId, input as ReturnType<typeof businessProfileInput>, principal, businessRequestId, trace) : await dependencies.settings.saveDocumentsBranding(organizationId, input as ReturnType<typeof documentsBrandingInput>, principal, businessRequestId, trace);
      response.json({ ok: true, data });
    } catch (cause) { failure(response, cause); }
  };
  router.put("/business-profile", save("business_profile"));
  router.put("/documents-branding", save("documents_branding"));
  router.post("/documents-branding/logo", async (request, response) => {
    try {
      if (!dependencies.logoAdoption) throw new V2ApplicationError("RETRYABLE_FAILURE", "Organization logo adoption is unavailable.");
      const { organizationId, principal } = await operator(request);
      const input = await logoMultipart(request);
      if (!input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      dependencies.logger.log("info", "v2.organization_settings.logo.request_received", { operationId: "organization.documents_branding.logo.adopt.v1", organizationId, businessRequestId: input.businessRequestId, ...principalLogContext(principal) });
      response.json({ ok: true, data: await dependencies.logoAdoption.adopt(organizationId, principal, input) });
    } catch (cause) { failure(response, cause); }
  });
  return router;
};
