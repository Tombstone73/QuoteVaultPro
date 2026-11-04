import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { directPrintJobs, localBridgeAgents, orders, printerProfiles, shipments } from "@shared/schema";

/** Read-only projection. Never expose printContext, pairing secrets, or wake topics. */
export async function listDirectPrintJobDiagnostics(organizationId: string, ids?: string[]) {
  const rows = await db.select({
    id: directPrintJobs.id, status: directPrintJobs.status, documentType: directPrintJobs.documentType,
    copies: directPrintJobs.copies, orderNumber: orders.orderNumber, agentId: directPrintJobs.agentId,
    agentName: localBridgeAgents.name, machineLabel: localBridgeAgents.machineLabel,
    queueName: printerProfiles.windowsQueueName, destinationName: printerProfiles.displayName,
    createdAt: directPrintJobs.createdAt, claimedAt: directPrintJobs.claimedAt,
    submittedAt: directPrintJobs.submittedAt, failedAt: directPrintJobs.failedAt,
    updatedAt: directPrintJobs.updatedAt, lastError: directPrintJobs.lastError,
  }).from(directPrintJobs)
    .leftJoin(localBridgeAgents, and(eq(localBridgeAgents.id, directPrintJobs.agentId), eq(localBridgeAgents.organizationId, organizationId)))
    .leftJoin(printerProfiles, and(eq(printerProfiles.id, directPrintJobs.destinationId), eq(printerProfiles.organizationId, organizationId)))
    .leftJoin(shipments, and(eq(shipments.id, sql`${directPrintJobs.printContext}->>'shipmentId'`), eq(shipments.organizationId, organizationId)))
    .leftJoin(orders, and(eq(orders.id, sql`coalesce(${directPrintJobs.orderId},${shipments.primaryOrderId},${shipments.orderId})`), eq(orders.organizationId, organizationId)))
    .where(and(eq(directPrintJobs.organizationId, organizationId), ids ? inArray(directPrintJobs.id, ids) : undefined))
    .orderBy(desc(directPrintJobs.createdAt)).limit(ids?.length ?? 50);
  return rows.map(row => ({
    ...row,
    lastError: row.lastError?.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/(token|apikey|api_key|authorization)=\S+/gi, "$1=[redacted]")
      .replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 500) ?? null,
  }));
}
