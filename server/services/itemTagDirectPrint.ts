import { and, asc, desc, eq, sql } from "drizzle-orm";
import { directPrintJobs, localBridgeAgents, orders, printerProfiles } from "@shared/schema";
import {
  itemTagPrintContextSchema, itemTagReceiptWidthMm,
  type ItemTagDestination, type ItemTagDirectPrintRequest, type ItemTagPrintContext,
} from "@shared/itemTagDirectPrint";
import { effectiveOrderFulfillmentMethod } from "@shared/orderFulfillmentMethod";
import { db } from "../db";
import { canAgentServeQueue } from "./printAgentQueueMapping";
import { getOrderTravelerSource } from "./orderTravelerSourceService";
import { lineItemArtworkReadResolver, resolveProductionArtworkReferences } from "./artwork/LineItemArtworkReadResolver";
import { publishPrintAgentWake } from "./printAgentWake";

export class ItemTagPrintError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function destinationRows(organizationId: string, destinationId?: string) {
  return db.select({
    id: printerProfiles.id, displayName: printerProfiles.displayName, location: printerProfiles.location,
    isDefault: printerProfiles.isDefault, queueName: printerProfiles.windowsQueueName,
    trailingFeedMm: printerProfiles.trailingFeedMm, agentId: localBridgeAgents.id,
    agentName: localBridgeAgents.name, agentStatus: localBridgeAgents.status, lastSeenAt: localBridgeAgents.lastSeenAt,
    configuredTravelerPrinterName: localBridgeAgents.configuredTravelerPrinterName,
    knownWindowsQueues: localBridgeAgents.knownWindowsQueues, agentVersion: localBridgeAgents.agentVersion,
    tokenHash: localBridgeAgents.tokenHash,
  }).from(printerProfiles).leftJoin(localBridgeAgents, and(eq(localBridgeAgents.id, printerProfiles.printAgentId),
    eq(localBridgeAgents.organizationId, organizationId))).where(and(
    eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true),
    eq(printerProfiles.printerType, "production_ticket"),
    eq(printerProfiles.receiptWidthMm, String(itemTagReceiptWidthMm)),
    sql`${printerProfiles.supportedDocuments} ? 'traveler'`,
    destinationId ? eq(printerProfiles.id, destinationId) : undefined,
  )).orderBy(desc(printerProfiles.isDefault), asc(printerProfiles.displayName));
}

type DestinationRow = Awaited<ReturnType<typeof destinationRows>>[number];

function describeDestination(row: DestinationRow, now = Date.now()): ItemTagDestination {
  const unavailableReason = !row.agentId || row.agentStatus !== "active"
    ? "Pair this printer with an active Print Agent in Settings → Printers."
    : !canAgentServeQueue(row, row.queueName)
      ? "The paired Print Agent does not report this Windows printer queue."
      : !row.lastSeenAt || now - new Date(row.lastSeenAt).getTime() > 90_000
        ? "The paired Print Agent appears offline. Open the agent on its workstation and refresh printers."
        : null;
  return { id: row.id, displayName: row.displayName, location: row.location, agentName: row.agentName,
    queueName: row.queueName, isDefault: row.isDefault, available: unavailableReason === null, unavailableReason };
}

export async function listItemTagDestinations(organizationId: string) {
  return (await destinationRows(organizationId)).map(row => describeDestination(row));
}

export async function queueItemTagPrint(organizationId: string, orderId: string, userId: string,
  request: ItemTagDirectPrintRequest, wake = publishPrintAgentWake) {
  const whereKey = and(eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, request.requestKey));
  const getExisting = async () => (await db.select().from(directPrintJobs).where(whereKey).limit(1))[0];
  const respond = (job: typeof directPrintJobs.$inferSelect, duplicate: boolean) => {
    const context = itemTagPrintContextSchema.safeParse(job.printContext);
    if (job.documentType !== "item_tag" || !context.success || job.orderId !== orderId ||
        job.createdByUserId !== userId || job.destinationId !== request.destinationId ||
        !sameSelection(context.data.selection, request.selection)) {
      throw new ItemTagPrintError(409, "This print request is already in use. Reopen the dialog to start a new print.");
    }
    return { id: job.id, status: job.status, duplicate, lastError: job.lastError?.slice(0, 240) ?? null };
  };
  const existing = await getExisting();
  if (existing) return respond(existing, true);

  const [destination] = await destinationRows(organizationId, request.destinationId);
  if (!destination) throw new ItemTagPrintError(409, "Select an active 80 mm Traveler printer or use Browser Print.");
  const availability = describeDestination(destination);
  if (!availability.available || !destination.agentId || !destination.queueName || !destination.tokenHash)
    throw new ItemTagPrintError(409, availability.unavailableReason ?? "The selected printer is unavailable.");

  const [source, [order]] = await Promise.all([
    getOrderTravelerSource(organizationId, orderId),
    db.select({ shippingMethod: orders.shippingMethod }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId))).limit(1),
  ]);
  if (!source || !order) throw new ItemTagPrintError(404, "No current printable lines were found for this Order.");
  const selection = request.selection;
  const line = selection.scope === "order" ? null : source.lineItems.find(item => item.orderLineItemId === selection.lineItemId);
  const orderedQuantity = line?.quantity ?? null;
  if (selection.scope !== "order" && (!orderedQuantity || !Number.isSafeInteger(orderedQuantity) || orderedQuantity < 1 ||
      (selection.scope === "partial" && selection.quantity > orderedQuantity))) {
    throw new ItemTagPrintError(409, "The saved Order line or quantity has changed. Refresh the Order and check the tag quantity.");
  }

  const artwork = selection.scope === "order" ? [] : await loadItemTagArtwork(organizationId, selection.lineItemId);
  const context: ItemTagPrintContext = { kind: "fulfillment_item_tag", selection, queueName: destination.queueName,
    orderedQuantity, fulfillmentMethod: effectiveOrderFulfillmentMethod(order.shippingMethod), artwork };
  const [created] = await db.insert(directPrintJobs).values({
    organizationId, orderId, destinationId: destination.id, agentId: destination.agentId,
    copies: 1, documentType: "item_tag", trailingFeedMm: destination.trailingFeedMm,
    printContext: context, requestKey: request.requestKey, createdByUserId: userId,
  }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
  const job = created ?? await getExisting();
  if (!job) throw new ItemTagPrintError(503, "Could not confirm the print request. Retry from this dialog.");
  const result = respond(job, !created);
  if (created) await wake(destination.tokenHash).catch(() => console.warn("[ITEM TAG PRINT] Wake unavailable; job is queued."));
  return result;
}

function sameSelection(a: ItemTagPrintContext["selection"], b: ItemTagPrintContext["selection"]) {
  if (a.scope === "order" || b.scope === "order") return a.scope === b.scope;
  return a.scope === b.scope && a.lineItemId === b.lineItemId && a.includeThumbnails === b.includeThumbnails &&
    (a.scope !== "partial" || (b.scope === "partial" && a.quantity === b.quantity));
}

async function loadItemTagArtwork(organizationId: string, lineItemId: string) {
  const artwork = await lineItemArtworkReadResolver.resolveForLineItems({
    organizationId, lineItemIds: [lineItemId], purpose: "print_ticket",
  });
  const references = resolveProductionArtworkReferences(artwork.get(lineItemId));
  return Array.from(new Map(references.map(item => [item.id, {
    id: item.id, fileRecordId: item.fileRecordId, fileName: item.file.originalFilename ?? item.id,
    side: item.side, productionQuantity: item.allocationQuantity, productionGroupId: item.allocationGroupId,
  }])).values());
}

/** Same agent and exact compatible queue must still be configured at claim. */
export async function itemTagDestinationStillValid(job: { organizationId: string; destinationId: string; agentId: string }, queueName: string) {
  const [row] = await destinationRows(job.organizationId, job.destinationId);
  return Boolean(row && row.agentId === job.agentId && row.queueName === queueName &&
    row.agentStatus === "active" && canAgentServeQueue(row, queueName));
}
