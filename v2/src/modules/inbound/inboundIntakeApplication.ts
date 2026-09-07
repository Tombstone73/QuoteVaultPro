import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { CreateOrderInput, OrderOperationResult } from "../sales/orderApplication.js";
import { brandedId, type InboundIntakeId, type OrderId, type OrganizationId } from "../shared/commercialValues.js";
import {
  assertInboundReviewDraftReady,
  type InboundIntake,
  type InboundIntakeDetail,
  type InboundIntakeEvent,
  type InboundIntakePage,
  type InboundIntakeQuery,
  type InboundIntakeState,
  type IngestInboundIntake,
  type ReviewInboundIntake,
} from "./contracts.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
const actor = (context: OperationContext): Actor => ({
  principalKind: context.principal.kind,
  principalSubject: principalSubject(context.principal),
  ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
});
const stableConversionRequestId = (intakeId: InboundIntakeId): string =>
  "inbound-convert:" + createHash("sha256").update(intakeId).digest("hex");

export interface InboundIntakeStore {
  list(organizationId: OrganizationId, query: InboundIntakeQuery): Promise<InboundIntakePage>;
  detail(organizationId: OrganizationId, intakeId: InboundIntakeId): Promise<InboundIntakeDetail | null>;
  ingest(organizationId: OrganizationId, input: IngestInboundIntake, actor: Actor): Promise<InboundIntake>;
  transaction<T>(action: (transaction: InboundIntakeTransaction) => Promise<T>): Promise<T>;
}

export interface InboundIntakeTransaction {
  detail(organizationId: OrganizationId, intakeId: InboundIntakeId, lock?: boolean): Promise<InboundIntakeDetail | null>;
  hasEvent(organizationId: OrganizationId, intakeId: InboundIntakeId, eventType: string, businessRequestId: string): Promise<boolean>;
  saveReview(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; review: ReviewInboundIntake; state: "needs_review" | "ready"; actor: Actor }>): Promise<InboundIntake>;
  transition(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; from: readonly InboundIntakeState[]; to: InboundIntakeState; reason?: string; actor: Actor }>): Promise<InboundIntake | null>;
  reserveConversion(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; conversionRequestId: string; actor: Actor }>): Promise<InboundIntake | null>;
  completeConversion(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; conversionRequestId: string; orderId: OrderId; actor: Actor }>): Promise<InboundIntake | null>;
  recordEvent(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; type: string; businessRequestId?: string; detail?: Readonly<Record<string, unknown>>; actor: Actor }>): Promise<InboundIntakeEvent>;
}

/** Sales remains the only Order writer. Inbound translates a reviewed draft into its command. */
export interface InboundOrderConversionPort {
  createOrder(context: OperationContext, input: CreateOrderInput): Promise<ApplicationResult<OrderOperationResult>>;
}

const reject = (code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR", message: string): never => {
  throw new V2ApplicationError(code, message);
};
const requireValue = <T>(value: T | null, code: "NOT_FOUND" | "CONFLICT", message: string): T => {
  if (value === null) throw new V2ApplicationError(code, message);
  return value;
};

export class InboundIntakeApplicationService {
  constructor(
    private readonly store: InboundIntakeStore,
    private readonly orders: InboundOrderConversionPort,
    private readonly authority = new AuthorityPolicy(),
  ) {}

  private allow(context: OperationContext, capability: "inbound.view" | "inbound.review" | "order.create"): void {
    requireOperationPrincipalScope(context);
    if (!this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed)
      reject("FORBIDDEN", "Inbound Orders access is unavailable.");
  }

  async list(context: OperationContext, query: InboundIntakeQuery): Promise<ApplicationResult<InboundIntakePage>> {
    try {
      this.allow(context, "inbound.view");
      return success(await this.store.list(brandedId<"OrganizationId">(context.organizationId), query));
    } catch (cause) { return failure(asError(cause)); }
  }

  async detail(context: OperationContext, intakeId: InboundIntakeId): Promise<ApplicationResult<InboundIntakeDetail>> {
    try {
      this.allow(context, "inbound.view");
      const detail = requireValue(await this.store.detail(brandedId<"OrganizationId">(context.organizationId), intakeId), "NOT_FOUND", "Inbound work was not found.");
      return success(detail);
    } catch (cause) { return failure(asError(cause)); }
  }

  /** Provider adapters call this only after bounded retrieval; it has no provider side effects. */
  async ingest(context: OperationContext, input: IngestInboundIntake): Promise<ApplicationResult<InboundIntake>> {
    try {
      this.allow(context, "inbound.review");
      return success(await this.store.ingest(brandedId<"OrganizationId">(context.organizationId), input, actor(context)));
    } catch (cause) { return failure(asError(cause)); }
  }

  async review(context: OperationContext, intakeId: InboundIntakeId, review: ReviewInboundIntake): Promise<ApplicationResult<InboundIntake>> {
    try {
      this.allow(context, "inbound.review");
      if (!review.businessRequestId.trim()) reject("VALIDATION_ERROR", "businessRequestId is required.");
      const organizationId = brandedId<"OrganizationId">(context.organizationId);
      const result = await this.store.transaction(async (transaction) => {
        const current = requireValue(await transaction.detail(organizationId, intakeId, true), "NOT_FOUND", "Inbound work was not found.");
        if (current.intake.state === "converted") reject("CONFLICT", "Converted inbound work cannot be edited.");
        if (await transaction.hasEvent(organizationId, intakeId, "reviewed", review.businessRequestId)) return current.intake;
        const state = review.state ?? "needs_review";
        if (state === "ready") assertInboundReviewDraftReady(review.reviewDraft, review.matchedCustomerId);
        const saved = await transaction.saveReview({ organizationId, intakeId, review, state, actor: actor(context) });
        await transaction.recordEvent({ organizationId, intakeId, type: "reviewed", businessRequestId: review.businessRequestId, detail: { state }, actor: actor(context) });
        return saved;
      });
      return success(result);
    } catch (cause) { return failure(asError(cause)); }
  }

  async markTerminal(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string, state: "duplicate" | "rejected", reason: string): Promise<ApplicationResult<InboundIntake>> {
    try {
      this.allow(context, "inbound.review");
      if (!businessRequestId.trim() || !reason.trim()) reject("VALIDATION_ERROR", "businessRequestId and a reason are required.");
      const organizationId = brandedId<"OrganizationId">(context.organizationId);
      const eventType = state === "duplicate" ? "marked_duplicate" : "rejected";
      const result = await this.store.transaction(async (transaction) => {
        const current = requireValue(await transaction.detail(organizationId, intakeId, true), "NOT_FOUND", "Inbound work was not found.");
        if (await transaction.hasEvent(organizationId, intakeId, eventType, businessRequestId)) return current.intake;
        const changed = requireValue(await transaction.transition({ organizationId, intakeId, from: ["received", "needs_review", "ready", "failed", "action_required"], to: state, reason, actor: actor(context) }), "CONFLICT", "Inbound work is no longer eligible for this decision.");
        await transaction.recordEvent({ organizationId, intakeId, type: eventType, businessRequestId, detail: { reason }, actor: actor(context) });
        return changed;
      });
      return success(result);
    } catch (cause) { return failure(asError(cause)); }
  }

  async retry(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string): Promise<ApplicationResult<InboundIntake>> {
    try {
      this.allow(context, "inbound.review");
      if (!businessRequestId.trim()) reject("VALIDATION_ERROR", "businessRequestId is required.");
      const organizationId = brandedId<"OrganizationId">(context.organizationId);
      const result = await this.store.transaction(async (transaction) => {
        const current = requireValue(await transaction.detail(organizationId, intakeId, true), "NOT_FOUND", "Inbound work was not found.");
        if (await transaction.hasEvent(organizationId, intakeId, "retried", businessRequestId)) return current.intake;
        const changed = requireValue(await transaction.transition({ organizationId, intakeId, from: ["failed", "action_required"], to: "needs_review", actor: actor(context) }), "CONFLICT", "Only failed inbound work can be retried.");
        await transaction.recordEvent({ organizationId, intakeId, type: "retried", businessRequestId, actor: actor(context) });
        return changed;
      });
      return success(result);
    } catch (cause) { return failure(asError(cause)); }
  }

  async convert(context: OperationContext, intakeId: InboundIntakeId, businessRequestId: string): Promise<ApplicationResult<Readonly<{ intake: InboundIntake; orderId: OrderId; replayed: boolean }>>> {
    try {
      this.allow(context, "inbound.review");
      this.allow(context, "order.create");
      if (!businessRequestId.trim()) reject("VALIDATION_ERROR", "businessRequestId is required.");
      const organizationId = brandedId<"OrganizationId">(context.organizationId);
      const conversionRequestId = stableConversionRequestId(intakeId);
      const reserved = await this.store.transaction(async (transaction) => {
        const current = requireValue(await transaction.detail(organizationId, intakeId, true), "NOT_FOUND", "Inbound work was not found.");
        if (current.intake.state === "converted" && current.intake.convertedOrderId)
          return { intake: current.intake, replayed: true };
        if (current.intake.state !== "ready" && current.intake.state !== "converting")
          reject("CONFLICT", "Inbound work must be reviewed and marked ready before conversion.");
        assertInboundReviewDraftReady(current.intake.reviewDraft, current.intake.matchedCustomerId);
        const intake = requireValue(await transaction.reserveConversion({ organizationId, intakeId, conversionRequestId, actor: actor(context) }), "CONFLICT", "Inbound conversion is already owned by another request.");
        return { intake, replayed: false };
      });
      if (reserved.replayed) return success({ intake: reserved.intake, orderId: reserved.intake.convertedOrderId!, replayed: true });
      const draft = reserved.intake.reviewDraft;
      const customerContact = reserved.intake.matchedContactId
        ? { organizationId, customerId: reserved.intake.matchedCustomerId!, contactId: reserved.intake.matchedContactId }
        : { organizationId, customerId: reserved.intake.matchedCustomerId! };
      const created = await this.orders.createOrder(context, {
        businessRequestId: conversionRequestId,
        customerContact,
        ...(draft.purchaseOrderNumber ? { purchaseOrderNumber: draft.purchaseOrderNumber } : {}),
        ...(draft.requestedDueDate ? { requestedDueDate: draft.requestedDueDate } : {}),
        ...(draft.requestedFulfillment ? { requestedFulfillment: draft.requestedFulfillment } : {}),
        lines: draft.lines!.map((line) => ({ productId: line.productId, ...(line.description ? { description: line.description } : {}), quantity: line.quantity, ...(line.selections ? { selections: line.selections } : {}), ...(line.dimensions ? { dimensions: line.dimensions } : {}) })),
      });
      if (!created.ok) {
        await this.store.transaction(async (transaction) => {
          const failed = requireValue(
            await transaction.transition({
              organizationId, intakeId, from: ["converting"], to: "action_required",
              reason: created.error.publicMessage, actor: actor(context),
            }),
            "CONFLICT", "Inbound conversion failure could not be recorded.",
          );
          await transaction.recordEvent({
            organizationId, intakeId, type: "conversion_failed", businessRequestId,
            detail: { code: created.error.code }, actor: actor(context),
          });
          return failed;
        });
        return failure(created.error);
      }
      const orderId = created.value.order.order.orderId;
      const completed = await this.store.transaction(async (transaction) => {
        const intake = requireValue(await transaction.completeConversion({ organizationId, intakeId, conversionRequestId, orderId, actor: actor(context) }), "CONFLICT", "Inbound conversion completion could not be recorded.");
        await transaction.recordEvent({ organizationId, intakeId, type: "converted", businessRequestId, detail: { orderId }, actor: actor(context) });
        return intake;
      });
      return success({ intake: completed, orderId, replayed: false });
    } catch (cause) { return failure(asError(cause)); }
  }
}

const asError = (cause: unknown): V2ApplicationError =>
  cause instanceof V2ApplicationError
    ? cause
    : new V2ApplicationError("VALIDATION_ERROR", cause instanceof Error ? cause.message : "Inbound work could not be processed.");
