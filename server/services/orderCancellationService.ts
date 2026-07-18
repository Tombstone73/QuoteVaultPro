import { and, desc, eq, inArray, ne, or } from "drizzle-orm";

import { db } from "../db";
import {
  auditLogs,
  fulfillmentEvents,
  inventoryReservations,
  invoices,
  lineItemProofVersions,
  orderAuditLog,
  orderLineItems,
  orderStatusEvents,
  orderWorkflowStatuses,
  orderWorkflowVersions,
  orders,
  payments,
  pickupTickets,
  productionEvents,
  productionJobs,
  proofAccessTokens,
  shipmentOrders,
  shipments,
  users,
} from "@shared/schema";
import {
  isCanceledOrder,
  isOperationallyActiveProductionJob,
  isTerminalProductionStatus,
} from "@shared/operationalState";
import {
  orderCancellationReasonLabels,
  type OrderCancellationReason,
} from "@shared/orderCancellation";
import { applyWorkflowStatusPillFailSoft } from "./workflowStatusPillService";

export type OrderCancellationBlockCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_ALREADY_CANCELED"
  | "ORDER_TERMINAL"
  | "PAID_INVOICE"
  | "PARTIALLY_PAID_INVOICE"
  | "SHIPPED_SHIPMENT"
  | "PICKED_UP_ORDER";

export class OrderCancellationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: OrderCancellationBlockCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OrderCancellationError";
  }
}

export type OrderCancellationSideEffects = {
  canceledProductionJobIds: string[];
  stoppedTimerJobIds: string[];
  canceledLineItemIds: string[];
  voidedInvoiceIds: string[];
  voidedShipmentIds: string[];
  voidedPickupTicketIds: string[];
  cancelledProofVersionIds: string[];
  supersededProofVersionIds: string[];
  releasedInventoryReservationIds: string[];
};

export type OrderCancellationResult = {
  order: typeof orders.$inferSelect;
  warnings: string[];
  sideEffects: OrderCancellationSideEffects;
};

type InvoiceDecision =
  | { action: "void"; invoiceId: string; status: string; reason: string }
  | { action: "skip"; invoiceId: string; status: string; reason: string }
  | { action: "block"; invoiceId: string; status: string; code: "PAID_INVOICE" | "PARTIALLY_PAID_INVOICE"; message: string };

export type ShipmentDecision =
  | { action: "void"; shipmentId: string; status: string; reason: string }
  | { action: "skip"; shipmentId: string; status: string; reason: string }
  | { action: "block"; shipmentId: string; status: string; code: "SHIPPED_SHIPMENT"; message: string };

function toMoneyNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function classifyInvoiceForCancellation(invoice: {
  id: string;
  status: string | null;
  amountPaid?: string | number | null;
  balanceDue?: string | number | null;
}, successfulPaymentCents = 0): InvoiceDecision {
  const status = String(invoice.status || "draft").trim().toLowerCase();
  const amountPaid = toMoneyNumber(invoice.amountPaid);

  if (status === "void" || status === "voided" || status === "cancelled" || status === "canceled") {
    return { action: "skip", invoiceId: invoice.id, status, reason: "already_void" };
  }

  if (status === "paid") {
    return {
      action: "block",
      invoiceId: invoice.id,
      status,
      code: "PAID_INVOICE",
      message: "Paid invoices require manual accounting action before cancelling the order.",
    };
  }

  if (status === "partially_paid" || amountPaid > 0 || successfulPaymentCents > 0) {
    return {
      action: "block",
      invoiceId: invoice.id,
      status,
      code: "PARTIALLY_PAID_INVOICE",
      message: "Partially paid invoices require manual accounting action before cancelling the order.",
    };
  }

  return { action: "void", invoiceId: invoice.id, status, reason: status === "draft" ? "draft_invoice" : "unpaid_invoice" };
}

export function classifyShipmentForCancellation(shipment: {
  id: string;
  status: string | null;
}): ShipmentDecision {
  const status = String(shipment.status || "DRAFT").trim().toUpperCase();
  if (status === "VOIDED") {
    return { action: "skip", shipmentId: shipment.id, status, reason: "already_voided" };
  }
  if (status === "SHIPPED") {
    return {
      action: "block",
      shipmentId: shipment.id,
      status,
      code: "SHIPPED_SHIPMENT",
      message: "Shipped shipments require manual handling before cancelling the order.",
    };
  }
  return { action: "void", shipmentId: shipment.id, status, reason: "pending_shipment" };
}

function emptySideEffects(): OrderCancellationSideEffects {
  return {
    canceledProductionJobIds: [],
    stoppedTimerJobIds: [],
    canceledLineItemIds: [],
    voidedInvoiceIds: [],
    voidedShipmentIds: [],
    voidedPickupTicketIds: [],
    cancelledProofVersionIds: [],
    supersededProofVersionIds: [],
    releasedInventoryReservationIds: [],
  };
}

async function getActorName(tx: any, actorUserId: string) {
  const [user] = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);

  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "System";
}

async function getCancellationWorkflowStatus(tx: any, organizationId: string) {
  const [activeWorkflow] = await tx
    .select({ id: orderWorkflowVersions.id })
    .from(orderWorkflowVersions)
    .where(and(eq(orderWorkflowVersions.organizationId, organizationId), eq(orderWorkflowVersions.isActive, true)))
    .orderBy(desc(orderWorkflowVersions.createdAt))
    .limit(1);

  if (!activeWorkflow) return null;

  const [status] = await tx
    .select()
    .from(orderWorkflowStatuses)
    .where(
      and(
        eq(orderWorkflowStatuses.organizationId, organizationId),
        eq(orderWorkflowStatuses.workflowVersionId, activeWorkflow.id),
        eq(orderWorkflowStatuses.category, "canceled"),
        eq(orderWorkflowStatuses.isActive, true),
      ),
    )
    .orderBy(orderWorkflowStatuses.sortOrder)
    .limit(1);

  return status ?? null;
}

async function getLatestTimerType(tx: any, organizationId: string, productionJobId: string) {
  const [lastTimer] = await tx
    .select({ type: productionEvents.type, createdAt: productionEvents.createdAt })
    .from(productionEvents)
    .where(
      and(
        eq(productionEvents.organizationId, organizationId),
        eq(productionEvents.productionJobId, productionJobId),
        inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
      ),
    )
    .orderBy(desc(productionEvents.createdAt))
    .limit(1);

  return lastTimer ?? null;
}

async function stopTimerIfRunning(tx: any, args: {
  organizationId: string;
  productionJob: typeof productionJobs.$inferSelect;
  actorUserId: string;
  now: Date;
}) {
  const lastTimer = await getLatestTimerType(tx, args.organizationId, args.productionJob.id);
  if (lastTimer?.type !== "timer_started") return false;

  const startedAtMs = new Date(lastTimer.createdAt as any).getTime();
  const deltaSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((args.now.getTime() - startedAtMs) / 1000))
    : 0;

  await tx.insert(productionEvents).values({
    organizationId: args.organizationId,
    productionJobId: args.productionJob.id,
    orderId: args.productionJob.orderId,
    orderLineItemId: args.productionJob.lineItemId,
    actorUserId: args.actorUserId,
    type: "timer_stopped",
    payload: {
      seconds: deltaSeconds,
      interruptedBy: "order_cancellation",
      previousStatus: args.productionJob.status,
      stoppedAt: args.now.toISOString(),
    },
  });

  await tx
    .update(productionJobs)
    .set({
      totalSeconds: (Number(args.productionJob.totalSeconds) || 0) + deltaSeconds,
      updatedAt: args.now,
    })
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.productionJob.id)));

  return true;
}

export async function cancelOrder(args: {
  organizationId: string;
  orderId: string;
  actorUserId: string;
  reason: OrderCancellationReason;
  internalNote?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<OrderCancellationResult> {
  const result = await db.transaction(async (tx) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const warnings: string[] = [];
    const sideEffects = emptySideEffects();

    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, args.orderId), eq(orders.organizationId, args.organizationId)))
      .limit(1);

    if (!order) {
      throw new OrderCancellationError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    if (isCanceledOrder(order)) {
      throw new OrderCancellationError(409, "ORDER_ALREADY_CANCELED", "Order is already cancelled");
    }

    if (order.state === "closed" || order.status === "completed") {
      throw new OrderCancellationError(409, "ORDER_TERMINAL", "Completed or closed orders cannot be cancelled from this workflow.");
    }

    const [orderInvoices, orderLineRows, orderProductionJobs, linkedShipmentRows, pickupRows, reservedInventoryRows, activeProofRows] =
      await Promise.all([
        tx.select().from(invoices).where(and(eq(invoices.organizationId, args.organizationId), eq(invoices.orderId, args.orderId))),
        tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, args.orderId)),
        tx.select().from(productionJobs).where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.orderId, args.orderId))),
        (async () => {
          const linkedIds = await tx
            .select({ shipmentId: shipmentOrders.shipmentId })
            .from(shipmentOrders)
            .where(and(eq(shipmentOrders.organizationId, args.organizationId), eq(shipmentOrders.orderId, args.orderId)));
          const ids = Array.from(new Set(linkedIds.map((r: any) => r.shipmentId).filter(Boolean)));
          const shipmentPredicates = [
            eq(shipments.orderId, args.orderId),
            eq(shipments.primaryOrderId, args.orderId),
          ];
          if (ids.length > 0) {
            shipmentPredicates.push(inArray(shipments.id, ids));
          }
          return tx
            .select()
            .from(shipments)
            .where(
              and(
                eq(shipments.organizationId, args.organizationId),
                or(...shipmentPredicates),
              ),
            );
        })(),
        tx.select().from(pickupTickets).where(and(eq(pickupTickets.organizationId, args.organizationId), eq(pickupTickets.orderId, args.orderId))),
        tx
          .select({ id: inventoryReservations.id })
          .from(inventoryReservations)
          .where(and(eq(inventoryReservations.organizationId, args.organizationId), eq(inventoryReservations.orderId, args.orderId), eq(inventoryReservations.status, "RESERVED"))),
        tx
          .select()
          .from(lineItemProofVersions)
          .where(
            and(
              eq(lineItemProofVersions.organizationId, args.organizationId),
              eq(lineItemProofVersions.orderId, args.orderId),
              inArray(lineItemProofVersions.status, ["draft", "awaiting_response"]),
            ),
          ),
      ]);

    const paymentRows = orderInvoices.length
      ? await tx
          .select({
            invoiceId: payments.invoiceId,
            amountCents: payments.amountCents,
            amount: payments.amount,
            status: payments.status,
          })
          .from(payments)
          .where(
            and(
              eq(payments.organizationId, args.organizationId),
              inArray(payments.invoiceId, orderInvoices.map((invoice: any) => invoice.id)),
              inArray(payments.status, ["succeeded", "voided"]),
            ),
          )
      : [];

    const paidCentsByInvoiceId = new Map<string, number>();
    for (const payment of paymentRows) {
      if (payment.status === "voided") continue;
      const cents = Number(payment.amountCents) || Math.round(toMoneyNumber(payment.amount) * 100);
      paidCentsByInvoiceId.set(payment.invoiceId, (paidCentsByInvoiceId.get(payment.invoiceId) || 0) + Math.max(0, cents));
    }

    const invoiceDecisions = orderInvoices.map((invoice: any) =>
      classifyInvoiceForCancellation(invoice, paidCentsByInvoiceId.get(invoice.id) || 0),
    );
    const blockingInvoice = invoiceDecisions.find((decision) => decision.action === "block");
    if (blockingInvoice?.action === "block") {
      throw new OrderCancellationError(409, blockingInvoice.code, blockingInvoice.message, {
        invoiceId: blockingInvoice.invoiceId,
        status: blockingInvoice.status,
      });
    }

    const shipmentDecisions = linkedShipmentRows.map((shipment: any) => classifyShipmentForCancellation(shipment));
    const blockingShipment = shipmentDecisions.find((decision) => decision.action === "block");
    if (blockingShipment?.action === "block") {
      throw new OrderCancellationError(409, blockingShipment.code, blockingShipment.message, {
        shipmentId: blockingShipment.shipmentId,
        status: blockingShipment.status,
      });
    }

    const pickedUp = pickupRows.find((ticket: any) => String(ticket.status).toUpperCase() === "PICKED_UP");
    if (pickedUp) {
      throw new OrderCancellationError(409, "PICKED_UP_ORDER", "Picked up orders require manual handling before cancelling the order.", {
        pickupTicketId: pickedUp.id,
      });
    }

    const actorName = await getActorName(tx, args.actorUserId);
    const reasonLabel = orderCancellationReasonLabels[args.reason];
    const noteText = args.internalNote?.trim() || null;

    for (const job of orderProductionJobs) {
      if (!isOperationallyActiveProductionJob(job)) continue;

      const timerStopped = await stopTimerIfRunning(tx, {
        organizationId: args.organizationId,
        productionJob: job,
        actorUserId: args.actorUserId,
        now,
      });
      if (timerStopped) sideEffects.stoppedTimerJobIds.push(job.id);

      await tx
        .update(productionJobs)
        .set({
          status: "canceled",
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, job.id)));

      await tx.insert(productionEvents).values({
        organizationId: args.organizationId,
        productionJobId: job.id,
        orderId: job.orderId,
        orderLineItemId: job.lineItemId,
        actorUserId: args.actorUserId,
        type: "status_changed",
        payload: {
          previousStatus: job.status,
          newStatus: "canceled",
          reason: args.reason,
          internalNote: noteText,
          source: "order_cancellation",
          canceledAt: nowIso,
        },
      });

      sideEffects.canceledProductionJobIds.push(job.id);
    }

    const lineItemsToCancel = orderLineRows.filter((lineItem: any) => {
      const status = String(lineItem.status || "").toLowerCase();
      const workflowState = String(lineItem.workflowState || "").toLowerCase();
      return status !== "canceled" && status !== "complete" && workflowState !== "completed";
    });

    if (lineItemsToCancel.length > 0) {
      const lineItemIds = lineItemsToCancel.map((lineItem: any) => lineItem.id);
      await tx
        .update(orderLineItems)
        .set({ status: "canceled", workflowState: "canceled", updatedAt: now })
        .where(inArray(orderLineItems.id, lineItemIds));
      sideEffects.canceledLineItemIds.push(...lineItemIds);
    }

    const proofVersionIds = activeProofRows.map((proof: any) => proof.id);
    if (proofVersionIds.length > 0) {
      await tx
        .update(lineItemProofVersions)
        .set({ status: "cancelled", updatedAt: now })
        .where(inArray(lineItemProofVersions.id, proofVersionIds));

      await tx
        .update(proofAccessTokens)
        .set({ revokedAt: now })
        .where(and(eq(proofAccessTokens.organizationId, args.organizationId), inArray(proofAccessTokens.proofVersionId, proofVersionIds)));

      for (const proof of activeProofRows) {
        await tx.insert(orderAuditLog).values({
          orderId: args.orderId,
          orderLineItemId: proof.lineItemId,
          userId: args.actorUserId,
          userName: actorName,
          actionType: "proof_version_cancelled",
          fromStatus: proof.status,
          toStatus: "cancelled",
          note: noteText,
          metadata: {
            source: "order_cancellation",
            proofVersionId: proof.id,
            reason: args.reason,
            canceledAt: nowIso,
          },
        });
      }
      sideEffects.cancelledProofVersionIds.push(...proofVersionIds);
    }

    for (const decision of invoiceDecisions) {
      if (decision.action !== "void") continue;
      const invoice = orderInvoices.find((row: any) => row.id === decision.invoiceId);
      const voidNote = `Voided by order cancellation (${reasonLabel})${noteText ? `: ${noteText}` : ""}`;
      const existingNote = String(invoice?.notesInternal || "").trim();
      await tx
        .update(invoices)
        .set({
          status: "void",
          balanceDue: "0",
          notesInternal: existingNote ? `${existingNote}\n${voidNote}` : voidNote,
          updatedAt: now,
        } as any)
        .where(and(eq(invoices.organizationId, args.organizationId), eq(invoices.id, decision.invoiceId)));
      sideEffects.voidedInvoiceIds.push(decision.invoiceId);
    }

    const draftShipmentIds = shipmentDecisions
      .filter((decision): decision is Extract<ShipmentDecision, { action: "void" }> => decision.action === "void")
      .map((decision) => decision.shipmentId);
    if (draftShipmentIds.length > 0) {
      await tx
        .update(shipments)
        .set({ status: "VOIDED", updatedAt: now })
        .where(and(eq(shipments.organizationId, args.organizationId), inArray(shipments.id, draftShipmentIds)));

      await tx.insert(fulfillmentEvents).values(
        draftShipmentIds.map((shipmentId) => ({
          organizationId: args.organizationId,
          actorUserId: args.actorUserId,
          entityType: "SHIPMENT",
          entityId: shipmentId,
          eventType: "SHIPMENT_VOIDED",
          payloadJson: { source: "order_cancellation", reason: args.reason, canceledAt: nowIso },
        })),
      );
      sideEffects.voidedShipmentIds.push(...draftShipmentIds);
    }

    const pickupTicketIds = pickupRows
      .filter((ticket: any) => ["DRAFT", "READY_FOR_PICKUP"].includes(String(ticket.status).toUpperCase()))
      .map((ticket: any) => ticket.id);
    if (pickupTicketIds.length > 0) {
      await tx
        .update(pickupTickets)
        .set({ status: "VOIDED", updatedAt: now })
        .where(and(eq(pickupTickets.organizationId, args.organizationId), inArray(pickupTickets.id, pickupTicketIds)));

      await tx.insert(fulfillmentEvents).values(
        pickupTicketIds.map((ticketId) => ({
          organizationId: args.organizationId,
          actorUserId: args.actorUserId,
          entityType: "PICKUP_TICKET",
          entityId: ticketId,
          eventType: "PICKUP_VOIDED",
          payloadJson: { source: "order_cancellation", reason: args.reason, canceledAt: nowIso },
        })),
      );
      sideEffects.voidedPickupTicketIds.push(...pickupTicketIds);
    }

    const reservationIds = reservedInventoryRows.map((row: any) => row.id);
    if (reservationIds.length > 0) {
      await tx
        .update(inventoryReservations)
        .set({ status: "RELEASED", updatedAt: now })
        .where(and(eq(inventoryReservations.organizationId, args.organizationId), inArray(inventoryReservations.id, reservationIds)));
      sideEffects.releasedInventoryReservationIds.push(...reservationIds);
    }

    const workflowStatus = await getCancellationWorkflowStatus(tx, args.organizationId);
    const updatePayload: Partial<typeof orders.$inferInsert> = {
      state: "canceled",
      status: "canceled",
      canonicalState: "canceled",
      workflowStatusId: workflowStatus?.id ?? order.workflowStatusId,
      canceledAt: nowIso as any,
      cancellationReason: args.reason,
      routingTarget: null,
      billingStatus: order.billingStatus === "billed" ? order.billingStatus : "not_ready",
      billingReadyAt: null,
      updatedAt: now as any,
    };

    const [updatedOrder] = await tx
      .update(orders)
      .set(updatePayload as any)
      .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, args.orderId), ne(orders.state, "canceled")))
      .returning();

    if (!updatedOrder) {
      throw new OrderCancellationError(409, "ORDER_ALREADY_CANCELED", "Order was already cancelled by another request.");
    }

    if (workflowStatus) {
      await tx.insert(orderStatusEvents).values({
        organizationId: args.organizationId,
        orderId: args.orderId,
        fromStatusId: order.workflowStatusId,
        toStatusId: workflowStatus.id,
        fromStatusLabel: order.status,
        toStatusLabel: workflowStatus.label,
        changedByUserId: args.actorUserId,
        changedAt: now,
        note: noteText || reasonLabel,
      });
    }

    const eventSnapshot = {
      source: "order_cancellation",
      orderId: args.orderId,
      orderNumber: order.orderNumber,
      actorUserId: args.actorUserId,
      reason: args.reason,
      reasonLabel,
      internalNote: noteText,
      canceledAt: nowIso,
      sideEffects,
      invoices: orderInvoices.map((invoice: any) => ({ id: invoice.id, status: invoice.status })),
      shipments: linkedShipmentRows.map((shipment: any) => ({ id: shipment.id, status: shipment.status })),
      productionJobs: orderProductionJobs.map((job: any) => ({ id: job.id, status: job.status })),
    };

    await tx.insert(auditLogs).values({
      organizationId: args.organizationId,
      userId: args.actorUserId,
      userName: actorName,
      actionType: "ORDER_CANCELLED",
      entityType: "order",
      entityId: args.orderId,
      entityName: order.orderNumber,
      description: `Order cancelled: ${reasonLabel}`,
      oldValues: {
        state: order.state,
        status: order.status,
        workflowStatusId: order.workflowStatusId,
      },
      newValues: eventSnapshot,
      ipAddress: args.ipAddress || null,
      userAgent: args.userAgent || null,
    } as any);

    await tx.insert(orderAuditLog).values({
      orderId: args.orderId,
      userId: args.actorUserId,
      userName: actorName,
      actionType: "order_cancelled",
      fromStatus: order.state || order.status,
      toStatus: "canceled",
      note: noteText || reasonLabel,
      metadata: eventSnapshot,
    });

    if (sideEffects.voidedInvoiceIds.length > 0) {
      warnings.push(`${sideEffects.voidedInvoiceIds.length} unpaid invoice(s) were voided.`);
    }
    if (sideEffects.voidedShipmentIds.length > 0 || sideEffects.voidedPickupTicketIds.length > 0) {
      warnings.push("Pending fulfillment records were voided.");
    }
    if (sideEffects.stoppedTimerJobIds.length > 0) {
      warnings.push("Active production timer(s) were stopped and preserved as interrupted by cancellation.");
    }

    return { order: updatedOrder, warnings, sideEffects };
  });

  // Canonical cancellation commits first. Status-pill automation is fail-soft and
  // cannot roll back or weaken the cancellation side effects.
  await applyWorkflowStatusPillFailSoft({
    organizationId: args.organizationId,
    orderId: args.orderId,
    triggerKey: "order_canceled",
    actorUserId: args.actorUserId,
    source: "system",
    reason: args.internalNote?.trim() || orderCancellationReasonLabels[args.reason],
    metadata: {
      workflowEvent: "order_canceled",
      cancellationReason: args.reason,
    },
  });

  const [refreshedOrder] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, args.orderId)))
    .limit(1);
  return { ...result, order: refreshedOrder ?? result.order };
}
