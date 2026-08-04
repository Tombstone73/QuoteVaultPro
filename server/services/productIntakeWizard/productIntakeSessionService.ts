import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  productIntakeAnswers,
  productIntakeAiDiagnostics,
  productIntakeQuestions,
  productIntakeSessions,
  type ProductIntakeAnswerRow,
  type ProductIntakeQuestionRow,
  type ProductIntakeSessionRow,
} from "@shared/schema";
import {
  productIntakeAnswerSchema,
  productIntakeQuestionSchema,
  productIntakeReadinessSchema,
  productIntakeSessionSchema,
  type ProductIntakeAnswer,
  type ProductIntakeAnswerPatchItem,
  type ProductIntakeBrief,
  type ProductIntakeQuestion,
  type ProductIntakeQuestionType,
  type ProductIntakeReadiness,
  type ProductIntakeSession,
  type ProductIntakeSessionDetail,
  type ProductIntakeSessionStatus,
  type ProductIntakeWizardAnalyzeRequest,
} from "@shared/productIntakeWizardSchemas";
import type { CatalogMigrationLabAnalyzerResult } from "@shared/catalogMigrationLabSchemas";
import { db as defaultDb } from "../../db";
import { choicePricingExample, normalizeChoicePricingAnswer, stripDefaultChoiceAnnotation } from "./productIntakeOptionHelpers";

type NewQuestion = Omit<ProductIntakeQuestion, "id" | "organizationId" | "sessionId" | "createdAt">;

export type CreateProductIntakeSessionInput = {
  organizationId: string;
  userId: string | null;
  request: ProductIntakeWizardAnalyzeRequest;
  analyzer: CatalogMigrationLabAnalyzerResult | null;
  brief: ProductIntakeBrief;
};

export type ProductIntakeSessionListFilters = {
  status?: ProductIntakeSessionStatus;
  sourceType?: ProductIntakeSession["sourceType"];
  search?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type ProductIntakeSessionDeleteResult = {
  sessions: number;
  questions: number;
  answers: number;
  diagnostics: number;
};

export type ProductIntakeSessionDeleteFilters = {
  sessionIds?: string[];
  status?: Extract<ProductIntakeSessionStatus, "abandoned">;
  briefSource?: "rule_based_fallback";
};

export interface ProductIntakeSessionStore {
  createFromAnalysis(input: CreateProductIntakeSessionInput): Promise<ProductIntakeSessionDetail>;
  listSessions(organizationId: string, filters?: ProductIntakeSessionListFilters): Promise<ProductIntakeSession[]>;
  getSessionDetail(organizationId: string, sessionId: string): Promise<ProductIntakeSessionDetail | null>;
  /** Internal, tenant-scoped source lookup used only to produce a reviewed
   * assistant draft preview. The source is never returned to the browser. */
  getSessionSource?(organizationId: string, sessionId: string): Promise<{ sourceText: string | null; sourceJson: unknown | null } | null>;
  upsertAnswers(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
    answers: ProductIntakeAnswerPatchItem[];
  }): Promise<ProductIntakeSessionDetail | null>;
  /** Replaces a not-yet-created session's derived brief after an explicit
   * conversation correction. Matching valid answers survive; stale questions
   * and answers are replaced so readiness and confirmation fingerprints cannot
   * describe the previous proposal. */
  replaceBrief(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
    brief: ProductIntakeBrief;
    sourceText: string;
  }): Promise<ProductIntakeSessionDetail | null>;
  abandonSession(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
  }): Promise<ProductIntakeSessionDetail | null>;
  deleteSessions(args: {
    organizationId: string;
    filters: ProductIntakeSessionDeleteFilters;
  }): Promise<ProductIntakeSessionDeleteResult>;
}

export class ProductIntakeSessionError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, message: string, errorCode: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nullableIso(value: unknown): string | null {
  if (!value) return null;
  return toIso(value);
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "question";
}

function firstEvidencePath(evidence: Array<{ sourcePath: string }> | undefined): string | null {
  return evidence?.find((item) => item.sourcePath)?.sourcePath ?? null;
}

function option(label: string, value: string = normalizeKey(label)) {
  return { label, value };
}

function safeMatrixKey(value: string, fallback: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || fallback;
}

function matrixQuestionKey(dimension: string, choiceValue: string, tierLabel: string): string {
  return `matrix-price-${safeMatrixKey(dimension, "dimension")}-${safeMatrixKey(choiceValue, "choice")}-${safeMatrixKey(tierLabel, "tier")}`;
}

function questionForMissingDecision(brief: ProductIntakeBrief, decision: ProductIntakeBrief["missingDecisions"][number], sortOrder: number): NewQuestion | null {
  if (decision.severity === "info") return null;
  const sourcePath = firstEvidencePath(decision.evidence);
  const base = {
    questionKey: normalizeKey(decision.id),
    label: decision.question,
    helpText: decision.reason,
    required: decision.id === "select-material"
      ? false
      : decision.severity === "blocker" || decision.severity === "review",
    sourcePath,
    confidence: null,
    sortOrder,
  };

  if (decision.id === "select-material") {
    const materialOptions = brief.materialAnalysis.likelyMaterialMatches
      .filter((match) => match.materialId || match.name)
      .slice(0, 12)
      .map((match) => ({
        label: `${match.name}${match.sku ? ` (${match.sku})` : ""} - ${match.confidence}%`,
        value: match.materialId ?? match.name,
      }));
    if (materialOptions.length > 0) {
      return {
        ...base,
        questionType: "select",
        label: "Which material should this product use?",
        helpText: "Candidate TitanOS materials were found. Select the closest match or review the material library if none apply.",
        options: materialOptions,
        defaultValue: materialOptions[0]?.value ?? null,
      };
    }
    return {
      ...base,
      questionType: "text",
      label: "Which material should this product use?",
      helpText: "No confident material match was found. Enter the intended material or internal material name.",
      options: null,
      defaultValue: null,
    };
  }
  if (decision.id === "choose-pricing-model") {
    return {
      ...base,
      questionType: "select",
      label: "Which pricing model should this product use?",
      options: [
        option("Square foot", "square_foot"),
        option("Flat price", "flat"),
        option("Quantity tiers", "quantity_tiers"),
        option("Matrix or tiered", "matrix_or_tiered"),
        option("Formula", "formula"),
        option("Manual quote", "manual_quote"),
      ],
      defaultValue: null,
    };
  }
  if (decision.id === "confirm-category") {
    return {
      ...base,
      questionType: "text",
      label: "Which TitanOS product category should this use?",
      options: null,
      defaultValue: null,
    };
  }

  return {
    ...base,
    questionType: "text",
    options: null,
    defaultValue: null,
  };
}

function behaviorQuestion(args: {
  key: string;
  label: string;
  behavior: ProductIntakeBrief["sizeBehavior"];
  options: Array<{ label: string; value: string }>;
  sortOrder: number;
}): NewQuestion | null {
  if (args.behavior.behavior !== "unknown" && args.behavior.confidence >= 65) return null;
  return {
    questionKey: args.key,
    questionType: "select",
    label: args.label,
    helpText: "The analyzer could not determine this behavior confidently.",
    required: true,
    options: args.options,
    defaultValue: null,
    sourcePath: firstEvidencePath(args.behavior.evidence),
    confidence: args.behavior.confidence,
    sortOrder: args.sortOrder,
  };
}

function briefHasExplicitBasePricing(brief: ProductIntakeBrief): boolean {
  const text = [
    brief.pricingAnalysis.behavior,
    brief.pricingAnalysis.notes,
    ...brief.sourceEvidence.map((item) => `${item.label} ${item.value ?? ""} ${item.reason}`),
    ...brief.pricingAnalysis.evidence.map((item) => `${item.label} ${item.value ?? ""} ${item.reason}`),
  ].join("\n");
  return /\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf|each|piece|pc|item|unit)\b/i.test(text) ||
    /(?:minimum|min(?:imum)?\s*(?:charge|order)?|setup\s*minimum)\s*[:=]?\s*\$\s*\d[\d,]*(?:\.\d{1,2})?/i.test(text) ||
    /\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:minimum|min(?:imum)?(?:\s*charge)?)\b/i.test(text);
}

function pricingValueQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  if (briefHasExplicitBasePricing(brief)) return [];
  const sourcePath = firstEvidencePath(brief.pricingAnalysis.evidence) ?? firstEvidencePath(brief.sourceEvidence);
  const helpText = "Optional, draft-only base pricing. Leave blank if pricing needs later review; PBV2 publish will still require real pricing.";
  return [
    {
      questionKey: "base-price-per-sqft",
      questionType: "number",
      label: "What is the base price per square foot?",
      helpText,
      required: false,
      options: null,
      defaultValue: null,
      sourcePath,
      confidence: brief.pricingAnalysis.confidence,
      sortOrder: 50,
    },
    {
      questionKey: "base-price-per-piece",
      questionType: "number",
      label: "What is the base price per piece?",
      helpText,
      required: false,
      options: null,
      defaultValue: null,
      sourcePath,
      confidence: brief.pricingAnalysis.confidence,
      sortOrder: 51,
    },
    {
      questionKey: "minimum-charge",
      questionType: "number",
      label: "Is there a minimum charge?",
      helpText,
      required: false,
      options: null,
      defaultValue: null,
      sourcePath,
      confidence: brief.pricingAnalysis.confidence,
      sortOrder: 52,
    },
  ];
}

function matrixDecisionQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const readiness = brief.matrixReadiness;
  if (!readiness?.required) return [];
  const nonQuantityDimensions = readiness.matrixDimensions.filter((dimension) => !/^(quantity|qty|quantity_tier|quantity_tiers)$/i.test(dimension));
  if (readiness.matrixType === "QUANTITY_TIER" || nonQuantityDimensions.length === 0) return [];
  if (!readiness.noMatrixRowsGenerated && readiness.matrixConfidence >= 85) return [];
  if (readiness.matrixConfidence >= 85 && readiness.detectedQuantityBreaks.length >= 2) return [];

  const selectableOptions = [...brief.requiredOptions, ...brief.optionalOptions]
    .filter((optionGroup) => {
      const key = safeMatrixKey(optionGroup.normalizedGroup || optionGroup.label, "option");
      if (key === "quantity" || key.includes("quantity") || key === "qty") return false;
      if (key === "size" && optionGroup.sampleValues.filter((value) => value.trim()).length <= 1) return false;
      return optionGroup.sampleValues.filter((value) => value.trim()).length >= 2;
    });
  const dimensionOptions = selectableOptions.map((optionGroup) => ({
    label: optionGroup.label,
    value: safeMatrixKey(optionGroup.normalizedGroup || optionGroup.label, "option"),
  }));
  const preferredDimension = dimensionOptions.find((entry) => readiness.matrixDimensions.includes(entry.value)) ?? dimensionOptions[0] ?? null;
  const sourcePath = firstEvidencePath(brief.pricingAnalysis.evidence) ?? firstEvidencePath(brief.sourceEvidence);
  const questions: NewQuestion[] = [];

  questions.push({
    questionKey: "confirm-matrix-dimension",
    questionType: dimensionOptions.length > 0 ? "select" : "text",
    label: "Confirm matrix dimension",
    helpText: "Quantity tiers are quote/order line item quantity. Select the PBV2 customer option that defines the matrix rows.",
    required: true,
    options: dimensionOptions.length > 0 ? dimensionOptions : null,
    defaultValue: preferredDimension?.value ?? null,
    sourcePath,
    confidence: readiness.matrixConfidence,
    sortOrder: 55,
  });

  const detectedTierLabels = readiness.detectedQuantityBreaks.map(String);
  questions.push({
    questionKey: "confirm-matrix-quantity-tiers",
    questionType: "text",
    label: "Confirm quantity tiers",
    helpText: "Enter tiers like 1-100, 101-500, 501+. Quantity remains the line item quantity, not a PBV2 product option.",
    required: readiness.detectedQuantityBreaks.length < 2,
    options: null,
    defaultValue: detectedTierLabels.length > 0 ? detectedTierLabels.join(", ") : null,
    sourcePath,
    confidence: readiness.matrixConfidence,
    sortOrder: 56,
  });

  if (!preferredDimension || readiness.detectedQuantityBreaks.length < 2) return questions;
  const selectedOption = selectableOptions.find((optionGroup) => safeMatrixKey(optionGroup.normalizedGroup || optionGroup.label, "option") === preferredDimension.value);
  const choices = selectedOption?.sampleValues.map((label) => ({
    label: label.trim(),
    value: safeMatrixKey(label, "choice"),
  })).filter((choice) => choice.label) ?? [];
  choices.forEach((choice, choiceIndex) => {
    detectedTierLabels.forEach((tierLabel, tierIndex) => {
      questions.push({
        questionKey: matrixQuestionKey(preferredDimension.value, choice.value, tierLabel),
        questionType: "number",
        label: `What is the price for ${choice.label} at ${tierLabel}?`,
        helpText: "Enter the per-piece price for this matrix cell. Do not enter a placeholder.",
        required: false,
        options: null,
        defaultValue: null,
        sourcePath,
        confidence: readiness.matrixConfidence,
        sortOrder: 57 + choiceIndex * 10 + tierIndex,
      });
    });
  });
  return questions;
}

function formulaDecisionQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const behavior = `${brief.pricingAnalysis.behavior} ${brief.pricingAnalysis.notes ?? ""}`.toLowerCase();
  if (!/formula/.test(behavior) || brief.pricingAnalysis.confidence >= 85) return [];
  return [{
    questionKey: "choose-pricing-formula",
    questionType: "select",
    label: "Which pricing formula should be used?",
    helpText: "The source appears formula-driven, but the exact PBV2 formula pattern was not confident enough to assign automatically.",
    required: true,
    options: [
      option("Sticker adjusted rounded square feet", "STICKER_ADJUSTED_ROUNDED_SQFT"),
      option("Default square foot formula", "DEFAULT_SQFT"),
      option("Manual review", "MANUAL_REVIEW"),
    ],
    defaultValue: "STICKER_ADJUSTED_ROUNDED_SQFT",
    sourcePath: firstEvidencePath(brief.pricingAnalysis.evidence) ?? firstEvidencePath(brief.sourceEvidence),
    confidence: brief.pricingAnalysis.confidence,
    sortOrder: 54,
  }];
}

function ruleDecisionQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const options = [...brief.requiredOptions, ...brief.optionalOptions];
  const contour = options.find((optionGroup) => /contour[\s_-]*cut/i.test(`${optionGroup.label} ${optionGroup.normalizedGroup}`));
  const weed = options.find((optionGroup) => /weed[\s_-]*(?:and|&)?[\s_-]*tape/i.test(`${optionGroup.label} ${optionGroup.normalizedGroup}`));
  if (!contour || !weed) return [];
  if (contour.confidence >= 85 && weed.confidence >= 85) return [];
  return [{
    questionKey: "confirm-weed-and-tape-contour-rule",
    questionType: "boolean",
    label: "Should Weed and Tape require Contour Cutting?",
    helpText: "If yes, Product Intake will hide and clear Weed and Tape unless Contour Cutting is Yes.",
    required: false,
    options: null,
    defaultValue: true,
    sourcePath: weed.sourcePaths[0] ?? firstEvidencePath(weed.evidence) ?? firstEvidencePath(contour.evidence),
    confidence: Math.min(contour.confidence, weed.confidence),
    sortOrder: 58,
  }];
}

function customOptionQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const questions: NewQuestion[] = [];
  const allOptions = [...brief.requiredOptions, ...brief.optionalOptions];
  allOptions.forEach((optionGroup, optionIndex) => {
    // A template match is only a suggestion. Unless reuse was explicitly
    // selected, this is a normal product-local option that the wizard owns.
    if (optionGroup.source === "reusable_template" && optionGroup.reuseTemplateId) return;
    const optionKey = normalizeKey(optionGroup.normalizedGroup || optionGroup.label);
    const prefix = `custom-option-${optionKey}`;
    const sourcePath = optionGroup.sourcePaths[0] ?? firstEvidencePath(optionGroup.evidence);
    const structuredChoices = optionGroup.choices ?? [];
    const legacyChoices = optionGroup.sampleValues
      .map((value) => value.trim())
      .filter((value) => value && normalizeKey(value) !== optionKey);
    const choices = structuredChoices.length > 0
      ? structuredChoices.map((choice) => stripDefaultChoiceAnnotation(choice.label).label).filter(Boolean)
      : legacyChoices.map((choice) => stripDefaultChoiceAnnotation(choice).label).filter(Boolean);
    const pricedChoices = structuredChoices.filter((choice) => {
      const pricing = choice.pricing;
      return pricing && pricing.mode !== "none" && Number.isFinite(pricing.amount) && Number(pricing.amount) >= 0;
    });
    const completedPricingChoices = structuredChoices.filter((choice) => {
      const pricing = choice.pricing;
      return pricing?.mode === "none" || Boolean(pricing && Number.isFinite(pricing.amount) && Number(pricing.amount) >= 0);
    });
    const pricingIncomplete = optionGroup.pricingRequired === true && completedPricingChoices.length < Math.max(structuredChoices.length, choices.length);
    const sortBase = 130 + optionIndex * 10;

    questions.push({
      questionKey: `${prefix}-required`,
      questionType: "boolean",
      label: `Is ${optionGroup.label} required?`,
      helpText: "Product-specific option. This does not create or require a global option template.",
      required: false,
      options: null,
      defaultValue: optionGroup.required,
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase,
    });
    questions.push({
      questionKey: `${prefix}-selection-mode`,
      questionType: "select",
      label: `How should ${optionGroup.label} be selected?`,
      helpText: "Choose whether staff/customers select one choice or multiple choices.",
      required: false,
      options: [option("Single select", "single"), option("Multi-select", "multi")],
      defaultValue: optionGroup.selectionMode ?? "single",
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase + 1,
    });
    questions.push({
      questionKey: `${prefix}-choices`,
      questionType: "text",
      label: `What choices should ${optionGroup.label} have?`,
      helpText: "Enter comma-separated choices. New choices stay attached to this product only.",
      required: choices.length === 0,
      options: null,
      defaultValue: choices.length > 0 ? choices.join(", ") : null,
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase + 2,
    });
    questions.push({
      questionKey: `${prefix}-pricing-model`,
      questionType: "select",
      label: `How does ${optionGroup.label} affect price?`,
      helpText: "Use set-per-square-foot for material/thickness rates; modifiers may add flat, per-piece, per-square-foot, percent, or per-grommet charges.",
      required: pricingIncomplete,
      options: [
        ...(!pricingIncomplete ? [option("No price change", "none")] : []),
        option("Set price per square foot", "set_per_sqft"),
        option("Set price per piece", "set_per_piece"),
        option("Add flat fee", "add_flat"),
        option("Add per piece", "add_per_piece"),
        option("Add per square foot", "add_per_sqft"),
        option("Percent increase", "add_percent"),
        option("Per grommet", "add_per_grommet"),
      ],
      defaultValue: structuredChoices.find((choice) => choice.pricing?.mode && choice.pricing.mode !== "none")?.pricing?.mode ?? "none",
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase + 3,
    });
    questions.push({
      questionKey: `${prefix}-pricing-values`,
      questionType: "text",
      label: `What price applies to each ${optionGroup.label} choice?`,
      helpText: `Enter one pair per choice, for example ${choicePricingExample(choices)}. Amounts are dollars; percent uses percentage points. For a yes/no per-grommet price, “.25 per grommet” is accepted and becomes no=0, yes=0.25.`,
      required: pricingIncomplete,
      options: choices.map((choice) => ({ label: choice, value: choice })),
      defaultValue: pricedChoices.length > 0
        ? pricedChoices.map((choice) => `${choice.label}=${choice.pricing?.amount}`).join(", ")
        : null,
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase + 4,
    });
    questions.push({
      questionKey: `${prefix}-default-choice`,
      questionType: "select",
      label: `Which ${optionGroup.label} choice should be selected by default?`,
      helpText: "This controls the initial selection only; it does not become part of the customer-facing choice label.",
      required: false,
      options: choices.map((choice) => ({ label: choice, value: choice })),
      defaultValue: optionGroup.defaultChoice ?? null,
      sourcePath,
      confidence: optionGroup.confidence,
      sortOrder: sortBase + 5,
    });
    for (const [suffix, label, defaultValue] of [
      ["weight", `Does ${optionGroup.label} affect weight?`, optionGroup.affectsWeight ?? false],
      ["routing", `Does ${optionGroup.label} affect production routing?`, optionGroup.affectsRouting ?? false],
      ["proof", `Does ${optionGroup.label} affect proofing?`, optionGroup.affectsProof ?? false],
    ] as const) {
      questions.push({
        questionKey: `${prefix}-${suffix}`,
        questionType: "boolean",
        label,
        helpText: "This preserves operational intent on the generated PBV2 choices for staff review.",
        required: false,
        options: null,
        defaultValue,
        sourcePath,
        confidence: optionGroup.confidence,
        sortOrder: sortBase + (suffix === "weight" ? 6 : suffix === "routing" ? 7 : 8),
      });
    }
  });
  return questions;
}

function needsWorkflowFollowUp(brief: ProductIntakeBrief): boolean {
  return brief.draftWarnings.some((warning) => {
    const text = `${warning.code} ${warning.message}`;
    if (!/routing|prepress|proof/i.test(text)) return false;
    if (warning.severity === "info" && /proof_required|routing_signal/i.test(warning.code)) return false;
    return /unknown|missing|unclear|ambiguous|conflict|review|warning|blocker/i.test(text) || warning.severity === "warning";
  });
}

export function generateProductIntakeQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const questions: NewQuestion[] = [];
  const seen = new Set<string>();
  const push = (question: NewQuestion | null) => {
    if (!question || seen.has(question.questionKey)) return;
    seen.add(question.questionKey);
    questions.push(question);
  };

  brief.missingDecisions.forEach((decision, index) => push(questionForMissingDecision(brief, decision, index + 1)));
  push(behaviorQuestion({
    key: "confirm-size-behavior",
    label: "How should size be captured?",
    behavior: brief.sizeBehavior,
    options: [option("Fixed sizes", "fixed_size"), option("Custom width and height", "custom_size"), option("No size input", "none")],
    sortOrder: 40,
  }));
  push(behaviorQuestion({
    key: "confirm-quantity-behavior",
    label: "How should quantity be captured?",
    behavior: brief.quantityBehavior,
    options: [option("Per piece", "per_piece"), option("Quantity tiers", "quantity_tiers"), option("No customer quantity input", "none")],
    sortOrder: 41,
  }));
  pricingValueQuestions(brief).forEach(push);
  formulaDecisionQuestions(brief).forEach(push);
  matrixDecisionQuestions(brief).forEach(push);
  ruleDecisionQuestions(brief).forEach(push);
  customOptionQuestions(brief).forEach(push);

  for (const optionGroup of [...brief.requiredOptions, ...brief.optionalOptions]) {
    if (optionGroup.confidence < 65) {
      push({
        questionKey: `confirm-option-required-${normalizeKey(optionGroup.normalizedGroup)}`,
        questionType: "boolean",
        label: `Should ${optionGroup.normalizedGroup} be required?`,
        helpText: "The source was unclear about whether this option should be required or optional.",
        required: true,
        options: null,
        defaultValue: optionGroup.required,
        sourcePath: optionGroup.sourcePaths[0] ?? firstEvidencePath(optionGroup.evidence),
        confidence: optionGroup.confidence,
        sortOrder: 70 + questions.length,
      });
    }

    for (const match of optionGroup.templateMatches) {
      push({
        questionKey: `review-template-${normalizeKey(optionGroup.normalizedGroup)}-${normalizeKey(match.templateId)}`,
        questionType: "select",
        label: `Use suggested template "${match.name}" for ${optionGroup.normalizedGroup}?`,
        helpText: "Template reuse is optional. Keep product-specific to generate choices only for this product.",
        required: false,
        options: [option("Keep product-specific", "product_specific"), option("Reuse existing template", "reuse"), option("Not applicable", "not_applicable")],
        defaultValue: "product_specific",
        sourcePath: firstEvidencePath(match.evidence) ?? optionGroup.sourcePaths[0] ?? null,
        confidence: Math.round(match.score * 100),
        sortOrder: 90 + questions.length,
      });
    }
  }

  if (needsWorkflowFollowUp(brief)) {
    push({
      questionKey: "confirm-routing-proof-prepress",
      questionType: "text",
      label: "Any routing, proofing, or prepress requirements to preserve?",
      helpText: "The analyzer found workflow-related uncertainty worth capturing before draft generation.",
      required: false,
      options: null,
      defaultValue: null,
      sourcePath: firstEvidencePath(brief.draftWarnings.flatMap((warning) => warning.evidence)),
      confidence: null,
      sortOrder: 120,
    });
  }

  return questions.sort((a, b) => a.sortOrder - b.sortOrder || a.questionKey.localeCompare(b.questionKey));
}

function hasAnswerValue(question: ProductIntakeQuestion, value: unknown): boolean {
  if (value == null) return false;
  if (question.questionType === "boolean") return typeof value === "boolean";
  if (question.questionType === "number") return typeof value === "number" && Number.isFinite(value);
  if (question.questionType === "multiselect") return Array.isArray(value) && value.length > 0;
  if (question.questionType === "select") return typeof value === "string" ? value.trim().length > 0 : true;
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalChoiceLabel(value: string): string {
  const trimmed = value.trim().replace(/^[-*•\s]+|^\d+[.)]\s*/g, "");
  if (!trimmed) return "";
  return trimmed.split(/\s+/).map((part) => part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part).join(" ");
}

/** "None" is an ordinary option value, never a blank pending answer. */
export function parseProductIntakeChoiceAnswer(value: unknown): string[] {
  const source = Array.isArray(value) ? value.map(String).join("\n") : typeof value === "string" ? value : "";
  const seen = new Set<string>();
  return source.replace(/\r/g, "\n").split(/[\n,;/|]+/).map(canonicalChoiceLabel).filter((choice) => {
    const key = normalizeKey(choice);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Applies canonical question targets to the authoritative brief before
 * rebuilding questions/readiness; it never infers a second option group. */
export function applyProductIntakeAnswersToBrief(
  brief: ProductIntakeBrief,
  answers: Array<Pick<ProductIntakeAnswer, "questionKey" | "answer">>,
): ProductIntakeBrief {
  const answerByKey = new Map(answers.map((answer) => [answer.questionKey, answer.answer]));
  const updated = [...brief.requiredOptions, ...brief.optionalOptions].map((optionGroup) => {
    const optionKey = normalizeKey(optionGroup.normalizedGroup || optionGroup.label);
    const prefix = `custom-option-${optionKey}`;
    const choiceAnswer = answerByKey.get(`${prefix}-choices`);
    const defaultAnswer = answerByKey.get(`${prefix}-default-choice`);
    const requiredAnswer = answerByKey.get(`${prefix}-required`) ?? answerByKey.get(`confirm-option-required-${optionKey}`);
    const selectionAnswer = answerByKey.get(`${prefix}-selection-mode`);
    const parsedChoices = choiceAnswer === undefined ? [] : parseProductIntakeChoiceAnswer(choiceAnswer);
    const choiceLabels = parsedChoices.length ? parsedChoices : optionGroup.choices?.map((choice) => choice.label) ?? optionGroup.sampleValues;
    const requestedDefault = typeof defaultAnswer === "string" && defaultAnswer.trim()
      ? canonicalChoiceLabel(defaultAnswer)
      : optionGroup.defaultChoice ? canonicalChoiceLabel(optionGroup.defaultChoice) : null;
    const boundDefault = requestedDefault ? choiceLabels.find((choice) => normalizeKey(choice) === normalizeKey(requestedDefault)) ?? null : null;
    return {
      ...optionGroup,
      ...(typeof requiredAnswer === "boolean" ? { required: requiredAnswer } : {}),
      ...(selectionAnswer === "single" || selectionAnswer === "multi" ? { selectionMode: selectionAnswer as "single" | "multi" } : {}),
      ...(parsedChoices.length ? { sampleValues: parsedChoices, choices: parsedChoices.map((label) => ({ value: normalizeKey(label), label })) } : {}),
      ...(boundDefault ? { defaultChoice: boundDefault } : {}),
    };
  });
  return { ...brief, requiredOptions: updated.filter((option) => option.required), optionalOptions: updated.filter((option) => !option.required) };
}

function validateAnswerValue(question: ProductIntakeQuestion, value: unknown) {
  if (value == null) return;
  if (question.questionType === "boolean" && typeof value !== "boolean") {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be true or false.`, "INVALID_ANSWER");
  }
  if (question.questionType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be a number.`, "INVALID_ANSWER");
  }
  if (question.questionType === "multiselect" && !Array.isArray(value)) {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be an array.`, "INVALID_ANSWER");
  }
  if ((question.questionType === "select" || question.questionType === "text") && typeof value !== "string") {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be text.`, "INVALID_ANSWER");
  }
  if (question.questionKey.endsWith("-pricing-values") && typeof value === "string" && value.trim()) {
    const entries = value.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
    if (entries.length === 0 || entries.some((entry) => !/^.+?\s*=\s*\$?\s*\d+(?:\.\d+)?\s*%?$/.test(entry))) {
      throw new ProductIntakeSessionError(
        400,
        `Answer for "${question.label}" must use one Choice=Amount pair per choice (for example, ${choicePricingExample((question.options ?? []).map((choice) => String(choice.label)))}). Natural-language shortcuts are only supported for obvious yes/no per-unit pricing.`,
        "INVALID_OPTION_PRICING",
      );
    }
  }
}

export function resolveProductIntakeAnswersForPersistence(args: {
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswerPatchItem[];
}): Array<{ question: ProductIntakeQuestion; answer: unknown }> {
  const questionsById = new Map(args.questions.map((question) => [question.id, question]));
  const questionsByKey = new Map(args.questions.map((question) => [question.questionKey, question]));
  const resolved: Array<{ question: ProductIntakeQuestion; answer: unknown }> = [];

  for (const incoming of args.answers) {
    const question = incoming.questionId
      ? questionsById.get(incoming.questionId)
      : questionsByKey.get(incoming.questionKey ?? "");
    if (!question) {
      throw new ProductIntakeSessionError(404, "Question not found for this intake session.", "QUESTION_NOT_FOUND");
    }

    // Blank answers are intentionally ignored. Readiness continues to report
    // required context as missing, while previously saved answers stay intact.
    if (!hasAnswerValue(question, incoming.answer)) continue;
    const choiceLabels = (question.options ?? []).map((choice) => String(choice.label));
    const normalizedAnswer = question.questionKey.endsWith("-pricing-values")
      ? normalizeChoicePricingAnswer(incoming.answer, choiceLabels)
      : incoming.answer;
    validateAnswerValue(question, normalizedAnswer);
    resolved.push({ question, answer: normalizedAnswer });
  }

  return resolved;
}

type CorrectedStateOptionContract = {
  key: string;
  label: string;
  required: boolean;
  selectionMode: "single" | "multi";
  choices: string[];
  defaultChoice: string | null;
};

type CorrectedStateContract = {
  category: string | null;
  measurementBehavior: ProductIntakeBrief["sizeBehavior"]["behavior"] | null;
  perSqftCents: number | null;
  perPieceCents: number | null;
  minimumChargeCents: number | null;
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee" | null;
  requiresProductionJob: boolean | null;
  materialSelection: "auto" | "unset" | null;
  requiresProofApproval: boolean | null;
  productionRoute: string | null;
  minimumChargeExplicitlyUnset: boolean;
  requiredOptions: CorrectedStateOptionContract[];
  removedOptionKeys: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function correctedStateContractFromConfidence(value: unknown): CorrectedStateContract | null {
  const source = asRecord(value);
  if (!source) return null;
  const requiredOptions = Array.isArray(source.requiredOptions) ? source.requiredOptions.flatMap((item) => {
    const option = asRecord(item);
    if (!option) return [];
    const key = typeof option?.key === "string" ? option.key : "";
    const label = typeof option?.label === "string" ? option.label : "";
    if (!key || !label) return [];
    return [{
      key,
      label,
      required: option.required === true,
      selectionMode: option.selectionMode === "multi" ? "multi" as const : "single" as const,
      choices: Array.isArray(option.choices) ? option.choices.filter((choice): choice is string => typeof choice === "string") : [],
      defaultChoice: typeof option.defaultChoice === "string" ? option.defaultChoice : null,
    }];
  }) : [];
  return {
    category: typeof source.category === "string" && source.category.trim() ? source.category : null,
    measurementBehavior: typeof source.measurementBehavior === "string" ? source.measurementBehavior as ProductIntakeBrief["sizeBehavior"]["behavior"] : null,
    perSqftCents: typeof source.perSqftCents === "number" && Number.isInteger(source.perSqftCents) && source.perSqftCents > 0 ? source.perSqftCents : null,
    perPieceCents: typeof source.perPieceCents === "number" && Number.isInteger(source.perPieceCents) && source.perPieceCents > 0 ? source.perPieceCents : null,
    minimumChargeCents: typeof source.minimumChargeCents === "number" && Number.isInteger(source.minimumChargeCents) && source.minimumChargeCents > 0 ? source.minimumChargeCents : null,
    workflowIntent: source.workflowIntent === "standard_production" || source.workflowIntent === "fulfillment_only" || source.workflowIntent === "service_fee" ? source.workflowIntent : null,
    requiresProductionJob: typeof source.requiresProductionJob === "boolean" ? source.requiresProductionJob : null,
    materialSelection: source.materialSelection === "auto" || source.materialSelection === "unset" ? source.materialSelection : null,
    requiresProofApproval: typeof source.requiresProofApproval === "boolean" ? source.requiresProofApproval : null,
    productionRoute: typeof source.productionRoute === "string" && source.productionRoute.trim() ? source.productionRoute : null,
    minimumChargeExplicitlyUnset: source.minimumChargeExplicitlyUnset === true,
    requiredOptions,
    removedOptionKeys: Array.isArray(source.removedOptionKeys) ? source.removedOptionKeys.filter((key): key is string => typeof key === "string") : [],
  };
}

function centsFromText(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  const amount = match?.[1] ?? match?.[2];
  if (!amount) return null;
  const dollars = Number(amount.replace(/,/g, ""));
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
}

function correctedPricingContract(brief: ProductIntakeBrief, sourceText: string | null, prior: CorrectedStateContract | null) {
  const marker = "Explicit Product Intake correction (new explicit values override all prior assumptions):";
  const correction = sourceText?.includes(marker) ? sourceText.slice(sourceText.lastIndexOf(marker)) : null;
  const priceText = correction ?? brief.pricingAnalysis.notes ?? "";
  return {
    perSqftCents: centsFromText(priceText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet)\b/i) ?? prior?.perSqftCents ?? null,
    perPieceCents: centsFromText(priceText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:each|piece|pc|item|unit)\b/i) ?? prior?.perPieceCents ?? null,
    minimumChargeCents: centsFromText(priceText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:minimum|min(?:imum)?\s*charge)\b|(?:minimum|min(?:imum)?\s*charge)\s*(?:is|of|:)?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/i) ?? prior?.minimumChargeCents ?? null,
  };
}

function optionContract(option: ProductIntakeBrief["requiredOptions"][number]): CorrectedStateOptionContract {
  const choices = option.choices?.map((choice) => choice.label).filter(Boolean) ?? option.sampleValues;
  return {
    key: normalizeKey(option.normalizedGroup || option.label),
    label: option.label,
    required: option.required,
    selectionMode: option.selectionMode === "multi" ? "multi" : "single",
    choices,
    defaultChoice: option.defaultChoice ?? null,
  };
}

/** Captures an explicit correction's complete state in existing session JSON so
 * later question answers cannot silently rebuild a reduced proposal. */
export function buildCorrectedStateContract(
  brief: ProductIntakeBrief,
  sourceText: string | null,
  previous: unknown = null,
): CorrectedStateContract {
  const prior = correctedStateContractFromConfidence(previous);
  const removed = new Set(prior?.removedOptionKeys ?? []);
  if (sourceText && /\bremove\s+(?:the\s+)?size\s+option\b/i.test(sourceText)) removed.add("size");
  const pricing = correctedPricingContract(brief, sourceText, prior);
  return {
    category: brief.productIdentity.category.value?.trim() || prior?.category || null,
    measurementBehavior: brief.sizeBehavior.behavior ?? prior?.measurementBehavior ?? null,
    ...pricing,
    workflowIntent: brief.workflowIntent ?? prior?.workflowIntent ?? null,
    requiresProductionJob: brief.requiresProductionJob ?? prior?.requiresProductionJob ?? null,
    materialSelection: brief.materialSelection ?? prior?.materialSelection ?? null,
    requiresProofApproval: brief.requiresProofApproval ?? prior?.requiresProofApproval ?? null,
    productionRoute: brief.productionRoute ?? prior?.productionRoute ?? null,
    minimumChargeExplicitlyUnset: brief.minimumChargeExplicitlyUnset === true || prior?.minimumChargeExplicitlyUnset === true,
    requiredOptions: brief.requiredOptions.map(optionContract),
    removedOptionKeys: Array.from(removed),
  };
}

/** Returns blockers for a reduced or malformed corrected state before it can
 * be presented as ready or used to create a PBV2 DRAFT. */
export function correctedStateBlockers(brief: ProductIntakeBrief, contractValue: unknown = null): string[] {
  const blockers: string[] = [];
  const allOptions = [...brief.requiredOptions, ...brief.optionalOptions];
  if (!brief.productIdentity.category.value?.trim()) blockers.push("Product category is required before creating a draft.");
  const contract = correctedStateContractFromConfidence(contractValue);
  if (!contract) return blockers;
  if (contract.category && normalizeKey(brief.productIdentity.category.value ?? "") !== normalizeKey(contract.category)) {
    blockers.push(`Corrected category ${contract.category} is missing from the current intake revision.`);
  }
  if (contract.measurementBehavior && brief.sizeBehavior.behavior !== contract.measurementBehavior) {
    blockers.push("Corrected measurement behavior was not preserved in the current intake revision.");
  }
  const pricingText = brief.pricingAnalysis.notes ?? "";
  const perSqftCents = centsFromText(pricingText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet)\b/i);
  const minimumChargeCents = centsFromText(pricingText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:minimum|min(?:imum)?\s*charge)\b|(?:minimum|min(?:imum)?\s*charge)\s*(?:is|of|:)?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (contract.perSqftCents != null && perSqftCents !== contract.perSqftCents) {
    blockers.push("Corrected per-square-foot price was not preserved in the current intake revision.");
  }
  const perPieceCents = centsFromText(pricingText, /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:each|piece|pc|item|unit)\b/i);
  if (contract.perPieceCents != null && perPieceCents !== contract.perPieceCents) {
    blockers.push("Corrected per-piece price was not preserved in the current intake revision.");
  }
  if (contract.minimumChargeCents != null && minimumChargeCents !== contract.minimumChargeCents) {
    blockers.push("Corrected minimum charge was not preserved in the current intake revision.");
  }
  if (contract.workflowIntent != null && brief.workflowIntent !== contract.workflowIntent) {
    blockers.push("Corrected workflow intent was not preserved in the current intake revision.");
  }
  if (contract.requiresProductionJob != null && brief.requiresProductionJob !== contract.requiresProductionJob) {
    blockers.push("Corrected production-job requirement was not preserved in the current intake revision.");
  }
  if (contract.materialSelection === "unset" && brief.materialSelection !== "unset") {
    blockers.push("Corrected unset material state was not preserved in the current intake revision.");
  }
  if (contract.requiresProofApproval != null && brief.requiresProofApproval !== contract.requiresProofApproval) {
    blockers.push("Corrected proof-approval requirement was not preserved in the current intake revision.");
  }
  if (contract.productionRoute != null && brief.productionRoute !== contract.productionRoute) {
    blockers.push("Corrected production route was not preserved in the current intake revision.");
  }
  if (contract.minimumChargeExplicitlyUnset && brief.minimumChargeExplicitlyUnset !== true) {
    blockers.push("Corrected unset minimum charge was not preserved in the current intake revision.");
  }
  for (const expected of contract.requiredOptions) {
    const option = allOptions.find((candidate) => normalizeKey(candidate.normalizedGroup || candidate.label) === expected.key);
    if (!option) {
      blockers.push(`Required corrected option ${expected.label} is missing from the current intake revision.`);
      continue;
    }
    const choices = option.choices?.map((choice) => choice.label).filter(Boolean) ?? option.sampleValues;
    if (expected.required && !option.required) blockers.push(`Required state for ${expected.label} was not preserved.`);
    if (option.selectionMode !== expected.selectionMode) blockers.push(`Selection mode for ${expected.label} was not preserved.`);
    if (expected.choices.some((choice) => !choices.some((candidate) => normalizeKey(candidate) === normalizeKey(choice)))) {
      blockers.push(`Choices for ${expected.label} were not preserved.`);
    }
    const expectedDefault = expected.defaultChoice;
    if (expectedDefault && !choices.some((choice) => normalizeKey(choice) === normalizeKey(expectedDefault))) {
      blockers.push(`Default ${expectedDefault} for ${expected.label} is not a valid choice.`);
    } else if (expectedDefault && normalizeKey(option.defaultChoice ?? "") !== normalizeKey(expectedDefault)) {
      blockers.push(`Default ${expectedDefault} for ${expected.label} was not preserved.`);
    }
  }
  for (const removedKey of contract.removedOptionKeys) {
    if (allOptions.some((option) => normalizeKey(option.normalizedGroup || option.label) === removedKey)) {
      blockers.push(`Removed option ${removedKey} reappeared in the current intake revision.`);
    }
  }
  return blockers;
}

export function computeProductIntakeReadiness(args: {
  session: ProductIntakeSession;
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswer[];
}): ProductIntakeReadiness {
  const answerByKey = new Map(args.answers.map((answer) => [answer.questionKey, answer]));
  const unansweredRequiredCount = args.questions.filter((question) =>
    question.required && !hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer),
  ).length;
  const answeredCount = args.questions.filter((question) => hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer)).length;
  const status = args.session.status === "abandoned" || args.session.status === "draft_created"
    ? args.session.status
    : unansweredRequiredCount > 0
      ? "needs_answers"
      : "ready_for_draft";
  const penalties: Array<{ code: string; label: string; severity: "review" | "blocker" }> = [];
  const brief = args.session.brief;
  const materialConfidence = brief.materialAnalysis.confidence;
  const bestTemplateReviewCount = brief.templateMatches.filter((match) => match.recommendation === "review_required").length;
  const materialAnswered = hasAnswerValue(
    args.questions.find((question) => question.questionKey === "select-material") ?? ({
      questionType: "text",
    } as ProductIntakeQuestion),
    answerByKey.get("select-material")?.answer,
  );
  const pricingAnswered = hasAnswerValue(
    args.questions.find((question) => question.questionKey === "choose-pricing-model") ?? ({
      questionType: "text",
    } as ProductIntakeQuestion),
    answerByKey.get("choose-pricing-model")?.answer,
  );
  const workflowNeedsReview = brief.draftWarnings.some((warning) => {
    const text = `${warning.code} ${warning.message}`;
    if (!/routing|prepress|proof/i.test(text)) return false;
    if (warning.severity === "info" && /proof_required|routing_signal/i.test(warning.code)) return false;
    return warning.severity === "warning" || /unknown|missing|unclear|ambiguous|conflict|review/i.test(text);
  });

  if (unansweredRequiredCount > 0) {
    penalties.push({ code: "required_answers_open", label: `${unansweredRequiredCount} required answer(s) still open`, severity: "blocker" });
  }
  if (brief.workflowIntent !== "service_fee" && brief.materialSelection !== "unset" && !materialAnswered && (materialConfidence < 65 || brief.materialAnalysis.likelyMaterialMatches.length === 0)) {
    penalties.push({ code: "material_unresolved", label: "Material association required.", severity: "review" });
  }
  if (!pricingAnswered && (brief.pricingAnalysis.behavior === "unknown" || brief.pricingAnalysis.confidence < 65)) {
    penalties.push({ code: "pricing_unresolved", label: "Pricing behavior is unresolved or below confidence threshold", severity: "blocker" });
  }
  if (brief.workflowIntent === "service_fee" && brief.sizeBehavior.behavior !== "none") {
    penalties.push({ code: "service_fee_measurement_unresolved", label: "Service-fee products must use quantity-only measurement.", severity: "blocker" });
  }
  if (brief.workflowIntent === "service_fee" && brief.requiresProductionJob !== false) {
    penalties.push({ code: "service_fee_production_job_unresolved", label: "Service-fee products must explicitly not require a production job.", severity: "blocker" });
  }
  if (workflowNeedsReview) {
    penalties.push({ code: "workflow_unresolved", label: "Routing, proofing, or prepress workflow still needs review", severity: "review" });
  }
  if (bestTemplateReviewCount >= 3) {
    penalties.push({ code: "template_ambiguity", label: "Several option template matches still require review", severity: "review" });
  }
  for (const label of correctedStateBlockers(brief, args.session.confidence?.correctedStateContract)) {
    penalties.push({ code: "corrected_state_incomplete", label, severity: "blocker" });
  }

  const currentConfidence = typeof args.session.confidence?.currentConfidence === "number" ? args.session.confidence.currentConfidence : brief.overallConfidence;
  const reviewScore = clampConfidence(currentConfidence
    - penalties.filter((penalty) => penalty.severity === "blocker").length * 20
    - penalties.filter((penalty) => penalty.severity === "review").length * 10);
  const reviewState = args.session.status === "abandoned" || args.session.status === "draft_created"
    ? "not_ready"
    : penalties.some((penalty) => penalty.severity === "blocker")
      ? "not_ready"
      : penalties.length > 0 || reviewScore < 75
        ? "needs_review"
        : "ready_for_draft";
  const resolvedStatus = args.session.status === "abandoned" || args.session.status === "draft_created"
    ? args.session.status
    : penalties.some((penalty) => penalty.severity === "blocker")
      ? "needs_answers"
      : status;
  const canCreateDraft =
    resolvedStatus === "ready_for_draft" &&
    unansweredRequiredCount === 0 &&
    !penalties.some((penalty) => penalty.severity === "blocker") &&
    !args.session.createdProductId &&
    !args.session.createdPbv2TreeVersionId;

  return productIntakeReadinessSchema.parse({
    unansweredRequiredCount,
    answeredCount,
    canCreateDraft,
    status: resolvedStatus,
    reviewState,
    reviewScore,
    penalties,
  });
}

export function resolveProductIntakeSessionStatus(brief: ProductIntakeBrief, questions: Array<Pick<NewQuestion, "required">>): ProductIntakeSessionStatus {
  if (questions.some((question) => question.required)) return "needs_answers";
  if (brief.workflowIntent === "service_fee" && (brief.sizeBehavior.behavior !== "none" || brief.requiresProductionJob !== false)) return "needs_answers";
  if (correctedStateBlockers(brief).length > 0) return "needs_answers";
  return brief.overallConfidence >= 75 ? "ready_for_draft" : "analyzed";
}

function sourceTypeForRequest(request: ProductIntakeWizardAnalyzeRequest): ProductIntakeSession["sourceType"] {
  if (request.sourceType === "text_description") return "text_description";
  return request.sourceType === "uploaded_json" ? "json_upload" : "json_paste";
}

function parseSourceJson(request: ProductIntakeWizardAnalyzeRequest): unknown | null {
  if (request.sourceType === "text_description") return null;
  if (request.sourceJson !== undefined) return request.sourceJson;
  if (request.analyzerRequest?.sourceJson !== undefined) return request.analyzerRequest.sourceJson;
  const jsonText = request.jsonText ?? request.analyzerRequest?.jsonText;
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function sourceTextForRequest(request: ProductIntakeWizardAnalyzeRequest): string | null {
  if (request.sourceType === "text_description") return request.description ?? null;
  return request.jsonText ?? request.analyzerRequest?.jsonText ?? request.description ?? null;
}

export function fingerprintProductIntakeRequest(request: ProductIntakeWizardAnalyzeRequest, analyzer: CatalogMigrationLabAnalyzerResult | null): string | null {
  if (analyzer?.source.fingerprint) return analyzer.source.fingerprint;
  const text = sourceTextForRequest(request);
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex");
}

function confidenceNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function recalculateProductIntakeConfidence(args: {
  session: ProductIntakeSession;
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswer[];
}) {
  const existing = args.session.confidence ?? {};
  const originalConfidence = confidenceNumber(existing.originalConfidence) ?? confidenceNumber(existing.overallConfidence) ?? args.session.brief.overallConfidence;
  const answerByKey = new Map(args.answers.map((answer) => [answer.questionKey, answer]));
  const answeredKeys = args.questions
    .filter((question) => hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer))
    .map((question) => question.questionKey);
  let lift = 0;
  for (const key of answeredKeys) {
    if (key === "select-material") lift += 15;
    else if (key === "choose-pricing-model") lift += 12;
    else if (key === "confirm-size-behavior") lift += 10;
    else if (key === "confirm-quantity-behavior") lift += 8;
    else if (key.startsWith("confirm-option-required-")) lift += 4;
    else if (key.startsWith("review-template-")) lift += 2;
    else lift += 3;
  }
  return {
    ...existing,
    originalConfidence,
    currentConfidence: clampConfidence(originalConfidence + lift),
    answeredQuestionKeys: answeredKeys,
    answeredQuestionCount: answeredKeys.length,
    recalculatedAt: new Date().toISOString(),
  };
}

function mapSession(row: ProductIntakeSessionRow): ProductIntakeSession {
  return productIntakeSessionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    sourceFingerprint: row.sourceFingerprint,
    brief: row.aiBriefJson,
    confidence: row.confidenceJson ?? null,
    missingDecisions: Array.isArray(row.missingDecisionsJson) ? row.missingDecisionsJson : null,
    status: row.status,
    createdProductId: row.createdProductId,
    createdPbv2TreeVersionId: row.createdPbv2TreeVersionId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    abandonedAt: nullableIso(row.abandonedAt),
  });
}

function mapQuestion(row: ProductIntakeQuestionRow): ProductIntakeQuestion {
  return productIntakeQuestionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    questionKey: row.questionKey,
    questionType: row.questionType,
    label: row.label,
    helpText: row.helpText,
    required: row.required,
    options: Array.isArray(row.optionsJson) ? row.optionsJson : null,
    defaultValue: row.defaultValueJson ?? null,
    sourcePath: row.sourcePath,
    confidence: row.confidence == null ? null : Number(row.confidence),
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function mapAnswer(row: ProductIntakeAnswerRow): ProductIntakeAnswer {
  return productIntakeAnswerSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    questionId: row.questionId,
    questionKey: row.questionKey,
    answer: row.answerJson ?? null,
    answeredByUserId: row.answeredByUserId,
    answeredAt: nullableIso(row.answeredAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

export function createDbProductIntakeSessionStore(database: any = defaultDb): ProductIntakeSessionStore {
  const zeroDeleteResult = (): ProductIntakeSessionDeleteResult => ({ sessions: 0, questions: 0, answers: 0, diagnostics: 0 });

  const resolveDeleteSessionIds = async (organizationId: string, filters: ProductIntakeSessionDeleteFilters): Promise<string[]> => {
    const conditions = [eq(productIntakeSessions.organizationId, organizationId)];
    if (filters.sessionIds?.length) conditions.push(inArray(productIntakeSessions.id, filters.sessionIds));
    if (filters.status) conditions.push(eq(productIntakeSessions.status, filters.status));
    if (filters.briefSource) conditions.push(sql`${productIntakeSessions.aiBriefJson}->>'source' = ${filters.briefSource}` as any);
    const rows = await database
      .select({ id: productIntakeSessions.id })
      .from(productIntakeSessions)
      .where(and(...conditions))
      .limit(500);
    return rows.map((row: { id: string }) => row.id);
  };

  const getDetail = async (organizationId: string, sessionId: string): Promise<ProductIntakeSessionDetail | null> => {
    const [sessionRow] = await database
      .select()
      .from(productIntakeSessions)
      .where(and(eq(productIntakeSessions.id, sessionId), eq(productIntakeSessions.organizationId, organizationId)))
      .limit(1);
    if (!sessionRow) return null;

    const questionRows = await database
      .select()
      .from(productIntakeQuestions)
      .where(and(eq(productIntakeQuestions.sessionId, sessionId), eq(productIntakeQuestions.organizationId, organizationId)))
      .orderBy(productIntakeQuestions.sortOrder);
    const answerRows = await database
      .select()
      .from(productIntakeAnswers)
      .where(and(eq(productIntakeAnswers.sessionId, sessionId), eq(productIntakeAnswers.organizationId, organizationId)));

    const session = mapSession(sessionRow);
    const questions = questionRows.map(mapQuestion);
    const answers = answerRows.map(mapAnswer);
    const readiness = computeProductIntakeReadiness({ session, questions, answers });
    return { session, brief: session.brief, questions, answers, readiness };
  };

  return {
    async getSessionSource(organizationId, sessionId) {
      const [row] = await database
        .select({ sourceText: productIntakeSessions.sourceText, sourceJson: productIntakeSessions.sourceJson })
        .from(productIntakeSessions)
        .where(and(eq(productIntakeSessions.id, sessionId), eq(productIntakeSessions.organizationId, organizationId)))
        .limit(1);
      return row ? { sourceText: row.sourceText ?? null, sourceJson: row.sourceJson ?? null } : null;
    },
    async createFromAnalysis(input) {
      const generatedQuestions = generateProductIntakeQuestions(input.brief);
      const status = resolveProductIntakeSessionStatus(input.brief, generatedQuestions);
      const [sessionRow] = await database.insert(productIntakeSessions).values({
        organizationId: input.organizationId,
        sourceType: sourceTypeForRequest(input.request),
        sourceJson: parseSourceJson(input.request) as any,
        sourceText: sourceTextForRequest(input.request),
        sourceFingerprint: fingerprintProductIntakeRequest(input.request, input.analyzer),
        aiBriefJson: input.brief as any,
        confidenceJson: {
          originalConfidence: input.brief.overallConfidence,
          currentConfidence: input.brief.overallConfidence,
          overallConfidence: input.brief.overallConfidence,
          source: input.brief.source,
          workflowState: input.brief.workflowState,
        },
        missingDecisionsJson: input.brief.missingDecisions as any,
        status,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      }).returning();

      if (generatedQuestions.length > 0) {
        await database.insert(productIntakeQuestions).values(generatedQuestions.map((question) => ({
          organizationId: input.organizationId,
          sessionId: sessionRow.id,
          questionKey: question.questionKey,
          questionType: question.questionType,
          label: question.label,
          helpText: question.helpText,
          required: question.required,
          optionsJson: question.options as any,
          defaultValueJson: question.defaultValue as any,
          sourcePath: question.sourcePath,
          confidence: question.confidence == null ? null : String(question.confidence),
          sortOrder: question.sortOrder,
        })));
      }

      const detail = await getDetail(input.organizationId, sessionRow.id);
      if (!detail) throw new ProductIntakeSessionError(500, "Created session could not be reloaded.", "SESSION_RELOAD_FAILED");
      return detail;
    },

    async listSessions(organizationId, filters = {}) {
      const conditions = [eq(productIntakeSessions.organizationId, organizationId)];
      if (filters.status) conditions.push(eq(productIntakeSessions.status, filters.status));
      if (filters.sourceType) conditions.push(eq(productIntakeSessions.sourceType, filters.sourceType));
      if (filters.createdFrom) conditions.push(gte(productIntakeSessions.createdAt, new Date(filters.createdFrom)));
      if (filters.createdTo) conditions.push(lte(productIntakeSessions.createdAt, new Date(filters.createdTo)));
      if (filters.search?.trim()) {
        const pattern = `%${filters.search.trim()}%`;
        conditions.push(sql`${productIntakeSessions.aiBriefJson}->'productIdentity'->'likelyProductName'->>'value' ILIKE ${pattern}` as any);
      }

      const rows = await database
        .select()
        .from(productIntakeSessions)
        .where(and(...conditions))
        .orderBy(desc(productIntakeSessions.createdAt))
        .limit(50);
      return rows.map(mapSession);
    },

    getSessionDetail: getDetail,

    async upsertAnswers(args) {
      const detail = await getDetail(args.organizationId, args.sessionId);
      if (!detail) return null;
      if (detail.session.status === "abandoned") {
        throw new ProductIntakeSessionError(409, "Abandoned intake sessions cannot be answered.", "SESSION_ABANDONED");
      }

      const now = new Date();
      const resolvedAnswers = resolveProductIntakeAnswersForPersistence({ questions: detail.questions, answers: args.answers });
      const incomingByKey = new Map(resolvedAnswers.map(({ question, answer }) => [question.questionKey, answer]));
      const prospectiveAnswers = detail.answers.map((answer) => ({
        questionKey: answer.questionKey,
        answer: incomingByKey.has(answer.questionKey) ? incomingByKey.get(answer.questionKey) : answer.answer,
      }));
      for (const { question, answer } of resolvedAnswers) {
        if (!detail.answers.some((existing) => existing.questionKey === question.questionKey)) {
          prospectiveAnswers.push({ questionKey: question.questionKey, answer });
        }
      }
      // Calculate against the proposed answer set first. This makes a replay of
      // an already-applied answer a true no-op rather than a new revision.
      const canonicalBrief = applyProductIntakeAnswersToBrief(detail.brief, prospectiveAnswers);
      const briefChanged = JSON.stringify(canonicalBrief) !== JSON.stringify(detail.brief);
      const answerChanged = resolvedAnswers.some(({ question, answer }) => {
        const existing = detail.answers.find((candidate) => candidate.questionKey === question.questionKey);
        return JSON.stringify(existing?.answer) !== JSON.stringify(answer);
      });
      if (!briefChanged && !answerChanged) return detail;

      for (const { question, answer } of resolvedAnswers) {
        await database.insert(productIntakeAnswers).values({
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          questionId: question.id,
          questionKey: question.questionKey,
          answerJson: answer as any,
          answeredByUserId: args.userId,
          answeredAt: now,
        }).onConflictDoUpdate({
          target: [productIntakeAnswers.sessionId, productIntakeAnswers.questionKey],
          set: {
            questionId: question.id,
            answerJson: answer as any,
            answeredByUserId: args.userId,
            answeredAt: now,
            updatedAt: now,
          },
        });
      }

      const answeredDetail = await getDetail(args.organizationId, args.sessionId);
      if (!answeredDetail) return null;
      // The answer row is audit evidence, not the source of truth. Apply its
      // canonical question target to the current corrected brief before any
      // readiness or proposal fingerprint is calculated.
      if (briefChanged) {
        await database.update(productIntakeSessions)
          .set({ aiBriefJson: canonicalBrief as any, missingDecisionsJson: canonicalBrief.missingDecisions as any, updatedByUserId: args.userId, updatedAt: new Date() })
          .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)));
      }
      const resolvedDefaultQuestionKeys = [...canonicalBrief.requiredOptions, ...canonicalBrief.optionalOptions]
        .filter((optionGroup) => Boolean(optionGroup.defaultChoice) && (optionGroup.choices?.length ?? optionGroup.sampleValues.length) > 0)
        .map((optionGroup) => `custom-option-${normalizeKey(optionGroup.normalizedGroup || optionGroup.label)}-default-choice`);
      if (resolvedDefaultQuestionKeys.length > 0) {
        await database.delete(productIntakeQuestions)
          .where(and(
            eq(productIntakeQuestions.organizationId, args.organizationId),
            eq(productIntakeQuestions.sessionId, args.sessionId),
            inArray(productIntakeQuestions.questionKey, resolvedDefaultQuestionKeys),
          ));
      }
      const nextDetail = await getDetail(args.organizationId, args.sessionId);
      if (!nextDetail) return null;
      const nextStatus = nextDetail.readiness.status;
      const confidenceJson = {
        ...recalculateProductIntakeConfidence(nextDetail),
        correctedStateContract: buildCorrectedStateContract(canonicalBrief, null, answeredDetail.session.confidence?.correctedStateContract),
        revision: typeof answeredDetail.session.confidence?.revision === "number" ? answeredDetail.session.confidence.revision + 1 : 1,
      };
      const [updatedSession] = await database.update(productIntakeSessions)
        .set({ status: nextStatus, confidenceJson, updatedByUserId: args.userId, updatedAt: new Date() })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      return updatedSession ? await getDetail(args.organizationId, args.sessionId) : null;
    },

    async replaceBrief(args) {
      const detail = await getDetail(args.organizationId, args.sessionId);
      if (!detail) return null;
      if (detail.session.status === "abandoned" || detail.session.status === "draft_created") {
        throw new ProductIntakeSessionError(409, "Only an unfinished Product Intake session can be corrected.", "SESSION_NOT_CORRECTABLE");
      }

      const now = new Date();
      const nextQuestions = generateProductIntakeQuestions(args.brief);
      const priorAnswers = detail.answers.map((answer) => ({ questionKey: answer.questionKey, answer: answer.answer }));
      const correctedStateContract = buildCorrectedStateContract(args.brief, args.sourceText, detail.session.confidence?.correctedStateContract);
      await database.delete(productIntakeAnswers)
        .where(and(eq(productIntakeAnswers.organizationId, args.organizationId), eq(productIntakeAnswers.sessionId, args.sessionId)));
      await database.delete(productIntakeQuestions)
        .where(and(eq(productIntakeQuestions.organizationId, args.organizationId), eq(productIntakeQuestions.sessionId, args.sessionId)));

      const [updated] = await database.update(productIntakeSessions)
        .set({
          aiBriefJson: args.brief as any,
          sourceText: args.sourceText,
          sourceFingerprint: createHash("sha256").update(args.sourceText).digest("hex"),
          missingDecisionsJson: args.brief.missingDecisions as any,
          status: resolveProductIntakeSessionStatus(args.brief, nextQuestions),
          confidenceJson: { originalConfidence: detail.session.confidence?.overallConfidence ?? detail.brief.overallConfidence, currentConfidence: args.brief.overallConfidence, overallConfidence: args.brief.overallConfidence, correctedStateContract, revision: typeof detail.session.confidence?.revision === "number" ? detail.session.confidence.revision + 1 : 1 },
          updatedByUserId: args.userId,
          updatedAt: now,
        })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      if (!updated) return null;

      if (nextQuestions.length) {
        await database.insert(productIntakeQuestions).values(nextQuestions.map((question) => ({
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          questionKey: question.questionKey,
          questionType: question.questionType,
          label: question.label,
          helpText: question.helpText ?? null,
          required: question.required,
          optionsJson: question.options as any,
          defaultValueJson: question.defaultValue as any,
          sourcePath: question.sourcePath ?? null,
          confidence: String(question.confidence ?? 0),
          sortOrder: question.sortOrder,
        })));
      }

      const refreshed = await getDetail(args.organizationId, args.sessionId);
      if (!refreshed) return null;
      const retained = resolveProductIntakeAnswersForPersistence({ questions: refreshed.questions, answers: priorAnswers });
      for (const { question, answer } of retained) {
        await database.insert(productIntakeAnswers).values({
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          questionId: question.id,
          questionKey: question.questionKey,
          answerJson: answer as any,
          answeredByUserId: args.userId,
          answeredAt: now,
        });
      }
      const corrected = await getDetail(args.organizationId, args.sessionId);
      if (!corrected) return null;
      const [finalSession] = await database.update(productIntakeSessions)
        .set({ status: corrected.readiness.status, confidenceJson: { ...recalculateProductIntakeConfidence(corrected), correctedStateContract, revision: typeof detail.session.confidence?.revision === "number" ? detail.session.confidence.revision + 1 : 1 }, updatedByUserId: args.userId, updatedAt: new Date() })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      return finalSession ? await getDetail(args.organizationId, args.sessionId) : null;
    },

    async abandonSession(args) {
      const [updated] = await database.update(productIntakeSessions)
        .set({
          status: "abandoned",
          abandonedAt: new Date(),
          updatedAt: new Date(),
          updatedByUserId: args.userId,
        })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      if (!updated) return null;
      return getDetail(args.organizationId, args.sessionId);
    },

    async deleteSessions(args) {
      const sessionIds = await resolveDeleteSessionIds(args.organizationId, args.filters);
      if (sessionIds.length === 0) return zeroDeleteResult();

      const result = zeroDeleteResult();
      try {
        const diagnosticRows = await database.delete(productIntakeAiDiagnostics)
          .where(and(eq(productIntakeAiDiagnostics.organizationId, args.organizationId), inArray(productIntakeAiDiagnostics.sessionId, sessionIds)))
          .returning({ id: productIntakeAiDiagnostics.id });
        result.diagnostics = diagnosticRows.length;
      } catch (diagnosticError) {
        console.warn("[ProductIntakeWizard] Failed to delete AI diagnostics during intake cleanup:", diagnosticError);
      }

      const answerRows = await database.delete(productIntakeAnswers)
        .where(and(eq(productIntakeAnswers.organizationId, args.organizationId), inArray(productIntakeAnswers.sessionId, sessionIds)))
        .returning({ id: productIntakeAnswers.id });
      result.answers = answerRows.length;

      const questionRows = await database.delete(productIntakeQuestions)
        .where(and(eq(productIntakeQuestions.organizationId, args.organizationId), inArray(productIntakeQuestions.sessionId, sessionIds)))
        .returning({ id: productIntakeQuestions.id });
      result.questions = questionRows.length;

      const sessionRows = await database.delete(productIntakeSessions)
        .where(and(eq(productIntakeSessions.organizationId, args.organizationId), inArray(productIntakeSessions.id, sessionIds)))
        .returning({ id: productIntakeSessions.id });
      result.sessions = sessionRows.length;
      return result;
    },
  };
}
