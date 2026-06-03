import { z } from "zod";

export const aiReviewStatusValues = ["pending", "processing", "completed", "failed"] as const;
export const aiReviewKindValues = ["bug_review"] as const;
export const aiSeverityLevelValues = ["low", "medium", "high", "critical"] as const;
export const workflowImpactValues = ["none", "minor", "moderate", "major", "blocking"] as const;
export const revenueRiskValues = ["none", "low", "medium", "high", "critical"] as const;
export const suggestedOwnerValues = [
  "Orders",
  "Quotes",
  "PBV2",
  "Production",
  "Proofing",
  "Shipping",
  "Billing",
  "Customer Portal",
  "Inventory",
  "Admin",
] as const;

export type AiReviewStatus = (typeof aiReviewStatusValues)[number];
export type AiReviewKind = (typeof aiReviewKindValues)[number];
export type AiSeverityLevel = (typeof aiSeverityLevelValues)[number];
export type WorkflowImpact = (typeof workflowImpactValues)[number];
export type RevenueRisk = (typeof revenueRiskValues)[number];
export type SuggestedOwner = (typeof suggestedOwnerValues)[number];

export const bugAiReviewResultSchema = z.object({
  summary: z.string().min(1).max(1200),
  severityAssessment: z.enum(aiSeverityLevelValues),
  businessImpact: z.enum(aiSeverityLevelValues),
  urgency: z.enum(aiSeverityLevelValues),
  implementationPriority: z.enum(aiSeverityLevelValues),
  workflowImpact: z.enum(workflowImpactValues),
  revenueRisk: z.enum(revenueRiskValues),
  suggestedOwner: z.enum(suggestedOwnerValues),
  affectedModules: z.array(z.string().min(1).max(80)).max(12),
  reasoning: z.array(z.string().min(1).max(500)).min(1).max(10),
  unknowns: z.array(z.string().min(1).max(500)).max(10),
  confidence: z.number().min(0).max(1),
}).strict();

export type BugAiReviewResult = z.infer<typeof bugAiReviewResultSchema>;

export interface AiReviewDto {
  id: string;
  orgId: string;
  bugReportId: string;
  reviewKind: AiReviewKind;
  status: AiReviewStatus;
  isCurrent: boolean;
  requestedByEmail: string;
  provider: string | null;
  model: string | null;
  providerMetadata: unknown | null;
  promptVersion: string;
  result: BugAiReviewResult | null;
  summary: string | null;
  severityAssessment: AiSeverityLevel | null;
  businessImpact: AiSeverityLevel | null;
  urgency: AiSeverityLevel | null;
  implementationPriority: AiSeverityLevel | null;
  workflowImpact: WorkflowImpact | null;
  revenueRisk: RevenueRisk | null;
  suggestedOwner: SuggestedOwner | null;
  confidence: number | null;
  validationErrors: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiReviewFeatureFlagsDto {
  enabled: boolean;
  adminsOnly: boolean;
}

export interface CurrentBugAiReviewResponse {
  review: AiReviewDto | null;
  featureFlags: AiReviewFeatureFlagsDto;
  canRun: boolean;
}

export interface CreateBugAiReviewResponse {
  reviewId: string;
  status: AiReviewStatus;
}
