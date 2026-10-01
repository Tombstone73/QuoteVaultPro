import { z } from "zod";
import { shippingDocumentTypeSchema, shippingDocumentSourceSchema, type ShippingDocumentSource, type ShippingDocumentType } from "./shippingDocuments";

export const directPrintDocumentTypes = ["traveler", "pickup_traveler", "quick_note", "packing_slip", "shipment_manifest", "package_ticket"] as const;
export type DirectPrintDocumentType = typeof directPrintDocumentTypes[number];
export const printerDocumentCapabilities = ["traveler", "quick_note", "packing_slip", "shipment_manifest", "package_ticket"] as const;
export const shippingDirectPrintRequestSchema = z.object({
  documentType: shippingDocumentTypeSchema,
  printerProfileId: z.string().trim().min(1),
  requestKey: z.string().trim().min(1).max(160),
  copies: z.number().int().min(1).max(99),
  packageId: z.string().trim().min(1).optional(),
}).strict().refine((value) => !value.packageId || value.documentType === "package_ticket", { message: "Only package tickets accept a package id" });
export type ShippingDirectPrintRequest = z.infer<typeof shippingDirectPrintRequestSchema>;
export type ShippingPrintContext = { shipmentId: string; packageId: string | null; source: ShippingDocumentSource };
export const shippingPrintContextSchema = z.object({ shipmentId: z.string().min(1), packageId: z.string().min(1).nullable(), source: shippingDocumentSourceSchema }).strict();
export const claimedShippingDocumentSchema = z.object({ jobId: z.string().min(1), documentType: shippingDocumentTypeSchema,
  packageId: z.string().min(1).nullable(), copies: z.number().int().min(1).max(99), source: shippingDocumentSourceSchema }).strict();
export type ClaimedShippingDocument = { jobId: string; documentType: ShippingDocumentType; packageId: string | null; copies: number; source: ShippingDocumentSource };
export type ShippingPrintDestination = { id: string; displayName: string; location: string | null; defaultCopies: number; isDefault: boolean; available: boolean; agentVersion: string | null; unavailableReason: string | null };

export function isShippingDocumentType(value: unknown): value is ShippingDocumentType {
  return shippingDocumentTypeSchema.safeParse(value).success;
}

export function matchesShippingPrintRequest(job: { documentType: string; destinationId: string; copies: number; printContext: unknown }, shipmentId: string, request: ShippingDirectPrintRequest): boolean {
  const context = job.printContext as ShippingPrintContext | null;
  return job.documentType === request.documentType && job.destinationId === request.printerProfileId
    && job.copies === request.copies && context?.shipmentId === shipmentId
    && context.packageId === (request.packageId ?? null);
}
