import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { directPrintJobs, localBridgeAgents, printerProfiles } from "@shared/schema";
import {
  buildProductionLabelDocument, productionLabelConfirmationThreshold, productionLabelMediaSchema, productionLabelPrintContextSchema,
  productionLabelSource, summarizeProductionLabels, type ProductionLabelDestination, type ProductionLabelOptions,
  type ProductionLabelMedia,
} from "@shared/productionItemLabels";
import { bridgeConnectionLabel } from "@shared/printBridgeConnection";
import { db } from "../db";
import { isAgentVersionAtLeast, MINIMUM_PRODUCTION_LABEL_AGENT_VERSION } from "../lib/directPrintAgentCapabilities";
import { buildOrderCreationFingerprint } from "../routes/helpers/orderCreationIdempotency.helpers";
import { getOrderTravelerSource } from "./orderTravelerSourceService";
import { canAgentServeQueue } from "./printAgentQueueMapping";
import { publishPrintAgentWake } from "./printAgentWake";

export class ProductionLabelError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const documentType = "production_item_label";
const fingerprint = (value: unknown) => createHash("sha256").update(buildOrderCreationFingerprint(value)).digest("hex");

function availableProfile(profile: typeof printerProfiles.$inferSelect, agent: typeof localBridgeAgents.$inferSelect | null) {
  const media = productionLabelMediaSchema.safeParse({
    widthMm: Number(profile.productionLabelWidthMm), heightMm: Number(profile.productionLabelHeightMm),
  });
  const unavailableReason = !media.success ? "Set the production label width and height in Printer Settings."
    : !agent || agent.status !== "active" ? "Pair an active Print Agent to this profile."
    : !isAgentVersionAtLeast(agent.agentVersion, MINIMUM_PRODUCTION_LABEL_AGENT_VERSION)
      ? "Install Print Agent " + MINIMUM_PRODUCTION_LABEL_AGENT_VERSION + " or newer."
    : !canAgentServeQueue(agent, profile.windowsQueueName) ? "Select a Windows queue reported by the paired agent."
    : bridgeConnectionLabel(agent.status, agent.connectionHealth) !== "Connected" ? "Reconnect the paired Print Agent or use Browser Print." : null;
  const destination: ProductionLabelDestination = {
    id: profile.id, name: profile.displayName, queueName: profile.windowsQueueName,
    media: media.success ? media.data : null, isDefault: profile.isDefault, unavailableReason,
  };
  return destination;
}

async function loadProfiles(organizationId: string, id?: string) {
  return db.select({ profile: printerProfiles, agent: localBridgeAgents }).from(printerProfiles)
    .leftJoin(localBridgeAgents, and(eq(localBridgeAgents.id, printerProfiles.printAgentId), eq(localBridgeAgents.organizationId, organizationId)))
    .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.isActive, true),
      sql`${printerProfiles.supportedDocuments} ? 'production_item_label'`, id ? eq(printerProfiles.id, id) : undefined));
}

export async function listProductionLabelDestinations(organizationId: string) {
  const profiles = await loadProfiles(organizationId);
  return profiles.map(({ profile, agent }) => availableProfile(profile, agent)).sort((left, right) =>
    Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

async function resolveProductionLabelDestination(organizationId: string, id: string) {
  const [row] = await loadProfiles(organizationId, id);
  if (!row) throw new ProductionLabelError(409, "Choose an active printer profile enabled for production item labels.");
  const destination = availableProfile(row.profile, row.agent);
  if (destination.unavailableReason || !row.agent || !destination.media || !destination.queueName) {
    throw new ProductionLabelError(409, destination.unavailableReason ?? "The selected printer is unavailable.");
  }
  return { destination, agent: row.agent, media: destination.media, queueName: destination.queueName };
}

export async function loadProductionLabelSource(organizationId: string, orderId: string) {
  const traveler = await getOrderTravelerSource(organizationId, orderId);
  if (!traveler) throw new ProductionLabelError(404, "No saved Order lines are available for production labels.");
  return productionLabelSource(traveler);
}

export async function previewProductionLabels(
  organizationId: string, orderId: string, options: ProductionLabelOptions,
  target: { type: "browser"; media: ProductionLabelMedia } | { type: "printer"; id: string },
) {
  const source = await loadProductionLabelSource(organizationId, orderId);
  const printer = target.type === "printer" ? await resolveProductionLabelDestination(organizationId, target.id) : null;
  const media = target.type === "browser" ? target.media : printer!.media;
  let document;
  try {
    document = buildProductionLabelDocument(source, options, media);
  } catch (error) {
    throw new ProductionLabelError(400, error instanceof Error ? error.message : "Invalid label configuration.");
  }
  const summary = summarizeProductionLabels(document);
  const previewFingerprint = fingerprint({
    orderId, options, document, printerId: printer?.destination.id, queue: printer?.queueName, agentId: printer?.agent.id,
  });
  return { document, summary, previewFingerprint, printer };
}

export async function queueProductionLabels(organizationId: string, orderId: string, userId: string, request: {
  destinationId: string; options: ProductionLabelOptions; previewFingerprint: string; confirmedLargeJob: boolean; requestKey: string;
}) {
  const requestFingerprint = fingerprint({ orderId, userId, ...request });
  const findExisting = async () => (await db.select().from(directPrintJobs).where(and(
    eq(directPrintJobs.organizationId, organizationId), eq(directPrintJobs.requestKey, request.requestKey),
  )).limit(1))[0];
  async function report(job: typeof directPrintJobs.$inferSelect, duplicate: boolean) {
    const saved = productionLabelPrintContextSchema.safeParse(job.printContext);
    if (job.documentType !== documentType || !saved.success || saved.data.requestFingerprint !== requestFingerprint)
      throw new ProductionLabelError(409, "This print request key belongs to a different submission.");
    // The existing queue is authoritative even if a wake cannot be delivered.
    const [agent] = job.status === "queued" ? await db.select({ tokenHash: localBridgeAgents.tokenHash }).from(localBridgeAgents).where(and(
      eq(localBridgeAgents.organizationId, organizationId), eq(localBridgeAgents.id, job.agentId), eq(localBridgeAgents.status, "active"),
    )).limit(1) : [];
    if (agent) await publishPrintAgentWake(agent.tokenHash);
    return { id: job.id, status: job.status, duplicate, labelCount: saved.data.labelCount };
  }
  const existing = await findExisting();
  if (existing) return report(existing, true);
  const preview = await previewProductionLabels(organizationId, orderId, request.options, { type: "printer", id: request.destinationId });
  if (preview.previewFingerprint !== request.previewFingerprint)
    throw new ProductionLabelError(409, "The saved Order or printer changed. Preview the labels again.");
  if (preview.summary.labelCount > productionLabelConfirmationThreshold && !request.confirmedLargeJob)
    throw new ProductionLabelError(400, "Confirm the number of labels before sending this large print job.");
  const printer = preview.printer!;
  const [created] = await db.insert(directPrintJobs).values({
    organizationId, orderId, destinationId: printer.destination.id, agentId: printer.agent.id,
    documentType, copies: 1, requestKey: request.requestKey, createdByUserId: userId,
    printContext: { ...preview.summary, document: preview.document, queueName: printer.queueName, destinationName: printer.destination.name,
      previewFingerprint: preview.previewFingerprint, requestFingerprint },
  }).onConflictDoNothing({ target: [directPrintJobs.organizationId, directPrintJobs.requestKey] }).returning();
  const job = created ?? await findExisting();
  if (!job) throw new ProductionLabelError(500, "Could not confirm the queued print job.");
  return report(job, !created);
}

export async function validateClaimedProductionLabelDestination(job: typeof directPrintJobs.$inferSelect) {
  const saved = productionLabelPrintContextSchema.safeParse(job.printContext);
  if (!saved.success) return false;
  try {
    const { agent, queueName, media } = await resolveProductionLabelDestination(job.organizationId, job.destinationId);
    return job.agentId === agent.id && saved.data.queueName === queueName
      && media.widthMm === saved.data.document.media.widthMm && media.heightMm === saved.data.document.media.heightMm;
  } catch (error) {
    if (error instanceof ProductionLabelError) return false;
    throw error;
  }
}
