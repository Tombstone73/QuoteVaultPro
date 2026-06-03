import { z } from "zod";
import { aiReviewStatusValues } from "./aiReviewContracts";

const triageItemConfidence = z.number().min(0).max(1);

export const triageBriefStatusValues = aiReviewStatusValues;
export type TriageBriefStatus = (typeof triageBriefStatusValues)[number];

/**
 * Feedback status semantics for normal AI Triage Briefs:
 * - open = active, not yet completed
 * - in_review = active/evaluating
 * - resolved = addressed, not active
 * - closed = archived/final, not active
 *
 * Normal triage briefs only analyze active feedback. Resolved/closed feedback
 * requires a future explicit historical mode and must not appear in default
 * priorities, active bug clusters, or next sprint recommendations.
 */
export const activeTriageFeedbackStatusValues = ["open", "in_review"] as const;
export const inactiveTriageFeedbackStatusValues = ["resolved", "closed"] as const;
export type ActiveTriageFeedbackStatus = (typeof activeTriageFeedbackStatusValues)[number];

export function getIncludedTriageFeedbackStatuses(status: unknown): ActiveTriageFeedbackStatus[] {
  if (activeTriageFeedbackStatusValues.includes(status as ActiveTriageFeedbackStatus)) {
    return [status as ActiveTriageFeedbackStatus];
  }
  if (inactiveTriageFeedbackStatusValues.includes(status as (typeof inactiveTriageFeedbackStatusValues)[number])) {
    return [];
  }
  return [...activeTriageFeedbackStatusValues];
}

export const triageRiskItemSchema = z.object({
  title: z.string().min(1).max(160),
  impact: z.string().min(1).max(800),
  confidence: triageItemConfidence,
  rationale: z.string().min(1).max(1000),
}).strict();

export const triageBugClusterSchema = z.object({
  issue: z.string().min(1).max(180),
  reportCount: z.number().int().min(1),
  affectedModules: z.array(z.string().min(1).max(80)).max(12),
  impact: z.string().min(1).max(1000),
}).strict();

export const triageFeatureRequestSchema = z.object({
  feature: z.string().min(1).max(180),
  requestCount: z.number().int().min(1),
  value: z.string().min(1).max(1000),
  complexity: z.string().min(1).max(500),
}).strict();

export const triagePriorityItemSchema = z.object({
  item: z.string().min(1).max(180),
  rationale: z.string().min(1).max(1000),
  urgency: z.enum(["low", "medium", "high", "critical"]),
}).strict();

export const triageDuplicateSignalSchema = z.object({
  theme: z.string().min(1).max(180),
  reportIds: z.array(z.string().min(1).max(120)).min(1).max(20),
  rationale: z.string().min(1).max(1000),
  confidence: triageItemConfidence,
}).strict();

export const aiTriageBriefResultSchema = z.object({
  executiveSummary: z.string().min(1).max(1600),
  topOperationalRisks: z.array(triageRiskItemSchema).max(8),
  topWorkflowRisks: z.array(triageRiskItemSchema).max(8),
  topRevenueRisks: z.array(triageRiskItemSchema).max(8),
  topBugClusters: z.array(triageBugClusterSchema).max(10),
  topFeatureRequests: z.array(triageFeatureRequestSchema).max(10),
  duplicateSignals: z.array(triageDuplicateSignalSchema).max(12),
  suggestedPriorityOrder: z.array(triagePriorityItemSchema).max(15),
  recommendedNextSprint: z.array(triagePriorityItemSchema).max(8),
  unknowns: z.array(z.string().min(1).max(700)).max(12),
  confidence: z.number().min(0).max(1),
}).strict();

export type AiTriageBriefResult = z.infer<typeof aiTriageBriefResultSchema>;

export interface AiTriageBriefDto {
  id: string;
  orgId: string;
  status: TriageBriefStatus;
  requestedByEmail: string;
  filtersSnapshot: Record<string, unknown>;
  reportSnapshot: unknown;
  provider: string | null;
  model: string | null;
  mode: string | null;
  promptVersion: string;
  result: AiTriageBriefResult | null;
  summary: string | null;
  topRisks: unknown | null;
  topFeatures: unknown | null;
  recommendedPriorities: unknown | null;
  duplicateSignals: unknown | null;
  workflowRisks: unknown | null;
  revenueRisks: unknown | null;
  unknowns: unknown | null;
  confidence: number | null;
  providerMetadata: unknown | null;
  usageMetadata: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiTriageBriefListResponse {
  briefs: AiTriageBriefDto[];
  canGenerate: boolean;
  featureEnabled: boolean;
}

export interface CreateAiTriageBriefResponse {
  briefId: string;
  status: TriageBriefStatus;
}
