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

export const proofApprovalSourceValues = [
  "normal",
  "manual_override",
] as const;

export const proofQueueSliceValues = [
  "all",
  "awaiting_send",
  "awaiting_approval",
  "revision_requested",
  "approved",
] as const;

export const proofQueueStatusValues = [
  "awaiting_send",
  "awaiting_approval",
  "revision_requested",
  "approved",
  "approved_by_override",
  "rejected",
  "no_active_proof",
] as const;

export const proofVersionStatusSchema = z.enum(proofVersionStatusValues);
export const proofDecisionSchema = z.enum(proofDecisionValues);
export const proofApprovalSourceSchema = z.enum(proofApprovalSourceValues);
export const proofQueueSliceSchema = z.enum(proofQueueSliceValues);
export const proofQueueStatusSchema = z.enum(proofQueueStatusValues);

export const proofVersionHistoryEntrySchema = z.object({
  id: z.string(),
  proofFileId: z.string(),
  versionNumber: z.number().int(),
  status: proofVersionStatusSchema,
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

export const manualApprovalOverrideHistoryEntrySchema = z.object({
  id: z.string(),
  orderId: z.string(),
  lineItemId: z.string(),
  proofVersionId: z.string(),
  source: z.literal("manual_override"),
  overrideReason: z.string(),
  internalNote: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  overriddenAt: z.string().datetime(),
});

export const proofingReadModelSchema = z.object({
  lineItemId: z.string(),
  orderId: z.string(),
  workflowState: lineItemWorkflowStateSchema,
  requiresProofApproval: z.boolean(),
  approvedProofVersionId: z.string().nullable(),
  approvedProofDecisionId: z.string().nullable(),
  approvedProofSource: proofApprovalSourceSchema.nullable(),
  approvedNormally: z.boolean(),
  approvedByOverride: z.boolean(),
  currentActionableProofVersionId: z.string().nullable(),
  currentActionableProofDecisionId: z.string().nullable(),
  currentActionableProofVersion: proofVersionHistoryEntrySchema.nullable(),
  approvedProofVersion: proofVersionHistoryEntrySchema.nullable(),
  proofVersionHistory: z.array(proofVersionHistoryEntrySchema),
  proofDecisionHistory: z.array(proofDecisionHistoryEntrySchema),
  manualApprovalOverrideHistory: z.array(manualApprovalOverrideHistoryEntrySchema),
  blockedPendingProofApproval: z.boolean(),
});

export const proofingQueueRowSchema = z.object({
  lineItemId: z.string(),
  orderId: z.string(),
  orderNumber: z.string().nullable(),
  customerDisplayName: z.string().nullable(),
  lineItemLabel: z.string(),
  packageLabel: z.string(),
  workflowState: lineItemWorkflowStateSchema,
  currentQueueStatus: proofQueueStatusSchema,
  currentQueueBadge: z.string(),
  currentDisplayedProofVersionId: z.string().nullable(),
  currentDisplayedProofVersionLabel: z.string().nullable(),
  currentDisplayedProofVersionStatus: proofVersionStatusSchema.nullable(),
  approvedProofVersionId: z.string().nullable(),
  approvedProofSource: proofApprovalSourceSchema.nullable(),
  approvedNormally: z.boolean(),
  approvedByOverride: z.boolean(),
  lastDecision: proofDecisionSchema.nullable(),
  lastActivityAt: z.string().datetime(),
  blockedPendingProofApproval: z.boolean(),
  hasApprovedProof: z.boolean(),
  requiresProofApproval: z.boolean(),
  requiresPrepress: z.boolean(),
  proofCount: z.number().int().nonnegative(),
});

export const proofingQueueCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  awaitingSend: z.number().int().nonnegative(),
  awaitingApproval: z.number().int().nonnegative(),
  revisionRequested: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
});

export const proofingQueueResponseSchema = z.object({
  slice: proofQueueSliceSchema,
  counts: proofingQueueCountsSchema,
  rows: z.array(proofingQueueRowSchema),
});

export type ProofVersionStatus = z.infer<typeof proofVersionStatusSchema>;
export type ProofDecision = z.infer<typeof proofDecisionSchema>;
export type ProofApprovalSource = z.infer<typeof proofApprovalSourceSchema>;
export type ProofQueueSlice = z.infer<typeof proofQueueSliceSchema>;
export type ProofQueueStatus = z.infer<typeof proofQueueStatusSchema>;
export type ProofVersionHistoryEntry = z.infer<typeof proofVersionHistoryEntrySchema>;
export type ProofDecisionHistoryEntry = z.infer<typeof proofDecisionHistoryEntrySchema>;
export type ManualApprovalOverrideHistoryEntry = z.infer<typeof manualApprovalOverrideHistoryEntrySchema>;
export type ProofingReadModel = z.infer<typeof proofingReadModelSchema>;
export type ProofingQueueRow = z.infer<typeof proofingQueueRowSchema>;
export type ProofingQueueCounts = z.infer<typeof proofingQueueCountsSchema>;
export type ProofingQueueResponse = z.infer<typeof proofingQueueResponseSchema>;
