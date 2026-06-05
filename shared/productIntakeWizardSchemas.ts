import { z } from "zod";
import { catalogMigrationLabAnalyzerRequestSchema, catalogMigrationLabAnalyzerResultSchema } from "./catalogMigrationLabSchemas";

export const productIntakeSourceTypeValues = ["uploaded_json", "pasted_json", "text_description"] as const;
export const productIntakeWorkflowStateValues = ["SOURCE_UPLOADED", "AI_ANALYZED", "REVIEW_READY"] as const;
export const productIntakeBriefSourceValues = ["live_ai", "rule_based_fallback"] as const;

export const productIntakeConfidenceSchema = z.number().min(0).max(100);

export const productIntakeEvidenceSchema = z.object({
  sourcePath: z.string().min(1),
  label: z.string().min(1),
  value: z.string().nullable(),
  reason: z.string().min(1),
});

export const productIntakeConclusionSchema = z.object({
  value: z.string().nullable(),
  confidence: productIntakeConfidenceSchema,
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeMaterialMatchSchema = z.object({
  materialId: z.string().nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  confidence: productIntakeConfidenceSchema,
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeBehaviorSchema = z.object({
  behavior: z.string().min(1),
  confidence: productIntakeConfidenceSchema,
  notes: z.string().optional(),
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeTemplateRecommendationSchema = z.enum(["suggest_reuse", "review_required"]);

export const productIntakeTemplateMatchSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  score: z.number().min(0).max(1),
  recommendation: productIntakeTemplateRecommendationSchema,
  matchedSignals: z.array(z.string()),
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeOptionSchema = z.object({
  label: z.string().min(1),
  normalizedGroup: z.string().min(1),
  required: z.boolean(),
  confidence: productIntakeConfidenceSchema,
  sampleValues: z.array(z.string()),
  sourcePaths: z.array(z.string().min(1)),
  templateMatches: z.array(productIntakeTemplateMatchSchema).default([]),
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeMissingDecisionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(["blocker", "review", "info"]),
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeRedundantFieldCategorySchema = z.enum([
  "duplicate_label",
  "duplicate_option_structure",
  "internal_id",
  "timestamp",
  "inactive_record",
  "empty_or_default",
  "customer_metadata",
  "ui_metadata",
  "metadata_only",
]);

export const productIntakeRedundantFieldSchema = z.object({
  fieldLabel: z.string().min(1),
  sourcePath: z.string().min(1),
  category: productIntakeRedundantFieldCategorySchema,
  reason: z.string().min(1),
  confidence: productIntakeConfidenceSchema,
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["warning", "info"]),
  evidence: z.array(productIntakeEvidenceSchema),
});

export const productIntakeBriefSchema = z.object({
  workflowState: z.enum(productIntakeWorkflowStateValues),
  source: z.enum(productIntakeBriefSourceValues),
  fallbackReason: z.string().nullable().optional(),
  productIdentity: z.object({
    likelyProductName: productIntakeConclusionSchema,
    category: productIntakeConclusionSchema,
    productType: productIntakeConclusionSchema,
  }),
  materialAnalysis: z.object({
    detectedMaterialReferences: z.array(z.string()),
    likelyMaterialMatches: z.array(productIntakeMaterialMatchSchema),
    confidence: productIntakeConfidenceSchema,
    evidence: z.array(productIntakeEvidenceSchema),
  }),
  sizeBehavior: productIntakeBehaviorSchema,
  quantityBehavior: productIntakeBehaviorSchema,
  pricingAnalysis: productIntakeBehaviorSchema,
  requiredOptions: z.array(productIntakeOptionSchema),
  optionalOptions: z.array(productIntakeOptionSchema),
  templateMatches: z.array(productIntakeTemplateMatchSchema),
  missingDecisions: z.array(productIntakeMissingDecisionSchema),
  redundantFields: z.array(productIntakeRedundantFieldSchema),
  draftWarnings: z.array(productIntakeWarningSchema),
  sourceEvidence: z.array(productIntakeEvidenceSchema),
  overallConfidence: productIntakeConfidenceSchema,
});

export const productIntakeWizardAnalyzeRequestSchema = z.object({
  sourceType: z.enum(productIntakeSourceTypeValues),
  fileName: z.string().trim().max(255).optional(),
  jsonText: z.string().optional(),
  sourceJson: z.unknown().optional(),
  description: z.string().trim().max(20000).optional(),
  analyzerRequest: catalogMigrationLabAnalyzerRequestSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.sourceType === "text_description") {
    if (!value.description || value.description.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide description for text_description sources.",
        path: ["description"],
      });
    }
    return;
  }

  const hasAnalyzerRequest = value.analyzerRequest !== undefined;
  const hasJsonText = typeof value.jsonText === "string" && value.jsonText.trim().length > 0;
  const hasSourceJson = value.sourceJson !== undefined;
  if (!hasAnalyzerRequest && !hasJsonText && !hasSourceJson) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide jsonText, sourceJson, or analyzerRequest for JSON sources.",
      path: ["jsonText"],
    });
  }
});

export const productIntakeWizardAnalyzeResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: z.object({
      workflow: z.object({
        currentState: z.enum(productIntakeWorkflowStateValues),
        terminalState: z.literal("REVIEW_READY"),
        catalogMutationAllowed: z.literal(false),
      }),
      analyzer: catalogMigrationLabAnalyzerResultSchema.nullable(),
      brief: productIntakeBriefSchema,
    }),
  }),
  z.object({
    success: z.literal(false),
    message: z.string(),
    errorCode: z.string().optional(),
  }),
]);

export type ProductIntakeSourceType = z.infer<typeof productIntakeWizardAnalyzeRequestSchema>["sourceType"];
export type ProductIntakeEvidence = z.infer<typeof productIntakeEvidenceSchema>;
export type ProductIntakeTemplateMatch = z.infer<typeof productIntakeTemplateMatchSchema>;
export type ProductIntakeBrief = z.infer<typeof productIntakeBriefSchema>;
export type ProductIntakeWizardAnalyzeRequest = z.infer<typeof productIntakeWizardAnalyzeRequestSchema>;
export type ProductIntakeWizardAnalyzeResponse = z.infer<typeof productIntakeWizardAnalyzeResponseSchema>;
