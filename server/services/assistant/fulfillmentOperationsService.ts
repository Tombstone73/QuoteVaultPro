import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  assistantFulfillmentIntakeSessions,
  orders,
  shipments,
  type AssistantFulfillmentIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { canonicalFulfillmentOperations } from "../fulfillment/canonicalFulfillmentOperations";
import { isFulfillmentQueueEligibleOrder } from "../fulfillment/eligibility";
import { FulfillmentHttpError, type FulfillmentDetailDto } from "../fulfillment/types";
import { buildPickupTravelerProgressSnapshot } from "@shared/pickupTravelerProgress";

export const fulfillmentOperationCommandNames = [
  "fulfillment.create_shipment",
  "fulfillment.update_shipment_details",
  "fulfillment.mark_shipped",
  "fulfillment.create_pickup_ticket",
  "fulfillment.record_pickup",
  "fulfillment.add_note",
] as const;
export type FulfillmentOperationCommandName =
  (typeof fulfillmentOperationCommandNames)[number];
type Intake = {
  command: FulfillmentOperationCommandName;
  orderIds?: string[];
  shipmentId?: string;
  orderId?: string;
  orderLineItemId?: string;
  fulfillmentOrderId?: string;
  quantity?: number;
  timing?: "today" | null;
  details?: Record<string, unknown>;
  note?: string;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type PendingFulfillmentPickup = {
  orderId: string | null;
  orderLineItemId: string | null;
  /**
   * Investigation's Fulfillment resource is an Order-owned workspace. Its id
   * is therefore the canonical Order id, not a persisted fulfillment row id.
   */
  fulfillmentOrderId: string | null;
  quantity: number | null;
  timing: "today" | null;
};

type CanonicalPickupPreview = {
  orderId: string;
  orderNumber: string;
  orderLineItemId: string;
  productLabel: string;
  orderedQuantity: number;
  currentPickedUpQuantity: number;
  requestedQuantity: number;
  projectedPickedUpQuantity: number;
  projectedRemainingQuantity: number;
  pickupTicketId: string | null;
};

type CanonicalPickupTarget = {
  orderId: string;
  orderLineItemId: string | null;
  fulfillmentWorkspaceOrderId: string | null;
};

const nonEmptyId = (value: string | null | undefined) =>
  typeof value === "string" && value.trim() ? value : null;

/**
 * Binds a pickup proposal to the same Order-keyed target used by the
 * fulfillment workspace UI. A workspace reference is an order key only; it
 * is never used as a synthetic fulfillment-record identifier.
 */
export function resolveCanonicalPickupTarget(input: {
  orderId?: string | null;
  orderLineItemId?: string | null;
  fulfillmentOrderId?: string | null;
}): CanonicalPickupTarget {
  const explicitOrderId = nonEmptyId(input.orderId);
  const fulfillmentWorkspaceOrderId = nonEmptyId(input.fulfillmentOrderId);
  const orderLineItemId = nonEmptyId(input.orderLineItemId);
  if (!explicitOrderId && !fulfillmentWorkspaceOrderId) {
    throw new FulfillmentOperationError(
      "FULFILLMENT_TARGET_NOT_RESOLVABLE",
      "The pickup action could not resolve one canonical order. Nothing was changed.",
    );
  }
  if (explicitOrderId && fulfillmentWorkspaceOrderId && explicitOrderId !== fulfillmentWorkspaceOrderId) {
    throw new FulfillmentOperationError(
      "PICKUP_TARGET_MISMATCH",
      "The resolved fulfillment workspace belongs to a different order. Nothing was changed.",
    );
  }
  return {
    orderId: explicitOrderId ?? fulfillmentWorkspaceOrderId!,
    orderLineItemId,
    fulfillmentWorkspaceOrderId,
  };
}

function resolveCanonicalPickupLine(
  detail: FulfillmentDetailDto,
  requestedOrderLineItemId: string | null,
) {
  if (requestedOrderLineItemId) {
    const line = detail.lineItems.find((candidate) => candidate.id === requestedOrderLineItemId);
    if (!line) throw new FulfillmentOperationError("ORDER_LINE_NOT_FOUND", "The resolved order line is no longer part of this order.");
    return line;
  }
  // The UI sends a selected line id. When the action handoff has not yet
  // persisted a line discovered during this same Operator run, the server can
  // make the same unambiguous selection only for one eligible, remaining line.
  const eligibleLines = detail.lineItems.filter((candidate) =>
    candidate.production.eligible && candidate.production.remainingQuantity > 0,
  );
  if (eligibleLines.length === 1) return eligibleLines[0]!;
  if (eligibleLines.length > 1) {
    throw new FulfillmentOperationError(
      "FULFILLMENT_TARGET_NOT_RESOLVABLE",
      "More than one eligible fulfillment line remains. Select the line for this pickup. Nothing was changed.",
    );
  }
  throw new FulfillmentOperationError(
    "FULFILLMENT_TARGET_NOT_RESOLVABLE",
    "The pickup action could not resolve an eligible fulfillment line. Nothing was changed.",
  );
}

/**
 * Presentation-only projection of the authoritative fulfillment detail. The
 * canonical Fulfillment service still decides whether a handoff is allowed
 * and recomputes quantities under its line lock at execution time.
 */
export function previewPendingFulfillmentPickup(
  detail: FulfillmentDetailDto,
  intake: Pick<Intake, "orderId" | "orderLineItemId" | "fulfillmentOrderId" | "quantity">,
): CanonicalPickupPreview {
  const target = resolveCanonicalPickupTarget(intake);
  const quantity = intake.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new FulfillmentOperationError("PICKUP_DETAILS_REQUIRED", "A positive pickup quantity is required.");
  }
  if (detail.orderId !== target.orderId) {
    throw new FulfillmentOperationError("PICKUP_TARGET_MISMATCH", "The fulfillment workspace does not belong to the resolved order. Nothing was changed.");
  }
  if (detail.fulfillmentType !== "PICKUP") {
    throw new FulfillmentOperationError("PICKUP_NOT_ELIGIBLE", "This order is not currently configured for pickup fulfillment.");
  }
  const line = resolveCanonicalPickupLine(detail, target.orderLineItemId);
  const currentPickedUpQuantity = line.production.pickedUpQuantity;
  const remainingQuantity = line.production.remainingQuantity;
  if (quantity > remainingQuantity) {
    throw new FulfillmentOperationError("QTY_EXCEEDS_ORDER", "Pickup quantity exceeds the remaining order quantity for this line item.");
  }
  // Reuse the shared canonical pre-handoff projection used by the Fulfillment
  // workflow instead of making the Assistant its own quantity calculator.
  const projected = buildPickupTravelerProgressSnapshot([
    { id: line.id, production: line.production },
  ], [{ orderLineItemId: line.id, quantity }], new Date().toISOString()).lines[0];
  if (!projected) throw new FulfillmentOperationError("PICKUP_PREVIEW_UNAVAILABLE", "The canonical pickup projection could not be prepared.");
  return {
    orderId: detail.orderId,
    orderNumber: detail.orderNumber,
    orderLineItemId: line.id,
    productLabel: line.productName || line.description || "Order line",
    orderedQuantity: line.production.orderedQuantity,
    currentPickedUpQuantity,
    requestedQuantity: quantity,
    projectedPickedUpQuantity: projected.afterPickupQuantity,
    projectedRemainingQuantity: projected.remainingAfterPickupQuantity,
    pickupTicketId: detail.pickupTicket?.id ?? null,
  };
}
export class FulfillmentOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class FulfillmentOperationsService {
  /** Turn a previously resolved, non-executable Operator intent into the
   * existing durable fulfillment intake/proposal boundary. */
  async prepareRecordPickup(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    pending: PendingFulfillmentPickup;
  }) {
    const target = resolveCanonicalPickupTarget(input.pending);
    return this.createProposal({
      organizationId: input.organizationId,
      userId: input.userId,
      conversationId: input.conversationId,
      intake: {
        command: "fulfillment.record_pickup",
        orderId: target.orderId,
        orderLineItemId: target.orderLineItemId ?? undefined,
        fulfillmentOrderId: target.fulfillmentWorkspaceOrderId ?? undefined,
        quantity: input.pending.quantity ?? undefined,
        timing: input.pending.timing,
      },
    });
  }

  async respond(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    message: string;
  }) {
    const message = input.message.trim();
    let intake: Intake | null = null;
    const shipment = message.match(
      /\bcreate\s+shipment\s+(?:for\s+)?([\w,-]+)/i,
    );
    const pickup = message.match(
      /\bcreate\s+pickup\s+(?:ticket\s+)?(?:for\s+)?([\w-]+)/i,
    );
    const shipped = message.match(/\bmark\s+shipment\s+([\w-]+)\s+shipped/i);
    const update = message.match(
      /\bupdate\s+shipment\s+([\w-]+)\s+(?:tracking|tracking number)\s*[:\-]?\s*(\S+)/i,
    );
    const note = message.match(
      /\b(?:add\s+)?fulfillment\s+note\s+(?:for\s+)?([\w-]+)\s*[:\-]\s*(.+)$/i,
    );
    if (shipment)
      intake = {
        command: "fulfillment.create_shipment",
        orderIds: shipment[1]
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      };
    else if (pickup)
      intake = {
        command: "fulfillment.create_pickup_ticket",
        orderIds: [pickup[1]],
      };
    else if (shipped)
      intake = { command: "fulfillment.mark_shipped", shipmentId: shipped[1] };
    else if (update)
      intake = {
        command: "fulfillment.update_shipment_details",
        shipmentId: update[1],
        details: { trackingNumber: update[2] },
      };
    else if (note)
      intake = {
        command: "fulfillment.add_note",
        orderIds: [note[1]],
        note: note[2].trim(),
      };
    if (!intake) return { handled: false, response: "", cards: [] };
    try {
      const proposal = await this.createProposal({ ...input, intake });
      return {
        handled: true,
        response:
          "I prepared a fulfillment preview. Use the dedicated GO control to confirm; free-text GO cannot execute fulfillment changes.",
        cards: [
          {
            kind: "fulfillment_operation_proposal",
            title: "Fulfillment operation proposal",
            summary: proposal.summary,
            sourceLinks: proposal.sourceLinks,
            details: proposal,
          },
          {
            kind: "action_proposal",
            title: "Confirm fulfillment operation",
            summary:
              "Confirmation is required and cannot create invoices or payments.",
            sourceLinks: [],
            plan: {
              action: intake.command,
              fulfillmentIntakeSessionId: proposal.fulfillmentIntakeSessionId,
              proposalFingerprint: proposal.proposalFingerprint,
            },
          },
        ],
      };
    } catch (error) {
      const summary =
        error instanceof Error
          ? error.message
          : "Unable to prepare fulfillment operation.";
      return {
        handled: true,
        response: summary,
        cards: [
          {
            kind: "missing_information",
            title: "Fulfillment operation unavailable",
            summary,
            sourceLinks: [],
          },
        ],
      };
    }
  }
  private async createProposal(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    intake: Intake;
  }) {
    const [session] = await db
      .insert(assistantFulfillmentIntakeSessions)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        conversationId: input.conversationId,
        commandName: input.intake.command,
        intakeJson: input.intake,
      })
      .returning();
    const proposal = await this.buildProposal(input.organizationId, session);
    await db
      .update(assistantFulfillmentIntakeSessions)
      .set({
        proposalFingerprint: proposal.proposalFingerprint,
        intakeJson: proposal.resolvedIntake,
        updatedAt: new Date(),
      })
      .where(eq(assistantFulfillmentIntakeSessions.id, session.id));
    return proposal;
  }
  private async load(org: string, id: string) {
    const [session] = await db
      .select()
      .from(assistantFulfillmentIntakeSessions)
      .where(
        and(
          eq(assistantFulfillmentIntakeSessions.id, id),
          eq(assistantFulfillmentIntakeSessions.organizationId, org),
        ),
      )
      .limit(1);
    if (!session)
      throw new FulfillmentOperationError(
        "SESSION_NOT_FOUND",
        "Fulfillment proposal not found.",
      );
    return session;
  }
  async buildProposal(
    org: string,
    session: AssistantFulfillmentIntakeSessionRow,
  ) {
    const intake = session.intakeJson as Intake;
    let resolvedIntake = intake;
    let source: unknown;
    let summary = "";
    let pickupPreview: CanonicalPickupPreview | null = null;
    const sourceLinks: { label: string; href: string }[] = [];
    if (intake.command === "fulfillment.record_pickup") {
      const target = resolveCanonicalPickupTarget(intake);
      let detail: FulfillmentDetailDto;
      try {
        detail = await canonicalFulfillmentOperations.getOrderDetail(org, target.orderId);
      } catch (error) {
        if (error instanceof FulfillmentHttpError && error.code === "NOT_FOUND") {
          throw new FulfillmentOperationError("ORDER_NOT_FOUND", "The resolved order is no longer available for fulfillment. Nothing was changed.");
        }
        throw error;
      }
      const preview = previewPendingFulfillmentPickup(detail, intake);
      pickupPreview = preview;
      resolvedIntake = {
        ...intake,
        orderId: preview.orderId,
        orderLineItemId: preview.orderLineItemId,
      };
      source = {
        orderId: preview.orderId,
        orderLineItemId: preview.orderLineItemId,
        fulfillmentOrderId: intake.fulfillmentOrderId,
        quantity: preview.requestedQuantity,
        pickupTicketId: preview.pickupTicketId,
        currentPickedUpQuantity: preview.currentPickedUpQuantity,
        remainingQuantity: preview.projectedRemainingQuantity + preview.requestedQuantity,
        pickupStatus: detail.pickupTicket?.status ?? null,
      };
      sourceLinks.push(
        { label: `Open Order ${preview.orderNumber}`, href: `/orders/${preview.orderId}` },
        { label: "Open fulfillment workspace", href: `/fulfillment/orders/${preview.orderId}` },
      );
      summary = `Record a ${preview.requestedQuantity}-piece pickup${intake.timing === "today" ? " today" : ""} for ${preview.productLabel} on Order ${preview.orderNumber}. Current picked up: ${preview.currentPickedUpQuantity} of ${preview.orderedQuantity}; after pickup: ${preview.projectedPickedUpQuantity}; remaining: ${preview.projectedRemainingQuantity}.`;
    } else if (
      intake.command === "fulfillment.create_shipment" ||
      intake.command === "fulfillment.create_pickup_ticket" ||
      intake.command === "fulfillment.add_note"
    ) {
      const ids = Array.from(new Set(intake.orderIds ?? []));
      if (!ids.length || ids.length > 10)
        throw new FulfillmentOperationError(
          "ORDER_REQUIRED",
          "Select between one and ten orders.",
        );
      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.organizationId, org), inArray(orders.id, ids)));
      if (rows.length !== ids.length)
        throw new FulfillmentOperationError(
          "ORDER_NOT_FOUND",
          "One or more orders were not found.",
        );
      if (
        intake.command !== "fulfillment.add_note" &&
        rows.some((order) => !isFulfillmentQueueEligibleOrder(order as any))
      )
        throw new FulfillmentOperationError(
          "ORDER_NOT_ELIGIBLE",
          "Selected orders are not eligible for fulfillment.",
        );
      if (
        intake.command === "fulfillment.create_pickup_ticket" &&
        (rows.length !== 1 || rows[0].shippingMethod !== "pickup")
      )
        throw new FulfillmentOperationError(
          "PICKUP_NOT_ELIGIBLE",
          "Pickup tickets require one eligible pickup order.",
        );
      if (intake.command === "fulfillment.add_note" && !intake.note)
        throw new FulfillmentOperationError(
          "NOTE_REQUIRED",
          "An internal fulfillment note is required.",
        );
      source = rows;
      sourceLinks.push(
        ...rows.map((order) => ({
          label: "Open order",
          href: `/orders/${order.id}`,
        })),
      );
      summary =
        intake.command === "fulfillment.create_shipment"
          ? `Create a draft shipment for ${rows.length} eligible order(s).`
          : intake.command === "fulfillment.create_pickup_ticket"
            ? "Create or reuse the eligible pickup ticket."
            : "Add an internal fulfillment note without changing state.";
    } else {
      if (!intake.shipmentId)
        throw new FulfillmentOperationError(
          "SHIPMENT_REQUIRED",
          "A shipment is required.",
        );
      const record = await canonicalFulfillmentOperations.getShipment(
        org,
        intake.shipmentId,
      );
      if (!record)
        throw new FulfillmentOperationError(
          "SHIPMENT_NOT_FOUND",
          "Shipment not found.",
        );
      if (
        intake.command === "fulfillment.mark_shipped" &&
        record.status !== "DRAFT"
      )
        throw new FulfillmentOperationError(
          "SHIPMENT_NOT_EDITABLE",
          "Only draft shipments can be marked shipped.",
        );
      source = record;
      sourceLinks.push({
        label: "Open shipment",
        href: `/fulfillment/shipments/${record.id}`,
      });
      summary =
        intake.command === "fulfillment.mark_shipped"
          ? "Mark this eligible draft shipment shipped without billing automation."
          : "Update safe draft shipment details only.";
    }
    const proposalFingerprint = hash({ sessionId: session.id, intake: resolvedIntake, source });
    return {
      fulfillmentIntakeSessionId: session.id,
      commandName: intake.command,
      proposalFingerprint,
      resolvedIntake,
      summary,
      sourceLinks,
      ...(pickupPreview ? { pickupPreview } : {}),
    };
  }
  async revalidateProposal(input: {
    organizationId: string;
    fulfillmentIntakeSessionId: string;
    expectedProposalFingerprint: string;
  }) {
    const session = await this.load(
      input.organizationId,
      input.fulfillmentIntakeSessionId,
    );
    if (session.status !== "preview_ready")
      return {
        valid: false as const,
        code: "FULFILLMENT_PROPOSAL_NOT_READY",
        summary: "Fulfillment proposal is not ready.",
      };
    const proposal = await this.buildProposal(input.organizationId, session);
    return session.proposalFingerprint === input.expectedProposalFingerprint &&
      proposal.proposalFingerprint === input.expectedProposalFingerprint
      ? { valid: true as const, proposal }
      : {
          valid: false as const,
          code: "FULFILLMENT_PROPOSAL_STALE",
          summary: "Fulfillment records changed; review a fresh preview.",
        };
  }
  async executeConfirmed(input: {
    organizationId: string;
    actorUserId: string;
    fulfillmentIntakeSessionId: string;
    proposalFingerprint: string;
    clientRequestId?: string;
    correlationId?: string;
    planId?: string;
  }) {
    const session = await this.load(
      input.organizationId,
      input.fulfillmentIntakeSessionId,
    );
    if (session.userId !== input.actorUserId)
      throw new FulfillmentOperationError(
        "SESSION_FORBIDDEN",
        "Only the proposing user can confirm this fulfillment operation.",
      );
    const validation = await this.revalidateProposal({
      organizationId: input.organizationId,
      fulfillmentIntakeSessionId: session.id,
      expectedProposalFingerprint: input.proposalFingerprint,
    });
    if (!validation.valid)
      throw new FulfillmentOperationError(validation.code, validation.summary);
    const intake = session.intakeJson as Intake;
    let pickupExecutionReference: { handoffId: string; planId: string | null; correlationId: string | null } | null = null;
    if (intake.command === "fulfillment.record_pickup") {
      // Creating a missing ticket is the canonical UI prerequisite; the
      // handoff itself remains the single authoritative pickup mutation.
      const ticket = await canonicalFulfillmentOperations.createOrGetPickupTicket(
        input.organizationId,
        intake.orderId!,
        input.actorUserId,
      );
      const result = await canonicalFulfillmentOperations.recordPickupHandoff(
        input.organizationId,
        ticket.id,
        {
          items: [{ orderLineItemId: intake.orderLineItemId!, quantity: intake.quantity! }],
          clientRequestId: input.clientRequestId,
        },
        input.actorUserId,
      );
      pickupExecutionReference = { handoffId: result.handoff.id, planId: input.planId ?? null, correlationId: input.correlationId ?? null };
    } else if (intake.command === "fulfillment.create_shipment")
      await canonicalFulfillmentOperations.createShipment(input.organizationId, {
        scope: intake.orderIds!.length === 1 ? "SINGLE_ORDER" : "MULTI_ORDER",
        orderIds: intake.orderIds!,
        primaryOrderId: intake.orderIds![0],
        actorUserId: input.actorUserId,
      });
    else if (intake.command === "fulfillment.mark_shipped")
      await canonicalFulfillmentOperations.markShipmentShipped(
        input.organizationId,
        intake.shipmentId!,
        input.actorUserId,
        { suppressBillingAutomation: true },
      );
    else if (intake.command === "fulfillment.create_pickup_ticket")
      await canonicalFulfillmentOperations.createOrGetPickupTicket(
        input.organizationId,
        intake.orderIds![0],
        input.actorUserId,
      );
    else if (intake.command === "fulfillment.add_note")
      await canonicalFulfillmentOperations.addOrderNote(
        input.organizationId,
        intake.orderIds![0],
        intake.note!,
        input.actorUserId,
      );
    else
      await canonicalFulfillmentOperations.patchShipment(
        input.organizationId,
        intake.shipmentId!,
        { ...(intake.details as any), actorUserId: input.actorUserId },
      );
    await db
      .update(assistantFulfillmentIntakeSessions)
      .set({
        status: "created",
        // This is Assistant telemetry only. The immutable handoff and its
        // fulfillment event remain the canonical business history.
        ...(pickupExecutionReference ? { intakeJson: { ...intake, assistantExecution: pickupExecutionReference } } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assistantFulfillmentIntakeSessions.id, session.id));
    if (intake.command === "fulfillment.record_pickup") {
      const detail = await canonicalFulfillmentOperations.getOrderDetail(input.organizationId, intake.orderId!);
      const line = detail.lineItems.find((candidate) => candidate.id === intake.orderLineItemId!);
      if (!line) throw new FulfillmentOperationError("ORDER_LINE_NOT_FOUND", "The pickup succeeded but its order line could not be reloaded.");
      return {
        sourceLinks: validation.proposal.sourceLinks,
        summary: `Recorded ${intake.quantity}-piece pickup. Authoritative state: ${line.production.pickedUpQuantity} picked up of ${line.production.orderedQuantity}; ${line.production.remainingQuantity} remaining.`,
      };
    }
    return { sourceLinks: validation.proposal.sourceLinks, summary: validation.proposal.summary };
  }
}
export const fulfillmentOperationsService = new FulfillmentOperationsService();
