import { z } from "zod";

import { lineItemWorkflowStateSchema } from "./schema";

export const proofVersionStatusValues = [
  "draft",
  "awaiting_response",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
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

export const proofArtifactKindValues = [
  "generated",
  "uploaded",
  "promoted_artwork",
] as const;

export const proofArtifactPreviewStatusValues = [
  "ready",
  "missing_preview",
  "generation_failed",
  "metadata_only",
] as const;

export const proofPreflightStatusValues = [
  "not_run",
  "queued",
  "running",
  "passed",
  "warning",
  "failed",
  "superseded",
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
export const proofArtifactKindSchema = z.enum(proofArtifactKindValues);
export const proofArtifactPreviewStatusSchema = z.enum(proofArtifactPreviewStatusValues);
export const proofPreflightStatusSchema = z.enum(proofPreflightStatusValues);
export const proofQueueSliceSchema = z.enum(proofQueueSliceValues);
export const proofQueueStatusSchema = z.enum(proofQueueStatusValues);

export const proofInputSnapshotSchema = z.object({
  lineItemId: z.string(),
  orderId: z.string(),
  orderNumber: z.string().nullable(),
  lineItemLabel: z.string(),
  sourceArtwork: z.object({
    sourceType: z.enum(["attachment", "asset", "line_item_file"]),
    sourceId: z.string(),
    fileRecordId: z.string().nullable(),
    fileName: z.string(),
    mimeType: z.string().nullable(),
    fileUrl: z.string().nullable(),
  }).nullable(),
  finishedWidth: z.number().nullable(),
  finishedHeight: z.number().nullable(),
  displaySizeLabel: z.string().nullable(),
  quantity: z.number().int().nullable(),
  printSides: z.enum(["Single-sided", "Double-sided", "Unknown"]).optional(),
  useSameArtworkBothSides: z.boolean().optional(),
  sameArtworkFileId: z.string().nullable().optional(),
  finishingSummary: z.array(z.string()),
  // Flat map of every selected-option name → formatted value (not capped like finishingSummary).
  // Used by the UI to look up specific options (contour cut, double sided, media, etc.) by name.
  selectedOptionMap: z.record(z.string(), z.string()).optional(),
  snapshotBasisAt: z.string().datetime(),
  lineItemUpdatedAt: z.string().datetime().nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
  preflightStatus: proofPreflightStatusSchema,
});

export const proofArtifactSummarySchema = z.object({
  attachmentId: z.string(),
  artifactKind: proofArtifactKindSchema,
  fileName: z.string(),
  mimeType: z.string().nullable(),
  generatedFromSnapshot: z.boolean(),
  previewStatus: proofArtifactPreviewStatusSchema,
  previewError: z.string().nullable(),
});

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
  packageLineItems: z.array(z.object({
    lineItemId: z.string(),
    lineItemLabel: z.string(),
    displaySizeLabel: z.string().nullable(),
    quantity: z.number().nullable(),
  })).optional(),
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
  currentProofInputSnapshot: proofInputSnapshotSchema.nullable(),
  currentDisplayedProofArtifact: proofArtifactSummarySchema.nullable(),
  proofVersionHistory: z.array(proofVersionHistoryEntrySchema),
  proofDecisionHistory: z.array(proofDecisionHistoryEntrySchema),
  manualApprovalOverrideHistory: z.array(manualApprovalOverrideHistoryEntrySchema),
  blockedPendingProofApproval: z.boolean(),
});

export const proofingQueueRowSchema = z.object({
  lineItemId: z.string(),
  orderId: z.string(),
  orderNumber: z.string().nullable(),
  lineItemSortOrder: z.number().int(),
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
  activeOwnerJobId: z.string().nullable(),
  activeOwnerStationKey: z.string().nullable(),
  activeOwnerStepKey: z.string().nullable(),
  productionJobId: z.string().nullable(),
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
export type ProofArtifactKind = z.infer<typeof proofArtifactKindSchema>;
export type ProofArtifactPreviewStatus = z.infer<typeof proofArtifactPreviewStatusSchema>;
export type ProofPreflightStatus = z.infer<typeof proofPreflightStatusSchema>;
export type ProofQueueSlice = z.infer<typeof proofQueueSliceSchema>;
export type ProofQueueStatus = z.infer<typeof proofQueueStatusSchema>;
export type ProofInputSnapshot = z.infer<typeof proofInputSnapshotSchema>;
export type ProofArtifactSummary = z.infer<typeof proofArtifactSummarySchema>;
export type ProofVersionHistoryEntry = z.infer<typeof proofVersionHistoryEntrySchema>;
export type ProofDecisionHistoryEntry = z.infer<typeof proofDecisionHistoryEntrySchema>;
export type ManualApprovalOverrideHistoryEntry = z.infer<typeof manualApprovalOverrideHistoryEntrySchema>;
export type ProofingReadModel = z.infer<typeof proofingReadModelSchema>;
export type ProofingQueueRow = z.infer<typeof proofingQueueRowSchema>;
export type ProofingQueueCounts = z.infer<typeof proofingQueueCountsSchema>;
export type ProofingQueueResponse = z.infer<typeof proofingQueueResponseSchema>;
