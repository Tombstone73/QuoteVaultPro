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

export const fulfillmentOperationCommandNames = [
  "fulfillment.create_shipment",
  "fulfillment.update_shipment_details",
  "fulfillment.mark_shipped",
  "fulfillment.create_pickup_ticket",
  "fulfillment.add_note",
] as const;
export type FulfillmentOperationCommandName =
  (typeof fulfillmentOperationCommandNames)[number];
type Intake = {
  command: FulfillmentOperationCommandName;
  orderIds?: string[];
  shipmentId?: string;
  details?: Record<string, unknown>;
  note?: string;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class FulfillmentOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class FulfillmentOperationsService {
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
    let source: unknown;
    let summary = "";
    const sourceLinks: { label: string; href: string }[] = [];
    if (
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
    const proposalFingerprint = hash({ sessionId: session.id, intake, source });
    return {
      fulfillmentIntakeSessionId: session.id,
      commandName: intake.command,
      proposalFingerprint,
      summary,
      sourceLinks,
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
    if (intake.command === "fulfillment.create_shipment")
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
      .set({ status: "created", updatedAt: new Date() })
      .where(eq(assistantFulfillmentIntakeSessions.id, session.id));
    return {
      sourceLinks: validation.proposal.sourceLinks,
      summary: validation.proposal.summary,
    };
  }
}
export const fulfillmentOperationsService = new FulfillmentOperationsService();
