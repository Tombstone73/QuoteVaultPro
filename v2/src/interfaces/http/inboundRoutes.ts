import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import {
  inboundIntakeStates,
  type InboundIntake,
  type InboundIntakeDetail,
  type InboundIntakePage,
  type InboundReviewDraft,
  type ReviewInboundIntake,
} from "../../modules/inbound/contracts.js";
import { brandedId, type InboundIntakeId } from "../../modules/shared/commercialValues.js";
import { isM77fQaDevTarget } from "../../../infrastructure/communications/m77fQaProofDeliverySafety.js";

export interface InboundHttpService {
  ingest(context: OperationContext, input: import("../../modules/inbound/contracts.js").IngestInboundIntake): Promise<ApplicationResult<InboundIntake>>;
  list(context: OperationContext, query: Readonly<{ limit: number; cursor?: string; status?: (typeof inboundIntakeStates)[number]; search?: string }>): Promise<ApplicationResult<InboundIntakePage>>;
  detail(context: OperationContext, intakeId: InboundIntakeId): Promise<ApplicationResult<InboundIntakeDetail>>;
  review(context: OperationContext, intakeId: InboundIntakeId, review: ReviewInboundIntake): Promise<ApplicationResult<InboundIntake>>;
  convert(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string): Promise<ApplicationResult<unknown>>;
  markTerminal(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string, state: "duplicate" | "rejected", reason: string): Promise<ApplicationResult<InboundIntake>>;
  retry(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string): Promise<ApplicationResult<InboundIntake>>;
}
export interface VerifiedV2InboundPrincipalProvider { principal(request: Request, organizationId: string): Promise<Principal> }
export type InboundHttpDependencies = Readonly<{ service: InboundHttpService; principals: VerifiedV2InboundPrincipalProvider }>;

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", "An inbound command object is required.");
  return value as Record<string, unknown>;
};
const asString = (value: unknown, label: string, required = false): string | undefined => {
  if (value === undefined || value === null) {
    if (required) throw new V2ApplicationError("VALIDATION_ERROR", label + " is required.");
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) throw new V2ApplicationError("VALIDATION_ERROR", label + " is invalid.");
  return value.trim();
};
const status = (error: V2ApplicationError): number =>
  error.code === "VALIDATION_ERROR" ? 400
    : error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404
        : error.code === "CONFLICT" || error.code === "STALE_STATE" || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
const send = (response: Response, result: ApplicationResult<unknown>): void => {
  if (result.ok) response.status(200).json({ ok: true, data: result.value });
  else response.status(status(result.error)).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
};
const run = async (response: Response, operation: () => Promise<void>): Promise<void> => {
  try { await operation(); }
  catch (cause) {
    const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Inbound work is unavailable.");
    response.status(status(error)).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
  }
};
const context = async (request: Request, dependencies: InboundHttpDependencies, mutation = false): Promise<OperationContext> => {
  const organizationId = asString(request.params.organizationId, "organizationId", true)!;
  const value = mutation ? object(request.body) : undefined;
  const requestId = mutation ? asString(value!.businessRequestId, "businessRequestId", true)! : undefined;
  return {
    organizationId,
    operationId: "http:" + request.method + ":" + request.path,
    principal: await dependencies.principals.principal(request, organizationId),
    ...(requestId ? { businessRequest: { id: requestId, payloadFingerprint: "route-fingerprint-is-derived-by-operation" } } : {}),
  };
};
const intakeId = (request: Request): InboundIntakeId => brandedId<"InboundIntakeId">(asString(request.params.id, "inbound intake id", true)!);
const review = (body: Record<string, unknown>): ReviewInboundIntake => {
  const candidate = object(body.reviewDraft ?? body.draft ?? {});
  const lines = candidate.lines;
  if (lines !== undefined && !Array.isArray(lines)) throw new V2ApplicationError("VALIDATION_ERROR", "review draft lines are invalid.");
  const state = candidate.state ?? body.state;
  const fulfillmentIntent = candidate.fulfillmentIntent;
  const requestedFulfillment = candidate.requestedFulfillment === undefined ? undefined : object(candidate.requestedFulfillment);
  const fulfillmentMethod = requestedFulfillment?.method ?? fulfillmentIntent;
  if (fulfillmentMethod !== undefined && fulfillmentMethod !== "pickup" && fulfillmentMethod !== "shipping" && fulfillmentMethod !== "local_delivery")
    throw new V2ApplicationError("VALIDATION_ERROR", "fulfillmentIntent is invalid.");
  if (state !== undefined && state !== "needs_review" && state !== "ready") throw new V2ApplicationError("VALIDATION_ERROR", "Inbound review state is invalid.");
  return {
    businessRequestId: asString(body.businessRequestId, "businessRequestId", true)!,
    reviewDraft: {
      ...(asString(candidate.purchaseOrderNumber, "purchaseOrderNumber") ? { purchaseOrderNumber: asString(candidate.purchaseOrderNumber, "purchaseOrderNumber") } : {}),
      ...(asString(candidate.requestedDueDate, "requestedDueDate") ? { requestedDueDate: asString(candidate.requestedDueDate, "requestedDueDate") } : {}),
      ...(asString(candidate.notes, "notes") ? { notes: asString(candidate.notes, "notes") } : {}),
      ...(fulfillmentMethod ? { requestedFulfillment: requestedFulfillment ? requestedFulfillment as InboundReviewDraft["requestedFulfillment"] : { method: fulfillmentMethod } } : {}),
      ...(lines ? { lines: lines.map((line) => {
        const value = object(line);
        const productId = asString(value.productId, "Product", true)!;
        const quantity = value.quantity;
        if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Each proposed line needs a positive whole quantity.");
        return { productId: brandedId<"ProductId">(productId), quantity, ...(asString(value.description, "line description") ? { description: asString(value.description, "line description") } : {}), ...(value.selections && typeof value.selections === "object" && !Array.isArray(value.selections) ? { selections: value.selections as Record<string, unknown> } : {}), ...(value.dimensions && typeof value.dimensions === "object" && !Array.isArray(value.dimensions) ? { dimensions: value.dimensions as never } : {}) };
      }) } : {}),
    },
    ...(asString(body.matchedCustomerId ?? candidate.customerId, "matchedCustomerId") ? { matchedCustomerId: brandedId<"CustomerId">(asString(body.matchedCustomerId ?? candidate.customerId, "matchedCustomerId")!) } : {}),
    ...(asString(body.matchedContactId ?? candidate.contactId, "matchedContactId") ? { matchedContactId: brandedId<"ContactId">(asString(body.matchedContactId ?? candidate.contactId, "matchedContactId")!) } : {}),
    ...(state ? { state } : {}),
  };
};
const listQuery = (request: Request) => {
  const limit = Number(request.query.limit ?? 25);
  const state = typeof request.query.status === "string" ? request.query.status : undefined;
  if (state && state !== "all" && !(inboundIntakeStates as readonly string[]).includes(state)) throw new V2ApplicationError("VALIDATION_ERROR", "Inbound status is invalid.");
  return { limit: Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 25, ...(typeof request.query.cursor === "string" ? { cursor: request.query.cursor } : {}), ...(state && state !== "all" ? { status: state as (typeof inboundIntakeStates)[number] } : {}), ...(typeof request.query.q === "string" ? { search: request.query.q } : {}) };
};
const asIsoTimestamp = (value: unknown, label: string): string => {
  const parsed = asString(value, label, true)!;
  if (Number.isNaN(Date.parse(parsed))) throw new V2ApplicationError("VALIDATION_ERROR", label + " is invalid.");
  return parsed;
};
const assertSyntheticQaIngress = (organizationId:string):void => {
  if (!isM77fQaDevTarget(organizationId)) throw new V2ApplicationError("FORBIDDEN","Synthetic inbound is restricted to M7 QA DEV validation.");
};

/** Mounted only by the V2 authenticated host. Source ingestion is deliberately not a browser route. */
export const createInboundRouter = (dependencies: InboundHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  router.post("/dev-qa-synthetic", (request,response) => void run(response,async()=>{
    const body=object(request.body); const operation=await context(request,dependencies,true); assertSyntheticQaIngress(operation.organizationId);
    const sourceMessageId=asString(body.sourceMessageId,"sourceMessageId",true)!;
    const receivedAt=asIsoTimestamp(body.receivedAt,"receivedAt");
    const result=await dependencies.service.ingest(operation,{sourceProvider:"imported",sourceMessageId:`m77f:${sourceMessageId}`,sourceMailbox:"m77f-qa-synthetic",senderName:asString(body.senderName,"senderName"),senderEmail:asString(body.senderEmail,"senderEmail"),recipientEmail:asString(body.recipientEmail,"recipientEmail"),subject:asString(body.subject,"subject"),receivedAt,rawSource:{mode:"M77F_QA_SYNTHETIC",sourceMessageId,attachments:Array.isArray(body.attachments)?body.attachments:[]},normalizedBody:asString(body.body,"body"),extractedDraft:{}});
    send(response,result);
  }));
  router.get("/", (request, response) => void run(response, async () => send(response, await dependencies.service.list(await context(request, dependencies), listQuery(request)))));
  router.get("/:id", (request, response) => void run(response, async () => send(response, await dependencies.service.detail(await context(request, dependencies), intakeId(request)))));
  router.patch("/:id/review", (request, response) => void run(response, async () => {
    const body = object(request.body);
    const operation = await context(request, dependencies, true);
    const result = await dependencies.service.review(operation, intakeId(request), review(body));
    if (!result.ok) return send(response, result);
    response.status(200).json({ ok: true, data: result.value });
  }));
  router.post("/:id/convert", (request, response) => void run(response, async () => {
    const body = object(request.body);
    const operation = await context(request, dependencies, true);
    const result = await dependencies.service.convert(operation, intakeId(request), asString(body.businessRequestId, "businessRequestId", true)!);
    if (!result.ok) return send(response, result);
    response.status(200).json({ ok: true, data: result.value });
  }));
  router.post("/:id/mark-duplicate", (request, response) => void run(response, async () => {
    const body = object(request.body);
    const operation = await context(request, dependencies, true);
    const result = await dependencies.service.markTerminal(operation, intakeId(request), asString(body.businessRequestId, "businessRequestId", true)!, "duplicate", asString(body.reason, "reason", true)!);
    if (!result.ok) return send(response, result);
    response.status(200).json({ ok: true, data: result.value });
  }));
  router.post("/:id/reject", (request, response) => void run(response, async () => {
    const body = object(request.body);
    const operation = await context(request, dependencies, true);
    const result = await dependencies.service.markTerminal(operation, intakeId(request), asString(body.businessRequestId, "businessRequestId", true)!, "rejected", asString(body.reason, "reason", true)!);
    if (!result.ok) return send(response, result);
    response.status(200).json({ ok: true, data: result.value });
  }));
  router.post("/:id/retry", (request, response) => void run(response, async () => {
    const body = object(request.body);
    const operation = await context(request, dependencies, true);
    const result = await dependencies.service.retry(operation, intakeId(request), asString(body.businessRequestId, "businessRequestId", true)!);
    if (!result.ok) return send(response, result);
    response.status(200).json({ ok: true, data: result.value });
  }));
  return router;
};
