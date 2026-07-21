import { z } from "zod";
import { catalogMigrationLabAnalyzerRequestSchema, catalogMigrationLabAnalyzerResultSchema } from "./catalogMigrationLabSchemas";

export const productIntakeSourceTypeValues = ["uploaded_json", "pasted_json", "text_description"] as const;
export const productIntakeWorkflowStateValues = ["SOURCE_UPLOADED", "AI_ANALYZED", "REVIEW_READY"] as const;
export const productIntakeBriefSourceValues = ["live_ai", "rule_based_fallback"] as const;
export const productIntakeSessionSourceTypeValues = ["json_upload", "json_paste", "text_description"] as const;
export const productIntakeSessionStatusValues = ["analyzed", "needs_answers", "ready_for_draft", "draft_created", "abandoned"] as const;
export const productIntakeQuestionTypeValues = ["select", "multiselect", "text", "number", "boolean"] as const;
export const productIntakeMatrixTypeValues = [
  "NONE",
  "SIZE_QUANTITY",
  "QUANTITY_STOCK",
  "SIZE_MATERIAL",
  "QUANTITY_TIER",
  "MULTI_DIMENSION",
] as const;

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

export const productIntakeOptionPricingModeValues = [
  "none",
  "set_per_sqft",
  "set_per_piece",
  "add_flat",
  "add_per_piece",
  "add_per_sqft",
  "add_percent",
  "add_per_grommet",
] as const;

export const productIntakeOptionChoiceSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  pricing: z.object({
    mode: z.enum(productIntakeOptionPricingModeValues),
    amount: z.number().nonnegative().nullable().optional(),
    label: z.string().nullable().optional(),
  }).optional(),
  weightOz: z.number().nonnegative().nullable().optional(),
  workflowTags: z.array(z.string().min(1)).optional(),
  requiresProof: z.boolean().nullable().optional(),
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
  // Product Intake options are product-local by default. Template matches are
  // suggestions only; reuse must be selected explicitly.
  source: z.enum(["product_specific", "reusable_template"]).optional(),
  reuseTemplateId: z.string().min(1).nullable().optional(),
  selectionMode: z.enum(["single", "multi"]).optional(),
  defaultChoice: z.string().min(1).nullable().optional(),
  choices: z.array(productIntakeOptionChoiceSchema).optional(),
  pricingRequired: z.boolean().optional(),
  affectsWeight: z.boolean().optional(),
  affectsRouting: z.boolean().optional(),
  affectsProof: z.boolean().optional(),
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

export const productIntakeMatrixReadinessSchema = z.object({
  required: z.boolean(),
  matrixType: z.enum(productIntakeMatrixTypeValues),
  matrixDimensions: z.array(z.string().min(1)),
  matrixConfidence: productIntakeConfidenceSchema,
  reasoning: z.array(z.string().min(1)),
  recommendedSetup: z.string().min(1),
  detectedSizes: z.array(z.string().min(1)),
  detectedQuantityBreaks: z.array(z.number().int().positive()),
  detectedMaterials: z.array(z.string().min(1)),
  detectedPricingSignals: z.array(z.string().min(1)),
  noMatrixRowsGenerated: z.boolean().default(true),
});

export const productIntakeMatrixDraftTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  minQty: z.number().int().positive(),
  maxQty: z.number().int().positive().nullable(),
});

export const productIntakeMatrixDraftPriceSchema = z.object({
  tierId: z.string().min(1),
  label: z.string().min(1),
  minQty: z.number().int().positive(),
  perPieceCents: z.number().int().positive().nullable().optional(),
  perSqftCents: z.number().int().positive().nullable().optional(),
  minimumChargeCents: z.number().int().positive().nullable().optional(),
});

export const productIntakeMatrixDraftRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  when: z.record(z.unknown()),
  prices: z.array(productIntakeMatrixDraftPriceSchema),
});

export const productIntakeMatrixDraftSchema = z.object({
  generatedByAI: z.literal(true),
  reviewRequired: z.literal(true),
  matrixConfidence: productIntakeConfidenceSchema,
  generationReasoning: z.array(z.string().min(1)),
  sourceSignals: z.array(z.string().min(1)),
  dimensions: z.array(z.string().min(1)),
  tiers: z.array(productIntakeMatrixDraftTierSchema),
  rows: z.array(productIntakeMatrixDraftRowSchema),
  warnings: z.array(z.string()),
});

export const productIntakeAiRepairActionSchema = z.object({
  path: z.string().min(1),
  originalValue: z.unknown().optional(),
  repairedValue: z.unknown().optional(),
  reason: z.string().min(1),
  confidenceImpact: z.string().nullable().optional(),
});

const productIntakeAiRepairActionInputSchema = z.union([
  productIntakeAiRepairActionSchema,
  z.string().transform((value) => ({
    path: "$",
    originalValue: null,
    repairedValue: null,
    reason: value,
    confidenceImpact: null,
  })),
]);

export const productIntakeBriefSchema = z.object({
  workflowState: z.enum(productIntakeWorkflowStateValues),
  source: z.enum(productIntakeBriefSourceValues),
  fallbackReason: z.string().nullable().optional(),
  aiRepair: z.object({
    accepted: z.boolean(),
    actions: z.array(productIntakeAiRepairActionSchema),
    repairedAt: z.string().optional(),
  }).optional(),
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
  matrixReadiness: productIntakeMatrixReadinessSchema.optional(),
  requiredOptions: z.array(productIntakeOptionSchema),
  optionalOptions: z.array(productIntakeOptionSchema),
  templateMatches: z.array(productIntakeTemplateMatchSchema),
  missingDecisions: z.array(productIntakeMissingDecisionSchema),
  redundantFields: z.array(productIntakeRedundantFieldSchema),
  draftWarnings: z.array(productIntakeWarningSchema),
  sourceEvidence: z.array(productIntakeEvidenceSchema),
  overallConfidence: productIntakeConfidenceSchema,
});

export const productIntakeQuestionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const productIntakeQuestionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  sessionId: z.string().min(1),
  questionKey: z.string().min(1),
  questionType: z.enum(productIntakeQuestionTypeValues),
  label: z.string().min(1),
  helpText: z.string().nullable(),
  required: z.boolean(),
  options: z.array(productIntakeQuestionOptionSchema).nullable(),
  defaultValue: z.unknown().nullable(),
  sourcePath: z.string().nullable(),
  confidence: productIntakeConfidenceSchema.nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

export const productIntakeAnswerSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  questionKey: z.string().min(1),
  answer: z.unknown().nullable(),
  answeredByUserId: z.string().nullable(),
  answeredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const productIntakeSessionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  sourceType: z.enum(productIntakeSessionSourceTypeValues),
  sourceFingerprint: z.string().nullable(),
  brief: productIntakeBriefSchema,
  confidence: z.record(z.unknown()).nullable(),
  missingDecisions: z.array(productIntakeMissingDecisionSchema).nullable(),
  status: z.enum(productIntakeSessionStatusValues),
  createdProductId: z.string().nullable(),
  createdPbv2TreeVersionId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  abandonedAt: z.string().nullable(),
});

export const productIntakeReadinessSchema = z.object({
  unansweredRequiredCount: z.number().int().min(0),
  answeredCount: z.number().int().min(0),
  canCreateDraft: z.boolean(),
  status: z.enum(productIntakeSessionStatusValues),
  reviewState: z.enum(["ready_for_draft", "needs_review", "not_ready"]).optional(),
  reviewScore: z.number().min(0).max(100).optional(),
  penalties: z.array(z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    severity: z.enum(["review", "blocker"]),
  })).optional(),
});

export const productIntakeSessionDetailSchema = z.object({
  session: productIntakeSessionSchema,
  brief: productIntakeBriefSchema,
  questions: z.array(productIntakeQuestionSchema),
  answers: z.array(productIntakeAnswerSchema),
  readiness: productIntakeReadinessSchema,
});

export const productIntakeDraftQualitySchema = z.object({
  label: z.enum(["Excellent", "Good", "Needs Review"]),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});

export const productIntakeCreateDraftResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    productId: z.string().min(1),
    pbv2TreeVersionId: z.string().min(1),
    draftQuality: productIntakeDraftQualitySchema,
    session: productIntakeSessionSchema,
    detail: productIntakeSessionDetailSchema,
  }),
});

export const productIntakeDraftReviewFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["ERROR", "WARNING", "INFO"]),
  message: z.string().min(1),
  path: z.string().min(1),
  entityId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export const productIntakeDraftReviewSchema = z.object({
  intake: z.object({
    sessionId: z.string().min(1),
    status: z.string().min(1),
    sourceType: z.string().min(1),
    sourceText: z.string().nullable(),
    sourceJson: z.unknown().nullable(),
    sourceFingerprint: z.string().nullable(),
    briefSource: z.string().nullable(),
    confidence: z.number().nullable(),
    productName: z.string().nullable(),
    materialMatch: z.string().nullable(),
    materialMatchStatus: z.enum(["resolved", "review_required", "unresolved"]),
    materialAssociationRequired: z.boolean(),
    sourceMaterialText: z.string().nullable(),
    materialCandidates: z.array(z.object({
      materialId: z.string().nullable(),
      sku: z.string().nullable(),
      name: z.string(),
      confidence: z.number().min(0).max(100),
    })),
    warnings: z.array(z.string()),
    unansweredDecisions: z.array(z.string()),
  }),
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().nullable(),
    description: z.string(),
    isActive: z.boolean(),
    productTypeId: z.string().nullable(),
    productTypeName: z.string().nullable(),
    primaryMaterialId: z.string().nullable(),
    pbv2ActiveTreeVersionId: z.string().nullable(),
  }),
  pbv2Tree: z.object({
    id: z.string().min(1),
    status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED", "ARCHIVED"]),
    schemaVersion: z.number().int(),
    publishedAt: z.string().nullable(),
    updatedAt: z.string(),
    groupCount: z.number().int().min(0),
    optionCount: z.number().int().min(0),
    optionGroups: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      optionCount: z.number().int().min(0),
      options: z.array(z.string()),
    })),
    draftQuality: z.unknown().nullable(),
    intakeSummary: z.unknown().nullable(),
    matrixReadiness: productIntakeMatrixReadinessSchema.nullable(),
    matrixPreview: productIntakeMatrixDraftSchema.nullable(),
    basePricing: z.object({
      perSqftCents: z.number().nullable(),
      perPieceCents: z.number().nullable(),
      minimumChargeCents: z.number().nullable(),
    }),
  }),
  publishReadiness: z.object({
    productInactive: z.boolean(),
    pbv2TreeDraft: z.boolean(),
    pbv2TreePublished: z.boolean(),
    activeTreeAssigned: z.boolean(),
    requiredOptionsPresent: z.boolean(),
    noDuplicateSizeControls: z.boolean(),
    pricingConfigured: z.boolean(),
    materialLinked: z.boolean(),
    validationStatus: z.enum(["ready", "blocked", "warnings", "published"]),
    findings: z.array(productIntakeDraftReviewFindingSchema),
  }),
});

export const productIntakeDraftPricingPatchRequestSchema = z.object({
  base: z.object({
    perSqftCents: z.number().int().min(0).nullable().optional(),
    perPieceCents: z.number().int().min(0).nullable().optional(),
    minimumChargeCents: z.number().int().min(0).nullable().optional(),
  }),
});

export const productIntakeDraftLinkSchema = z.object({
  sessionId: z.string().min(1),
  productId: z.string().min(1),
  pbv2TreeVersionId: z.string().nullable(),
  sessionStatus: z.string().min(1),
  productIsActive: z.boolean(),
  pbv2Status: z.string().nullable(),
  pbv2ActiveTreeVersionId: z.string().nullable(),
  materialAssociationRequired: z.boolean().optional(),
  intakeWarnings: z.array(z.string()).optional(),
});

export const productIntakeDraftReviewResponseSchema = z.object({
  success: z.literal(true),
  data: productIntakeDraftReviewSchema,
});

export const productIntakeDraftLinkResponseSchema = z.object({
  success: z.literal(true),
  data: productIntakeDraftLinkSchema.nullable(),
});

export const productIntakeAnswerPatchItemSchema = z.object({
  questionId: z.string().min(1).optional(),
  questionKey: z.string().min(1).optional(),
  // Blank browser controls may omit `answer` or serialize it as undefined.
  // Normalize that state to null so partial guided-answer submissions remain valid.
  answer: z.preprocess((value) => value == null ? null : value, z.unknown().nullable()),
}).superRefine((value, ctx) => {
  if (!value.questionId && !value.questionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide questionId or questionKey.",
      path: ["questionKey"],
    });
  }
});

export const productIntakeAnswersPatchRequestSchema = z.object({
  answers: z.array(productIntakeAnswerPatchItemSchema).default([]),
});

export const productIntakeSessionListQuerySchema = z.object({
  status: z.enum(productIntakeSessionStatusValues).optional(),
  sourceType: z.enum(productIntakeSessionSourceTypeValues).optional(),
  search: z.string().trim().max(200).optional(),
  createdFrom: z.string().trim().optional(),
  createdTo: z.string().trim().optional(),
});

export const productIntakeSessionListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessions: z.array(productIntakeSessionSchema),
  }),
});

export const productIntakeSessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: productIntakeSessionDetailSchema,
});

export const productIntakeAiDiagnosticIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const productIntakeAiDiagnosticSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  sessionId: z.string().nullable(),
  sourceType: z.enum(productIntakeSourceTypeValues),
  sourceFingerprint: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  rawAiResponse: z.string(),
  validationErrors: z.array(productIntakeAiDiagnosticIssueSchema),
  failedSchemaPaths: z.array(z.string()),
  repairActions: z.array(productIntakeAiRepairActionInputSchema),
  promptVersion: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
});

export const productIntakeAiDiagnosticsListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    diagnostics: z.array(productIntakeAiDiagnosticSchema),
  }),
});

export const productIntakeAiReadinessReasonValues = [
  "live_ai_ready",
  "missing_org_ai_settings",
  "ai_disabled",
  "feature_review_disabled",
  "missing_provider_config",
  "missing_encryption_key",
  "managed_env_missing",
  "provider_unavailable",
] as const;

export const productIntakeAiReadinessSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().nullable(),
  databaseIdentifier: z.string().nullable(),
  enabled: z.boolean(),
  mode: z.string(),
  featureReviewEnabled: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  reason: z.enum(productIntakeAiReadinessReasonValues),
  managedEnv: z.object({
    endpointPresent: z.boolean(),
    apiKeyPresent: z.boolean(),
    modelPresent: z.boolean(),
  }),
  encryptionKeyPresent: z.boolean(),
  canAttemptLiveAi: z.boolean(),
});

export const productIntakeAiReadinessResponseSchema = z.object({
  success: z.literal(true),
  data: productIntakeAiReadinessSchema,
});

export const productIntakeAiRunSourceResultValues = [
  "live_ai",
  "live_ai_repaired",
  "analyzer_fallback",
  "timeout_fallback",
  "provider_unavailable_fallback",
  "schema_fallback",
] as const;

export const productIntakeAiRunSchema = z.object({
  attempted: z.boolean(),
  reachedProvider: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  reason: z.string(),
  elapsedMs: z.number().int().min(0).nullable(),
  timeoutMs: z.number().int().positive().nullable(),
  sourceResult: z.enum(productIntakeAiRunSourceResultValues),
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
      sessionId: z.string().optional(),
      status: z.enum(productIntakeSessionStatusValues).optional(),
      session: productIntakeSessionSchema.optional(),
      questions: z.array(productIntakeQuestionSchema).optional(),
      answers: z.array(productIntakeAnswerSchema).optional(),
      readiness: productIntakeReadinessSchema.optional(),
      aiRun: productIntakeAiRunSchema.optional(),
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
export type ProductIntakeOptionChoice = z.infer<typeof productIntakeOptionChoiceSchema>;
export type ProductIntakeOption = z.infer<typeof productIntakeOptionSchema>;
export type ProductIntakeBrief = z.infer<typeof productIntakeBriefSchema>;
export type ProductIntakeQuestion = z.infer<typeof productIntakeQuestionSchema>;
export type ProductIntakeAnswer = z.infer<typeof productIntakeAnswerSchema>;
export type ProductIntakeSession = z.infer<typeof productIntakeSessionSchema>;
export type ProductIntakeReadiness = z.infer<typeof productIntakeReadinessSchema>;
export type ProductIntakeSessionDetail = z.infer<typeof productIntakeSessionDetailSchema>;
export type ProductIntakeDraftQuality = z.infer<typeof productIntakeDraftQualitySchema>;
export type ProductIntakeMatrixReadiness = z.infer<typeof productIntakeMatrixReadinessSchema>;
export type ProductIntakeMatrixDraft = z.infer<typeof productIntakeMatrixDraftSchema>;
export type ProductIntakeCreateDraftResponse = z.infer<typeof productIntakeCreateDraftResponseSchema>;
export type ProductIntakeDraftReview = z.infer<typeof productIntakeDraftReviewSchema>;
export type ProductIntakeDraftReviewResponse = z.infer<typeof productIntakeDraftReviewResponseSchema>;
export type ProductIntakeDraftPricingPatchRequest = z.infer<typeof productIntakeDraftPricingPatchRequestSchema>;
export type ProductIntakeDraftLink = z.infer<typeof productIntakeDraftLinkSchema>;
export type ProductIntakeDraftLinkResponse = z.infer<typeof productIntakeDraftLinkResponseSchema>;
export type ProductIntakeAiDiagnosticIssue = z.infer<typeof productIntakeAiDiagnosticIssueSchema>;
export type ProductIntakeAiRepairAction = z.infer<typeof productIntakeAiRepairActionSchema>;
export type ProductIntakeAiDiagnostic = z.infer<typeof productIntakeAiDiagnosticSchema>;
export type ProductIntakeAiReadiness = z.infer<typeof productIntakeAiReadinessSchema>;
export type ProductIntakeAiRun = z.infer<typeof productIntakeAiRunSchema>;
export type ProductIntakeAnswerPatchItem = z.infer<typeof productIntakeAnswerPatchItemSchema>;
export type ProductIntakeAnswersPatchRequest = z.infer<typeof productIntakeAnswersPatchRequestSchema>;
export type ProductIntakeSessionStatus = z.infer<typeof productIntakeSessionSchema>["status"];
export type ProductIntakeQuestionType = z.infer<typeof productIntakeQuestionSchema>["questionType"];
export type ProductIntakeWizardAnalyzeRequest = z.infer<typeof productIntakeWizardAnalyzeRequestSchema>;
export type ProductIntakeWizardAnalyzeResponse = z.infer<typeof productIntakeWizardAnalyzeResponseSchema>;
