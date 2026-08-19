import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ArtworkFileId } from "../../modules/shared/commercialValues.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { ArtworkWorkspaceItem } from "../../../infrastructure/artwork/postgresArtworkWorkspaceReads.js";
import type { ArtworkUploadService } from "../../../infrastructure/artwork/artworkUploadService.js";
import busboy from "busboy";

export interface ArtworkHttpService {
  listForOrder(context: OperationContext, orderId: string): Promise<ApplicationResult<unknown>>;
  assign(context: OperationContext, input: Readonly<Record<string, unknown>>): Promise<ApplicationResult<unknown>>;
}
export interface VerifiedV2ArtworkPrincipalProvider { principal(request: Request, organizationId: string): Promise<Principal>; }
export type ArtworkHttpDependencies = Readonly<{ service: ArtworkHttpService; upload?: ArtworkUploadService; workspace: Readonly<{ list(organizationId: string, query?: string): Promise<readonly ArtworkWorkspaceItem[]> }>; principals: VerifiedV2ArtworkPrincipalProvider }>;

const maximumUploadBytes = 10 * 1024 * 1024;
type MultipartArtworkCommand = Readonly<{ businessRequestId: string; orderId: string; orderLineId: string; purpose: string; side?: string; sourcePageIndex?: number; layerKey?: string; layerOrder?: number; filename: string; contentType: string; bytes: Buffer }>;

const multipart = (request: Request): Promise<MultipartArtworkCommand> => new Promise((resolve, reject) => {
  if (!request.headers["content-type"]?.startsWith("multipart/form-data")) return reject(new V2ApplicationError("VALIDATION_ERROR", "Artwork upload must use multipart/form-data."));
  const fields: Record<string, string> = {};
  let file: Readonly<{ filename: string; contentType: string; bytes: Buffer }> | undefined;
  let failure: V2ApplicationError | undefined;
  const parser = busboy({ headers: request.headers, limits: { files: 1, fileSize: maximumUploadBytes } });
  parser.on("field", (name: string, value: string) => { fields[name] = value; });
  parser.on("file", (name: string, stream: any, info: Readonly<{ filename: string; mimeType: string }>) => {
    if (name !== "file" || file) { failure ??= new V2ApplicationError("VALIDATION_ERROR", "Exactly one Artwork file is required."); stream.resume(); return; }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("limit", () => { failure = new V2ApplicationError("VALIDATION_ERROR", "Artwork file exceeds the 10 MB limit."); });
    stream.on("end", () => { if (!failure) file = { filename: info.filename, contentType: info.mimeType, bytes: Buffer.concat(chunks) }; });
  });
  parser.on("error", () => reject(new V2ApplicationError("VALIDATION_ERROR", "Artwork upload could not be read.")));
  parser.on("finish", () => {
    if (failure) return reject(failure);
    if (!file) return reject(new V2ApplicationError("VALIDATION_ERROR", "Exactly one Artwork file is required."));
    const parseInteger = (value: string | undefined, label: string): number | undefined => {
      if (value === undefined || value === "") return undefined;
      if (!/^\d+$/u.test(value)) throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
      return Number(value);
    };
    try { resolve({ businessRequestId: fields.businessRequestId ?? "", orderId: fields.orderId ?? "", orderLineId: fields.orderLineId ?? "", purpose: fields.purpose ?? "", ...(fields.side ? { side: fields.side } : {}), ...(fields.sourcePageIndex !== undefined ? { sourcePageIndex: parseInteger(fields.sourcePageIndex, "Artwork source page index") } : {}), ...(fields.layerKey !== undefined ? { layerKey: fields.layerKey } : {}), ...(fields.layerOrder !== undefined ? { layerOrder: parseInteger(fields.layerOrder, "Artwork layer order") } : {}), ...file }); }
    catch (error) { reject(error); }
  });
  request.pipe(parser);
});

const status = (code: string): number => code === "VALIDATION_ERROR" ? 400 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404 : code === "CONFLICT" || code === "STALE_STATE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : code === "RETRYABLE_FAILURE" ? 503 : 500;
const send = (response: Response, result: ApplicationResult<unknown>): void => {
  if (!result.ok) { response.status(status(result.error.code)).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } }); return; }
  response.status(200).json({ ok: true, data: result.value });
};
const command = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "An Artwork command object is required.");
  return value as Readonly<Record<string, unknown>>;
};
const context = async (request: Request, dependencies: ArtworkHttpDependencies, mutation = false): Promise<OperationContext> => {
  const organizationId = request.params.organizationId;
  if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
  const body = mutation ? command(request.body) : undefined;
  const businessRequestId = body?.businessRequestId;
  if (mutation && (typeof businessRequestId !== "string" || !businessRequestId.trim())) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
  return { principal: await dependencies.principals.principal(request, organizationId), organizationId, operationId: `http:${request.method}:${request.path}`, ...(mutation ? { businessRequest: { id: businessRequestId as string, payloadFingerprint: "route-fingerprint-is-derived-by-operation" } } : {}) };
};

/** HTTP transport for bounded Artwork reads and safe existing-file usage assignment. */
export const createArtworkRouter = (dependencies: ArtworkHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  router.get("/workspace", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId!;
      const principal = await dependencies.principals.principal(request, organizationId);
      if (!new AuthorityPolicy().decide(principal, { capability: "artwork.view", resource: { organizationId } }).allowed)
        return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Artwork access is unavailable." } });
      const query = typeof request.query.q === "string" ? request.query.q : "";
      return response.status(200).json({ ok: true, data: { items: await dependencies.workspace.list(organizationId, query) } });
    } catch { return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } }); }
  });
  router.get("/orders/:orderId", async (request, response) => {
    try { send(response, await dependencies.service.listForOrder(await context(request, dependencies), request.params.orderId)); }
    catch (cause) { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Artwork read is unavailable."); response.status(status(error.code)).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); }
  });
  router.post("/files/:artworkFileId/assign", async (request, response) => {
    try {
      const body = command(request.body);
      send(response, await dependencies.service.assign(await context(request, dependencies, true), { ...body, artworkFileId: request.params.artworkFileId as ArtworkFileId }));
    } catch (cause) { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Artwork assignment is unavailable."); response.status(status(error.code)).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); }
  });
  router.post("/uploads", async (request, response) => {
    try {
      if (!dependencies.upload) throw new V2ApplicationError("RETRYABLE_FAILURE", "Artwork upload is unavailable.");
      const input = await multipart(request);
      if (!input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      const organizationId = (request.params as Readonly<{ organizationId?: string }>).organizationId;
      if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
      const operation = await dependencies.upload.upload({ principal: await dependencies.principals.principal(request, organizationId), organizationId, operationId: `http:${request.method}:${request.path}`, businessRequest: { id: input.businessRequestId, payloadFingerprint: "artwork-upload-fingerprint-is-derived-by-operation" } }, input as never);
      send(response, operation);
    } catch (cause) { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Artwork upload is unavailable."); response.status(status(error.code)).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); }
  });
  return router;
};
