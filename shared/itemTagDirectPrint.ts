import { z } from "zod";
import type { OrderTravelerSource } from "./productionTicket";

export const itemTagReceiptWidthMm = 80;
const id = z.string().trim().min(1).max(160);
const quantity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const itemTagSelectionSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("order") }).strict(),
  z.object({ scope: z.literal("line"), lineItemId: id, includeThumbnails: z.boolean() }).strict(),
  z.object({ scope: z.literal("partial"), lineItemId: id, includeThumbnails: z.boolean(), quantity }).strict(),
]);

export const itemTagDirectPrintRequestSchema = z.object({
  destinationId: id,
  requestKey: id,
  selection: itemTagSelectionSchema,
}).strict();
export type ItemTagDirectPrintRequest = z.infer<typeof itemTagDirectPrintRequestSchema>;

const itemTagArtworkSchema = z.object({
  id, fileRecordId: id, fileName: z.string(),
  side: z.enum(["front", "back", "both", "unknown"]).nullable(),
  productionQuantity: z.number().nullable(),
  productionGroupId: z.string().nullable(),
});
export type ItemTagArtwork = z.infer<typeof itemTagArtworkSchema>;

export const itemTagPrintContextSchema = z.object({
  kind: z.literal("fulfillment_item_tag"),
  selection: itemTagSelectionSchema,
  queueName: z.string().min(1).max(255),
  orderedQuantity: quantity.nullable(),
  fulfillmentMethod: z.enum(["pickup", "deliver", "ship"]),
  artwork: z.array(itemTagArtworkSchema),
}).strict();
export type ItemTagPrintContext = z.infer<typeof itemTagPrintContextSchema>;

export type ClaimedItemTag = { jobId: string; source: OrderTravelerSource; itemTag: ItemTagPrintContext };
export type ItemTagDestination = {
  id: string;
  displayName: string;
  location: string | null;
  agentName: string | null;
  queueName: string | null;
  available: boolean;
  isDefault: boolean;
  unavailableReason: string | null;
};
export type ItemTagPrintJob = { id: string; status: string; duplicate: boolean; lastError: string | null };
