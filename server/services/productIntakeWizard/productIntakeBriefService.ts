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
import type { ProductIntakeAiDiagnosticsStore } from "./productIntakeDiagnosticsService";

export type ProductIntakeTemplateReference = {
  id: string;
  name: string;
  slug: string;
  category: string;
  tags: string[];
  workflowMetadata: Record<string, unknown>;
  templateTree: Record<string, any>;
};

export type ProductIntakeMaterialReference = {
  id: string;
  sku: string | null;
  name: string;
};

export type ProductIntakeBriefInput = {
  orgId: string;
  request: ProductIntakeWizardAnalyzeRequest;
  analyzer: CatalogMigrationLabAnalyzerResult | null;
  templates: ProductIntakeTemplateReference[];
  materials?: ProductIntakeMaterialReference[];
  sourceFingerprint?: string | null;
  provider?: AiProviderAdapter | null;
  diagnosticsStore?: ProductIntakeAiDiagnosticsStore | null;
  createdByUserId?: string | null;
};

const PRODUCT_INTAKE_BRIEF_PROMPT_VERSION = "product-intake-brief-v1";

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
  const signals = extractTextDescriptionSignals(description);
  if (signals.productName) return signals.productName;
  const beforeWith = cleaned.split(/\bwith\b/i)[0]?.trim();
  return (beforeWith || cleaned).slice(0, 120);
}

function inferCategoryFromText(text: string): { value: string | null; confidence: number } {
  const normalized = normalizeText(text);
  if (/\bbanner\b/.test(normalized)) return { value: "Banners", confidence: 80 };
  if (/foam board|foamcore|foam core/.test(normalized)) return { value: "Foam Board", confidence: 82 };
  if (/coroplast|coro|yard sign/.test(normalized)) return { value: "Coroplast / Yard Signs", confidence: 82 };
  if (/styrene|rigid sheet|rigid sign/.test(normalized)) return { value: "Rigid Signs", confidence: 84 };
  if (/acrylic|pvc|acm|rigid/.test(normalized)) return { value: "Rigid Sheet", confidence: 68 };
  if (/sticker|decal|label/.test(normalized)) return { value: "Stickers", confidence: 76 };
  return { value: null, confidence: 20 };
}

type TextDescriptionSignals = {
  productName: string | null;
  category: string | null;
  categoryConfidence: number;
  productType: string | null;
  materialReferences: string[];
  sizes: string[];
  customSize: boolean;
  sides: string[];
  printOptions: string[];
  finishingOptions: string[];
  quantityBasedPricing: boolean;
  proofSignals: string[];
  routingSignals: string[];
  evidence: ProductIntakeEvidence[];
};

function extractTextDescriptionSignals(description: string): TextDescriptionSignals {
  const normalized = normalizeText(description);
  const lines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const materialReferences: string[] = [];
  const customSize = /custom\s+(?:width\s+and\s+height|size)|width\s+and\s+height/i.test(description);
  const quantityBasedPricing = /quantity[\s-]*(?:based|tier|break|pricing)|qty[\s-]*(?:based|tier|break|pricing)/i.test(description);
  const sizeMatches = Array.from(description.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*[x×]\s*(\d{1,3}(?:\.\d+)?)\b/gi))
    .map((match) => `${match[1]}x${match[2]}`);

  const styreneGaugeMatch = description.match(/(?:\.(\d{2,3})\s*(?:rigid\s+)?styrene|styrene\s*\.?(\d{2,3}))/i);
  if (styreneGaugeMatch) {
    const gauge = styreneGaugeMatch[1] ?? styreneGaugeMatch[2];
    materialReferences.push(`Styrene .${gauge.padStart(3, "0")}`);
  } else if (/\bstyrene\b/i.test(description)) {
    materialReferences.push("Styrene");
  }
  const bannerOzMatch = description.match(/(?:\b(\d{1,2})\s*oz\b.*\bbanner\b|\bbanner\b.*\b(\d{1,2})\s*oz\b)/i);
  const bannerOz = bannerOzMatch ? bannerOzMatch[1] ?? bannerOzMatch[2] : null;
  if (bannerOz) materialReferences.push(`${bannerOz}oz Banner`);
  else if (/\bbanner\b/i.test(description)) materialReferences.push("Banner");

  const sides: string[] = [];
  if (/single[\s-]*sided/i.test(description)) sides.push("Single sided");
  if (/double[\s-]*sided/i.test(description)) sides.push("Double sided");

  const printOptions: string[] = [];
  if (/full\s*color|4\s*color|cmyk/i.test(description)) printOptions.push("Full color printing");

  const finishingOptions: string[] = [];
  if (/rounded\s+corners?/i.test(description)) finishingOptions.push("Rounded corners");
  if (/\bhemm?ing\b/i.test(description)) finishingOptions.push("Hemming");
  if (/\bgrommets?\b/i.test(description)) finishingOptions.push("Grommets");
  if (/pole\s+pockets?/i.test(description)) finishingOptions.push("Pole pockets");

  const proofSignals: string[] = [];
  if (/proof\s+(required|needed|mandatory)|requires?\s+proof/i.test(description)) proofSignals.push("Proof required");

  const routingSignals = unique([
    /\bflatbed\b/i.test(description) ? "Flatbed" : null,
    /roll\s+printer|route\s+to\s+roll|\broll\b/i.test(description) ? "Roll printer" : null,
    /\brouter\b/i.test(description) ? "Router" : null,
    /\bcut(?:ting)?\b/i.test(description) ? "Cut" : null,
  ]);

  const isStyreneRigid = /styrene/.test(normalized) && (/rigid|sheet|sign/.test(normalized) || sizeMatches.length > 0);
  const isBanner = /\bbanner\b/.test(normalized);
  const productName = isStyreneRigid ? "Styrene Signs" : isBanner ? (bannerOz ? `${bannerOz}oz Banner` : "Banner") : null;
  const category = isStyreneRigid ? "Rigid Signs" : isBanner ? "Banners" : null;

  return {
    productName,
    category,
    categoryConfidence: category ? 86 : 20,
    productType: isStyreneRigid ? "rigid_signage" : isBanner ? "banner" : null,
    materialReferences: unique(materialReferences),
    sizes: unique(sizeMatches),
    customSize,
    sides: unique(sides),
    printOptions: unique(printOptions),
    finishingOptions: unique(finishingOptions),
    quantityBasedPricing,
    proofSignals,
    routingSignals,
    evidence: [
      evidence("$.description", "description", lines[0] ?? description.slice(0, 120), "Text description was parsed for deterministic product signals."),
    ],
  };
}

function gaugeTokens(value: string): string[] {
  const gauges = Array.from(value.matchAll(/(?:^|\D)\.?(\d{2,3})(?:\D|$)/g)).map((match) => match[1]);
  return unique(gauges.flatMap((gauge) => [gauge, `.${gauge.padStart(3, "0")}`, `0.${gauge.padStart(3, "0")}`]));
}

function matchMaterialsFromText(signals: TextDescriptionSignals, materials: ProductIntakeMaterialReference[] = []) {
  if (signals.materialReferences.length === 0) return [];
  const referenceText = normalizeText(signals.materialReferences.join(" "));
  const referenceGauges = new Set(gaugeTokens(signals.materialReferences.join(" ")));
  return materials
    .map((material) => {
      const haystack = `${material.name} ${material.sku ?? ""}`;
      const normalized = normalizeText(haystack);
      let score = 0;
      if (referenceText.includes("styrene") && normalized.includes("styrene")) score += 55;
      if (referenceText.includes("banner") && normalized.includes("banner")) score += 55;
      for (const gauge of Array.from(referenceGauges)) {
        if (haystack.toLowerCase().includes(gauge.toLowerCase()) || normalized.includes(gauge.replace(/[^0-9]/g, ""))) score += 35;
      }
      if (score === 0 && signals.materialReferences.some((reference) => normalized.includes(normalizeText(reference)))) score += 60;
      return { material, score: clampConfidence(score) };
    })
    .filter((match) => match.score >= 45)
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
    .slice(0, 8)
    .map((match) => ({
      materialId: match.material.id,
      sku: match.material.sku,
      name: match.material.name,
      confidence: match.score,
      evidence: [evidence("$.description", signals.materialReferences.join(", "), match.material.name, "Text material reference matched a read-only TitanOS material candidate.")],
    }));
}

function textOptionGroup(args: {
  label: string;
  normalizedGroup: string;
  required: boolean;
  sampleValues: string[];
  sourcePath: string;
  confidence: number;
  templates: ProductIntakeTemplateReference[];
  reason: string;
}) {
  const templateMatches = matchOptionTemplates({
    optionLabel: args.normalizedGroup,
    sampleValues: args.sampleValues,
    sourcePaths: [args.sourcePath],
    templates: args.templates,
  });
  return {
    label: args.label,
    normalizedGroup: args.normalizedGroup,
    required: args.required,
    confidence: clampConfidence(args.confidence),
    sampleValues: args.sampleValues,
    sourcePaths: [args.sourcePath],
    templateMatches,
    evidence: [evidence(args.sourcePath, args.label, args.sampleValues.join(", "), args.reason)],
  };
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
  const textSignals = input.request.description ? extractTextDescriptionSignals(input.request.description) : null;
  const textCategory = inferCategoryFromText(text);
  const readiness = input.analyzer?.migrationReadiness.find((row) => row.sourceProductName === (product?.name ?? product?.sku));
  const structure = input.analyzer?.productStructures.find((row) => row.productName === (product?.name ?? product?.sku));
  const analyzerMaterialMatches = input.analyzer?.materialCandidates
    .filter((material) => !product || material.sampleProducts.includes(product.name ?? product.sku ?? ""))
    .slice(0, 5)
    .map((material) => ({
      materialId: material.matchedMaterial?.id ?? null,
      sku: material.matchedMaterial?.sku ?? null,
      name: material.matchedMaterial?.name ?? material.reference,
      confidence: material.matchedMaterial ? 88 : 55,
      evidence: [evidence("$.materialCandidates", material.reference, material.matchedMaterial?.name ?? material.reference, "Analyzer detected this material reference.")],
    })) ?? [];
  const textMaterialMatches = textSignals ? matchMaterialsFromText(textSignals, input.materials ?? []) : [];
  const materialMatches = unique([...analyzerMaterialMatches, ...textMaterialMatches].map((match) => match.materialId ?? match.name))
    .map((key) => [...analyzerMaterialMatches, ...textMaterialMatches].find((match) => (match.materialId ?? match.name) === key)!)
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
  const descriptionName = input.request.description ? textDescriptionProductName(input.request.description) : null;
  const categoryValue = readiness?.suggestedCategory ?? structure?.suggestedCategory ?? textSignals?.category ?? textCategory.value;
  const categoryConfidence = readiness ? 75 : structure?.categoryConfidence === "source" || structure?.categoryConfidence === "high" ? 85 : textSignals?.category ? textSignals.categoryConfidence : textCategory.confidence;
  const analyzerRequiredOptions = buildOptions(product, input.templates, true);
  const analyzerOptionalOptions = buildOptions(product, input.templates, false);
  const textRequiredOptions = textSignals ? [
    textSignals.sizes.length > 0 || textSignals.customSize ? textOptionGroup({
      label: "Size",
      normalizedGroup: "Size",
      required: true,
      sampleValues: textSignals.sizes.length > 0 ? textSignals.sizes : ["Custom width", "Custom height"],
      sourcePath: "$.description.sizes",
      confidence: textSignals.sizes.length > 0 ? 90 : 84,
      templates: input.templates,
      reason: textSignals.sizes.length > 0 ? "Fixed size options were listed in the text description." : "Custom width and height were stated in the text description.",
    }) : null,
    textSignals.sides.length > 0 ? textOptionGroup({
      label: "Printed Sides",
      normalizedGroup: "Printed Sides",
      required: true,
      sampleValues: textSignals.sides,
      sourcePath: "$.description.sides",
      confidence: 88,
      templates: input.templates,
      reason: "Single-sided and double-sided print choices were listed in the text description.",
    }) : null,
  ].filter(Boolean) as ReturnType<typeof textOptionGroup>[] : [];
  const textOptionalOptions = textSignals ? [
    textSignals.printOptions.length > 0 ? textOptionGroup({
      label: "Printing",
      normalizedGroup: "Printing",
      required: false,
      sampleValues: textSignals.printOptions,
      sourcePath: "$.description.printing",
      confidence: 78,
      templates: input.templates,
      reason: "Printing intent was stated in the text description.",
    }) : null,
    textSignals.finishingOptions.length > 0 ? textOptionGroup({
      label: "Finishing",
      normalizedGroup: "Finishing",
      required: false,
      sampleValues: textSignals.finishingOptions,
      sourcePath: "$.description.finishing",
      confidence: 86,
      templates: input.templates,
      reason: "Optional finishing choices were stated in the text description.",
    }) : null,
  ].filter(Boolean) as ReturnType<typeof textOptionGroup>[] : [];
  const requiredOptions = [...analyzerRequiredOptions, ...textRequiredOptions];
  const optionalOptions = [...analyzerOptionalOptions, ...textOptionalOptions];
  const templateMatches = unique([...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches.map((match) => match.templateId)))
    .map((templateId) => [...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches).find((match) => match.templateId === templateId)!)
    .filter(Boolean);
  const analyzerBehaviors = behaviorFromAnalyzer(product, input.analyzer);
  const behaviors = textSignals ? {
    sizeBehavior: textSignals.sizes.length > 0
      ? {
          behavior: "fixed_size",
          confidence: 90,
          notes: textSignals.sizes.join(", "),
          evidence: [evidence("$.description.sizes", "Sizes", textSignals.sizes.join(", "), "Fixed size options were parsed from the text description.")],
        }
      : textSignals.customSize
        ? {
            behavior: "custom_size",
            confidence: 88,
            notes: "Custom width and height",
            evidence: [evidence("$.description.sizes", "Size", "Custom width and height", "Custom size behavior was parsed from the text description.")],
          }
      : analyzerBehaviors.sizeBehavior,
    quantityBehavior: textSignals.quantityBasedPricing
      ? {
          behavior: "quantity_tiers",
          confidence: 84,
          evidence: [evidence("$.description.pricing", "Quantity", "Quantity based pricing", "Quantity-based pricing was stated in the text description.")],
        }
      : textSignals.sizes.length > 0 || textSignals.customSize
      ? {
          behavior: "per_piece",
          confidence: 68,
          evidence: [evidence("$.description.sizes", "Quantity", textSignals.sizes.join(", ") || "Custom size", "Product appears to be ordered per piece; confirm if needed.")],
        }
      : analyzerBehaviors.quantityBehavior,
    pricingAnalysis: textSignals.quantityBasedPricing
      ? {
          behavior: "quantity_tiers",
          confidence: 86,
          evidence: [evidence("$.description.pricing", "Pricing", "Quantity based pricing", "Quantity-based pricing was stated in the text description.")],
        }
      : textSignals.sizes.length > 0 || textSignals.sides.length > 0
      ? {
          behavior: "matrix_or_tiered",
          confidence: 62,
          evidence: [evidence("$.description", "Pricing", [...textSignals.sizes, ...textSignals.sides].join(", "), "Size and side choices imply matrix or tiered pricing, but prices were not supplied.")],
        }
      : analyzerBehaviors.pricingAnalysis,
  } : analyzerBehaviors;
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
      evidence: [evidence(product?.sourcePath ?? "$.description", "material", textSignals?.materialReferences.join(", ") || null, "Material evidence was missing or could not be matched.")],
    });
  } else if (Math.max(...materialMatches.map((match) => match.confidence)) < 85) {
    missingDecisions.push({
      id: "select-material",
      question: "Which material should this product use?",
      reason: "Material candidates were found, but none reached the auto-select confidence threshold.",
      severity: "review",
      evidence: materialMatches.flatMap((match) => match.evidence).slice(0, 3),
    });
  }
  if (behaviors.pricingAnalysis.behavior === "unknown" || behaviors.pricingAnalysis.confidence < 65) {
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

  const draftWarnings: ProductIntakeBrief["draftWarnings"] = (input.analyzer?.warnings ?? []).slice(0, 12).map((warning) => ({
    code: warning.code,
    message: warning.message,
    severity: warning.severity === "blocker" ? "warning" as const : warning.severity === "warning" ? "warning" as const : "info" as const,
    evidence: [evidence(warning.path ?? product?.sourcePath ?? "$.warnings", warning.fieldLabel ?? warning.code, warning.productName ?? null, "Analyzer warning retained for human review.")],
  }));
  if (textSignals?.proofSignals.length) {
    draftWarnings.push({
      code: "proof_required",
      message: "Source mentions proof required.",
      severity: "info" as const,
      evidence: [evidence("$.description.proof", "Proof", textSignals.proofSignals.join(", "), "Proof workflow signal parsed from the description.")],
    });
  }
  if (textSignals?.routingSignals.length) {
    draftWarnings.push({
      code: "routing_signal",
      message: `Source mentions routing signals: ${textSignals.routingSignals.join(", ")}.`,
      severity: "info" as const,
      evidence: [evidence("$.description.routing", "Routing", textSignals.routingSignals.join(", "), "Production routing signal parsed from the description.")],
    });
  }

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
        value: product?.name ?? textSignals?.productName ?? descriptionName ?? "Untitled Product",
        confidence: product?.name ? 85 : textSignals?.productName ? 86 : descriptionName ? 60 : 20,
        evidence: [evidence(product?.sourcePath ?? "$.description", "product name", product?.name ?? descriptionName ?? null, "Best available product identity signal.")],
      },
      category: {
        value: categoryValue,
        confidence: clampConfidence(categoryConfidence),
        evidence: [evidence(product?.sourcePath ?? "$.source", "category", categoryValue, "Category inferred from source or analyzer rules.")],
      },
      productType: {
        value: product?.productType ?? readiness?.suggestedProductTemplate ?? textSignals?.productType ?? null,
        confidence: product?.productType ? 80 : readiness?.suggestedProductTemplate ? 60 : textSignals?.productType ? 75 : 20,
        evidence: [evidence(product?.sourcePath ?? "$.source", "product type", product?.productType ?? readiness?.suggestedProductTemplate ?? textSignals?.productType ?? null, "Product type or template signal from source analysis.")],
      },
    },
    materialAnalysis: {
      detectedMaterialReferences: unique([
        ...(input.analyzer ? input.analyzer.materialCandidates.map((material) => material.reference) : []),
        ...(textSignals?.materialReferences ?? []),
      ]),
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

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function normalizeOptionArray(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((entry) => typeof entry === "string" ? entry : asRecord(entry)?.label ?? asRecord(entry)?.name ?? String(entry ?? "")));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function repairProductIntakeBriefShape(raw: unknown, deterministicBrief: ProductIntakeBrief): { repaired: unknown; actions: string[] } {
  const source = asRecord(raw);
  if (!source) return { repaired: raw, actions: [] };
  const actions: string[] = [];
  const repaired: ProductIntakeBrief = JSON.parse(JSON.stringify(deterministicBrief));

  const name = typeof source.productName === "string" ? source.productName : typeof source.name === "string" ? source.name : null;
  if (name) {
    repaired.productIdentity.likelyProductName.value = name;
    repaired.productIdentity.likelyProductName.confidence = Math.max(repaired.productIdentity.likelyProductName.confidence, 65);
    actions.push("normalized productName/name into productIdentity.likelyProductName");
  }

  if (typeof source.category === "string") {
    repaired.productIdentity.category.value = source.category;
    repaired.productIdentity.category.confidence = Math.max(repaired.productIdentity.category.confidence, 65);
    actions.push("normalized category string into productIdentity.category");
  }

  if (typeof source.material === "string") {
    repaired.materialAnalysis.detectedMaterialReferences = unique([...repaired.materialAnalysis.detectedMaterialReferences, source.material]);
    repaired.materialAnalysis.confidence = Math.max(repaired.materialAnalysis.confidence, 55);
    if (repaired.materialAnalysis.evidence.length === 0) {
      repaired.materialAnalysis.evidence = [evidence("$.ai.material", "material", source.material, "AI material string normalized into materialAnalysis.")];
    }
    actions.push("normalized material string into materialAnalysis.detectedMaterialReferences");
  } else if (asRecord(source.material)?.detectedReference) {
    const detectedReference = String(asRecord(source.material)?.detectedReference);
    repaired.materialAnalysis.detectedMaterialReferences = unique([...repaired.materialAnalysis.detectedMaterialReferences, detectedReference]);
    repaired.materialAnalysis.confidence = Math.max(repaired.materialAnalysis.confidence, 60);
    actions.push("normalized material.detectedReference into materialAnalysis.detectedMaterialReferences");
  }

  const sizes = normalizeOptionArray(source.sizes ?? source.sizeOptions);
  if (sizes.length > 0 && !repaired.requiredOptions.some((option) => normalizeText(option.normalizedGroup) === "size")) {
    repaired.requiredOptions.push({
      label: "Size",
      normalizedGroup: "Size",
      required: true,
      confidence: 75,
      sampleValues: sizes,
      sourcePaths: ["$.ai.sizes"],
      templateMatches: [],
      evidence: [evidence("$.ai.sizes", "Size", sizes.join(", "), "AI size array normalized into required option group.")],
    });
    repaired.sizeBehavior = {
      behavior: "fixed_size",
      confidence: Math.max(repaired.sizeBehavior.confidence, 75),
      notes: sizes.join(", "),
      evidence: [evidence("$.ai.sizes", "Size", sizes.join(", "), "AI size array normalized into fixed size behavior.")],
    };
    actions.push("normalized sizes into required Size option and fixed_size behavior");
  }

  const options = normalizeOptionArray(source.options);
  if (options.length > 0) {
    for (const optionLabel of options.slice(0, 6)) {
      if (repaired.optionalOptions.some((option) => normalizeText(option.normalizedGroup) === normalizeText(optionLabel))) continue;
      repaired.optionalOptions.push({
        label: optionLabel,
        normalizedGroup: optionLabel,
        required: false,
        confidence: 60,
        sampleValues: [optionLabel],
        sourcePaths: ["$.ai.options"],
        templateMatches: [],
        evidence: [evidence("$.ai.options", optionLabel, optionLabel, "AI options array normalized into optional option group.")],
      });
    }
    actions.push("normalized options into optional option groups");
  }

  repaired.overallConfidence = clampConfidence(Math.max(repaired.overallConfidence, deterministicBrief.overallConfidence));
  return { repaired, actions };
}

async function recordAiDiagnostic(input: ProductIntakeBriefInput, args: {
  response: Awaited<ReturnType<AiProviderAdapter["generateJson"]>>;
  validationErrors: Array<{ path: string; message: string; code?: string }>;
  repairActions?: string[];
}) {
  if (!input.diagnosticsStore) return;
  try {
    await input.diagnosticsStore.recordSchemaValidationFailure({
      organizationId: input.orgId,
      sourceType: input.request.sourceType,
      sourceFingerprint: input.sourceFingerprint ?? null,
      provider: args.response.provider ?? null,
      model: args.response.model ?? null,
      rawAiResponse: args.response.rawText,
      validationErrors: args.validationErrors,
      failedSchemaPaths: unique(args.validationErrors.map((issue) => issue.path || "$")),
      repairActions: args.repairActions ?? [],
      promptVersion: PRODUCT_INTAKE_BRIEF_PROMPT_VERSION,
      createdByUserId: input.createdByUserId ?? null,
    });
  } catch (diagnosticError) {
    console.warn("[ProductIntakeWizard] Failed to store AI schema diagnostic:", diagnosticError);
  }
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
      promptVersion: PRODUCT_INTAKE_BRIEF_PROMPT_VERSION,
    });
    let aiObject: unknown;
    try {
      aiObject = parseAiJsonObject(response.rawText);
    } catch (parseError: any) {
      await recordAiDiagnostic(input, {
        response,
        validationErrors: [{
          path: "$",
          message: `AI response was not parseable JSON: ${parseError?.message ?? "unknown parse error"}`,
          code: "invalid_json",
        }],
      });
      return fallbackBrief(input, "Live AI response failed schema validation; deterministic analyzer brief returned.");
    }

    const parsed = productIntakeBriefSchema.safeParse(aiObject);
    if (!parsed.success) {
      const repair = repairProductIntakeBriefShape(aiObject, deterministicBrief);
      const repairedParsed = repair.actions.length > 0 ? productIntakeBriefSchema.safeParse(repair.repaired) : parsed;
      if (repairedParsed.success) {
        return {
          ...repairedParsed.data,
          workflowState: "REVIEW_READY",
          source: "live_ai",
          fallbackReason: null,
        };
      }
      const validationErrors = repairedParsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      }));
      await recordAiDiagnostic(input, { response, validationErrors, repairActions: repair.actions });
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
