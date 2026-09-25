import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { directPrintJobs, fulfillmentEvents, pickupHandoffs, pickupHandoffItems, users } from "@shared/schema";
import { pickupReversalHistory, pickupTravelerContext, samePickupQuantities, type PickupTravelerHistoryEntry } from "@shared/pickupTravelerProgress";
import { FulfillmentHttpError } from "./fulfillment/types";

/** Validate and lock explicitly selected paperwork before the physical transaction.
 * No matching by timestamp, quantity similarity, or last-printed job is permitted. */
export async function lockPickupTravelers(tx: any, orgId: string, orderId: string, ids: string[], items: Array<{ orderLineItemId: string; quantity: number }>) {
  if (!ids.length) return [];
  const unique = Array.from(new Set(ids));
  const jobs = await tx.select().from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, orgId),
    eq(directPrintJobs.orderId, orderId), eq(directPrintJobs.documentType, "pickup_traveler"), inArray(directPrintJobs.id, unique))).for("update");
  if (jobs.length !== unique.length || jobs.some((job: any) => {
    const context = pickupTravelerContext(job.printContext);
    return !context?.progressSnapshot || context.pickupHandoffId || context.reprintOf || !samePickupQuantities(context.lineQuantities, items);
  })) throw new FulfillmentHttpError(409, "Selected Travelers must be unlinked preparations with exactly these pickup quantities. Select matching paperwork or clear the selection.", "PICKUP_TRAVELER_MISMATCH");
  return jobs;
}

/** Only the association changes; document/progress/box snapshots are untouched. */
export async function bindPickupTravelers(tx: any, orgId: string, jobs: Array<{ id: string }>, handoffId: string) {
  if (!jobs.length) return;
  await tx.update(directPrintJobs).set({ printContext: sql`jsonb_set(${directPrintJobs.printContext}, '{pickupHandoffId}', to_jsonb(${handoffId}::text))` })
    .where(and(eq(directPrintJobs.organizationId, orgId), inArray(directPrintJobs.id, jobs.map(j => j.id))));
}

export async function listPickupTravelers(executor: any, orgId: string, orderId: string): Promise<PickupTravelerHistoryEntry[]> {
  const jobs = await executor.select({ id: directPrintJobs.id, createdAt: directPrintJobs.createdAt, printContext: directPrintJobs.printContext })
    .from(directPrintJobs).where(and(eq(directPrintJobs.organizationId, orgId), eq(directPrintJobs.orderId, orderId),
      eq(directPrintJobs.documentType, "pickup_traveler"))).orderBy(desc(directPrintJobs.createdAt));
  const events = await executor.select({ id: pickupHandoffs.id, createdAt: pickupHandoffs.handedOffAt, payloadJson: fulfillmentEvents.payloadJson })
    .from(pickupHandoffs).innerJoin(fulfillmentEvents, and(eq(fulfillmentEvents.organizationId, orgId),
      eq(fulfillmentEvents.entityType, "PICKUP_TICKET"), eq(fulfillmentEvents.entityId, pickupHandoffs.pickupTicketId),
      eq(fulfillmentEvents.eventType, "PICKUP_HANDOFF_RECORDED"), sql`${fulfillmentEvents.payloadJson}->>'handoffId' = ${pickupHandoffs.id}`))
    .where(and(eq(pickupHandoffs.organizationId, orgId), eq(pickupHandoffs.orderId, orderId)));
  const sources = [...jobs, ...events.map((event: any) => ({ id: `handoff:${event.id}`, createdAt: event.createdAt, printContext: event.payloadJson?.travelerContext }))];
  return sources.flatMap((job: any) => {
    const context = pickupTravelerContext(job.printContext);
    if (!context || context.reprintOf) return [];
    return [{ id: job.id, createdAt: new Date(job.createdAt).toISOString(), pickupHandoffId: context.pickupHandoffId ?? null,
      box: context.box ?? null, ...(context.box === undefined ? { legacyBoxCount: context.boxCount } : {}),
      lines: context.lineQuantities.map(l => ({ ...l, description: context.documentSnapshot?.lineItems.find(d => d.orderLineItemId === l.orderLineItemId)?.description || "Line item" })) }];
  });
}

/** Original paper can belong to a prepared print job or to the completion event
 * when no document was printed beforehand. Both are tenant/order scoped. */
export async function loadSavedPickupTraveler(executor: any, orgId: string, orderId: string, id: string) {
  if (!id.startsWith("handoff:")) {
    const [job] = await executor.select({ printContext: directPrintJobs.printContext }).from(directPrintJobs)
      .where(and(eq(directPrintJobs.id, id), eq(directPrintJobs.organizationId, orgId),
        eq(directPrintJobs.orderId, orderId), eq(directPrintJobs.documentType, "pickup_traveler"))).limit(1);
    return pickupTravelerContext(job?.printContext);
  }
  const handoffId = id.slice("handoff:".length);
  const [event] = await executor.select({ payloadJson: fulfillmentEvents.payloadJson }).from(pickupHandoffs)
    .innerJoin(fulfillmentEvents, and(eq(fulfillmentEvents.organizationId, orgId), eq(fulfillmentEvents.entityType, "PICKUP_TICKET"),
      eq(fulfillmentEvents.entityId, pickupHandoffs.pickupTicketId), eq(fulfillmentEvents.eventType, "PICKUP_HANDOFF_RECORDED"),
      sql`${fulfillmentEvents.payloadJson}->>'handoffId' = ${pickupHandoffs.id}`))
    .where(and(eq(pickupHandoffs.organizationId, orgId), eq(pickupHandoffs.orderId, orderId), eq(pickupHandoffs.id, handoffId))).limit(1);
  return pickupTravelerContext(event?.payloadJson?.travelerContext);
}

/** Live status only. Quantity and document snapshots are never recomputed. */
export async function readPickupTravelerStatus(executor: any, orgId: string, orderId: string, handoffId: string) {
  const [handoff] = await executor.select({ id: pickupHandoffs.id, ticketId: pickupHandoffs.pickupTicketId }).from(pickupHandoffs)
    .where(and(eq(pickupHandoffs.organizationId, orgId), eq(pickupHandoffs.orderId, orderId), eq(pickupHandoffs.id, handoffId))).limit(1);
  if (!handoff) throw new FulfillmentHttpError(409, "The Traveler's pickup association could not be verified.", "PICKUP_TRAVELER_HANDOFF_MISSING");
  const items = await executor.select({ orderLineItemId: pickupHandoffItems.orderLineItemId, quantity: pickupHandoffItems.quantity }).from(pickupHandoffItems)
    .where(and(eq(pickupHandoffItems.organizationId, orgId), eq(pickupHandoffItems.pickupHandoffId, handoff.id)));
  const events = await executor.select({ id: fulfillmentEvents.id, eventType: fulfillmentEvents.eventType, payloadJson: fulfillmentEvents.payloadJson,
    createdAt: fulfillmentEvents.createdAt, actorUserId: fulfillmentEvents.actorUserId, actorFirstName: users.firstName, actorLastName: users.lastName })
    .from(fulfillmentEvents).leftJoin(users, eq(users.id, fulfillmentEvents.actorUserId))
    .where(and(eq(fulfillmentEvents.organizationId, orgId), eq(fulfillmentEvents.entityType, "PICKUP_TICKET"),
      eq(fulfillmentEvents.entityId, handoff.ticketId), eq(fulfillmentEvents.eventType, "PICKUP_HANDOFF_REVERSED")));
  return pickupReversalHistory(handoffId, items, events).status;
}
