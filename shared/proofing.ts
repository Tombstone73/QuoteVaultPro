import { z } from "zod";

import { lineItemWorkflowStateSchema } from "./schema";

export const proofVersionStatusValues = [
  "draft",
  "awaiting_response",
  "approved",
  "rejected",
  "revision_requested",
  "superseded",
] as const;

export const proofDecisionValues = [
  "approved",
  "rejected",
  "revision_requested",
] as const;

export const proofVersionStatusSchema = z.enum(proofVersionStatusValues);
export const proofDecisionSchema = z.enum(proofDecisionValues);

export const proofVersionHistoryEntrySchema = z.object({
  id: z.string(),
  proofFileId: z.string(),
  versionNumber: z.number().int(),
  status: proofVersionStatusSchema,
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  sentToName: z.string().nullable(),
  sentToEmail: z.string().nullable(),
});

export const proofDecisionHistoryEntrySchema = z.object({
  id: z.string(),
  proofVersionId: z.string(),
  decision: proofDecisionSchema,
  responseNotes: z.string().nullable(),
  responderName: z.string().nullable(),
  responderEmail: z.string().nullable(),
  responderSource: z.string().nullable(),
  respondedAt: z.string().datetime(),
});

export const proofingReadModelSchema = z.object({
  lineItemId: z.string(),
  orderId: z.string(),
  workflowState: lineItemWorkflowStateSchema,
  requiresProofApproval: z.boolean(),
  approvedProofVersionId: z.string().nullable(),
  currentActionableProofVersionId: z.string().nullable(),
  currentActionableProofDecisionId: z.string().nullable(),
  currentActionableProofVersion: proofVersionHistoryEntrySchema.nullable(),
  approvedProofVersion: proofVersionHistoryEntrySchema.nullable(),
  proofVersionHistory: z.array(proofVersionHistoryEntrySchema),
  proofDecisionHistory: z.array(proofDecisionHistoryEntrySchema),
  blockedPendingProofApproval: z.boolean(),
});

export type ProofVersionStatus = z.infer<typeof proofVersionStatusSchema>;
export type ProofDecision = z.infer<typeof proofDecisionSchema>;
export type ProofVersionHistoryEntry = z.infer<typeof proofVersionHistoryEntrySchema>;
export type ProofDecisionHistoryEntry = z.infer<typeof proofDecisionHistoryEntrySchema>;
export type ProofingReadModel = z.infer<typeof proofingReadModelSchema>;
