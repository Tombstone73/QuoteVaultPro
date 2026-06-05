import type {
  CatalogMigrationLabAnalyzerResult,
  CatalogMigrationLabSourceField,
  NormalizedSourceProduct,
} from "@shared/catalogMigrationLabSchemas";
import {
  productIntakeBriefSchema,
  type ProductIntakeBrief,
  type ProductIntakeEvidence,
  type ProductIntakeTemplateMatch,
  type ProductIntakeWizardAnalyzeRequest,
} from "@shared/productIntakeWizardSchemas";
import { parseAiJsonObject } from "../ai/bugReviewValidator";
import { createConfiguredAiProvider } from "../ai/providers/configuredProvider";
import { AiProviderUnavailableError, type AiProviderAdapter } from "../ai/providers/AiProviderAdapter";

export type ProductIntakeTemplateReference = {
  id: string;
  name: string;
  slug: string;
  category: string;
  tags: string[];
  workflowMetadata: Record<string, unknown>;
  templateTree: Record<string, any>;
};

export type ProductIntakeBriefInput = {
  orgId: string;
  request: ProductIntakeWizardAnalyzeRequest;
  analyzer: CatalogMigrationLabAnalyzerResult | null;
  templates: ProductIntakeTemplateReference[];
  provider?: AiProviderAdapter | null;
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function evidence(sourcePath: string, label: string, value: unknown, reason: string): ProductIntakeEvidence {
  const stringValue = value == null ? null : String(value).slice(0, 500);
  return { sourcePath, label, value: stringValue, reason };
}

function firstProduct(analyzer: CatalogMigrationLabAnalyzerResult | null): NormalizedSourceProduct | null {
  if (!analyzer || analyzer.products.length === 0) return null;
  const ready = analyzer.migrationReadiness.find((row) => row.readyForImport === "Ready" || row.readyForImport === "Needs Review");
  if (ready) {
    return analyzer.products.find((product) => (product.name ?? product.sku) === ready.sourceProductName) ?? analyzer.products[0];
  }
  return analyzer.products[0];
}

function sourceLabel(request: ProductIntakeWizardAnalyzeRequest): string {
  if (request.sourceType === "text_description") return "Manual description";
  if (request.fileName) return request.fileName;
  return request.sourceType === "uploaded_json" ? "Uploaded JSON" : "Pasted JSON";
}

function textDescriptionProductName(description: string): string {
  const cleaned = description.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Untitled Product";
  const beforeWith = cleaned.split(/\bwith\b/i)[0]?.trim();
  return (beforeWith || cleaned).slice(0, 120);
}

function inferCategoryFromText(text: string): { value: string | null; confidence: number } {
  const normalized = normalizeText(text);
  if (/\bbanner\b/.test(normalized)) return { value: "Banners", confidence: 80 };
  if (/foam board|foamcore|foam core/.test(normalized)) return { value: "Foam Board", confidence: 82 };
  if (/coroplast|coro|yard sign/.test(normalized)) return { value: "Coroplast / Yard Signs", confidence: 82 };
  if (/acrylic|pvc|acm|rigid/.test(normalized)) return { value: "Rigid Sheet", confidence: 68 };
  if (/sticker|decal|label/.test(normalized)) return { value: "Stickers", confidence: 76 };
  return { value: null, confidence: 20 };
}

function optionSignalsFromTree(template: ProductIntakeTemplateReference): string[] {
  const nodes = template.templateTree?.nodes;
  if (!nodes || typeof nodes !== "object") return [];
  const signals: string[] = [template.name, template.slug, template.category, ...template.tags];
  for (const node of Object.values(nodes) as any[]) {
    if (!node || typeof node !== "object") continue;
    signals.push(node.label, node.name, node.description);
    const choices = node.input?.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) signals.push(choice?.label, choice?.value);
    }
  }
  for (const value of Object.values(template.workflowMetadata ?? {})) {
    if (Array.isArray(value)) signals.push(...value.map((entry) => String(entry)));
    else if (value != null && typeof value !== "object") signals.push(String(value));
  }
  return unique(signals);
}

export function matchOptionTemplates(args: {
  optionLabel: string;
  sampleValues: string[];
  templates: ProductIntakeTemplateReference[];
  sourcePaths: string[];
}): ProductIntakeTemplateMatch[] {
  const optionTokens = new Set(normalizeText([args.optionLabel, ...args.sampleValues].join(" ")).split(" ").filter(Boolean));
  if (optionTokens.size === 0) return [];

  return args.templates
    .map((template) => {
      const signals = optionSignalsFromTree(template);
      const signalTokens = new Set(normalizeText(signals.join(" ")).split(" ").filter(Boolean));
      const matchedSignals = signals.filter((signal) => {
        const normalized = normalizeText(signal);
        return normalized && (normalizeText(args.optionLabel).includes(normalized) || normalized.includes(normalizeText(args.optionLabel)) || normalized.split(" ").some((token) => optionTokens.has(token)));
      });
      const overlap = Array.from(optionTokens).filter((token) => signalTokens.has(token)).length;
      const exactish = matchedSignals.some((signal) => normalizeText(signal) === normalizeText(args.optionLabel));
      const score = Math.min(1, (overlap / Math.max(optionTokens.size, 1)) * 0.75 + (exactish ? 0.3 : 0) + (matchedSignals.length > 1 ? 0.1 : 0));
      return {
        template,
        score,
        matchedSignals: unique(matchedSignals).slice(0, 8),
      };
    })
    .filter((match) => match.score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((match) => ({
      templateId: match.template.id,
      name: match.template.name,
      slug: match.template.slug,
      category: match.template.category,
      score: Number(match.score.toFixed(2)),
      recommendation: match.score >= 0.85 ? "suggest_reuse" : "review_required",
      matchedSignals: match.matchedSignals,
      evidence: [
        evidence(args.sourcePaths[0] ?? "$.source", args.optionLabel, match.matchedSignals.join(", "), "Template metadata and choice labels overlap with the source option."),
      ],
    }));
}

function sourceFieldsForProduct(product: NormalizedSourceProduct | null): CatalogMigrationLabSourceField[] {
  return product?.sourceFields ?? [];
}

function buildOptions(product: NormalizedSourceProduct | null, templates: ProductIntakeTemplateReference[], required: boolean) {
  const fields = sourceFieldsForProduct(product).filter((field) =>
    field.required === required &&
    !field.isCustomerMetadata &&
    field.normalizedGroup !== "Unknown" &&
    field.normalizedGroup !== "Customer Metadata" &&
    (field.normalizedGroup !== "Other Product Field" || normalizeText(field.fieldLabel).length > 0)
  );
  const byGroup = new Map<string, CatalogMigrationLabSourceField[]>();
  for (const field of fields) {
    const key = field.normalizedGroup === "Other Product Field"
      ? field.normalizedFieldLabel || field.fieldLabel
      : field.normalizedGroup || field.normalizedFieldLabel || field.fieldLabel;
    byGroup.set(key, [...(byGroup.get(key) ?? []), field]);
  }

  return Array.from(byGroup.entries()).map(([group, groupFields]) => {
    const sampleValues = unique(groupFields.map((field) => field.optionText)).slice(0, 12);
    const sourcePaths = unique(groupFields.map((field) => field.sourcePath));
    const matches = matchOptionTemplates({
      optionLabel: group,
      sampleValues,
      sourcePaths,
      templates,
    });
    return {
      label: groupFields[0]?.fieldLabel || group,
      normalizedGroup: group,
      required,
      confidence: clampConfidence(75 + (groupFields.length > 1 ? 10 : 0) + (matches.some((match) => match.recommendation === "suggest_reuse") ? 10 : 0)),
      sampleValues,
      sourcePaths,
      templateMatches: matches,
      evidence: groupFields.slice(0, 5).map((field) =>
        evidence(field.sourcePath, field.fieldLabel, field.optionText ?? field.fieldType, "Source field contributes to this option group."),
      ),
    };
  });
}

export function detectRedundantFields(analyzer: CatalogMigrationLabAnalyzerResult | null): ProductIntakeBrief["redundantFields"] {
  if (!analyzer) return [];
  const redundant: ProductIntakeBrief["redundantFields"] = [];
  const seenByProductLabel = new Map<string, CatalogMigrationLabSourceField>();

  for (const product of analyzer.products) {
    for (const field of product.sourceFields) {
      const key = `${product.sourceIndex}:${normalizeText(field.fieldLabel)}:${field.fieldType}`;
      const category = field.isCustomerMetadata
        ? "customer_metadata"
        : /(^|[_\s-])(id|uuid|guid)($|[_\s-])/.test(normalizeText(field.fieldLabel))
          ? "internal_id"
          : /created|updated|timestamp|date/.test(normalizeText(field.fieldLabel))
            ? "timestamp"
            : /ui|css|style|display|sort|position/.test(normalizeText(field.fieldLabel))
              ? "ui_metadata"
              : seenByProductLabel.has(key)
                ? "duplicate_label"
                : null;

      if (category) {
        redundant.push({
          fieldLabel: field.fieldLabel,
          sourcePath: field.sourcePath,
          category,
          reason: category === "duplicate_label"
            ? "A field with the same label and type already appeared for this product."
            : "The field appears to describe metadata rather than product setup intent.",
          confidence: category === "duplicate_label" ? 85 : 75,
          evidence: [evidence(field.sourcePath, field.fieldLabel, field.optionText ?? field.fieldType, "Classified as potentially redundant for intake review.")],
        });
      }
      seenByProductLabel.set(key, field);
    }

    if (product.status === "inactive") {
      redundant.push({
        fieldLabel: `${product.name ?? "Unnamed product"} status`,
        sourcePath: product.sourcePath,
        category: "inactive_record",
        reason: "Inactive source records should be reviewed before becoming product drafts.",
        confidence: 90,
        evidence: [evidence(product.sourcePath, "status", product.status, "Source product is marked inactive.")],
      });
    }

    for (const unsupported of product.unsupportedFieldNames) {
      const normalized = normalizeText(unsupported);
      const category = /id|uuid|guid/.test(normalized)
        ? "internal_id"
        : /created|updated|timestamp|date/.test(normalized)
          ? "timestamp"
          : /ui|css|style|display|sort|position|index|count/.test(normalized)
            ? "ui_metadata"
            : "metadata_only";
      redundant.push({
        fieldLabel: unsupported,
        sourcePath: product.sourcePath,
        category,
        reason: "Unsupported source field is retained for audit but is not needed for Phase 1 product intent.",
        confidence: 70,
        evidence: [evidence(product.sourcePath, unsupported, unsupported, "Unsupported source field surfaced by the existing analyzer.")],
      });
    }
  }

  return redundant.slice(0, 100);
}

function behaviorFromAnalyzer(product: NormalizedSourceProduct | null, analyzer: CatalogMigrationLabAnalyzerResult | null) {
  const structure = analyzer?.productStructures.find((row) => row.productName === (product?.name ?? product?.sku));
  const sizeEvidence = (structure?.sizeFieldsDetected ?? []).map((field) => evidence(product?.sourcePath ?? "$.source", field, field, "Analyzer detected this as a size-related field."));
  const pricing = analyzer?.pricingPatterns[0];
  const pricingEvidence = pricing ? [evidence("$.pricingPatterns", pricing.bucket, pricing.fields.join(", "), "Existing analyzer grouped pricing signals into this bucket.")] : [];

  const sizeBehavior = structure?.sizeFieldsDetected.some((field) => /width|height|custom/i.test(field))
    ? "custom_size"
    : structure?.sizeFieldsDetected.length
      ? "fixed_size"
      : "unknown";
  const quantityBehavior = structure?.quantityFieldDetected
    ? "per_piece"
    : pricing?.bucket === "quantity_breaks" || pricing?.bucket === "tiered_pricing"
      ? "quantity_tiers"
      : "unknown";
  const pricingBehavior = pricing?.bucket === "flat_price"
    ? "flat"
    : pricing?.bucket === "size_based"
      ? "square_foot"
      : pricing?.bucket === "tiered_pricing"
        ? "matrix_or_tiered"
        : pricing?.bucket === "formula_like"
          ? "formula"
          : "unknown";

  return {
    sizeBehavior: {
      behavior: sizeBehavior,
      confidence: sizeBehavior === "unknown" ? 25 : 78,
      notes: structure?.sizeFieldsDetected.join(", ") || undefined,
      evidence: sizeEvidence.length ? sizeEvidence : [evidence(product?.sourcePath ?? "$.source", "size", null, "No explicit size fields were detected.")],
    },
    quantityBehavior: {
      behavior: quantityBehavior,
      confidence: quantityBehavior === "unknown" ? 30 : 72,
      evidence: structure?.quantityFieldDetected
        ? [evidence(product?.sourcePath ?? "$.source", "Quantity", "detected", "Analyzer found a quantity candidate.")]
        : pricingEvidence,
    },
    pricingAnalysis: {
      behavior: pricingBehavior,
      confidence: pricingBehavior === "unknown" ? 25 : 70,
      evidence: pricingEvidence.length ? pricingEvidence : [evidence(product?.sourcePath ?? "$.source", "pricing", null, "No strong pricing signal was detected.")],
    },
  };
}

function fallbackBrief(input: ProductIntakeBriefInput, fallbackReason: string | null): ProductIntakeBrief {
  const product = firstProduct(input.analyzer);
  const sourceName = sourceLabel(input.request);
  const text = input.request.description ?? input.request.jsonText ?? "";
  const textCategory = inferCategoryFromText(text);
  const readiness = input.analyzer?.migrationReadiness.find((row) => row.sourceProductName === (product?.name ?? product?.sku));
  const structure = input.analyzer?.productStructures.find((row) => row.productName === (product?.name ?? product?.sku));
  const materialMatches = input.analyzer?.materialCandidates
    .filter((material) => !product || material.sampleProducts.includes(product.name ?? product.sku ?? ""))
    .slice(0, 5)
    .map((material) => ({
      materialId: material.matchedMaterial?.id ?? null,
      sku: material.matchedMaterial?.sku ?? null,
      name: material.matchedMaterial?.name ?? material.reference,
      confidence: material.matchedMaterial ? 88 : 55,
      evidence: [evidence("$.materialCandidates", material.reference, material.matchedMaterial?.name ?? material.reference, "Analyzer detected this material reference.")],
    })) ?? [];
  const descriptionName = input.request.description ? textDescriptionProductName(input.request.description) : null;
  const categoryValue = readiness?.suggestedCategory ?? structure?.suggestedCategory ?? textCategory.value;
  const categoryConfidence = readiness ? 75 : structure?.categoryConfidence === "source" || structure?.categoryConfidence === "high" ? 85 : textCategory.confidence;
  const requiredOptions = buildOptions(product, input.templates, true);
  const optionalOptions = buildOptions(product, input.templates, false);
  const templateMatches = unique([...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches.map((match) => match.templateId)))
    .map((templateId) => [...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches).find((match) => match.templateId === templateId)!)
    .filter(Boolean);
  const behaviors = behaviorFromAnalyzer(product, input.analyzer);
  const missingDecisions: ProductIntakeBrief["missingDecisions"] = [];

  if (!categoryValue) {
    missingDecisions.push({
      id: "confirm-category",
      question: "Which TitanOS product category should this use?",
      reason: "No high-confidence category was found.",
      severity: "review",
      evidence: [evidence(product?.sourcePath ?? "$.source", "category", null, "Category evidence was missing or weak.")],
    });
  }
  if (materialMatches.length === 0) {
    missingDecisions.push({
      id: "select-material",
      question: "Which material should this product use?",
      reason: "No material match was found in the source.",
      severity: "review",
      evidence: [evidence(product?.sourcePath ?? "$.source", "material", null, "Material evidence was missing.")],
    });
  }
  if (behaviors.pricingAnalysis.behavior === "unknown") {
    missingDecisions.push({
      id: "choose-pricing-model",
      question: "Which pricing model should be used before draft generation?",
      reason: "Pricing evidence is missing or ambiguous.",
      severity: "blocker",
      evidence: behaviors.pricingAnalysis.evidence,
    });
  }

  const sourceEvidence = [
    evidence(product?.sourcePath ?? "$.source", sourceName, product?.name ?? descriptionName ?? null, "Primary source used for the intake brief."),
    ...((structure?.detectedOptionGroups ?? []).slice(0, 5).map((group) => evidence(product?.sourcePath ?? "$.source", group, group, "Analyzer detected this product option group."))),
  ];

  const draftWarnings = (input.analyzer?.warnings ?? []).slice(0, 12).map((warning) => ({
    code: warning.code,
    message: warning.message,
    severity: warning.severity === "blocker" ? "warning" as const : warning.severity === "warning" ? "warning" as const : "info" as const,
    evidence: [evidence(warning.path ?? product?.sourcePath ?? "$.warnings", warning.fieldLabel ?? warning.code, warning.productName ?? null, "Analyzer warning retained for human review.")],
  }));

  const evidenceBackedConfidence = [
    product?.name || descriptionName ? 75 : 20,
    categoryValue ? categoryConfidence : 20,
    materialMatches.length ? Math.max(...materialMatches.map((match) => match.confidence)) : 20,
    behaviors.pricingAnalysis.confidence,
    requiredOptions.length + optionalOptions.length > 0 ? 75 : 35,
  ];

  return productIntakeBriefSchema.parse({
    workflowState: "REVIEW_READY",
    source: "rule_based_fallback",
    fallbackReason,
    productIdentity: {
      likelyProductName: {
        value: product?.name ?? descriptionName ?? "Untitled Product",
        confidence: product?.name ? 85 : descriptionName ? 60 : 20,
        evidence: [evidence(product?.sourcePath ?? "$.description", "product name", product?.name ?? descriptionName ?? null, "Best available product identity signal.")],
      },
      category: {
        value: categoryValue,
        confidence: clampConfidence(categoryConfidence),
        evidence: [evidence(product?.sourcePath ?? "$.source", "category", categoryValue, "Category inferred from source or analyzer rules.")],
      },
      productType: {
        value: product?.productType ?? readiness?.suggestedProductTemplate ?? null,
        confidence: product?.productType ? 80 : readiness?.suggestedProductTemplate ? 60 : 20,
        evidence: [evidence(product?.sourcePath ?? "$.source", "product type", product?.productType ?? readiness?.suggestedProductTemplate ?? null, "Product type or template signal from source analysis.")],
      },
    },
    materialAnalysis: {
      detectedMaterialReferences: input.analyzer ? unique(input.analyzer.materialCandidates.map((material) => material.reference)) : [],
      likelyMaterialMatches: materialMatches,
      confidence: materialMatches.length ? Math.max(...materialMatches.map((match) => match.confidence)) : 20,
      evidence: materialMatches.flatMap((match) => match.evidence),
    },
    ...behaviors,
    requiredOptions,
    optionalOptions,
    templateMatches,
    missingDecisions,
    redundantFields: detectRedundantFields(input.analyzer),
    draftWarnings,
    sourceEvidence,
    overallConfidence: clampConfidence(evidenceBackedConfidence.reduce((sum, value) => sum + value, 0) / evidenceBackedConfidence.length),
  });
}

function promptForBrief(input: ProductIntakeBriefInput, deterministicBrief: ProductIntakeBrief): { system: string; user: string } {
  const analyzerSummary = input.analyzer ? {
    source: input.analyzer.source,
    products: input.analyzer.products.slice(0, 5),
    productStructures: input.analyzer.productStructures.slice(0, 5),
    migrationReadiness: input.analyzer.migrationReadiness.slice(0, 5),
    materialCandidates: input.analyzer.materialCandidates.slice(0, 20),
    pricingPatterns: input.analyzer.pricingPatterns,
    warnings: input.analyzer.warnings.slice(0, 30),
  } : null;
  const templateSummary = input.templates.map((template) => ({
    id: template.id,
    name: template.name,
    slug: template.slug,
    category: template.category,
    tags: template.tags,
    workflowMetadata: template.workflowMetadata,
  }));

  return {
    system: [
      "You create TitanOS Product Intake Briefs.",
      "Return only JSON that matches the provided draft schema shape.",
      "Phase 1 is read-only: do not create products, trees, templates, or publish actions.",
      "Every major conclusion needs source-path evidence; if evidence is weak, lower confidence and add a missing decision.",
      "Only include template matches with score >= 0.65. score >= 0.85 means suggest_reuse; 0.65-0.84 means review_required.",
    ].join(" "),
    user: JSON.stringify({
      task: "Refine this Product Intake Brief while preserving the same schema.",
      sourceType: input.request.sourceType,
      description: input.request.description ?? null,
      analyzerSummary,
      existingOptionTemplates: templateSummary,
      deterministicBrief,
    }),
  };
}

export async function generateProductIntakeBrief(input: ProductIntakeBriefInput): Promise<ProductIntakeBrief> {
  const deterministicBrief = fallbackBrief(input, null);
  const provider = input.provider === undefined ? createConfiguredAiProvider() : input.provider;
  if (!provider) return deterministicBrief;

  try {
    const prompt = promptForBrief(input, deterministicBrief);
    const response = await provider.generateJson({
      orgId: input.orgId,
      feature: "feature_review",
      system: prompt.system,
      user: prompt.user,
      promptVersion: "product-intake-brief-v1",
    });
    const parsed = productIntakeBriefSchema.safeParse(parseAiJsonObject(response.rawText));
    if (!parsed.success) {
      return fallbackBrief(input, "Live AI response failed schema validation; deterministic analyzer brief returned.");
    }
    return {
      ...parsed.data,
      workflowState: "REVIEW_READY",
      source: "live_ai",
      fallbackReason: null,
    };
  } catch (error: any) {
    const reason = error instanceof AiProviderUnavailableError
      ? "AI provider unavailable; deterministic analyzer brief returned."
      : `AI brief generation failed; deterministic analyzer brief returned: ${error?.message ?? "unknown error"}`;
    return fallbackBrief(input, reason);
  }
}
