import { randomUUID } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  auditLogs,
  pbv2OptionGroupTemplates,
  pbv2TreeVersions,
  pricingFormulas,
  productIntakeAnswers,
  productIntakeSessions,
  products,
  productTypes,
} from "@shared/schema";
import {
  productIntakeBriefSchema,
  productIntakeSessionSchema,
  type ProductIntakeBrief,
  type ProductIntakeDraftQuality,
  type ProductIntakeMatrixDraft,
  type ProductIntakeMatrixReadiness,
  type ProductIntakeOption,
  type ProductIntakeSession,
} from "@shared/productIntakeWizardSchemas";
import { validateOptionTreeV2, type OptionTreeV2, type PricingV2Tier } from "@shared/optionTreeV2";
import type { Pbv2FixedDimensions } from "@shared/pbv2/fixedDimensions";
import type { ProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";
import type { ProductOptionRule } from "@shared/productOptionRules";
import { cloneTemplateIntoTree } from "@shared/pbv2/optionGroupTemplates";
import { db as defaultDb } from "../../db";
import { ProductIntakeSessionError } from "./productIntakeSessionService";

export type ProductIntakeDraftTemplateRow = {
  id: string;
  templateTree: Record<string, any>;
};

export type ProductIntakeDraftCreationResult = {
  productId: string;
  pbv2TreeVersionId: string;
  draftQuality: ProductIntakeDraftQuality;
  session: ProductIntakeSession;
};

export type ProductIntakeDraftCreator = {
  createDraftFromSession(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
    userName?: string | null;
  }): Promise<ProductIntakeDraftCreationResult>;
};

type IntakePricingBase = {
  perSqftCents?: number;
  perPieceCents?: number;
  minimumChargeCents?: number;
};

type IntakePricingAnalysis = {
  base: IntakePricingBase;
  sources: string[];
  warnings: string[];
  likelyMatrixPricing: boolean;
  candidateDimensions: string[];
  matrixReadiness: ProductIntakeMatrixReadiness;
  matrixEvidence: string[];
};

type ProductIntakeAnswerLike = {
  questionKey: string;
  answer: unknown;
};

type ProductIntakeFormulaAssignment = {
  code: string;
  name: string;
  pricingProfileKey: string;
  expression: string;
  config: Record<string, unknown>;
  pricingFormulaId?: string | null;
};

const STICKER_ADJUSTED_ROUNDED_SQFT_FORMULA: ProductIntakeFormulaAssignment = {
  code: "STICKER_ADJUSTED_ROUNDED_SQFT",
  name: "Sticker adjusted rounded square feet",
  pricingProfileKey: "default",
  expression: "ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price",
  config: { formulaOutputMeaning: "final_price" },
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSession(row: typeof productIntakeSessions.$inferSelect): ProductIntakeSession {
  const brief = productIntakeBriefSchema.parse(row.aiBriefJson);
  return productIntakeSessionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    sourceFingerprint: row.sourceFingerprint,
    brief,
    confidence: row.confidenceJson ?? null,
    missingDecisions: Array.isArray(row.missingDecisionsJson) ? row.missingDecisionsJson : null,
    status: row.status,
    createdProductId: row.createdProductId,
    createdPbv2TreeVersionId: row.createdPbv2TreeVersionId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    abandonedAt: row.abandonedAt ? toIso(row.abandonedAt) : null,
  });
}

function compactText(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function collectBriefText(brief: ProductIntakeBrief, extraText?: string | null, sourceJson?: unknown): string {
  const values: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  };
  push(extraText);
  push(brief.pricingAnalysis.behavior);
  push(brief.pricingAnalysis.notes);
  push(brief.quantityBehavior.behavior);
  push(brief.quantityBehavior.notes);
  for (const evidence of [
    ...brief.sourceEvidence,
    ...brief.pricingAnalysis.evidence,
    ...brief.quantityBehavior.evidence,
    ...brief.draftWarnings.flatMap((warning) => warning.evidence),
  ]) {
    push(evidence.label);
    push(evidence.value);
    push(evidence.reason);
  }
  if (sourceJson != null) {
    try {
      push(JSON.stringify(sourceJson));
    } catch {
      // Ignore non-serializable debug payloads; source text/evidence still covers normal intake.
    }
  }
  return values.join("\n");
}

function dollarsToCents(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function positiveCentsFromAnswer(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value * 100);
  if (typeof value === "string" && value.trim()) return dollarsToCents(value.trim().replace(/^\$/, ""));
  return null;
}

function firstPriceMatch(text: string, patterns: RegExp[]): { cents: number; source: string } | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    const amount = match?.[1];
    if (!amount) continue;
    const cents = dollarsToCents(amount);
    if (cents == null) continue;
    return { cents, source: match[0].trim() };
  }
  return null;
}

function extractPricingFromText(text: string): Pick<IntakePricingAnalysis, "base" | "sources"> {
  const base: IntakePricingBase = {};
  const sources: string[] = [];
  const perSqft = firstPriceMatch(text, [
    /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf)\b/i,
    /(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf)\s*(?:price|rate)?\s*[:=]?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/i,
  ]);
  if (perSqft) {
    base.perSqftCents = perSqft.cents;
    sources.push(perSqft.source);
  }
  const perPiece = firstPriceMatch(text, [
    /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:each|piece|pc|item|unit)\b/i,
    /(?:each|piece|pc|item|unit)\s*(?:price|rate)?\s*[:=]?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/i,
  ]);
  if (perPiece) {
    base.perPieceCents = perPiece.cents;
    sources.push(perPiece.source);
  }
  const minimum = firstPriceMatch(text, [
    /(?:minimum|min(?:imum)?\s*(?:charge|order)?|setup\s*minimum)\s*[:=]?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/i,
    /\$(\d[\d,]*(?:\.\d{1,2})?)\s*(?:minimum|min(?:imum)?(?:\s*charge)?)\b/i,
  ]);
  if (minimum) {
    base.minimumChargeCents = minimum.cents;
    sources.push(minimum.source);
  }
  return { base, sources };
}

function mergeAnswerPricing(base: IntakePricingBase, answers: ProductIntakeAnswerLike[] = []): { base: IntakePricingBase; sources: string[] } {
  const next = { ...base };
  const sources: string[] = [];
  for (const answer of answers) {
    const cents = positiveCentsFromAnswer(answer.answer);
    if (cents == null) continue;
    if (answer.questionKey === "base-price-per-sqft") {
      next.perSqftCents = cents;
      sources.push("Product Intake answer: base price per square foot");
    }
    if (answer.questionKey === "base-price-per-piece") {
      next.perPieceCents = cents;
      sources.push("Product Intake answer: base price per piece");
    }
    if (answer.questionKey === "minimum-charge") {
      next.minimumChargeCents = cents;
      sources.push("Product Intake answer: minimum charge");
    }
  }
  return { base: next, sources };
}

function hasBasePricing(base: IntakePricingBase): boolean {
  return Number(base.perSqftCents) > 0 || Number(base.perPieceCents) > 0 || Number(base.minimumChargeCents) > 0;
}

const NO_MATRIX_READINESS: ProductIntakeMatrixReadiness = {
  required: false,
  matrixType: "NONE",
  matrixDimensions: [],
  matrixConfidence: 0,
  reasoning: [],
  recommendedSetup: "No pricing matrix setup is recommended from the current intake signals.",
  detectedSizes: [],
  detectedQuantityBreaks: [],
  detectedMaterials: [],
  detectedPricingSignals: [],
  noMatrixRowsGenerated: true,
};

function extractSizeSignals(brief: ProductIntakeBrief, text: string): string[] {
  const sourceSizes = Array.from(text.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?\s*(?:wide|w)?\s*(?:x|×|by)\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?\s*(?:high|h)?\b/gi))
    .map((match) => `${match[1]}x${match[2]}`);
  const optionSizes = [...brief.requiredOptions, ...brief.optionalOptions]
    .filter(isSizeOption)
    .flatMap((option) => option.sampleValues)
    .filter((value) => /\d/.test(value));
  return unique([...sourceSizes, ...optionSizes]).slice(0, 30);
}

function extractQuantityBreaks(brief: ProductIntakeBrief, text: string): number[] {
  const values = new Set<number>();
  const pushNumber = (value: unknown) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 100000) values.add(parsed);
  };

  for (const option of [...brief.requiredOptions, ...brief.optionalOptions]) {
    const optionText = `${option.label} ${option.normalizedGroup}`.toLowerCase();
    if (!/\b(qty|quantity|quantities|tier|tiers|break|breaks)\b/.test(optionText)) continue;
    option.sampleValues.forEach(pushNumber);
  }

  const quantityPhrases = text.match(/(?:qty|quantity|quantities|breaks?|tiers?|price\s*breaks?)\s*[:=-]?\s*((?:\d+[\s,;:/-]*(?:and\s*)?){2,})/gi) ?? [];
  for (const phrase of quantityPhrases) {
    const numbers = phrase.match(/\b\d+\b/g) ?? [];
    numbers.forEach(pushNumber);
  }
  for (const match of Array.from(text.matchAll(/\b(\d{1,6})\s*(?:-\s*\d{1,6}|\+)\b/g))) {
    pushNumber(match[1]);
  }

  return Array.from(values).sort((a, b) => a - b).slice(0, 30);
}

function parseFixedDimensionText(value: string): Pbv2FixedDimensions | null {
  const match = value.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?\s*(?:wide|w)?\s*(?:x|×|by)\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?\s*(?:high|h)?\b/i);
  if (!match) return null;
  const widthIn = Number(match[1]);
  const heightIn = Number(match[2]);
  if (!Number.isFinite(widthIn) || widthIn <= 0 || !Number.isFinite(heightIn) || heightIn <= 0) return null;
  return {
    widthIn,
    heightIn,
    unit: "in",
    label: `${widthIn}" x ${heightIn}"`,
    source: "product_intake",
    confidence: 95,
  };
}

function fixedDimensionsForBrief(
  brief: ProductIntakeBrief,
  sizeOption: ProductIntakeOption | null,
  text: string,
  sizeMode: SizeMode,
): Pbv2FixedDimensions | null {
  if (sizeMode !== "fixed_dropdown" || hasMultipleSelectableFixedSizeChoices(sizeOption)) return null;
  const sources = [
    ...(sizeOption?.sampleValues ?? []),
    ...extractSizeSignals(brief, text),
    text,
  ];
  for (const source of sources) {
    const parsed = parseFixedDimensionText(String(source ?? ""));
    if (parsed) return parsed;
  }
  return null;
}

function sizeMetadataForBrief(args: {
  brief: ProductIntakeBrief;
  sizeOption: ProductIntakeOption | null;
  sizeMode: SizeMode;
  fixedDimensions: Pbv2FixedDimensions | null;
}) {
  const sourceOptions = args.sizeOption
    ? [{
      label: args.sizeOption.label,
      normalizedGroup: args.sizeOption.normalizedGroup,
      required: args.sizeOption.required,
      confidence: args.sizeOption.confidence,
      sampleValues: args.sizeOption.sampleValues,
      sourcePaths: args.sizeOption.sourcePaths,
    }]
    : [];

  if (args.fixedDimensions) {
    return {
      behavior: "fixed_dimensions" as const,
      fixedDimensions: args.fixedDimensions,
      customerFacingOptionGenerated: false,
      sourceOptions,
      warning: "Fixed size is stored as product metadata and was not generated as a PBV2 Size option.",
    };
  }

  if (args.sizeMode === "custom_dimension") {
    return {
      behavior: "custom_dimensions" as const,
      customerFacingOptionGenerated: true,
      sourceOptions,
      warning: null,
    };
  }

  return {
    behavior: "none" as const,
    customerFacingOptionGenerated: false,
    sourceOptions,
    warning: null,
  };
}

function hasProductSignal(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isStickerFormulaProduct(brief: ProductIntakeBrief, text: string): boolean {
  const haystack = `${text}\n${brief.productIdentity.likelyProductName.value ?? ""}\n${brief.productIdentity.category.value ?? ""}\n${brief.productIdentity.productType.value ?? ""}\n${brief.pricingAnalysis.behavior}\n${brief.pricingAnalysis.notes ?? ""}`;
  const isSticker = /sticker|stickers|decal|decals|label|labels|vinyl/i.test(haystack);
  const customSize = /custom\s+(?:size|width|height)|width\s*\/\s*height|width\s+and\s+height|custom_size/i.test(haystack) ||
    /custom|dimension|width|height/i.test(`${brief.sizeBehavior.behavior} ${brief.sizeBehavior.notes ?? ""}`);
  const formulaDriven = /formula|rounded\s+sqft|round(?:ed)?\s+square\s+foot|ceil|adjusted\s+dimensions|add\s+0\.25|0\.25"?\s+to\s+width|0\.25"?\s+to\s+height|square\s+footage|sqft/i.test(haystack);
  return isSticker && customSize && formulaDriven;
}

function formulaAssignmentForBrief(brief: ProductIntakeBrief, text: string): ProductIntakeFormulaAssignment | null {
  if (!isStickerFormulaProduct(brief, text)) return null;
  return STICKER_ADJUSTED_ROUNDED_SQFT_FORMULA;
}

function optionTextForMatrix(brief: ProductIntakeBrief): string {
  return [...brief.requiredOptions, ...brief.optionalOptions]
    .map((option) => `${option.label} ${option.normalizedGroup} ${option.sampleValues.join(" ")}`)
    .join(" ")
    .toLowerCase();
}

function recommendationForMatrixType(matrixType: ProductIntakeMatrixReadiness["matrixType"]): string {
  if (matrixType === "SIZE_QUANTITY") return "Create a PBV2 pricing matrix with Size as the selectable dimension and line item quantity tiers or row-level quantity tiers before publish.";
  if (matrixType === "QUANTITY_STOCK") return "Create a PBV2 pricing matrix using Stock/Material choices with quantity-tier pricing before publish.";
  if (matrixType === "SIZE_MATERIAL") return "Create a PBV2 pricing matrix using Size and Material/Stock dimensions before publish.";
  if (matrixType === "QUANTITY_TIER") return "Configure PBV2 quantity tiers before publish; a full option matrix may not be needed unless another selectable dimension affects price.";
  if (matrixType === "MULTI_DIMENSION") return "Create a PBV2 pricing matrix with each detected selectable dimension and review quantity-tier behavior before publish.";
  return NO_MATRIX_READINESS.recommendedSetup;
}

function detectMatrixPricing(brief: ProductIntakeBrief, text: string): Pick<IntakePricingAnalysis, "likelyMatrixPricing" | "candidateDimensions" | "matrixEvidence" | "matrixReadiness"> {
  const lower = text.toLowerCase();
  const dimensions = new Set<string>();
  const reasoning: string[] = [];
  const pricingSignals: string[] = [];
  const addReason = (value: string) => {
    if (value && !reasoning.includes(value)) reasoning.push(value);
  };
  const addSignal = (value: string) => {
    if (value && !pricingSignals.includes(value)) pricingSignals.push(value);
  };
  const hasQuantity = /\b(qty|quantity|quantities|breaks?|tiers?|price\s*breaks?)\b/.test(lower) ||
    /quantity|tier|matrix/i.test(`${brief.quantityBehavior.behavior} ${brief.quantityBehavior.notes ?? ""}`);
  const hasMatrixLanguage = /\b(matrix|rate\s*table|price\s*grid|pricing\s*grid|price\s*table|multiple\s+price\s+tables?|breakpoint\s+pricing|size\s*x\s*quantity|quantity\s*x\s*size|stock\s*x|coating\s*x)\b/i.test(text) ||
    /matrix|tier/i.test(`${brief.pricingAnalysis.behavior} ${brief.pricingAnalysis.notes ?? ""}`);
  const optionText = optionTextForMatrix(brief);
  const detectedSizes = extractSizeSignals(brief, text);
  const detectedQuantityBreaks = extractQuantityBreaks(brief, text);
  const materialNames = unique([
    ...brief.materialAnalysis.detectedMaterialReferences,
    ...brief.materialAnalysis.likelyMaterialMatches.map((match) => match.name),
  ]).slice(0, 12);

  if (/\b(size|width|height|dimension)\b/.test(optionText) || /fixed|custom|size|dimension/i.test(brief.sizeBehavior.behavior) || detectedSizes.length > 0) {
    dimensions.add("size");
    if (detectedSizes.length > 1) addReason("Multiple fixed sizes were detected.");
  }
  if (hasQuantity) dimensions.add("quantity");
  if (detectedQuantityBreaks.length > 1) {
    dimensions.add("quantity");
    addReason("Quantity breaks were detected.");
    addSignal("Quantity tier pricing present.");
  }
  const stockMatrixSignal = /\b(stock|paper|substrate)\s*x|x\s*(stock|paper|substrate)|business\s*cards?|postcards?/i.test(text);
  const coatingMatrixSignal = /\b(coating|coat|laminate|lamination)\s*x|x\s*(coating|coat|laminate|lamination)|business\s*cards?/i.test(text);
  const materialMatrixSignal = /\b(material|substrate)\s*x|x\s*(material|substrate)|size\s*x\s*material|material\s*x\s*size/i.test(text);
  const printedSidesMatrixSignal = /\b(sides?|printed\s*sides?)\s*x|x\s*(sides?|printed\s*sides?)|sides?\s+price\s+table|printed\s+sides/i.test(text);
  if (stockMatrixSignal && /\b(stock|paper|substrate)\b/.test(optionText)) dimensions.add("stock");
  if (coatingMatrixSignal && /\b(coating|coat|laminate|lamination)\b/.test(optionText)) dimensions.add("coating");
  if (materialMatrixSignal && /\b(material|substrate)\b/.test(optionText)) dimensions.add("material");
  if (printedSidesMatrixSignal && /\b(side|sides|printed)\b/.test(optionText)) dimensions.add("printed_sides");
  if (/\b(size\s*x\s*quantity|quantity\s*x\s*size)\b/i.test(text)) {
    addReason("Source references size x quantity pricing.");
    addSignal("Size x quantity pricing signal.");
  }
  if (/\b(rate\s*table|price\s*grid|pricing\s*grid|price\s*table|matrix|multiple\s+price\s+tables?|breakpoint\s+pricing)\b/i.test(text)) {
    addReason("Source references a pricing matrix, price table, or breakpoint pricing.");
    addSignal("Matrix/table pricing language present.");
  }
  if (hasProductSignal(text, [/business\s*cards?/i, /postcards?/i]) && hasQuantity && /\b(stock|paper|coating|coat|size)\b/.test(optionText)) {
    addReason("Common print product pattern suggests quantity plus stock/coating/size matrix pricing.");
  }
  if (hasProductSignal(text, [/yard\s*signs?/i, /coroplast/i, /\bcoro\b/i]) && hasQuantity && dimensions.has("size")) {
    addReason("Yard sign/coroplast products commonly use size x quantity pricing.");
  }
  const formulaFriendlySticker = isStickerFormulaProduct(brief, text);
  if (!formulaFriendlySticker && hasProductSignal(text, [/stickers?|decals?/i]) && hasQuantity && dimensions.has("size")) {
    addReason("Sticker products commonly use size x quantity or quantity-tier pricing.");
  }

  const dimensionList = Array.from(dimensions);
  const formulaFriendlyBanner = /\bbanner\b/i.test(text) &&
    /square\s*foot|sqft|per\s+sq|formula|custom_size|custom size/i.test(`${text} ${brief.sizeBehavior.behavior} ${brief.pricingAnalysis.behavior}`) &&
    !hasMatrixLanguage &&
    detectedQuantityBreaks.length === 0;
  let matrixType: ProductIntakeMatrixReadiness["matrixType"] = "NONE";
  if (!formulaFriendlyBanner && !formulaFriendlySticker) {
    if (dimensionList.length >= 3) matrixType = "MULTI_DIMENSION";
    else if (dimensions.has("size") && dimensions.has("quantity") && dimensionList.filter((dimension) => !["size", "quantity"].includes(dimension)).length === 0) matrixType = "SIZE_QUANTITY";
    else if (dimensions.has("quantity") && (dimensions.has("stock") || dimensions.has("coating")) && dimensionList.length <= 3) matrixType = "QUANTITY_STOCK";
    else if (dimensions.has("size") && (dimensions.has("material") || dimensions.has("stock")) && !dimensions.has("quantity")) matrixType = "SIZE_MATERIAL";
    else if (dimensions.has("quantity") && detectedQuantityBreaks.length > 1 && dimensionList.length === 1) matrixType = "QUANTITY_TIER";
    else if (dimensionList.length >= 2) matrixType = "MULTI_DIMENSION";
  }

  const required = matrixType !== "NONE" && (hasMatrixLanguage || reasoning.length > 0 || detectedQuantityBreaks.length > 1);
  const confidence = required
    ? Math.min(95, 55 + (hasMatrixLanguage ? 15 : 0) + Math.min(20, reasoning.length * 7) + (detectedQuantityBreaks.length > 1 ? 10 : 0))
    : 0;
  const matrixReadiness: ProductIntakeMatrixReadiness = required
    ? {
        required: true,
        matrixType,
        matrixDimensions: dimensionList,
        matrixConfidence: confidence,
        reasoning: reasoning.length ? reasoning : ["Matrix-style pricing signals were detected from intake behavior and options."],
        recommendedSetup: recommendationForMatrixType(matrixType),
        detectedSizes,
        detectedQuantityBreaks,
        detectedMaterials: materialNames,
        detectedPricingSignals: pricingSignals,
        noMatrixRowsGenerated: true,
      }
    : {
        ...NO_MATRIX_READINESS,
        detectedSizes,
        detectedQuantityBreaks,
        detectedMaterials: materialNames,
        detectedPricingSignals: pricingSignals,
      };

  return {
    likelyMatrixPricing: matrixReadiness.required,
    candidateDimensions: matrixReadiness.matrixDimensions,
    matrixEvidence: matrixReadiness.reasoning,
    matrixReadiness,
  };
}

function analyzeDraftPricing(args: {
  brief: ProductIntakeBrief;
  sourceText?: string | null;
  sourceJson?: unknown;
  answers?: ProductIntakeAnswerLike[];
}): IntakePricingAnalysis {
  const text = collectBriefText(args.brief, args.sourceText, args.sourceJson);
  const detected = extractPricingFromText(text);
  const answered = mergeAnswerPricing(detected.base, args.answers);
  const matrix = detectMatrixPricing(args.brief, text);
  const warnings: string[] = [];
  if (!hasBasePricing(answered.base)) {
    warnings.push("Base pricing was not found in the intake source. PBV2 publish will remain blocked until per sqft, per piece, or minimum charge pricing is configured.");
  }
  if (matrix.likelyMatrixPricing) {
    warnings.push("Likely matrix pricing detected. Product Intake will generate matrix rows only when explicit dimensions, tiers, and prices meet the confidence threshold.");
  }
  return {
    base: answered.base,
    sources: [...detected.sources, ...answered.sources],
    warnings,
    ...matrix,
  };
}

function safeKey(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function uniqueKey(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

const TRUE_CONDITION = { op: "EXISTS", value: { op: "literal", value: true } };
const PRODUCT_INTAKE_TEMPLATE_REUSE_THRESHOLD = 0.85;

function optionChoices(option: ProductIntakeOption): Array<{ value: string; label: string; sortOrder: number }> {
  const seen = new Set<string>();
  return option.sampleValues
    .map((value) => compactText(value, ""))
    .filter(Boolean)
    .map((label) => {
      const value = safeKey(label, "choice");
      const uniqueValue = uniqueKey(value, seen);
      return { value: uniqueValue, label, sortOrder: seen.size - 1 };
    })
    .slice(0, 30);
}

type MatrixTierCandidate = {
  id: string;
  label: string;
  minQty: number;
  maxQty: number | null;
};

type MatrixChoiceCandidate = {
  value: string;
  label: string;
};

type MatrixDimensionCandidate = {
  selectionKey: string;
  label: string;
  choices: MatrixChoiceCandidate[];
};

type MatrixCombinationCandidate = {
  dimensions: MatrixDimensionCandidate[];
  choices: MatrixChoiceCandidate[];
  prices: Array<{ tier: MatrixTierCandidate; cents: number }>;
};

type GeneratedMatrixDraft = {
  matrix: ProductOptionPricingMatrix;
  draft: ProductIntakeMatrixDraft;
  readiness: ProductIntakeMatrixReadiness;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMatrixText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[–—]/g, "-");
}

function parseQuantityTierDefinitions(text: string, readiness: ProductIntakeMatrixReadiness): MatrixTierCandidate[] {
  const normalized = normalizeMatrixText(text);
  const tiers: MatrixTierCandidate[] = [];
  const seen = new Set<string>();
  const pushTier = (label: string, minQty: number, maxQty: number | null) => {
    if (!Number.isInteger(minQty) || minQty <= 0) return;
    if (maxQty != null && (!Number.isInteger(maxQty) || maxQty < minQty)) return;
    const id = safeKey(`qty_${label}`, `qty_${minQty}`);
    if (seen.has(id)) return;
    seen.add(id);
    tiers.push({ id, label, minQty, maxQty });
  };

  for (const match of Array.from(normalized.matchAll(/\b(\d{1,6})\s*-\s*(\d{1,6})\b/g))) {
    pushTier(`${match[1]}-${match[2]}`, Number(match[1]), Number(match[2]));
  }
  for (const match of Array.from(normalized.matchAll(/\b(\d{1,6})\s*\+/g))) {
    pushTier(`${match[1]}+`, Number(match[1]), null);
  }
  if (tiers.length > 0) return tiers.slice(0, 20);

  const quantityLine = normalized.split("\n")
    .map((line) => line.trim())
    .find((line) => /^(?:quantity|quantities|qty|quantity tiers?|tiers?|price breaks?)\b/i.test(line));
  const detectedBreaks = quantityLine
    ? Array.from(quantityLine.matchAll(/\b\d{1,6}\b/g)).map((match) => Number(match[0]))
    : readiness.detectedQuantityBreaks;
  for (const value of detectedBreaks) {
    pushTier(String(value), value, null);
  }
  return tiers.slice(0, 20);
}

function pricePatternForTier(tier: MatrixTierCandidate): RegExp {
  const labels = [tier.label, String(tier.minQty)];
  if (tier.maxQty != null) labels.push(`${tier.minQty}-${tier.maxQty}`);
  else labels.push(`${tier.minQty}+`);
  const alternatives = Array.from(new Set(labels.map(escapeRegExp))).join("|");
  return new RegExp(`(?:^|[^\\d])(?:${alternatives})(?:\\s+(?:signs?|pieces?|pcs?|items?|units?|each|ea))?\\s*(?:=|:)\\s*\\$?\\s*(\\d[\\d,]*(?:\\.\\d{1,4})?)\\b`, "i");
}

function extractChoicePriceBlock(text: string, choiceLabels: string[], targetLabel: string): string | null {
  const lines = normalizeMatrixText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const headerPatternFor = (label: string) => new RegExp(`^(?:[-*]\\s*)?${escapeRegExp(label)}\\s*:?(?:\\s*$|\\s+(?=\\d{1,6}\\b))`, "i");
  const stripTargetPattern = new RegExp(`^(?:[-*]\\s*)?${escapeRegExp(targetLabel)}\\s*:?\\s*`, "i");
  const targetPattern = headerPatternFor(targetLabel);
  const nextChoicePatterns = choiceLabels
    .filter((label) => label.toLowerCase() !== targetLabel.toLowerCase())
    .map(headerPatternFor);
  const startIndexes = lines
    .map((line, index) => targetPattern.test(line) ? index : -1)
    .filter((index) => index >= 0);
  for (const startIndex of startIndexes) {
    const block: string[] = [lines[startIndex].replace(stripTargetPattern, "").trim()];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (nextChoicePatterns.some((pattern) => pattern.test(line))) break;
      if (/^(?:pricing|prices|pricing matrix|matrix dimensions?|quantity tiers?|tiers?|stock|size|printed sides?)\s*:?\s*$/i.test(line)) continue;
      block.push(line);
    }
    const joined = block.join(" ").trim();
    if (/\b\d{1,6}\s*(?:-\s*\d{1,6}|\+)?\b.*(?:=|:)\s*\$?\s*\d/.test(joined)) return joined;
  }
  return null;
}

function centsFromTierBlock(block: string, tier: MatrixTierCandidate): number | null {
  const match = pricePatternForTier(tier).exec(block);
  if (!match?.[1]) return null;
  return dollarsToCents(match[1]);
}

function centsFromPipeTable(text: string, choiceLabel: string, tier: MatrixTierCandidate): number | null {
  const rows = normalizeMatrixText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean));
  const headerIndex = rows.findIndex((cells) =>
    cells.some((cell) => /printed\s+sides?|sides?|option|dimension/i.test(cell)) &&
    cells.some((cell) => cell.toLowerCase() === tier.label.toLowerCase()),
  );
  if (headerIndex < 0) return null;
  const header = rows[headerIndex];
  const tierIndex = header.findIndex((cell) => cell.toLowerCase() === tier.label.toLowerCase());
  if (tierIndex < 0) return null;
  const row = rows.slice(headerIndex + 1).find((cells) => cells[0]?.toLowerCase() === choiceLabel.toLowerCase());
  if (!row?.[tierIndex]) return null;
  return dollarsToCents(row[tierIndex].replace(/^\$/, ""));
}

function choiceAliasPattern(label: string): RegExp {
  const escaped = escapeRegExp(label).replace(/\\ /g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i");
}

function headerContainsChoice(header: string, choice: MatrixChoiceCandidate): boolean {
  return choiceAliasPattern(choice.label).test(header) || choiceAliasPattern(choice.value.replace(/_/g, " ")).test(header);
}

function cartesianChoiceCombinations(dimensions: MatrixDimensionCandidate[]): MatrixChoiceCandidate[][] {
  return dimensions.reduce<MatrixChoiceCandidate[][]>((acc, dimension) => {
    const next: MatrixChoiceCandidate[][] = [];
    for (const prefix of acc) {
      for (const choice of dimension.choices) {
        next.push([...prefix, choice]);
      }
    }
    return next;
  }, [[]]);
}

function dimensionSubsets(dimensions: MatrixDimensionCandidate[], maxSize = 3): MatrixDimensionCandidate[][] {
  const out: MatrixDimensionCandidate[][] = [];
  const visit = (start: number, current: MatrixDimensionCandidate[]) => {
    if (current.length > 0) out.push([...current]);
    if (current.length >= maxSize) return;
    for (let index = start; index < dimensions.length; index += 1) {
      current.push(dimensions[index]);
      visit(index + 1, current);
      current.pop();
    }
  };
  visit(0, []);
  return out;
}

function extractCombinationPriceBlock(
  text: string,
  selectedChoices: MatrixChoiceCandidate[],
  excludedChoices: MatrixChoiceCandidate[],
): string | null {
  const lines = normalizeMatrixText(text).split("\n").map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !/:$/.test(line)) continue;
    const header = line.replace(/:\s*$/, "");
    if (!selectedChoices.every((choice) => headerContainsChoice(header, choice))) continue;
    if (excludedChoices.some((choice) => headerContainsChoice(header, choice))) continue;

    const block: string[] = [];
    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const blockLine = lines[blockIndex];
      if (!blockLine) {
        if (block.length > 0) break;
        continue;
      }
      if (/:$/.test(blockLine) && !/\b\d{1,6}\s*(?:-\s*\d{1,6}|\+)?\b.*(?:=|:)\s*\$?\s*\d/.test(blockLine)) break;
      block.push(blockLine);
    }
    const joined = block.join(" ").trim();
    if (/\b\d{1,6}\s*(?:-\s*\d{1,6}|\+)?\b.*(?:=|:)\s*\$?\s*\d/.test(joined)) return joined;
  }
  return null;
}

function matrixDimensionCandidatesFromTree(tree: OptionTreeV2): MatrixDimensionCandidate[] {
  return Object.values(tree.nodes)
    .filter((node: any) => String(node?.type ?? "").toUpperCase() === "INPUT" && node?.input?.type === "select")
    .map((node: any) => {
      const selectionKey = String(node.input?.selectionKey ?? node.key ?? "").trim();
      const choices = Array.isArray(node.choices)
        ? node.choices
            .map((choice: any) => ({ value: String(choice?.value ?? ""), label: String(choice?.label ?? "") }))
            .filter((choice: MatrixChoiceCandidate) => choice.value && choice.label)
        : [];
      return {
        selectionKey,
        label: String(node.label ?? selectionKey),
        choices,
      };
    })
    .filter((candidate) =>
      candidate.selectionKey &&
      candidate.selectionKey !== "quantity" &&
      candidate.choices.length >= 2,
    );
}

function appendMatrixAnswerSourceText(args: {
  sourceText: string;
  tree: OptionTreeV2;
  answers?: ProductIntakeAnswerLike[];
  readiness: ProductIntakeMatrixReadiness;
}): string {
  const answers = args.answers ?? [];
  if (answers.length === 0) return args.sourceText;
  const answerByKey = new Map(answers.map((answer) => [answer.questionKey, answer.answer]));
  const answeredTiers = answerByKey.get("confirm-matrix-quantity-tiers");
  const tierText = typeof answeredTiers === "string" && answeredTiers.trim()
    ? `\nQuantity Tiers: ${answeredTiers.trim()}`
    : "";
  const baseText = `${args.sourceText}${tierText}`;
  const tiers = parseQuantityTierDefinitions(baseText, args.readiness);
  if (tiers.length === 0) return baseText;

  const selectedDimension = typeof answerByKey.get("confirm-matrix-dimension") === "string"
    ? String(answerByKey.get("confirm-matrix-dimension"))
    : null;
  const dimensions = matrixDimensionCandidatesFromTree(args.tree)
    .filter((dimension) => !selectedDimension || dimension.selectionKey === selectedDimension);
  const lines: string[] = [];
  for (const dimension of dimensions) {
    for (const choice of dimension.choices) {
      const priceParts: string[] = [];
      for (const tier of tiers) {
        const answerKey = `matrix-price-${safeKey(dimension.selectionKey, "dimension")}-${safeKey(choice.value, "choice")}-${safeKey(tier.label, "tier")}`;
        const cents = positiveCentsFromAnswer(answerByKey.get(answerKey));
        if (cents == null) continue;
        priceParts.push(`${tier.label} = $${(cents / 100).toFixed(2)}`);
      }
      if (priceParts.length > 0) lines.push(`${choice.label}: ${priceParts.join(", ")}`);
    }
  }
  return lines.length > 0 ? `${baseText}\n${lines.join("\n")}` : baseText;
}

function buildGeneratedMatrixDraft(args: {
  tree: OptionTreeV2;
  sessionId: string;
  sourceText: string;
  pricingReadiness: IntakePricingAnalysis;
}): GeneratedMatrixDraft | null {
  const tiers = parseQuantityTierDefinitions(args.sourceText, args.pricingReadiness.matrixReadiness);
  if (tiers.length < 2) return null;

  const priceField = /\b(?:per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf)\b/i.test(args.sourceText)
    ? "perSqftCents"
    : "perPieceCents";
  const dimensionCandidates = matrixDimensionCandidatesFromTree(args.tree);
  const parsedCandidates = dimensionSubsets(dimensionCandidates).map((dimensions) => {
    const selectedKeys = new Set(dimensions.map((dimension) => dimension.selectionKey));
    const excludedChoices = dimensionCandidates
      .filter((dimension) => !selectedKeys.has(dimension.selectionKey))
      .flatMap((dimension) => dimension.choices);
    const singleDimension = dimensions.length === 1 ? dimensions[0] : null;
    const singleChoiceLabels = singleDimension?.choices.map((choice) => choice.label) ?? [];
    const rows = cartesianChoiceCombinations(dimensions).map((choices): MatrixCombinationCandidate | null => {
      const block = dimensions.length === 1
        ? (extractChoicePriceBlock(args.sourceText, singleChoiceLabels, choices[0].label) ?? extractCombinationPriceBlock(args.sourceText, choices, excludedChoices) ?? "")
        : (extractCombinationPriceBlock(args.sourceText, choices, excludedChoices) ?? "");
      const prices = tiers.map((tier) => ({
        tier,
        cents: centsFromTierBlock(block, tier) ?? (singleDimension ? centsFromPipeTable(args.sourceText, choices[0].label, tier) : null),
      }));
      if (prices.some((price) => price.cents == null)) return null;
      return {
        dimensions,
        choices,
        prices: prices as Array<{ tier: MatrixTierCandidate; cents: number }>,
      };
    }).filter(Boolean) as MatrixCombinationCandidate[];
    return { dimensions, rows };
  }).filter((candidate) => candidate.rows.length >= 2);

  const selected = parsedCandidates.sort((a, b) => {
    const scoreA = a.rows.length * tiers.length * a.dimensions.length;
    const scoreB = b.rows.length * tiers.length * b.dimensions.length;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.dimensions.length - a.dimensions.length;
  })[0];
  if (!selected) return null;

  const confidence = Math.max(85, Math.min(98, Math.max(args.pricingReadiness.matrixReadiness.matrixConfidence, 88 + Math.min(10, selected.rows.length + tiers.length))));
  if (confidence < 85) return null;

  const matrixRows = selected.rows.map((row) => {
    const rowKey = row.dimensions.map((dimension, index) => `${dimension.selectionKey}_${row.choices[index].value}`).join("_");
    const rowId = safeKey(`intake_matrix_${rowKey}`, "intake_matrix_row");
    const when = Object.fromEntries(row.dimensions.map((dimension, index) => [dimension.selectionKey, row.choices[index].value]));
    const qtyTiers: PricingV2Tier[] = row.prices.map(({ tier, cents }) => ({
      id: safeKey(`${rowId}_${tier.id}`, "tier"),
      label: tier.label,
      minQty: tier.minQty,
      [priceField]: cents,
    }));
    return {
      id: rowId,
      when,
      qtyTiers,
      tierBasis: "line_item_quantity" as const,
    };
  });

  const previewRows = selected.rows.map((row) => ({
    id: safeKey(`preview_${row.dimensions.map((dimension, index) => `${dimension.selectionKey}_${row.choices[index].value}`).join("_")}`, "preview_row"),
    label: row.choices.map((choice) => choice.label).join(" + "),
    when: Object.fromEntries(row.dimensions.map((dimension, index) => [dimension.selectionKey, row.choices[index].value])),
    prices: row.prices.map(({ tier, cents }) => ({
      tierId: tier.id,
      label: tier.label,
      minQty: tier.minQty,
      [priceField]: cents,
    })),
  }));

  const sourceSignals = unique([
    ...args.pricingReadiness.matrixReadiness.reasoning,
    ...args.pricingReadiness.matrixReadiness.detectedPricingSignals,
    `${selected.dimensions.map((dimension) => dimension.label).join(" + ")} rows matched explicit price values for ${tiers.length} quantity tiers.`,
  ]);
  const selectedDimensionKeys = selected.dimensions.map((dimension) => dimension.selectionKey);
  const readiness: ProductIntakeMatrixReadiness = {
    ...args.pricingReadiness.matrixReadiness,
    required: true,
    matrixType: args.pricingReadiness.matrixReadiness.matrixType === "NONE" ? "QUANTITY_TIER" : args.pricingReadiness.matrixReadiness.matrixType,
    matrixDimensions: unique([
      ...selectedDimensionKeys,
      ...args.pricingReadiness.matrixReadiness.matrixDimensions.filter((dimension) => !selectedDimensionKeys.includes(dimension)),
      "quantity",
    ]),
    matrixConfidence: confidence,
    reasoning: sourceSignals,
    recommendedSetup: "AI generated a PBV2 pricing matrix draft from explicit source tiers and prices. Review all rows in the PBV2 builder before publish.",
    detectedQuantityBreaks: unique([...args.pricingReadiness.matrixReadiness.detectedQuantityBreaks.map(String), ...tiers.map((tier) => String(tier.minQty))]).map(Number),
    detectedPricingSignals: sourceSignals,
    noMatrixRowsGenerated: false,
  };

  return {
    matrix: {
      id: safeKey(`intake_matrix_${args.sessionId}`, "intake_matrix"),
      dimensions: selectedDimensionKeys,
      rows: matrixRows,
    },
    draft: {
      generatedByAI: true,
      reviewRequired: true,
      matrixConfidence: confidence,
      generationReasoning: [
        "Explicit matrix dimension labels matched PBV2 option choices.",
        "Every generated row included every detected quantity tier price.",
      ],
      sourceSignals,
      dimensions: selectedDimensionKeys,
      tiers,
      rows: previewRows,
      warnings: [
        "AI generated this pricing matrix as an inactive draft artifact only.",
        "Publish and product activation remain separate review steps.",
      ],
    },
    readiness,
  };
}

type DraftGroupKey =
  | "size_quantity"
  | "print_setup"
  | "finishing"
  | "lamination"
  | "cutting"
  | "application_prep"
  | "hardware"
  | "materials"
  | "review";
type SizeMode = "fixed_dropdown" | "custom_dimension" | "none";

const DRAFT_GROUPS: Record<DraftGroupKey, { id: string; label: string; sortOrder: number }> = {
  size_quantity: { id: "group_size_quantity", label: "Size & Quantity", sortOrder: 10 },
  print_setup: { id: "group_print_setup", label: "Print Setup", sortOrder: 20 },
  finishing: { id: "group_finishing", label: "Finishing", sortOrder: 30 },
  lamination: { id: "group_lamination", label: "Lamination", sortOrder: 31 },
  cutting: { id: "group_cutting", label: "Cutting", sortOrder: 32 },
  application_prep: { id: "group_application_prep", label: "Application Prep", sortOrder: 33 },
  hardware: { id: "group_hardware", label: "Hardware", sortOrder: 40 },
  materials: { id: "group_materials", label: "Materials", sortOrder: 50 },
  review: { id: "group_review", label: "Review", sortOrder: 90 },
};

function ensureGroup(tree: OptionTreeV2, groupKey: DraftGroupKey, usedNodeIds: Set<string>): string {
  const group = DRAFT_GROUPS[groupKey];
  if (!tree.nodes[group.id]) {
    usedNodeIds.add(group.id);
    tree.nodes[group.id] = {
      id: group.id,
      kind: "group",
      type: "GROUP",
      status: "ENABLED",
      key: group.id,
      label: group.label,
      ui: { sortOrder: group.sortOrder, layoutHint: "stack" },
    };
  }
  return group.id;
}

function addQuestionNode(args: {
  tree: OptionTreeV2;
  key: string;
  label: string;
  inputType: "boolean" | "select" | "number" | "dimension";
  required: boolean;
  choices?: Array<{ value: string; label: string; sortOrder?: number; pricingImpact?: any[] }>;
  usedNodeIds: Set<string>;
  usedEdgeIds: Set<string>;
  groupKey: DraftGroupKey;
  sortOrder: number;
}) {
  const nodeId = uniqueKey(`intake_${safeKey(args.key, "option")}`, args.usedNodeIds);
  const groupId = ensureGroup(args.tree, args.groupKey, args.usedNodeIds);
  args.tree.nodes[nodeId] = {
    id: nodeId,
    kind: "question",
    type: "INPUT",
    status: "ENABLED",
    key: args.key,
    label: args.label,
    ui: { groupKey: groupId, sortOrder: args.sortOrder },
    input: {
      type: args.inputType,
      required: args.required,
      selectionKey: args.key,
      valueType: args.inputType === "boolean" ? "BOOLEAN" : args.inputType === "number" || args.inputType === "dimension" ? "NUMBER" : "ENUM",
      ...(args.inputType === "select" ? { constraints: { select: { allowEmpty: !args.required } } } : {}),
      ...(args.inputType === "number" ? { constraints: { number: { min: 1, step: 1, integerOnly: true } } } : {}),
    },
    ...(args.choices && args.choices.length > 0 ? { choices: args.choices } : {}),
  };
  if (!args.tree.rootNodeIds.includes(nodeId)) {
    args.tree.rootNodeIds.push(nodeId);
  }
  args.tree.edges = args.tree.edges ?? [];
  args.tree.edges.push({
    id: uniqueKey(`edge_${groupId}_${nodeId}`, args.usedEdgeIds),
    fromNodeId: groupId,
    toNodeId: nodeId,
    status: "DISABLED",
    priority: args.sortOrder,
    condition: TRUE_CONDITION,
  });
}

function selectionKeyForInputNode(node: any): string | null {
  const key = String(node?.input?.selectionKey ?? node?.key ?? "").trim();
  return key.length > 0 ? key : null;
}

function inputNodeBySelectionKey(tree: OptionTreeV2, selectionKey: string): any | null {
  return Object.values(tree.nodes).find((node: any) => {
    const nodeSelectionKey = selectionKeyForInputNode(node);
    return nodeSelectionKey === selectionKey || nodeSelectionKey?.startsWith(`${selectionKey}__`);
  }) ?? null;
}

function inputNodeByConcept(args: {
  tree: OptionTreeV2;
  selectionKeys: string[];
  labelPatterns: RegExp[];
}): any | null {
  for (const selectionKey of args.selectionKeys) {
    const node = inputNodeBySelectionKey(args.tree, selectionKey);
    if (node) return node;
  }
  return Object.values(args.tree.nodes).find((node: any) => {
    if (String(node?.type ?? "").toUpperCase() !== "INPUT") return false;
    const text = `${node?.label ?? ""} ${node?.key ?? ""} ${node?.input?.selectionKey ?? ""}`;
    return args.labelPatterns.some((pattern) => pattern.test(text));
  }) ?? null;
}

function yesChoiceValue(node: any): string | null {
  const choices = Array.isArray(node?.choices) ? node.choices : [];
  const choice = choices.find((entry: any) => /^yes$/i.test(String(entry?.label ?? entry?.value ?? "").trim()));
  return choice?.value ? String(choice.value) : null;
}

function percentImpactFromText(text: string, optionPatterns: RegExp | RegExp[]): number | null {
  const patterns = Array.isArray(optionPatterns) ? optionPatterns : [optionPatterns];
  for (const optionPattern of patterns) {
    optionPattern.lastIndex = 0;
    const match = optionPattern.exec(text);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function assignChoicePercentImpact(args: {
  tree: OptionTreeV2;
  selectionKey: string;
  percent: number | null;
  label: string;
}) {
  if (args.percent == null) return;
  const node = inputNodeBySelectionKey(args.tree, args.selectionKey);
  if (!node || !Array.isArray(node.choices)) return;
  const choiceIndex = node.choices.findIndex((choice: any) => /^yes$/i.test(String(choice?.label ?? choice?.value ?? "").trim()));
  if (choiceIndex < 0) return;
  const choice = node.choices[choiceIndex];
  const existing = Array.isArray(choice.pricingImpact) ? choice.pricingImpact : [];
  if (existing.some((impact: any) => impact?.mode === "addPercent" && Number(impact?.percent) === args.percent && (impact?.basis ?? "base") === "base")) return;
  node.choices[choiceIndex] = {
    ...choice,
    pricingImpact: [
      ...existing,
      { mode: "addPercent", percent: args.percent, basis: "base", label: args.label },
    ],
  };
}

function applyFormulaProductBehaviors(tree: OptionTreeV2, sourceText: string, formulaAssignment: ProductIntakeFormulaAssignment | null) {
  if (!formulaAssignment) return;
  const contourNode = inputNodeByConcept({
    tree,
    selectionKeys: ["contour_cutting", "cut_type"],
    labelPatterns: [/\bcontour\s+cutting\b/i, /\bkiss\s+cut(?:ting)?\b/i],
  });
  const weedNode = inputNodeByConcept({
    tree,
    selectionKeys: ["weed_and_tape", "application_prep"],
    labelPatterns: [/\bweed\s+(?:and|&)\s+tape\b/i, /\bweeding\s+(?:and|&)\s+(?:transfer\s+)?tape\b/i],
  });
  const contourSelectionKey = selectionKeyForInputNode(contourNode);
  const weedSelectionKey = selectionKeyForInputNode(weedNode);
  const contourYes = yesChoiceValue(contourNode);
  const impactVerbPattern = String.raw`(?:\+\s*|add(?:s|ed)?\s+|increase(?:s|d)?(?:\s+by)?\s+)`;
  const contourPercent = percentImpactFromText(sourceText, [
    new RegExp(String.raw`\bcontour\s+cutting\b[\s\S]{0,260}?${impactVerbPattern}(\d+(?:\.\d+)?)\s*%`, "i"),
    new RegExp(String.raw`\bkiss\s+cut(?:ting)?\b[\s\S]{0,260}?${impactVerbPattern}(\d+(?:\.\d+)?)\s*%`, "i"),
  ]);
  const weedPercent = percentImpactFromText(sourceText, [
    new RegExp(String.raw`\bweed\s+(?:and|&)\s+tape\b[\s\S]{0,260}?${impactVerbPattern}(\d+(?:\.\d+)?)\s*%`, "i"),
    new RegExp(String.raw`\bweeding\s+(?:and|&)\s+(?:transfer\s+)?tape\b[\s\S]{0,260}?${impactVerbPattern}(\d+(?:\.\d+)?)\s*%`, "i"),
  ]);

  const impacts = [
    ...(contourSelectionKey ? [{ selectionKey: contourSelectionKey, percent: contourPercent, label: "Contour Cutting surcharge" }] : []),
    ...(weedSelectionKey ? [{ selectionKey: weedSelectionKey, percent: weedPercent, label: "Weed and Tape surcharge" }] : []),
  ];
  for (const impact of impacts) {
    assignChoicePercentImpact({ tree, ...impact });
  }

  if (contourSelectionKey && weedSelectionKey && contourYes) {
    const rule: ProductOptionRule = {
      id: "rule_contour_cutting_weed_and_tape",
      label: "Contour Cutting controls Weed and Tape",
      enabled: true,
      when: {
        all: [{ optionGroup: contourSelectionKey, operator: "equals", value: contourYes }],
      },
      then: [{ action: "show", targetOptionGroup: weedSelectionKey }],
      else: [
        { action: "hide", targetOptionGroup: weedSelectionKey },
        { action: "clear", targetOptionGroup: weedSelectionKey },
      ],
    };
    const existingRules = Array.isArray((tree as any).rules) ? (tree as any).rules : [];
    if (!existingRules.some((existing: any) => existing?.id === rule.id)) {
      (tree as any).rules = [...existingRules, rule];
    }
  }

  tree.meta = {
    ...(tree.meta ?? {}),
    pricingProfileKey: formulaAssignment.pricingProfileKey,
    pricingFormula: formulaAssignment.expression,
    formulaOutputMeaning: "final_price",
    outputMeaning: "final_price",
    formulaVariables: {},
    pricingFormulaVariables: {},
    productIntake: {
      ...(tree.meta?.productIntake ?? { sessionId: "", productName: "", confidence: 0 }),
      productClassification: {
        type: "FORMULA_PRODUCT",
        confidence: 92,
        reasons: [
          "Sticker/decal product uses custom width and height.",
          "Source includes adjusted rounded square-foot formula instructions.",
          "No explicit matrix rows were required for pricing.",
        ],
      },
      formulaAssignment: {
        code: formulaAssignment.code,
        name: formulaAssignment.name,
        pricingProfileKey: formulaAssignment.pricingProfileKey,
        expression: formulaAssignment.expression,
        confidence: 92,
        source: "product_intake",
        pricingFormulaId: formulaAssignment.pricingFormulaId ?? null,
      },
      generatedBehaviors: {
        optionRules: contourSelectionKey && weedSelectionKey && contourYes ? ["rule_contour_cutting_weed_and_tape"] : [],
        pricingImpacts: [
          ...(contourPercent != null && contourSelectionKey ? [{ selectionKey: contourSelectionKey, choice: "yes", mode: "addPercent", percent: contourPercent, basis: "base" }] : []),
          ...(weedPercent != null && weedSelectionKey ? [{ selectionKey: weedSelectionKey, choice: "yes", mode: "addPercent", percent: weedPercent, basis: "base" }] : []),
        ],
      },
    },
  };
}

function isSizeOption(option: ProductIntakeOption): boolean {
  const text = `${option.label} ${option.normalizedGroup}`.toLowerCase();
  return /\b(size|sizes|dimension|dimensions|width|height)\b/.test(text);
}

function hasFixedSizeChoices(option: ProductIntakeOption | null): boolean {
  if (!option) return false;
  const choices = option.sampleValues.map((value) => value.trim()).filter(Boolean);
  if (choices.length < 2) return false;
  return choices.some((value) => /\d+(\.\d+)?\s*(x|×|by)\s*\d+(\.\d+)?/i.test(value)) || choices.length >= 2;
}

function hasMultipleSelectableFixedSizeChoices(option: ProductIntakeOption | null): boolean {
  return Boolean(option && option.sampleValues.map((value) => value.trim()).filter(Boolean).length > 1);
}

function resolveSizeMode(brief: ProductIntakeBrief, sizeOption: ProductIntakeOption | null): SizeMode {
  const text = `${brief.sizeBehavior.behavior} ${brief.sizeBehavior.notes ?? ""}`.toLowerCase();
  const custom = /custom|dimension|width|height|area|sqft|square|linear/.test(text);
  const fixed = /fixed|standard|preset|predefined|dropdown|list|sizes/.test(text) || hasFixedSizeChoices(sizeOption);
  if (fixed && !custom) return "fixed_dropdown";
  if (custom) return "custom_dimension";
  if (fixed) return "fixed_dropdown";
  return "none";
}

function shouldCollectQuantity(brief: ProductIntakeBrief): boolean {
  const text = `${brief.quantityBehavior.behavior} ${brief.quantityBehavior.notes ?? ""}`.toLowerCase();
  return !/unknown|none|not applicable|fixed/.test(text);
}

function quantityMetadataForBrief(brief: ProductIntakeBrief) {
  const behavior = compactText(brief.quantityBehavior.behavior, "unknown");
  const notes = compactText(brief.quantityBehavior.notes, "");
  const sourceOptions = [...brief.requiredOptions, ...brief.optionalOptions]
    .filter((option) => {
      const text = `${option.label} ${option.normalizedGroup}`.toLowerCase();
      return /\b(qty|quantity|quantities|tier|tiers|piece|pieces)\b/.test(text);
    })
    .map((option) => ({
      label: option.label,
      normalizedGroup: option.normalizedGroup,
      required: option.required,
      confidence: option.confidence,
      sampleValues: option.sampleValues,
      sourcePaths: option.sourcePaths,
    }));

  return {
    behavior,
    confidence: brief.quantityBehavior.confidence,
    notes: notes || null,
    lineItemQuantitySource: true,
    customerFacingOptionGenerated: false,
    sourceOptions,
    warning: shouldCollectQuantity(brief)
      ? "Quantity is captured on quote/order line items. Intake quantity behavior is preserved as pricing metadata and must not create a PBV2 customer-facing option."
      : null,
  };
}

function pricingModeForBrief(brief: ProductIntakeBrief): "area" | "quantity" | "flat" {
  const text = `${brief.pricingAnalysis.behavior} ${brief.pricingAnalysis.notes ?? ""}`.toLowerCase();
  if (/flat|fixed/.test(text)) return "flat";
  if (/qty|quantity|tier|piece|each/.test(text)) return "quantity";
  return "area";
}

function isReusableTemplateMatch(match: ProductIntakeBrief["templateMatches"][number]): boolean {
  return match.recommendation === "suggest_reuse" && match.score >= PRODUCT_INTAKE_TEMPLATE_REUSE_THRESHOLD;
}

function collectTemplateIds(brief: ProductIntakeBrief): string[] {
  const ids = new Set<string>();
  const collect = (matches: ProductIntakeBrief["templateMatches"]) => {
    for (const match of matches) {
      if (isReusableTemplateMatch(match)) ids.add(match.templateId);
    }
  };
  collect(brief.templateMatches);
  for (const option of [...brief.requiredOptions, ...brief.optionalOptions]) collect(option.templateMatches);
  return Array.from(ids).slice(0, 20);
}

function applyTemplateMatches(tree: OptionTreeV2, templates: ProductIntakeDraftTemplateRow[]): { tree: OptionTreeV2; reusedTemplateIds: Set<string> } {
  let current: OptionTreeV2 = tree;
  const reusedTemplateIds = new Set<string>();
  for (const template of templates) {
    const cloned = cloneTemplateIntoTree(current, template.templateTree, { sourceTemplateId: template.id });
    if (!cloned.ok) continue;
    current = cloned.tree as OptionTreeV2;
    reusedTemplateIds.add(template.id);
  }
  return { tree: current, reusedTemplateIds };
}

function optionUsesReusedTemplate(option: ProductIntakeOption, reusedTemplateIds: Set<string>): boolean {
  return option.templateMatches.some((match) => isReusableTemplateMatch(match) && reusedTemplateIds.has(match.templateId));
}

function classifyOptionGroup(option: ProductIntakeOption): DraftGroupKey {
  const text = `${option.label} ${option.normalizedGroup}`.toLowerCase();
  if (/material|substrate|stock/.test(text)) return "materials";
  if (/side|sides|print|color|white ink|ink/.test(text)) return "print_setup";
  if (/stake|h-wire|h wire|standoff|stand off|hardware|frame|grommet stake/.test(text)) return "hardware";
  if (/laminate|lamination/.test(text)) return "lamination";
  if (/weed\s*(?:and|&)?\s*tape|weeding|transfer tape|application prep|mask/.test(text)) return "application_prep";
  if (/contour|kiss cut|die cut|cutting|cut type/.test(text)) return "cutting";
  if (/grommet|pole pocket|pocket|rounded|corner|hem|sew|finish|shape/.test(text)) return "finishing";
  return "finishing";
}

function conceptKeyForOption(option: ProductIntakeOption): string {
  const key = conceptKeyFromText(option.normalizedGroup || option.label);
  return key;
}

function conceptKeyFromText(value: string): string {
  const key = safeKey(value, "option").replace(/__.+$/, "");
  if (/qty|quantity|quantities|tier|tiers/.test(key)) return "quantity";
  if (/printed?_?sides?|sides?/.test(key)) return "printed_sides";
  if (/grommet/.test(key)) return "grommets";
  if (/pole.*pocket|pocket/.test(key)) return "pole_pockets";
  if (/laminat/.test(key)) return "laminate";
  if (/contour|cut_type|die_cut|kiss_cut/.test(key)) return "cut_type";
  if (/weed.*tape|weeding|transfer_tape/.test(key)) return "weed_and_tape";
  if (/h_?wire|stake/.test(key)) return "h_wire_stakes";
  if (/material|substrate/.test(key)) return "material";
  if (/size|dimension|width|height/.test(key)) return "size";
  return key;
}

function normalizeProductIntakeRuntimeRoots(tree: OptionTreeV2): OptionTreeV2 {
  const nodes = tree.nodes ?? {};
  const edges = tree.edges ?? [];
  const roots = new Set<string>();

  tree.edges = edges.map((edge) => {
    const from = nodes[edge.fromNodeId];
    const to = nodes[edge.toNodeId];
    if (String(from?.type ?? "").toUpperCase() !== "GROUP" && String(to?.type ?? "").toUpperCase() !== "GROUP") {
      return edge;
    }
    if (to && String(to.type ?? "").toUpperCase() !== "GROUP" && String(to.status ?? "ENABLED").toUpperCase() !== "DELETED") {
      roots.add(to.id);
    }
    return { ...edge, status: "DISABLED" as const };
  });

  for (const rootId of tree.rootNodeIds ?? []) {
    const node = nodes[rootId];
    if (!node || String(node.type ?? "").toUpperCase() === "GROUP" || String(node.status ?? "ENABLED").toUpperCase() === "DELETED") continue;
    roots.add(rootId);
  }

  for (const node of Object.values(nodes)) {
    if (String(node.type ?? "").toUpperCase() !== "INPUT") continue;
    if (String(node.status ?? "ENABLED").toUpperCase() === "DELETED") continue;
    roots.add(node.id);
  }

  tree.rootNodeIds = Array.from(roots);
  return tree;
}

function collectTreeConcepts(tree: OptionTreeV2): Set<string> {
  const concepts = new Set<string>();
  for (const node of Object.values(tree.nodes)) {
    const raw = String(node.input?.selectionKey ?? node.key ?? node.label ?? "");
    if (raw) concepts.add(conceptKeyFromText(raw));
  }
  return concepts;
}

function bestMaterialMatch(brief: ProductIntakeBrief) {
  return brief.materialAnalysis.likelyMaterialMatches
    .filter((match) => match.materialId)
    .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function materialReviewMetadata(brief: ProductIntakeBrief, materialMatch: ReturnType<typeof bestMaterialMatch>) {
  const sourceMaterialText = unique(brief.materialAnalysis.detectedMaterialReferences.map((value) => value.trim()).filter(Boolean)).join(", ") || null;
  const candidateMatches = brief.materialAnalysis.likelyMaterialMatches
    .slice(0, 10)
    .map((match) => ({
      materialId: match.materialId ?? null,
      sku: match.sku ?? null,
      name: match.name,
      confidence: match.confidence,
    }));
  const matchConfidence = Math.max(
    brief.materialAnalysis.confidence,
    ...candidateMatches.map((match) => match.confidence),
    0,
  );
  const resolved = Boolean(materialMatch?.materialId && brief.materialAnalysis.confidence >= 65 && Number(materialMatch.confidence) >= 65);
  const materialMatchStatus: "resolved" | "review_required" | "unresolved" = resolved
    ? "resolved"
    : candidateMatches.length > 0 || sourceMaterialText
      ? "review_required"
      : "unresolved";
  const materialAssociationRequired = materialMatchStatus !== "resolved";

  return {
    materialMatchStatus,
    materialAssociationRequired,
    sourceMaterialText,
    candidateMatches,
    confidence: matchConfidence,
    warnings: materialAssociationRequired ? ["Material association required."] : [],
  };
}

function assessDraftQuality(args: {
  brief: ProductIntakeBrief;
  tree: OptionTreeV2;
  sizeMode: SizeMode;
  pricingReadiness: IntakePricingAnalysis;
  skippedTemplateOptionCount: number;
  requestedTemplateCount: number;
  reusedTemplateCount: number;
}): ProductIntakeDraftQuality {
  let score = 100;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const nodes = Object.values(args.tree.nodes);
  const inputNodes = nodes.filter((node) => node.kind === "question" || String(node.type ?? "").toUpperCase() === "INPUT");
  const selectionKeys = inputNodes.map((node) => String(node.input?.selectionKey ?? node.key ?? node.id));
  const labels = inputNodes.map((node) => safeKey(String(node.label ?? ""), "option"));
  const duplicateSelectionKeys = selectionKeys.filter((key, index) => selectionKeys.indexOf(key) !== index);
  const duplicateLabels = labels.filter((label, index) => labels.indexOf(label) !== index);
  const hasDimensionSize = inputNodes.some((node) => (node.input?.selectionKey === "size" || node.key === "size") && node.input?.type === "dimension");
  const hasDropdownSize = inputNodes.some((node) => (node.input?.selectionKey === "size" || node.key === "size") && node.input?.type === "select");
  const groupNodes = nodes.filter((node) => String(node.type ?? "").toUpperCase() === "GROUP");
  const invalidRootGroups = args.tree.rootNodeIds.some((nodeId) => {
    const node = args.tree.nodes[nodeId];
    return node && String(node.type ?? "").toUpperCase() === "GROUP";
  });
  const generatedMatrix = Boolean((args.tree as any).pricingMatrix?.rows?.length && args.tree.meta?.productIntake?.matrixDraft?.generatedByAI === true);

  if (duplicateSelectionKeys.length > 0) {
    score -= 15;
    warnings.push("Duplicate option selection keys detected.");
  }
  if (duplicateLabels.length > 0) {
    score -= 10;
    warnings.push("Duplicate option concepts detected.");
  }
  if (hasDimensionSize && hasDropdownSize) {
    score -= 25;
    warnings.push("Conflicting size controls detected.");
  }
  if (!bestMaterialMatch(args.brief) || args.brief.materialAnalysis.confidence < 65) {
    score -= 15;
    warnings.push("Material match needs review.");
  }
  if (args.brief.pricingAnalysis.behavior === "unknown" || args.brief.pricingAnalysis.confidence < 65) {
    score -= 15;
    warnings.push("Pricing setup required.");
  }
  if (!hasBasePricing(args.pricingReadiness.base)) {
    score -= 25;
    warnings.push("Base pricing is missing and must be configured before publish.");
  }
  if (!inputNodes.some((node) => node.input?.required === true)) {
    score -= 25;
    warnings.push("Missing required PBV2 inputs.");
  }
  if (generatedMatrix) {
    score += 5;
    warnings.push("AI-generated pricing matrix draft must be reviewed before publish.");
  }
  const unresolvedRequired = args.brief.missingDecisions.filter((decision) => decision.severity === "blocker");
  if (unresolvedRequired.length > 0) {
    score -= 20;
    warnings.push(`${unresolvedRequired.length} required decision(s) remain unresolved.`);
  }
  const templateAmbiguity = [
    ...args.brief.templateMatches,
    ...args.brief.requiredOptions.flatMap((option) => option.templateMatches),
    ...args.brief.optionalOptions.flatMap((option) => option.templateMatches),
  ].filter((match) => match.recommendation === "review_required");
  if (templateAmbiguity.length > 0) {
    score -= 10;
    warnings.push("Template ambiguity needs review.");
  }
  if (invalidRootGroups) {
    score -= 10;
    warnings.push("Runtime root organization needs review.");
  }
  if (args.requestedTemplateCount > args.reusedTemplateCount) {
    score -= 5;
    warnings.push("One or more reusable templates could not be applied.");
  }

  if (args.sizeMode === "fixed_dropdown") reasons.push("Fixed size is preserved as intake metadata unless multiple selectable sizes are present.");
  if (args.sizeMode === "custom_dimension") reasons.push("Custom size behavior produced a Size dimension input only.");
  if (args.skippedTemplateOptionCount > 0) reasons.push(`${args.skippedTemplateOptionCount} generic option(s) skipped because reusable templates were applied.`);
  if (groupNodes.length >= 2 && !invalidRootGroups) reasons.push("Options were organized into logical PBV2 groups.");
  reasons.push("Quote/order line item quantity remains outside customer-facing PBV2 options.");
  if (generatedMatrix) {
    reasons.push("High-confidence AI pricing matrix draft was generated for review.");
  } else if (args.pricingReadiness.matrixReadiness.required) {
    reasons.push("Matrix pricing guidance was preserved without generating matrix rows because source pricing was incomplete or below confidence threshold.");
  }
  if (warnings.length === 0) reasons.push("No draft quality penalties detected.");

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: normalizedScore,
    label: normalizedScore >= 90 ? "Excellent" : normalizedScore >= 75 ? "Good" : "Needs Review",
    reasons,
    warnings,
  };
}

export function buildProductIntakeDraftTree(args: {
  brief: ProductIntakeBrief;
  sessionId: string;
  productName: string;
  userId: string | null;
  templates?: ProductIntakeDraftTemplateRow[];
  sourceText?: string | null;
  sourceJson?: unknown;
  answers?: ProductIntakeAnswerLike[];
  formulaAssignment?: ProductIntakeFormulaAssignment | null;
  now?: Date;
}): OptionTreeV2 {
  const now = args.now ?? new Date();
  const usedNodeIds = new Set<string>();
  const usedEdgeIds = new Set<string>();
  const sizeOption = [...args.brief.requiredOptions, ...args.brief.optionalOptions].find(isSizeOption) ?? null;
  const sizeMode = resolveSizeMode(args.brief, sizeOption);
  const sourceText = collectBriefText(args.brief, args.sourceText, args.sourceJson);
  const fixedDimensions = fixedDimensionsForBrief(args.brief, sizeOption, sourceText, sizeMode);
  const sizeMetadata = sizeMetadataForBrief({ brief: args.brief, sizeOption, sizeMode, fixedDimensions });
  const materialMatch = bestMaterialMatch(args.brief);
  const materialReview = materialReviewMetadata(args.brief, materialMatch);
  const pricingReadiness = analyzeDraftPricing({
    brief: args.brief,
    sourceText: args.sourceText,
    sourceJson: args.sourceJson,
    answers: args.answers,
  });
  const formulaAssignment = args.formulaAssignment ?? formulaAssignmentForBrief(args.brief, sourceText);
  let tree: OptionTreeV2 = {
    schemaVersion: 2,
    status: "DRAFT",
    rootNodeIds: [],
    nodes: {},
    edges: [],
    meta: {
      title: `${args.productName} PBV2 Draft`,
      updatedAt: now.toISOString(),
      updatedByUserId: args.userId ?? undefined,
      notes: `Generated from Product Intake session ${args.sessionId}. Product remains inactive until the normal publish flow is completed.`,
      pricingProfileKey: "default",
      pricingV2: {
        unitSystem: "imperial",
        tierBasis: "line_item_quantity",
        base: pricingReadiness.base,
        qtyTiers: [],
      },
      requiresDimensions: sizeMode === "custom_dimension",
      ...(fixedDimensions ? { fixedDimensions } : {}),
      productIntake: {
        sessionId: args.sessionId,
        productName: args.productName,
        confidence: args.brief.overallConfidence,
        sizeMode,
        ...(fixedDimensions ? { fixedDimensions } : {}),
        size: sizeMetadata,
        quantity: quantityMetadataForBrief(args.brief),
        pricingReadiness: {
          base: pricingReadiness.base,
          sources: pricingReadiness.sources,
          warnings: pricingReadiness.warnings,
          basePricingConfigured: hasBasePricing(pricingReadiness.base),
          likelyMatrixPricing: pricingReadiness.likelyMatrixPricing,
          candidateDimensions: pricingReadiness.candidateDimensions,
          matrixEvidence: pricingReadiness.matrixEvidence,
          matrixType: pricingReadiness.matrixReadiness.matrixType,
          matrixConfidence: pricingReadiness.matrixReadiness.matrixConfidence,
          detectedSizes: pricingReadiness.matrixReadiness.detectedSizes,
          detectedQuantityBreaks: pricingReadiness.matrixReadiness.detectedQuantityBreaks,
          detectedMaterials: pricingReadiness.matrixReadiness.detectedMaterials,
          detectedPricingSignals: pricingReadiness.matrixReadiness.detectedPricingSignals,
        },
        matrixReadiness: pricingReadiness.matrixReadiness,
        pricingWarnings: pricingReadiness.warnings,
        materialMatch: materialMatch ? {
          materialId: materialMatch.materialId,
          sku: materialMatch.sku,
          name: materialMatch.name,
          confidence: materialMatch.confidence,
        } : null,
        materialMatchStatus: materialReview.materialMatchStatus,
        materialAssociationRequired: materialReview.materialAssociationRequired,
        sourceMaterialText: materialReview.sourceMaterialText,
        materialCandidateMatches: materialReview.candidateMatches,
        materialWarnings: materialReview.warnings,
        missingDecisions: args.brief.missingDecisions.map((decision) => ({
          id: decision.id,
          question: decision.question,
          severity: decision.severity,
        })),
      },
    },
  };

  const requestedTemplateCount = collectTemplateIds(args.brief).length;
  const templateResult = applyTemplateMatches(tree, args.templates ?? []);
  tree = templateResult.tree;
  const reusedTemplateIds = templateResult.reusedTemplateIds;
  usedNodeIds.clear();
  Object.keys(tree.nodes).forEach((nodeId) => usedNodeIds.add(nodeId));
  (tree.edges ?? []).forEach((edge) => {
    if (edge.id) usedEdgeIds.add(edge.id);
  });
  const templateConcepts = collectTreeConcepts(tree);

  let sortOrder = tree.rootNodeIds.length + 1;
  if (sizeMode === "custom_dimension") {
    addQuestionNode({
      tree,
      key: "size",
      label: "Size",
      inputType: "dimension",
      required: true,
      usedNodeIds,
      usedEdgeIds,
      groupKey: "size_quantity",
      sortOrder: sortOrder++,
    });
  } else if (sizeMode === "fixed_dropdown" && sizeOption && hasMultipleSelectableFixedSizeChoices(sizeOption)) {
    const choices = optionChoices(sizeOption);
    addQuestionNode({
      tree,
      key: "size",
      label: "Size",
      inputType: choices.length > 0 ? "select" : "boolean",
      required: sizeOption.required,
      choices: choices.length > 0 ? choices : undefined,
      usedNodeIds,
      usedEdgeIds,
      groupKey: "size_quantity",
      sortOrder: sortOrder++,
    });
  }

  if (shouldCollectQuantity(args.brief)) {
    const quantityWarnings = Array.isArray(tree.meta?.productIntake?.quantityWarnings)
      ? tree.meta.productIntake.quantityWarnings as string[]
      : [];
    tree.meta = {
      ...(tree.meta ?? {}),
      productIntake: {
        sessionId: args.sessionId,
        productName: args.productName,
        confidence: args.brief.overallConfidence,
        ...(tree.meta?.productIntake ?? {}),
        quantityWarnings: [
          ...quantityWarnings,
          "Quantity behavior found in intake. Quantity remains a quote/order line item field and was not generated as a PBV2 option.",
        ],
      },
    };
  }

  let skippedTemplateOptionCount = 0;
  for (const option of [...args.brief.requiredOptions, ...args.brief.optionalOptions]) {
    if (isSizeOption(option)) continue;
    const optionConcept = conceptKeyForOption(option);
    if (optionConcept === "quantity") {
      skippedTemplateOptionCount += 1;
      continue;
    }
    if (optionUsesReusedTemplate(option, reusedTemplateIds) || templateConcepts.has(conceptKeyForOption(option))) {
      skippedTemplateOptionCount += 1;
      continue;
    }
    const key = safeKey(option.normalizedGroup || option.label, "option");
    const choices = optionChoices(option);
    addQuestionNode({
      tree,
      key,
      label: compactText(option.label, option.normalizedGroup),
      inputType: choices.length > 0 ? "select" : "boolean",
      required: option.required,
      choices: choices.length > 0 ? choices : undefined,
      usedNodeIds,
      usedEdgeIds,
      groupKey: classifyOptionGroup(option),
      sortOrder: sortOrder++,
    });
  }

  if (tree.rootNodeIds.length === 0) {
    addQuestionNode({
      tree,
      key: "review_required",
      label: "Review Required",
      inputType: "boolean",
      required: true,
      usedNodeIds,
      usedEdgeIds,
      groupKey: "review",
      sortOrder,
    });
  }

  applyFormulaProductBehaviors(tree, sourceText, formulaAssignment);

  const matrixSourceText = appendMatrixAnswerSourceText({
    sourceText,
    tree,
    answers: args.answers,
    readiness: pricingReadiness.matrixReadiness,
  });
  const generatedMatrix = formulaAssignment ? null : buildGeneratedMatrixDraft({
      tree,
      sessionId: args.sessionId,
      sourceText: matrixSourceText,
      pricingReadiness,
    });
  if (generatedMatrix) {
    (tree as any).pricingMatrix = generatedMatrix.matrix;
    pricingReadiness.matrixReadiness = generatedMatrix.readiness;
    pricingReadiness.likelyMatrixPricing = true;
    pricingReadiness.candidateDimensions = generatedMatrix.readiness.matrixDimensions;
    pricingReadiness.matrixEvidence = generatedMatrix.readiness.reasoning;
    pricingReadiness.warnings = pricingReadiness.warnings.filter((warning) => !/Likely matrix pricing detected/i.test(warning));
    pricingReadiness.warnings.push("AI generated a PBV2 Pricing Matrix draft from explicit source prices. Review rows before publish.");
    tree.meta = {
      ...(tree.meta ?? {}),
      productIntake: {
        sessionId: args.sessionId,
        productName: args.productName,
        confidence: args.brief.overallConfidence,
        ...(tree.meta?.productIntake ?? {}),
        pricingReadiness: {
          ...(tree.meta?.productIntake?.pricingReadiness ?? {}),
          base: pricingReadiness.base,
          sources: pricingReadiness.sources,
          warnings: pricingReadiness.warnings,
          basePricingConfigured: hasBasePricing(pricingReadiness.base),
          likelyMatrixPricing: true,
          candidateDimensions: generatedMatrix.readiness.matrixDimensions,
          matrixEvidence: generatedMatrix.readiness.reasoning,
          matrixType: generatedMatrix.readiness.matrixType,
          matrixConfidence: generatedMatrix.readiness.matrixConfidence,
          detectedSizes: generatedMatrix.readiness.detectedSizes,
          detectedQuantityBreaks: generatedMatrix.readiness.detectedQuantityBreaks,
          detectedMaterials: generatedMatrix.readiness.detectedMaterials,
          detectedPricingSignals: generatedMatrix.readiness.detectedPricingSignals,
        },
        matrixReadiness: generatedMatrix.readiness,
        matrixDraft: generatedMatrix.draft,
        pricingWarnings: pricingReadiness.warnings,
      },
    };
  }

  tree = normalizeProductIntakeRuntimeRoots(tree);

  const draftQuality = assessDraftQuality({
    brief: args.brief,
    tree,
    sizeMode,
    pricingReadiness,
    skippedTemplateOptionCount,
    requestedTemplateCount,
    reusedTemplateCount: reusedTemplateIds.size,
  });
  tree.meta = {
    ...(tree.meta ?? {}),
    productIntake: {
      ...(tree.meta?.productIntake ?? {
        sessionId: args.sessionId,
        productName: args.productName,
        confidence: args.brief.overallConfidence,
      }),
      draftQuality,
    },
  };

  const validation = validateOptionTreeV2(tree);
  if (!validation.ok) {
    throw new ProductIntakeSessionError(500, `Generated PBV2 draft tree is invalid: ${validation.errors.join("; ")}`, "PBV2_DRAFT_INVALID");
  }
  return tree;
}

export function buildProductIntakeProductValues(args: {
  organizationId: string;
  productId: string;
  brief: ProductIntakeBrief;
  productTypeId: string | null;
  formulaAssignment?: ProductIntakeFormulaAssignment | null;
}) {
  const productName = compactText(args.brief.productIdentity.likelyProductName.value, "Product Intake Draft");
  const material = args.brief.materialAnalysis.likelyMaterialMatches
    .filter((match) => match.materialId && args.brief.materialAnalysis.confidence >= 65 && match.confidence >= 65)
    .sort((a, b) => b.confidence - a.confidence)[0];
  const summaryEvidence = args.brief.sourceEvidence
    .map((evidence) => `${evidence.label}: ${evidence.value ?? ""}`.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");

  return {
    id: args.productId,
    organizationId: args.organizationId,
    name: productName,
    description: summaryEvidence || `Inactive product draft generated from Product Intake for ${productName}.`,
    productTypeId: args.productTypeId,
    category: args.brief.productIdentity.category.value,
    pricingMode: pricingModeForBrief(args.brief),
    pricingEngine: args.formulaAssignment
      ? (args.formulaAssignment.pricingFormulaId ? "formulaLibrary" as const : "pricingFormula" as const)
      : "pricingProfile" as const,
    pricingFormulaId: args.formulaAssignment?.pricingFormulaId ?? null,
    pricingFormula: args.formulaAssignment?.expression ?? null,
    pricingProfileKey: args.formulaAssignment?.pricingProfileKey ?? "default",
    pricingProfileConfig: args.formulaAssignment?.config ?? null,
    primaryMaterialId: material?.materialId ?? null,
    requiresProductionJob: true,
    requiresProofApproval: false,
    isTaxable: true,
    isService: false,
    isActive: false,
    optionTreeJson: null,
    pbv2ActiveTreeVersionId: null,
  };
}

function resolveProductTypeId(brief: ProductIntakeBrief, rows: Array<{ id: string; name: string }>): string | null {
  const expected = compactText(brief.productIdentity.productType.value, "").toLowerCase();
  if (!expected) return null;
  const exact = rows.find((row) => row.name.toLowerCase() === expected);
  if (exact) return exact.id;
  return rows.find((row) => expected.includes(row.name.toLowerCase()) || row.name.toLowerCase().includes(expected))?.id ?? null;
}

export function createDbProductIntakeDraftCreator(database: any = defaultDb): ProductIntakeDraftCreator {
  return {
    async createDraftFromSession({ organizationId, sessionId, userId, userName }) {
      return database.transaction(async (tx: any) => {
        const [sessionRow] = await tx
          .select()
          .from(productIntakeSessions)
          .where(and(eq(productIntakeSessions.id, sessionId), eq(productIntakeSessions.organizationId, organizationId)))
          .limit(1);

        if (!sessionRow) {
          throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
        }
        if (sessionRow.createdProductId || sessionRow.createdPbv2TreeVersionId) {
          throw new ProductIntakeSessionError(409, "This intake session already created a draft product.", "INTAKE_DRAFT_ALREADY_CREATED");
        }
        if (sessionRow.status !== "ready_for_draft") {
          throw new ProductIntakeSessionError(409, "Only ready_for_draft intake sessions can create draft products.", "INTAKE_NOT_READY");
        }

        const brief = productIntakeBriefSchema.parse(sessionRow.aiBriefJson);
        const productName = compactText(brief.productIdentity.likelyProductName.value, "Product Intake Draft");
        const productId = randomUUID();
        const pbv2TreeVersionId = randomUUID();
        const now = new Date();
        const answerRows = await tx
          .select({
            questionKey: productIntakeAnswers.questionKey,
            answer: productIntakeAnswers.answerJson,
          })
          .from(productIntakeAnswers)
          .where(and(
            eq(productIntakeAnswers.organizationId, organizationId),
            eq(productIntakeAnswers.sessionId, sessionId),
          ));
        const templateIds = collectTemplateIds(brief);
        const templateRows = templateIds.length > 0
          ? await tx
            .select({ id: pbv2OptionGroupTemplates.id, templateTree: pbv2OptionGroupTemplates.templateTree })
            .from(pbv2OptionGroupTemplates)
            .where(and(
              inArray(pbv2OptionGroupTemplates.id, templateIds),
              eq(pbv2OptionGroupTemplates.state, "active"),
              or(
                eq(pbv2OptionGroupTemplates.organizationId, organizationId),
                eq(pbv2OptionGroupTemplates.isSystemTemplate, true),
              ),
            ))
          : [];
        const typeRows = await tx
          .select({ id: productTypes.id, name: productTypes.name })
          .from(productTypes)
          .where(eq(productTypes.organizationId, organizationId));
        const productTypeId = resolveProductTypeId(brief, typeRows);
        const formulaSourceText = collectBriefText(brief, sessionRow.sourceText, sessionRow.sourceJson);
        let formulaAssignment = formulaAssignmentForBrief(brief, formulaSourceText);
        if (formulaAssignment) {
          const requestedFormulaAssignment = formulaAssignment;
          const formulaRows = await tx
            .select({
              id: pricingFormulas.id,
              name: pricingFormulas.name,
              code: pricingFormulas.code,
              pricingProfileKey: pricingFormulas.pricingProfileKey,
              expression: pricingFormulas.expression,
              config: pricingFormulas.config,
            })
            .from(pricingFormulas)
            .where(and(
              eq(pricingFormulas.organizationId, organizationId),
              eq(pricingFormulas.isActive, true),
            ));
          const normalizedTargetCode = safeKey(formulaAssignment.code, "formula");
          const matchedFormula = formulaRows.find((row: any) => {
            const rowCode = safeKey(String(row.code ?? ""), "formula");
            const rowName = safeKey(String(row.name ?? ""), "formula");
            const expression = String(row.expression ?? "").replace(/\s+/g, "");
            return rowCode === normalizedTargetCode ||
              rowName.includes("sticker_adjusted_rounded") ||
              rowName.includes("sticker_rounded") ||
              expression === requestedFormulaAssignment.expression.replace(/\s+/g, "");
          });
          if (matchedFormula?.expression) {
            formulaAssignment = {
              ...formulaAssignment,
              pricingFormulaId: matchedFormula.id,
              code: matchedFormula.code ?? formulaAssignment.code,
              name: matchedFormula.name ?? formulaAssignment.name,
              pricingProfileKey: matchedFormula.pricingProfileKey ?? formulaAssignment.pricingProfileKey,
              expression: matchedFormula.expression,
              config: matchedFormula.config && typeof matchedFormula.config === "object" && !Array.isArray(matchedFormula.config)
                ? matchedFormula.config as Record<string, unknown>
                : formulaAssignment.config,
            };
          }
        }
        const productValues = buildProductIntakeProductValues({ organizationId, productId, brief, productTypeId, formulaAssignment });
        const treeJson = buildProductIntakeDraftTree({
          brief,
          sessionId,
          productName,
          userId,
          templates: templateRows,
          sourceText: sessionRow.sourceText,
          sourceJson: sessionRow.sourceJson,
          answers: answerRows,
          formulaAssignment,
          now,
        });
        const draftQuality = treeJson.meta?.productIntake?.draftQuality;
        if (!draftQuality) {
          throw new ProductIntakeSessionError(500, "Generated PBV2 draft tree is missing draft quality metadata.", "PBV2_DRAFT_INVALID");
        }

        await tx.insert(products).values(productValues);
        await tx.insert(pbv2TreeVersions).values({
          id: pbv2TreeVersionId,
          organizationId,
          productId,
          status: "DRAFT",
          schemaVersion: 2,
          treeJson: treeJson as any,
          publishedAt: null,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        });

        const [updatedSessionRow] = await tx
          .update(productIntakeSessions)
          .set({
            status: "draft_created",
            createdProductId: productId,
            createdPbv2TreeVersionId: pbv2TreeVersionId,
            updatedByUserId: userId,
            updatedAt: now,
          })
          .where(and(
            eq(productIntakeSessions.id, sessionId),
            eq(productIntakeSessions.organizationId, organizationId),
            eq(productIntakeSessions.status, "ready_for_draft"),
          ))
          .returning();

        if (!updatedSessionRow) {
          throw new ProductIntakeSessionError(409, "Draft product creation was already completed or the session is no longer ready.", "INTAKE_DRAFT_ALREADY_CREATED");
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: userName ?? null,
          actionType: "draft_created",
          entityType: "product_intake_session",
          entityId: sessionId,
          entityName: productName,
          description: `Product Intake draft_created: inactive product ${productId} and PBV2 DRAFT tree ${pbv2TreeVersionId} created.`,
          newValues: {
            sessionId,
            productId,
            pbv2TreeVersionId,
            productIsActive: false,
            pbv2Status: "DRAFT",
            activeTreeAssigned: false,
            draftQuality,
          },
        });

        return {
          productId,
          pbv2TreeVersionId,
          draftQuality,
          session: mapSession(updatedSessionRow),
        };
      });
    },
  };
}
