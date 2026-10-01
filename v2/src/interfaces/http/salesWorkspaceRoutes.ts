import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import busboy from "busboy";
import { z } from "zod";
import type { OperationContext } from "../../application/operation.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { WorkspaceArtworkLifecycle, WorkspaceArtworkUploads } from "../../modules/artwork/workspaceArtwork.js";
import type { OrderEditArtwork } from "../../modules/artwork/orderEditArtwork.js";
import type { OrderEditWorkspaceApplicationService } from "../../modules/sales/orderEditWorkspace.js";
import {
  authorizeSalesWorkspace, validateSalesWorkspaceHeader, validateSalesWorkspaceLineInput,
  type SalesWorkspaceApplicationService,
} from "../../modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceHeader } from "../../modules/sales/workspaceContracts.js";
import type { SalesWorkspaceLineService } from "../../modules/sales/workspaceLines.js";
import type { QuoteLinePricingPreview, QuoteLinePricingPreviewInput } from "../../modules/sales/quoteApplication.js";
import type { WorkspacePromotion } from "../../modules/sales/workspacePromotion.js";
import type { QuoteFormReadPort, VerifiedV2PrincipalProvider } from "./quoteRoutes.js";

export type SalesWorkspaceLineHttpService = Pick<SalesWorkspaceLineService, "add" | "update" | "remove" | "reorder" | "refresh">;

/** The trusted host mounts session authentication, audit and requireV2CsrfToken.
 * Every injected operation retains its own fresh workspace/creator authorization. */
export type SalesWorkspaceHttpDependencies = Readonly<{
  service: Pick<SalesWorkspaceApplicationService, "create" | "get" | "list" | "saveDraft" | "discard">;
  lines: SalesWorkspaceLineHttpService;
  promotion: WorkspacePromotion;
  orderEdits?: Pick<OrderEditWorkspaceApplicationService, "start">;
  orderEditArtwork?: OrderEditArtwork;
  principals: VerifiedV2PrincipalProvider;
  formReads: QuoteFormReadPort;
  preview(context: OperationContext, workspace: SalesWorkspace, input: QuoteLinePricingPreviewInput): Promise<QuoteLinePricingPreview>;
  artwork: Readonly<{
    uploads: WorkspaceArtworkUploads;
    lifecycle: WorkspaceArtworkLifecycle;
    download?: (context: OperationContext, workspaceId: string, claimId: string) => Promise<Readonly<{ filename: string; bytes: Uint8Array }>>;
  }>;
}>;

const uuid = z.string().uuid();
const requestId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revision = z.number().int().positive().max(2147483646);
const mutation = z.object({ requestId, expectedRevision: revision }).strict();
const lineMutation = mutation.extend({ header: z.unknown().optional() }).strict();
const search = z.object({ q: z.string().max(200).optional() }).strict();
const emptyQuery = z.object({}).strict();
const maximumUploadBytes = 10 * 1024 * 1024;

function parse<Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Sales workspace request.");
  return result.data;
}

const status = (code: string): number =>
  ["VALIDATION_ERROR", "EMPTY_FILE", "SIZE_LIMIT", "NOT_PDF", "CORRUPT_PDF", "UPLOAD_TRANSPORT_CORRUPTION"].includes(code) ? 400
    : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404
      : ["CONFLICT", "STALE_STATE", "IDEMPOTENCY_CONFLICT"].includes(code) ? 409
        : code === "RETRYABLE_FAILURE" ? 503 : 500;
const sendError = (response: Response, cause: unknown): void => {
  const safe = cause instanceof V2ApplicationError ? cause
    : new V2ApplicationError("INTERNAL_ERROR", "Sales workspace operation could not be completed.");
  response.status(status(safe.code)).json({ ok: false, error: { code: safe.code, message: safe.publicMessage } });
};
const send = (response: Response, data: unknown): void => {
  response.status(200).type("application/json").send(JSON.stringify(
    { ok: true, data }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value,
  ));
};
const withRequest = (context: OperationContext, id: string): OperationContext =>
  ({ ...context, businessRequest: { id, payloadFingerprint: "route-fingerprint-is-derived-by-operation" } });
const workspaceId = (request: Request): string => parse(uuid, request.params.workspaceId);
const headerInput = (value: unknown, organizationId: string): Readonly<{ header?: SalesWorkspaceHeader }> =>
  value === undefined ? {} : { header: validateSalesWorkspaceHeader(value, organizationId) };

/** Same memory-only Busboy transport as Artwork routes, with workspace fields
 * and explicit duplicate/unknown-field limits. PDF acceptance remains Artwork-owned. */
function parseWorkspaceArtworkMultipart(request: Request): Promise<Readonly<{
  requestId: string; expectedRevision: number; workspaceLineId?: string;
  filename: string; contentType: string; bytes: Buffer;
}>> {
  return new Promise((resolve, reject) => {
    if (!request.headers["content-type"]?.startsWith("multipart/form-data")) {
      return reject(new V2ApplicationError("VALIDATION_ERROR", "Artwork upload must use multipart/form-data."));
    }
    const fields: Record<string, string> = Object.create(null);
    let file: Readonly<{ filename: string; contentType: string; bytes: Buffer }> | undefined;
    let fileCount = 0;
    let failure: V2ApplicationError | undefined;
    const invalid = () => { failure ??= new V2ApplicationError("VALIDATION_ERROR", "Invalid Artwork upload fields."); };
    let parser: ReturnType<typeof busboy>;
    try {
      // Busboy emits parts/file limits when reached, not only when exceeded.
      parser = busboy({ headers: request.headers, limits: { files: 1, fileSize: maximumUploadBytes + 1, fields: 3, fieldSize: 129, parts: 5 } });
    } catch {
      return reject(new V2ApplicationError("UPLOAD_TRANSPORT_CORRUPTION", "Artwork upload could not be read."));
    }
    parser.on("field", (name, value, info) => {
      if (!["requestId", "expectedRevision", "workspaceLineId"].includes(name)
        || Object.hasOwn(fields, name) || info.nameTruncated || info.valueTruncated) return invalid();
      fields[name] = value;
    });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || ++fileCount !== 1) { invalid(); stream.resume(); return; }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => { if (!failure) chunks.push(chunk); });
      stream.on("limit", () => { failure = new V2ApplicationError("SIZE_LIMIT", "Artwork file exceeds the 10 MB limit."); });
      stream.on("error", () => reject(new V2ApplicationError("UPLOAD_TRANSPORT_CORRUPTION", "Artwork upload could not be read.")));
      stream.on("end", () => { if (!failure) file = { filename: info.filename, contentType: info.mimeType, bytes: Buffer.concat(chunks) }; });
    });
    parser.on("filesLimit", invalid);
    parser.on("fieldsLimit", invalid);
    parser.on("partsLimit", invalid);
    parser.on("error", () => reject(new V2ApplicationError("UPLOAD_TRANSPORT_CORRUPTION", "Artwork upload could not be read.")));
    const aborted = () => { parser.destroy(); reject(new V2ApplicationError("UPLOAD_TRANSPORT_CORRUPTION", "Artwork upload was interrupted.")); };
    request.once("aborted", aborted);
    parser.on("close", () => request.off("aborted", aborted));
    parser.on("finish", () => {
      try {
        if (failure) throw failure;
        if (!file) throw new V2ApplicationError("VALIDATION_ERROR", "Exactly one Artwork file is required.");
        const input = parse(z.object({ requestId, expectedRevision: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(revision), workspaceLineId: uuid.optional() }).strict(), fields);
        resolve({ ...input, ...file });
      } catch (cause) { reject(cause); }
    });
    request.pipe(parser);
  });
}

export const createSalesWorkspaceRouter = (dependencies: SalesWorkspaceHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  const operationContext = async (request: Request): Promise<OperationContext> => {
    const organizationId = parse(uuid, request.params.organizationId);
    const context = { principal: await dependencies.principals.principal(request, organizationId), organizationId,
      operationId: `http:${request.method}:${request.path}` };
    authorizeSalesWorkspace(context);
    return context;
  };
  const handle = async (request: Request, response: Response, work: (context: OperationContext) => Promise<unknown>): Promise<void> => {
    try {
      response.setHeader("Cache-Control", "private, no-store");
      send(response, await work(await operationContext(request)));
    } catch (cause) { sendError(response, cause); }
  };

  router.post("/", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(z.object({ requestId, kind: z.literal("new_sales").optional(), header: z.unknown().optional() }).strict(), request.body);
    return dependencies.service.create(withRequest(context, input.requestId), {
      requestId: input.requestId, kind: input.kind, ...headerInput(input.header, context.organizationId),
    });
  }));
  router.get("/", (request, response) => handle(request, response, async (context) => {
    const query = parse(z.object({ limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).optional() }).strict(), request.query);
    return dependencies.service.list(context, query.limit ?? 50);
  }));
  router.post("/order-edits", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(z.object({ requestId, orderId: uuid, expectedSourceRevision: z.string().regex(/^[1-9]\d{0,17}$/).optional() }).strict(), request.body);
    if (!dependencies.orderEdits) throw new V2ApplicationError("RETRYABLE_FAILURE", "Order edit workspaces are not configured.");
    return dependencies.orderEdits.start(withRequest(context, input.requestId), {
      requestId: input.requestId, sourceOrderId: input.orderId,
      ...(input.expectedSourceRevision === undefined ? {} : { expectedSourceRevision: input.expectedSourceRevision }),
    });
  }));
  router.get("/:workspaceId/artwork-edit", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    if (!dependencies.orderEditArtwork) throw new V2ApplicationError("RETRYABLE_FAILURE", "Order edit Artwork is not configured.");
    return dependencies.orderEditArtwork.readOrderEditArtwork(context, workspaceId(request));
  }));
  router.post("/:workspaceId/artwork-edit", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation.extend({ sourceAssignmentId: uuid, action: z.enum(["keep", "remove"]) }).strict(), request.body);
    if (!dependencies.orderEditArtwork) throw new V2ApplicationError("RETRYABLE_FAILURE", "Order edit Artwork is not configured.");
    return dependencies.orderEditArtwork.stageOrderEditArtworkIntent(withRequest(context, input.requestId), workspaceId(request),
      input.sourceAssignmentId, input.action === "keep" ? "KEEP" : "REMOVE", input.expectedRevision, input.requestId);
  }));
  router.get("/:workspaceId", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    return dependencies.service.get(context, workspaceId(request));
  }));
  router.patch("/:workspaceId", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation.extend({ header: z.unknown() }).strict(), request.body);
    return dependencies.service.saveDraft(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision,
      header: validateSalesWorkspaceHeader(input.header, context.organizationId),
    });
  }));
  router.post("/:workspaceId/discard", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation, request.body);
    return dependencies.service.discard(withRequest(context, input.requestId), workspaceId(request), input);
  }));
  router.post("/:workspaceId/promote", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation.extend({ target: z.enum(["quote", "order"]) }).strict(), request.body);
    const result = await dependencies.promotion.promote(withRequest(context, input.requestId), { ...input, workspaceId: workspaceId(request) });
    if (!result.ok) throw result.error;
    return result.value;
  }));

  router.post("/:workspaceId/lines", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(lineMutation.extend({ line: z.unknown(), operationalNote: z.string().max(4000).optional() }).strict(), request.body);
    return dependencies.lines.add(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision, ...headerInput(input.header, context.organizationId),
      line: validateSalesWorkspaceLineInput(input.line),
      ...(input.operationalNote === undefined ? {} : { operationalNote: input.operationalNote }),
    });
  }));
  router.patch("/:workspaceId/lines/:lineId", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(lineMutation.extend({ line: z.unknown(), operationalNote: z.string().max(4000).optional() }).strict(), request.body);
    return dependencies.lines.update(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision, ...headerInput(input.header, context.organizationId),
      lineId: parse(uuid, request.params.lineId), line: validateSalesWorkspaceLineInput(input.line),
      ...(input.operationalNote === undefined ? {} : { operationalNote: input.operationalNote }),
    });
  }));
  router.delete("/:workspaceId/lines/:lineId", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(lineMutation, request.body);
    return dependencies.lines.remove(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision, ...headerInput(input.header, context.organizationId), lineId: parse(uuid, request.params.lineId),
    });
  }));
  router.post("/:workspaceId/lines/reorder", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(lineMutation.extend({ lineIds: z.array(uuid).max(500) }).strict(), request.body);
    return dependencies.lines.reorder(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision, ...headerInput(input.header, context.organizationId), lineIds: input.lineIds,
    });
  }));
  router.post("/:workspaceId/lines/refresh", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(lineMutation, request.body);
    return dependencies.lines.refresh(withRequest(context, input.requestId), workspaceId(request), {
      requestId: input.requestId, expectedRevision: input.expectedRevision, ...headerInput(input.header, context.organizationId),
    });
  }));

  for (const resource of ["customers", "products"] as const) {
    router.get(`/:workspaceId/${resource}`, (request, response) => handle(request, response, async (context) => {
      const query = parse(search, request.query);
      await dependencies.service.get(context, workspaceId(request));
      return dependencies.formReads[resource](context.organizationId, query.q);
    }));
  }
  router.get("/:workspaceId/contacts", (request, response) => handle(request, response, async (context) => {
    const query = parse(z.object({ customerId: uuid }).strict(), request.query);
    await dependencies.service.get(context, workspaceId(request));
    return dependencies.formReads.contacts(context.organizationId, query.customerId);
  }));
  router.get("/:workspaceId/products/:productId/configuration", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const productId = parse(uuid, request.params.productId);
    await dependencies.service.get(context, workspaceId(request));
    const configuration = await dependencies.formReads.configuration(context.organizationId, productId);
    if (!configuration) throw new V2ApplicationError("NOT_FOUND", "Product configuration is unavailable.");
    return configuration;
  }));
  router.post("/:workspaceId/products/:productId/resolve", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const productId = parse(uuid, request.params.productId);
    const input = parse(z.object({ selections: z.unknown().refine((value) => value !== undefined) }).strict(), request.body);
    const line = validateSalesWorkspaceLineInput({ productId, quantity: 1, selections: input.selections });
    await dependencies.service.get(context, workspaceId(request));
    const configuration = await dependencies.formReads.configuration(context.organizationId, productId, line.selections);
    if (!configuration) throw new V2ApplicationError("NOT_FOUND", "Product configuration is unavailable.");
    return configuration;
  }));
  router.post("/:workspaceId/products/:productId/preview", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const productId = parse(uuid, request.params.productId);
    const input = parse(z.object({ quantity: z.unknown(), selections: z.unknown().optional(), dimensions: z.unknown().optional() }).strict(), request.body);
    const line = validateSalesWorkspaceLineInput({ ...input, productId });
    const workspace = await dependencies.service.get(context, workspaceId(request));
    return dependencies.preview(context, workspace, line);
  }));

  router.get("/:workspaceId/artwork", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    return dependencies.artwork.lifecycle.list(context, workspaceId(request));
  }));
  router.post("/:workspaceId/artwork", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const id = workspaceId(request);
    await dependencies.service.get(context, id);
    const input = await parseWorkspaceArtworkMultipart(request);
    const result = await dependencies.artwork.uploads.upload(withRequest(context, input.requestId), { ...input, workspaceId: id });
    if (!result.ok) throw result.error;
    return result.value;
  }));
  router.delete("/:workspaceId/artwork/:claimId", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation, request.body);
    return dependencies.artwork.lifecycle.remove(withRequest(context, input.requestId), {
      ...input, workspaceId: workspaceId(request), claimId: parse(uuid, request.params.claimId),
    });
  }));
  router.post("/:workspaceId/artwork/:claimId/assign", (request, response) => handle(request, response, async (context) => {
    parse(emptyQuery, request.query);
    const input = parse(mutation.extend({ workspaceLineId: uuid }).strict(), request.body);
    return dependencies.artwork.lifecycle.assign(withRequest(context, input.requestId), {
      ...input, workspaceId: workspaceId(request), claimId: parse(uuid, request.params.claimId),
    });
  }));
  router.get("/:workspaceId/artwork/:claimId/content", async (request, response) => {
    try {
      const context = await operationContext(request);
      parse(emptyQuery, request.query);
      const id = workspaceId(request);
      const claimId = parse(uuid, request.params.claimId);
      await dependencies.service.get(context, id);
      if (!dependencies.artwork.download) throw new V2ApplicationError("RETRYABLE_FAILURE", "Staged Artwork download is unavailable.");
      const file = await dependencies.artwork.download(context, id, claimId);
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 200) || "artwork.pdf"}"`);
      response.type("application/pdf").status(200).send(Buffer.from(file.bytes));
    } catch (cause) { sendError(response, cause); }
  });
  return router;
};
