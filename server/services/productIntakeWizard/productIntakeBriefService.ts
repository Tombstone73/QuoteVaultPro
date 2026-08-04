import type {
  CatalogMigrationLabAnalyzerResult,
  CatalogMigrationLabSourceField,
  NormalizedSourceProduct,
} from "@shared/catalogMigrationLabSchemas";
import {
  productIntakeBriefSchema,
  type ProductIntakeAiReadiness,
  type ProductIntakeAiRun,
  type ProductIntakeAiRepairAction,
  type ProductIntakeBrief,
  type ProductIntakeEvidence,
  type ProductIntakeMatrixReadiness,
  type ProductIntakeTemplateMatch,
  type ProductIntakeWizardAnalyzeRequest,
} from "@shared/productIntakeWizardSchemas";
import { parseAiJsonObject } from "../ai/bugReviewValidator";
import { createConfiguredAiProvider } from "../ai/providers/configuredProvider";
import { AiProviderTimeoutError, AiProviderUnavailableError, type AiProviderAdapter } from "../ai/providers/AiProviderAdapter";
import type { ProductIntakeAiDiagnosticsStore } from "./productIntakeDiagnosticsService";
import { normalizeChoiceLabels, stripDefaultChoiceAnnotation } from "./productIntakeOptionHelpers";
import { hasCompleteNaturalLanguageQuantityTiers, parseNaturalLanguageQuantityTiers } from "./quantityTierParsing";

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
  aiReadiness?: ProductIntakeAiReadiness | null;
};

export type ProductIntakeBriefGenerationResult = {
  brief: ProductIntakeBrief;
  aiRun: ProductIntakeAiRun;
};

const PRODUCT_INTAKE_BRIEF_PROMPT_VERSION = "product-intake-brief-v1";
const PRODUCT_INTAKE_AI_DEFAULT_TIMEOUT_MS = 60000;

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

function titleCaseProductName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => {
      if (/^\.\d+$/.test(part) || /^\d+(?:mm|oz)$/i.test(part)) return part.toLowerCase();
      if (/^h-?wire$/i.test(part)) return "H-wire";
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\bPvc\b/g, "PVC")
    .replace(/\bAcm\b/g, "ACM")
    .replace(/\bCmyk\b/g, "CMYK")
    .replace(/\bContour Cut\b/g, "Contour-Cut");
}

export function resolveProductIntakeAiTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRODUCT_INTAKE_AI_TIMEOUT_MS
    ?? env.AI_PROVIDER_TIMEOUT_MS
    ?? env.AI_BUG_REVIEW_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PRODUCT_INTAKE_AI_DEFAULT_TIMEOUT_MS;
}

function inferCategoryFromText(text: string): { value: string | null; confidence: number } {
  const normalized = normalizeText(text);
  if (/\bbanner\b/.test(normalized)) return { value: "Banners", confidence: 80 };
  if (/foam board|foamcore|foam core/.test(normalized)) return { value: "Foam Board", confidence: 82 };
  if (/coroplast|coro|yard sign/.test(normalized)) return { value: "Coroplast / Yard Signs", confidence: 82 };
  if (/styrene|rigid sheet|rigid sign/.test(normalized)) return { value: "Rigid Signs", confidence: 84 };
  if (/sticker|decal|label/.test(normalized)) return { value: "Stickers", confidence: 76 };
  if (/acrylic|pvc|acm|rigid/.test(normalized)) return { value: "Rigid Signs", confidence: 74 };
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
  customOptions: Array<{ label: string; choices: string[]; defaultChoice?: string | null; required?: boolean; selectionMode?: "single" | "multi" }>;
  quantityBasedPricing: boolean;
  proofSignals: string[];
  routingSignals: string[];
  evidence: ProductIntakeEvidence[];
};

function extractTextDescriptionSignals(description: string): TextDescriptionSignals {
  const normalized = normalizeText(description);
  const lines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const calledProductName = description.match(/\b(?:new\s+)?product\s+called\s+["“]?(.+?)["”]?(?=[.!?]|$)/i)?.[1]?.trim() ?? null;
  const explicitProductName = description.match(/\b(?:product\s+draft|product)\s+named\s+["“]?(.+?)["”]?(?=(?:[.!?]\s*(?:sell|use|allow|route|with|add)\b)|$)/i)?.[1]?.trim() ?? null;
  const materialReferences: string[] = [];
  const customSize = /custom\s+(?:width\s+and\s+height|size)|width\s+and\s+height/i.test(description);
  const quantityBasedPricing = /quantity[\s-]*(?:based|tier|break|pricing)|qty[\s-]*(?:based|tier|break|pricing)/i.test(description) || hasCompleteNaturalLanguageQuantityTiers(description);
  const sizeMatches = Array.from(description.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*(?:[xX]|\u00D7)\s*(\d{1,3}(?:\.\d+)?)\b/gi))
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
  const coroplastMmMatch = description.match(/(?:\b(\d{1,2})\s*mm\b.*\b(?:coroplast|coro)\b|\b(?:coroplast|coro)\b.*\b(\d{1,2})\s*mm\b)/i);
  const coroplastMm = coroplastMmMatch ? coroplastMmMatch[1] ?? coroplastMmMatch[2] : null;
  if (coroplastMm) materialReferences.push(`Coroplast ${coroplastMm}mm`);
  else if (/\b(?:coroplast|coro)\b/i.test(description)) materialReferences.push("Coroplast");
  const acrylicMmMatch = description.match(/(?:\b(\d{1,2})\s*mm\b.*\bacrylic\b|\bacrylic\b.*\b(\d{1,2})\s*mm\b)/i);
  const acrylicMm = acrylicMmMatch ? acrylicMmMatch[1] ?? acrylicMmMatch[2] : null;
  if (acrylicMm) materialReferences.push(`${acrylicMm}mm Acrylic`);
  else if (/\bacrylic\b/i.test(description)) materialReferences.push("Acrylic");
  const pvcMmMatch = description.match(/(?:\b(\d{1,2})\s*mm\b.*\bpvc\b|\bpvc\b.*\b(\d{1,2})\s*mm\b)/i);
  const pvcMm = pvcMmMatch ? pvcMmMatch[1] ?? pvcMmMatch[2] : null;
  if (pvcMm) materialReferences.push(`${pvcMm}mm PVC`);
  else if (/\bpvc\b/i.test(description)) materialReferences.push("PVC");
  if (/\bvinyl\b/i.test(description) && /sticker|decal|label/i.test(description)) materialReferences.push("Vinyl");

  const sides: string[] = [];
  if (/single[\s-]*sided/i.test(description)) sides.push("Single sided");
  if (/double[\s-]*sided/i.test(description)) sides.push("Double sided");

  const printOptions: string[] = [];
  if (/full\s*color|4\s*color|cmyk/i.test(description)) printOptions.push("Full color printing");

  const explicitCategory = description.match(/\b(?:use|set)\s+([a-z][a-z0-9 &/\-]{1,100}?)\s+as\s+(?:the\s+)?category\b/i)?.[1]?.trim()
    ?? description.match(/\buse\s+(?:the\s+)?([a-z][a-z0-9 &/\-]{1,100}?)\s+category\b/i)?.[1]?.trim()
    ?? null;
  const explicitCustomOptionGroups = Array.from(description.matchAll(/\b(?:add|include|use)\s+(?:a\s+)?([a-z][a-z0-9 &/\-]{1,60}?)\s+(?:single[\s-]*select|multi[\s-]*select)\s+(?:required\s+)?(?:custom\s+)?option(?:\s+group)?\s+(?:with\s+)?(?:choices?|values?)\s*[:=]?\s*([^\.\n]+?)(?:,?\s*(?:with\s+)?default(?:ing)?\s*(?:to)?\s*([a-z][a-z0-9 &/\-]{0,60}))?(?:[\.\n]|$)/gi))
    .map((match) => {
      const label = titleCaseProductName(String(match[1] ?? "").trim());
      const choices = String(match[2] ?? "").replace(/,?\s*(?:with\s+)?default(?:ing)?\s*(?:to)?\s+.*$/i, "")
        .split(/\s*,\s*|\s+and\s+/i).map((choice) => stripDefaultChoiceAnnotation(choice).label).filter(Boolean);
      const defaultChoice = stripDefaultChoiceAnnotation(match[3] ?? "").label || null;
      const source = String(match[0] ?? "");
      return label && choices.length ? {
        label,
        choices,
        defaultChoice,
        required: /\brequired\b/i.test(source),
        selectionMode: /\bmulti[\s-]*select\b/i.test(source) ? "multi" as const : "single" as const,
      } : null;
    })
    .filter(Boolean) as Array<{ label: string; choices: string[]; defaultChoice: string | null; required: boolean; selectionMode: "single" | "multi" }>;
  const multilineCustomOptionGroups = Array.from(description.matchAll(/\b(?:add|include|use)\s+(?:one\s+)?(?:(required)\s+)?(?:(single|multi)[\s-]*select)\s+(?:custom\s+)?option(?:\s+group)?\s+named\s+([a-z][a-z0-9 &/\-]{1,60}?)(?:\s+with\s+(?:these\s+)?(?:choices?|values?))?\s*:\s*((?:\s*(?:[-*]|\d+[.)])\s*[^\n]+\n?)+)/gi))
    .map((match) => {
      const label = titleCaseProductName(String(match[3] ?? "").trim());
      const choices = String(match[4] ?? "").split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(Boolean);
      const trailingText = description.slice((match.index ?? 0) + String(match[0] ?? "").length, (match.index ?? 0) + String(match[0] ?? "").length + 180);
      const defaultChoice = trailingText.match(/\b(?:set\s+)?([a-z][a-z0-9 &/\-]{0,60})\s+as\s+the\s+default\b|\bdefault(?:ing)?\s+(?:to\s+)?([a-z][a-z0-9 &/\-]{0,60})\b/i)?.slice(1).find(Boolean) ?? null;
      return label && choices.length ? { label, choices, defaultChoice, required: Boolean(match[1]), selectionMode: match[2] === "multi" ? "multi" as const : "single" as const } : null;
    })
    .filter(Boolean) as Array<{ label: string; choices: string[]; defaultChoice: string | null; required: boolean; selectionMode: "single" | "multi" }>;
  const hasExplicitLaminationGroup = explicitCustomOptionGroups.some((option) => normalizeText(option.label) === "lamination") || /\blamination\s+choices?\b/i.test(description);
  const finishingOptions: string[] = [];
  if (/rounded\s+corners?/i.test(description)) finishingOptions.push("Rounded corners");
  if (/\bhemm?ing\b/i.test(description)) finishingOptions.push("Hemming");
  if (/\bgrommets?\b/i.test(description)) finishingOptions.push("Grommets");
  if (/pole\s+pockets?/i.test(description)) finishingOptions.push("Pole pockets");
  if (/\blaminate|lamination\b/i.test(description) && !hasExplicitLaminationGroup && !/glossy[\s\S]{0,80}matte|matte[\s\S]{0,80}glossy/i.test(description)) finishingOptions.push("Laminate");
  if (/\bh[\s-]?wire\b|\bstakes?\b/i.test(description)) finishingOptions.push("H-wire Stakes");
  if (/white\s+ink/i.test(description)) finishingOptions.push("White Ink");
  if (/contour[\s-]?cut/i.test(description) && !/\bcontour\s+cutting\b[\s\S]{0,120}\b(?:no|yes)\b/i.test(description)) finishingOptions.push("Contour Cut");

  const customOptions = Array.from(description.matchAll(/\badd\s+([a-z][a-z0-9 &\/-]{1,60}?)(?=\s+(?:options?|choices?|with|priced|pricing|as)\b|\s*[:;,\.\n]|$)/gi))
    .map((match) => {
      const rawLabel = String(match[1] ?? "").trim().replace(/\s+(?:option|options)$/i, "");
      if (!rawLabel || /^(?:a|an|the|any other custom)$/i.test(rawLabel)) return null;
      const label = titleCaseProductName(rawLabel);
      const tail = description.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 180);
      const colonChoices = tail.match(/^\s*(?:options?|choices?)?\s*:\s*([^\.\n]+)/i)?.[1]
        ?.split(/[,;|]+/)
        .map((choice) => choice.trim())
        .filter(Boolean) ?? [];
      const booleanModifier = /contour|grommet|rounded|laminat|installation|mount|hem|pocket|corner/i.test(label);
      return { label, choices: colonChoices.length > 0 ? colonChoices : booleanModifier ? ["No", "Yes"] : [] };
    })
    .filter((entry): entry is { label: string; choices: string[] } => entry !== null && !/\b(?:single|multi)[\s-]*select\b|\brequired\b|\bcustom\b/i.test(entry.label));
  const explicitChoiceOptions = Array.from(description.matchAll(/\b([a-z][a-z0-9 &\/-]{1,60}?)\s+choices?\s+(?:of\s+)?([^\.\n]+?)(?:,\s*default(?:ing)?\s+to\s+([^\.\n]+))?(?:[\.\n]|$)/gi))
    .map((match) => {
      const rawLabel = String(match[1] ?? "").trim();
      const label = titleCaseProductName(rawLabel.split(/\b(?:with|add|include)\b/i).pop() ?? rawLabel);
      const choicesText = String(match[2] ?? "").replace(/,\s*default(?:ing)?\s+to\s+.*$/i, "");
      const choices = choicesText.split(/,\s*(?:and\s+)?|\s+and\s+/i).map((value) => stripDefaultChoiceAnnotation(value).label).filter(Boolean);
      const defaultChoice = stripDefaultChoiceAnnotation(match[3] ?? "").label || null;
      return label && choices.length ? { label, choices, defaultChoice } : null;
    })
    .filter((entry): entry is { label: string; choices: string[]; defaultChoice: string | null } => entry !== null && !/\boption\s+group\b/i.test(entry.label));

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
  const isCoroplastYardSign = /coroplast|coro|yard sign/.test(normalized);
  const isSticker = /sticker|decal|label/.test(normalized);
  const isContourCutSticker = isSticker && /contour\s*cut/.test(normalized);
  const isAcrylicSign = /acrylic/.test(normalized) && (/sign|sheet|panel|rigid/.test(normalized) || sizeMatches.length > 0);
  const isPvcSign = /\bpvc\b/.test(normalized) && (/sign|sheet|panel|rigid/.test(normalized) || sizeMatches.length > 0);
  const styreneName = isStyreneRigid ? titleCaseProductName(`${styreneGaugeMatch ? `.${(styreneGaugeMatch[1] ?? styreneGaugeMatch[2]).padStart(3, "0")} ` : ""}Styrene Signs`) : null;
  const coroplastName = isCoroplastYardSign ? titleCaseProductName(`${coroplastMm ? `${coroplastMm}mm ` : ""}Coroplast Yard Signs`) : null;
  const acrylicName = isAcrylicSign ? titleCaseProductName(`${acrylicMm ? `${acrylicMm}mm ` : ""}Acrylic Signs`) : null;
  const pvcName = isPvcSign ? titleCaseProductName(`${pvcMm ? `${pvcMm}mm ` : ""}PVC Signs`) : null;
  const productName = explicitProductName
    ?? calledProductName
    ?? styreneName
    ?? (isBanner ? (bannerOz ? `${bannerOz}oz Banner` : "Banner") : null)
    ?? coroplastName
    ?? (isContourCutSticker ? "Contour-Cut Stickers" : isSticker ? "Stickers" : null)
    ?? acrylicName
    ?? pvcName;
  const category = explicitCategory || (isStyreneRigid || isAcrylicSign || isPvcSign ? "Rigid Signs" : isBanner ? "Banners" : isCoroplastYardSign ? "Coroplast / Yard Signs" : isSticker ? "Stickers" : null);

  return {
    productName,
    category,
    categoryConfidence: explicitCategory ? 100 : category ? 86 : 20,
    productType: isStyreneRigid || isCoroplastYardSign || isAcrylicSign || isPvcSign ? "rigid_signage" : isBanner ? "banner" : isSticker ? "stickers" : null,
    materialReferences: unique(materialReferences),
    sizes: unique(sizeMatches),
    customSize,
    sides: unique(sides),
    printOptions: unique(printOptions),
    finishingOptions: unique(finishingOptions),
    customOptions: [...explicitCustomOptionGroups, ...multilineCustomOptionGroups, ...customOptions, ...explicitChoiceOptions].filter((entry, index, all) => all.findIndex((candidate) => normalizeText(candidate.label) === normalizeText(entry.label)) === index),
    quantityBasedPricing,
    proofSignals,
    routingSignals,
    evidence: [
      evidence("$.description", "description", lines[0] ?? description.slice(0, 120), "Text description was parsed for deterministic product signals."),
    ],
  };
}

function gaugeTokens(value: string): string[] {
  const gauges = Array.from(value.matchAll(/(?:^|\D)\.?(\d{1,3})(?:\D|$)/g)).map((match) => match[1]);
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
      if ((referenceText.includes("coroplast") || referenceText.includes("coro")) && (normalized.includes("coroplast") || normalized.includes("coro"))) score += 55;
      if (referenceText.includes("acrylic") && normalized.includes("acrylic")) score += 55;
      if (referenceText.includes("pvc") && normalized.includes("pvc")) score += 55;
      if (referenceText.includes("vinyl") && normalized.includes("vinyl")) score += 55;
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
  defaultChoice?: string | null;
  selectionMode?: "single" | "multi";
}) {
  const normalizedChoices = normalizeChoiceLabels(args.sampleValues);
  const explicitDefaultChoice = args.defaultChoice ? stripDefaultChoiceAnnotation(args.defaultChoice).label : null;
  const templateMatches = matchOptionTemplates({
    optionLabel: args.normalizedGroup,
    sampleValues: normalizedChoices.labels,
    sourcePaths: [args.sourcePath],
    templates: args.templates,
  });
  return {
    label: args.label,
    normalizedGroup: args.normalizedGroup,
    required: args.required,
    confidence: clampConfidence(args.confidence),
    sampleValues: normalizedChoices.labels,
    sourcePaths: [args.sourcePath],
    templateMatches,
    evidence: [evidence(args.sourcePath, args.label, args.sampleValues.join(", "), args.reason)],
    source: "product_specific" as const,
    selectionMode: args.selectionMode ?? "single",
    ...(explicitDefaultChoice || normalizedChoices.defaultChoice ? { defaultChoice: explicitDefaultChoice ?? normalizedChoices.defaultChoice } : {}),
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
      const normalizedOptionLabel = normalizeText(args.optionLabel);
      const normalizedSamples = args.sampleValues.map((value) => normalizeText(value));
      const exactish = matchedSignals.some((signal) => normalizeText(signal) === normalizedOptionLabel);
      const sampleExactish = normalizedSamples.some((sample) => sample && (sample === normalizedOptionLabel || signalTokens.has(sample)));
      const slugExactish = normalizeText(template.slug) === normalizedOptionLabel;
      const score = Math.min(1, (overlap / Math.max(optionTokens.size, 1)) * 0.75 + (exactish || slugExactish ? 0.3 : 0) + (sampleExactish ? 0.2 : 0) + (matchedSignals.length > 1 ? 0.1 : 0));
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

function fallbackMatrixReadiness(args: {
  text: string;
  textSignals: TextDescriptionSignals | null;
  requiredOptions: ProductIntakeBrief["requiredOptions"];
  optionalOptions: ProductIntakeBrief["optionalOptions"];
  materialMatches: ProductIntakeBrief["materialAnalysis"]["likelyMaterialMatches"];
  behaviors: Pick<ProductIntakeBrief, "sizeBehavior" | "quantityBehavior" | "pricingAnalysis">;
}): ProductIntakeMatrixReadiness {
  const optionText = [...args.requiredOptions, ...args.optionalOptions]
    .map((option) => `${option.label} ${option.normalizedGroup} ${option.sampleValues.join(" ")}`)
    .join(" ")
    .toLowerCase();
  const text = `${args.text} ${args.behaviors.sizeBehavior.behavior} ${args.behaviors.quantityBehavior.behavior} ${args.behaviors.pricingAnalysis.behavior} ${args.behaviors.pricingAnalysis.notes ?? ""}`;
  const lower = normalizeText(text);
  const dimensions = new Set<string>();
  const reasoning: string[] = [];
  const pricingSignals: string[] = [];
  const sizes = unique([
    ...(args.textSignals?.sizes ?? []),
    ...[...args.requiredOptions, ...args.optionalOptions]
      .filter((option) => /size|dimension|width|height/i.test(`${option.label} ${option.normalizedGroup}`))
      .flatMap((option) => option.sampleValues),
  ]).slice(0, 30);
  const quantityBreaks = unique((text.match(/\b\d+\b/g) ?? []).filter((value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= 100000;
  })).map(Number).slice(0, 30);

  if (sizes.length > 0 || /fixed|size|dimension|width|height/.test(lower)) dimensions.add("size");
  if (/quantity|quantities|qty|tier|break/.test(lower)) dimensions.add("quantity");
  const stockMatrixSignal = /\b(stock|paper|substrate)\s*x|x\s*(stock|paper|substrate)|business\s*cards?|postcards?/i.test(text);
  const coatingMatrixSignal = /\b(coating|coat|laminate|lamination)\s*x|x\s*(coating|coat|laminate|lamination)|business\s*cards?/i.test(text);
  const materialMatrixSignal = /\b(material|substrate)\s*x|x\s*(material|substrate)|size\s*x\s*material|material\s*x\s*size/i.test(text);
  if (stockMatrixSignal && /stock|paper|substrate/.test(optionText)) dimensions.add("stock");
  if (coatingMatrixSignal && /coating|coat|laminate|lamination/.test(optionText)) dimensions.add("coating");
  if (materialMatrixSignal && /material|substrate/.test(optionText)) dimensions.add("material");

  if (sizes.length > 1) reasoning.push("Multiple fixed sizes were detected.");
  if (/quantity|qty|tier|break/.test(lower)) {
    reasoning.push("Quantity-tier or quantity-break pricing was detected.");
    pricingSignals.push("Quantity tier pricing present.");
  }
  if (/matrix|price table|rate table|pricing grid|price grid|size x quantity|quantity x size|breakpoint pricing/.test(lower)) {
    reasoning.push("Matrix/table pricing language was detected.");
    pricingSignals.push("Matrix/table pricing language present.");
  }

  const dimensionList = Array.from(dimensions);
  let matrixType: ProductIntakeMatrixReadiness["matrixType"] = "NONE";
  if (dimensionList.length >= 3) matrixType = "MULTI_DIMENSION";
  else if (dimensions.has("size") && dimensions.has("quantity") && dimensionList.length === 2) matrixType = "SIZE_QUANTITY";
  else if (dimensions.has("quantity") && (dimensions.has("stock") || dimensions.has("coating")) && dimensionList.length <= 3) matrixType = "QUANTITY_STOCK";
  else if (dimensions.has("size") && (dimensions.has("material") || dimensions.has("stock")) && !dimensions.has("quantity")) matrixType = "SIZE_MATERIAL";
  else if (dimensions.has("quantity") && dimensionList.length === 1) matrixType = "QUANTITY_TIER";
  else if (dimensionList.length >= 2) matrixType = "MULTI_DIMENSION";

  const required = matrixType !== "NONE" && reasoning.length > 0 && !(/\bbanner\b/.test(lower) && /square foot|sqft|formula/.test(lower) && !/matrix|table|tier|break/.test(lower));
  const recommendedSetup = matrixType === "SIZE_QUANTITY"
    ? "Create a PBV2 pricing matrix with Size as the selectable dimension and line item quantity tiers or row-level quantity tiers before publish."
    : matrixType === "QUANTITY_STOCK"
      ? "Create a PBV2 pricing matrix using Stock/Material choices with quantity-tier pricing before publish."
      : matrixType === "SIZE_MATERIAL"
        ? "Create a PBV2 pricing matrix using Size and Material/Stock dimensions before publish."
        : matrixType === "QUANTITY_TIER"
          ? "Configure PBV2 quantity tiers before publish; a full option matrix may not be needed unless another selectable dimension affects price."
          : matrixType === "MULTI_DIMENSION"
            ? "Create a PBV2 pricing matrix with each detected selectable dimension and review quantity-tier behavior before publish."
            : "No pricing matrix setup is recommended from the current intake signals.";

  return {
    required,
    matrixType: required ? matrixType : "NONE",
    matrixDimensions: required ? dimensionList : [],
    matrixConfidence: required ? Math.min(95, 60 + reasoning.length * 8) : 0,
    reasoning: required ? reasoning : [],
    recommendedSetup,
    detectedSizes: sizes,
    detectedQuantityBreaks: required ? quantityBreaks : [],
    detectedMaterials: unique([
      ...(args.textSignals?.materialReferences ?? []),
      ...args.materialMatches.map((match) => match.name),
    ]).slice(0, 12),
    detectedPricingSignals: pricingSignals,
    noMatrixRowsGenerated: true,
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
    /\blaminate\b/i.test(text) && /\bglossy\b/i.test(text) && /\bmatte\b/i.test(text) ? textOptionGroup({
      label: "Laminate",
      normalizedGroup: "Laminate",
      required: true,
      sampleValues: ["Glossy", "Matte"],
      sourcePath: "$.description.options.laminate",
      confidence: 90,
      templates: input.templates,
      reason: "Glossy and matte laminate choices were listed in the text description.",
    }) : null,
    /\bcontour\s+cutting\b/i.test(text) && /\bno\b/i.test(text) && /\byes\b/i.test(text) ? textOptionGroup({
      label: "Contour Cutting",
      normalizedGroup: "Contour Cutting",
      required: true,
      sampleValues: ["No", "Yes"],
      sourcePath: "$.description.options.contour_cutting",
      confidence: 90,
      templates: input.templates,
      reason: "No/Yes contour cutting choices were listed in the text description.",
    }) : null,
  ].filter(Boolean) as ReturnType<typeof textOptionGroup>[] : [];
  const textOptionalOptions = textSignals ? [
    /\bweed\s+and\s+tape\b/i.test(text) && /\bno\b/i.test(text) && /\byes\b/i.test(text) ? textOptionGroup({
      label: "Weed and Tape",
      normalizedGroup: "Weed and Tape",
      required: false,
      sampleValues: ["No", "Yes"],
      sourcePath: "$.description.options.weed_and_tape",
      confidence: 90,
      templates: input.templates,
      reason: "No/Yes weed and tape choices were listed in the text description.",
    }) : null,
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
    ...textSignals.finishingOptions.map((finishing) => textOptionGroup({
      label: finishing,
      normalizedGroup: finishing,
      required: false,
      sampleValues: [finishing],
      sourcePath: `$.description.finishing.${normalizeText(finishing).replace(/\s+/g, "_")}`,
      confidence: 88,
      templates: input.templates,
      reason: "An optional finishing choice was stated in the text description.",
    })),
    ...textSignals.customOptions
      .filter((custom) => !custom.required)
      .filter((custom) => ![...textRequiredOptions, ...textSignals.finishingOptions.map((label) => ({ label }))]
        .some((existing) => normalizeText(existing.label) === normalizeText(custom.label)))
      .map((custom) => textOptionGroup({
        label: custom.label,
        normalizedGroup: custom.label,
        required: false,
        sampleValues: custom.choices,
        sourcePath: `$.description.custom_options.${normalizeText(custom.label).replace(/\s+/g, "_")}`,
        confidence: custom.choices.length > 0 ? 82 : 68,
        templates: input.templates,
        reason: "The description explicitly asked Product Intake to add this product-specific option.",
        defaultChoice: custom.defaultChoice,
        selectionMode: custom.selectionMode,
      })),
  ].filter(Boolean) as ReturnType<typeof textOptionGroup>[] : [];
  const requiredCustomOptions = textSignals ? textSignals.customOptions
    .filter((custom) => custom.required)
    .filter((custom) => !textRequiredOptions.some((existing) => normalizeText(existing.label) === normalizeText(custom.label)))
    .map((custom) => textOptionGroup({
      label: custom.label,
      normalizedGroup: custom.label,
      required: true,
      sampleValues: custom.choices,
      sourcePath: `$.description.custom_options.${normalizeText(custom.label).replace(/\s+/g, "_")}`,
      confidence: custom.choices.length > 0 ? 95 : 68,
      templates: input.templates,
      reason: "The description explicitly required this product-specific option.",
      defaultChoice: custom.defaultChoice,
      selectionMode: custom.selectionMode,
    })) : [];
  const requiredOptions = [...analyzerRequiredOptions, ...textRequiredOptions, ...requiredCustomOptions];
  const optionalOptions = [...analyzerOptionalOptions, ...textOptionalOptions];
  const templateMatches = unique([...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches.map((match) => match.templateId)))
    .map((templateId) => [...requiredOptions, ...optionalOptions].flatMap((option) => option.templateMatches).find((match) => match.templateId === templateId)!)
    .filter(Boolean);
  const analyzerBehaviors = behaviorFromAnalyzer(product, input.analyzer);
  const behaviors = textSignals ? {
    sizeBehavior: /\bquantity[-\s]?only\b/i.test(text)
      ? {
          behavior: "none",
          confidence: 96,
          notes: "Quantity-only product; width and height are not collected.",
          evidence: [evidence("$.description.measurement", "Measurement", "Quantity only", "The description explicitly excludes width and height.")],
        }
      : textSignals.sizes.length > 0
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
    pricingAnalysis: /\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf)\b/i.test(text)
      ? {
          behavior: "square_foot",
          confidence: 94,
          notes: "Explicit base rate per square foot",
          evidence: [evidence("$.description.pricing", "Square-foot base rate", text.match(/\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)?(?:sq\.?\s*ft|sqft|square\s*foot|square\s*feet|sf)\b/i)?.[0] ?? null, "An explicit square-foot rate was stated in the text description.")],
        }
      : /formula|rounded\s+sqft|round(?:ed)?\s+square\s+foot|ceil|adjusted\s+dimensions|add\s+0\.25|0\.25"?\s+to\s+width|0\.25"?\s+to\s+height/i.test(text) &&
      /sticker|decal|label|vinyl/i.test(text)
      ? {
          behavior: "formula",
          confidence: 92,
          notes: "Sticker-style adjusted rounded square-foot formula",
          evidence: [evidence("$.description.pricing_formula", "Pricing formula", "Adjusted rounded square footage", "Formula pricing instructions were stated in the text description.")],
        }
      : textSignals.quantityBasedPricing
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
  const parsedQuantityTiers = textSignals ? parseNaturalLanguageQuantityTiers(text) : null;
  const completeQuantityTierProduct = Boolean(textSignals && hasCompleteNaturalLanguageQuantityTiers(text) && /\bquantity[-\s]?only\b/i.test(text));

  if (!categoryValue) {
    missingDecisions.push({
      id: "confirm-category",
      question: "Which TitanOS product category should this use?",
      reason: "No high-confidence category was found.",
      severity: "review",
      evidence: [evidence(product?.sourcePath ?? "$.source", "category", null, "Category evidence was missing or weak.")],
    });
  }
  if (materialMatches.length === 0 && !completeQuantityTierProduct) {
    missingDecisions.push({
      id: "select-material",
      question: "Which material should this product use?",
      reason: "No material match was found in the source.",
      severity: "review",
      evidence: [evidence(product?.sourcePath ?? "$.description", "material", textSignals?.materialReferences.join(", ") || null, "Material evidence was missing or could not be matched.")],
    });
  } else if (materialMatches.length > 0 && Math.max(...materialMatches.map((match) => match.confidence)) < 85) {
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
  if (parsedQuantityTiers?.missingRateQuestions.length) {
    missingDecisions.push({
      id: "complete-quantity-tier-pricing",
      question: parsedQuantityTiers.missingRateQuestions[0]!,
      reason: "A quantity range was supplied without a corresponding per-piece rate.",
      severity: "blocker",
      evidence: [evidence("$.description.pricing", "Quantity tiers", null, "A complete tier family requires a rate for every quantity range.")],
    });
  } else if (parsedQuantityTiers?.errors.length) {
    missingDecisions.push({
      id: "correct-quantity-tier-pricing",
      question: parsedQuantityTiers.errors[0]!,
      reason: "Quantity tiers must be a complete, non-overlapping ordered family.",
      severity: "blocker",
      evidence: [evidence("$.description.pricing", "Quantity tiers", null, "The supplied quantity-tier ranges could not be normalized safely.")],
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
    materialMatches.length ? Math.max(...materialMatches.map((match) => match.confidence)) : completeQuantityTierProduct ? 75 : 20,
    behaviors.pricingAnalysis.confidence,
    requiredOptions.length + optionalOptions.length > 0 ? 75 : completeQuantityTierProduct ? 75 : 35,
  ];
  const matrixReadiness = fallbackMatrixReadiness({
    text,
    textSignals,
    requiredOptions,
    optionalOptions,
    materialMatches,
    behaviors,
  });

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
    matrixReadiness,
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

function repairSourcePath(input?: ProductIntakeBriefInput): string {
  return input?.request.sourceType === "text_description" ? "$.source_text" : "$.source";
}

function repairAction(args: {
  path: string;
  originalValue: unknown;
  repairedValue: unknown;
  reason: string;
  confidenceImpact?: string | null;
}): ProductIntakeAiRepairAction {
  return {
    path: args.path,
    originalValue: args.originalValue,
    repairedValue: args.repairedValue,
    reason: args.reason,
    confidenceImpact: args.confidenceImpact ?? null,
  };
}

export function normalizeProductIntakeConfidence(value: unknown, fallback = 60): number {
  if (typeof value === "number") return clampConfidence(value);
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    const numeric = value.match(/\d+(?:\.\d+)?/);
    if (numeric) return clampConfidence(Number(numeric[0]));
    if (normalized === "high" || normalized === "strong") return 85;
    if (normalized === "medium" || normalized === "moderate") return 65;
    if (normalized === "low" || normalized === "weak") return 35;
  }
  return clampConfidence(fallback);
}

export function normalizeProductIntakeBehaviorAlias(value: unknown, domain: "pricing" | "size" | "quantity" | "routing" = "pricing"): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (domain === "pricing" || domain === "quantity") {
    if (/quantity|qty|tier|tiers|tiered|break/.test(normalized)) return "quantity_tiers";
    if (/matrix/.test(normalized)) return "matrix_or_tiered";
    if (/square|sqft|sq ft/.test(normalized)) return "square_foot";
    if (/flat/.test(normalized)) return "flat";
    if (/formula/.test(normalized)) return "formula";
    if (/manual|quote/.test(normalized)) return "manual_quote";
  }
  if (domain === "size") {
    if (/custom|width height|width and height|width_height/.test(normalized)) return "custom_size";
    if (/fixed|preset|standard/.test(normalized)) return "fixed_size";
    if (/none|no size/.test(normalized)) return "none";
  }
  if (domain === "routing") {
    if (/roll|roll to roll|roll printer/.test(normalized)) return "roll_printer";
    if (/flatbed/.test(normalized)) return "flatbed";
    if (/router|cut/.test(normalized)) return "router_cut";
  }
  return String(value).trim();
}

function conclusionFromString(args: {
  value: string;
  confidence?: unknown;
  sourcePath: string;
  label: string;
  reason: string;
}) {
  return {
    value: args.value,
    confidence: normalizeProductIntakeConfidence(args.confidence, 65),
    evidence: [evidence(args.sourcePath, args.label, args.value, args.reason)],
  };
}

function optionGroupFromAi(args: {
  label: string;
  required: boolean;
  values: string[];
  sourcePath: string;
  confidence?: unknown;
  record?: Record<string, any> | null;
}) {
  const record = args.record ?? {};
  const rawChoices = Array.isArray(record.choices) ? record.choices : [];
  const choices = rawChoices.map((entry: unknown, index: number) => {
    const choice = asRecord(entry);
    if (!choice) return null;
    const parsedLabel = stripDefaultChoiceAnnotation(choice.label ?? choice.name ?? choice.value ?? "");
    const label = parsedLabel.label;
    if (!label) return null;
    const generatedValue = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `choice_${index + 1}`;
    const parsedValue = stripDefaultChoiceAnnotation(choice.value ?? generatedValue).label;
    const value = parsedValue || generatedValue;
    const pricingRecord = asRecord(choice.pricing ?? choice.pricingImpact ?? choice.price);
    const amount = pricingRecord?.amount == null ? null : Number(pricingRecord.amount);
    const pricingMode = ["none", "set_per_sqft", "set_per_piece", "add_flat", "add_per_piece", "add_per_sqft", "add_percent", "add_per_grommet"]
      .includes(String(pricingRecord?.mode)) ? String(pricingRecord?.mode) : "none";
    return {
      value,
      label,
      ...(pricingRecord ? {
        pricing: {
          mode: pricingMode,
          ...(Number.isFinite(amount) ? { amount } : { amount: null }),
          ...(typeof pricingRecord.label === "string" ? { label: pricingRecord.label } : {}),
        },
      } : {}),
      ...(Number.isFinite(Number(choice.weightOz)) ? { weightOz: Number(choice.weightOz) } : {}),
      ...(Array.isArray(choice.workflowTags) ? { workflowTags: choice.workflowTags.map(String).filter(Boolean) } : {}),
      ...(typeof choice.requiresProof === "boolean" ? { requiresProof: choice.requiresProof } : {}),
    };
  }).filter(Boolean);
  return {
    label: args.label,
    normalizedGroup: args.label,
    required: args.required,
    confidence: normalizeProductIntakeConfidence(args.confidence, args.required ? 70 : 60),
    sampleValues: args.values.length ? args.values : [args.label],
    sourcePaths: [args.sourcePath],
    templateMatches: [],
    evidence: [evidence(args.sourcePath, args.label, args.values.join(", ") || args.label, "AI option shape normalized for intake review.")],
    source: record.source === "reusable_template" ? "reusable_template" : "product_specific",
    ...(typeof record.reuseTemplateId === "string" && record.reuseTemplateId.trim() ? { reuseTemplateId: record.reuseTemplateId.trim() } : {}),
    selectionMode: record.selectionMode === "multi" ? "multi" : "single",
    ...(choices.length > 0 ? { choices } : {}),
    ...(() => {
      const parsedDefault = stripDefaultChoiceAnnotation(record.defaultChoice ?? record.defaultValue ?? record.default);
      const matchedDefault = choices.find((choice: any) => parsedDefault.label && choice.label.toLowerCase() === parsedDefault.label.toLowerCase());
      return matchedDefault ? { defaultChoice: matchedDefault.label } : {};
    })(),
    ...(typeof record.pricingRequired === "boolean" ? { pricingRequired: record.pricingRequired } : {}),
    ...(typeof record.affectsWeight === "boolean" ? { affectsWeight: record.affectsWeight } : {}),
    ...(typeof record.affectsRouting === "boolean" ? { affectsRouting: record.affectsRouting } : {}),
    ...(typeof record.affectsProof === "boolean" ? { affectsProof: record.affectsProof } : {}),
  };
}

function normalizeAiOptionGroups(value: unknown, required: boolean, sourcePath: string): ProductIntakeBrief["requiredOptions"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return optionGroupFromAi({ label: entry, required, values: [entry], sourcePath });
      }
      const record = asRecord(entry);
      if (!record) return null;
      const label = String(record.normalizedGroup ?? record.label ?? record.name ?? "").trim();
      if (!label) return null;
      const values = normalizeOptionArray(record.sampleValues ?? record.values ?? record.options ?? label);
      return optionGroupFromAi({ label, required: typeof record.required === "boolean" ? record.required : required, values, sourcePath, confidence: record.confidence, record });
    })
    .filter(Boolean) as ProductIntakeBrief["requiredOptions"];
}

export function repairProductIntakeBriefShape(raw: unknown, deterministicBrief: ProductIntakeBrief, options: { sourcePath?: string } = {}): { repaired: unknown; actions: ProductIntakeAiRepairAction[] } {
  const source = asRecord(raw);
  if (!source) return { repaired: raw, actions: [] };
  const actions: ProductIntakeAiRepairAction[] = [];
  const repaired: ProductIntakeBrief = JSON.parse(JSON.stringify(deterministicBrief));
  const sourcePath = options.sourcePath ?? "$.source_text";

  const sourceProductIdentity = asRecord(source.productIdentity);
  const sourceMaterial = asRecord(source.materialAnalysis) ?? asRecord(source.material);
  const sourceOptions = asRecord(source.options);
  const name = typeof source.productName === "string"
    ? source.productName
    : typeof source.name === "string"
      ? source.name
      : typeof sourceProductIdentity?.name === "string"
        ? sourceProductIdentity.name
        : null;
  if (name) {
    const next = conclusionFromString({ value: name, confidence: source.confidence ?? sourceProductIdentity?.confidence, sourcePath, label: "product name", reason: "AI product name alias normalized into productIdentity.likelyProductName." });
    actions.push(repairAction({ path: "productIdentity.likelyProductName", originalValue: name, repairedValue: next, reason: "Mapped productName/name alias into expected nested conclusion.", confidenceImpact: "Conservative repaired confidence used when source confidence was missing." }));
    repaired.productIdentity.likelyProductName = next;
  }

  const category = typeof source.productCategory === "string"
    ? source.productCategory
    : typeof source.category === "string"
      ? source.category
      : typeof sourceProductIdentity?.category === "string"
        ? sourceProductIdentity.category
        : null;
  if (category) {
    const next = conclusionFromString({ value: category, confidence: sourceProductIdentity?.categoryConfidence ?? sourceProductIdentity?.confidence, sourcePath, label: "category", reason: "AI category alias normalized into productIdentity.category." });
    actions.push(repairAction({ path: "productIdentity.category", originalValue: category, repairedValue: next, reason: "Mapped productCategory/category alias into expected nested conclusion.", confidenceImpact: "Conservative repaired confidence used when source confidence was missing." }));
    repaired.productIdentity.category = next;
  }

  const productType = typeof source.productType === "string"
    ? source.productType
    : typeof source.type === "string"
      ? source.type
      : typeof sourceProductIdentity?.type === "string"
        ? sourceProductIdentity.type
        : null;
  if (productType) {
    const next = conclusionFromString({ value: productType, confidence: sourceProductIdentity?.typeConfidence ?? sourceProductIdentity?.confidence, sourcePath, label: "product type", reason: "AI product type alias normalized into productIdentity.productType." });
    actions.push(repairAction({ path: "productIdentity.productType", originalValue: productType, repairedValue: next, reason: "Mapped productType/type alias into expected nested conclusion.", confidenceImpact: "Conservative repaired confidence used when source confidence was missing." }));
    repaired.productIdentity.productType = next;
  }

  const materialReferences = unique([
    ...normalizeOptionArray(source.materials),
    ...normalizeOptionArray(sourceMaterial?.detectedReferences),
    ...normalizeOptionArray(sourceMaterial?.detectedMaterialReferences),
    typeof source.material === "string" ? source.material : null,
    typeof sourceMaterial?.detectedReference === "string" ? sourceMaterial.detectedReference : null,
  ]);
  if (materialReferences.length > 0) {
    repaired.materialAnalysis.detectedMaterialReferences = unique([...repaired.materialAnalysis.detectedMaterialReferences, ...materialReferences]);
    repaired.materialAnalysis.confidence = Math.max(repaired.materialAnalysis.confidence, 55);
    if (repaired.materialAnalysis.evidence.length === 0) {
      repaired.materialAnalysis.evidence = [evidence(sourcePath, "material", materialReferences.join(", "), "AI material reference normalized into materialAnalysis for review.")];
    }
    actions.push(repairAction({ path: "materialAnalysis.detectedMaterialReferences", originalValue: source.material ?? source.materials ?? sourceMaterial, repairedValue: repaired.materialAnalysis.detectedMaterialReferences, reason: "Mapped material/materials alias into detected material references without selecting a specific material.", confidenceImpact: "Material confidence capped unless deterministic matching already found a material." }));
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
    actions.push(repairAction({ path: "requiredOptions.Size", originalValue: source.sizes ?? source.sizeOptions, repairedValue: sizes, reason: "Mapped AI size list into required Size option and fixed size behavior.", confidenceImpact: "Size behavior confidence raised to repaired conservative floor." }));
  }

  const sizeAlias = source.sizeBehavior ?? source.size ?? source.sizeModel;
  const repairedSizeBehavior = normalizeProductIntakeBehaviorAlias(sizeAlias, "size");
  if (repairedSizeBehavior) {
    const next = {
      behavior: repairedSizeBehavior,
      confidence: normalizeProductIntakeConfidence(asRecord(sizeAlias)?.confidence ?? source.sizeConfidence, 70),
      notes: typeof sizeAlias === "string" ? sizeAlias : undefined,
      evidence: [evidence(sourcePath, "size behavior", String(sizeAlias), "AI size behavior alias normalized.")],
    };
    actions.push(repairAction({ path: "sizeBehavior", originalValue: sizeAlias, repairedValue: next, reason: "Normalized size behavior alias into expected behavior object.", confidenceImpact: "Conservative repaired confidence used." }));
    repaired.sizeBehavior = next;
  }

  const quantityAlias = source.quantityBehavior ?? source.quantityModel ?? source.quantity;
  const repairedQuantityBehavior = normalizeProductIntakeBehaviorAlias(quantityAlias, "quantity");
  if (repairedQuantityBehavior) {
    const next = {
      behavior: repairedQuantityBehavior,
      confidence: normalizeProductIntakeConfidence(asRecord(quantityAlias)?.confidence ?? source.quantityConfidence, 70),
      notes: typeof quantityAlias === "string" ? quantityAlias : undefined,
      evidence: [evidence(sourcePath, "quantity behavior", String(quantityAlias), "AI quantity behavior alias normalized.")],
    };
    actions.push(repairAction({ path: "quantityBehavior", originalValue: quantityAlias, repairedValue: next, reason: "Normalized quantity behavior alias into expected behavior object.", confidenceImpact: "Conservative repaired confidence used." }));
    repaired.quantityBehavior = next;
  }

  const pricingAlias = source.pricingModel ?? source.pricingAnalysis ?? source.pricing;
  const repairedPricingBehavior = normalizeProductIntakeBehaviorAlias(typeof pricingAlias === "string" ? pricingAlias : asRecord(pricingAlias)?.type ?? asRecord(pricingAlias)?.behavior, "pricing");
  if (repairedPricingBehavior) {
    const next = {
      behavior: repairedPricingBehavior,
      confidence: normalizeProductIntakeConfidence(asRecord(pricingAlias)?.confidence ?? source.pricingConfidence, 70),
      notes: typeof pricingAlias === "string" ? pricingAlias : undefined,
      evidence: [evidence(sourcePath, "pricing model", String(typeof pricingAlias === "string" ? pricingAlias : asRecord(pricingAlias)?.type ?? asRecord(pricingAlias)?.behavior), "AI pricing model alias normalized.")],
    };
    actions.push(repairAction({ path: "pricingAnalysis", originalValue: pricingAlias, repairedValue: next, reason: "Normalized pricingModel/pricing alias into expected behavior object.", confidenceImpact: "Conservative repaired confidence used." }));
    repaired.pricingAnalysis = next;
  }

  const requiredOptions = normalizeAiOptionGroups(source.requiredOptions ?? sourceOptions?.required, true, sourcePath);
  const optionalOptions = normalizeAiOptionGroups(source.optionalOptions ?? sourceOptions?.optional ?? source.options, false, sourcePath);
  if (requiredOptions.length > 0) {
    for (const option of requiredOptions) {
      if (repaired.requiredOptions.some((existing) => normalizeText(existing.normalizedGroup) === normalizeText(option.normalizedGroup))) continue;
      repaired.requiredOptions.push(option);
    }
    actions.push(repairAction({ path: "requiredOptions", originalValue: source.requiredOptions ?? sourceOptions?.required, repairedValue: requiredOptions, reason: "Mapped AI required options alias into requiredOptions array.", confidenceImpact: "Template matches were not invented during repair." }));
  }
  if (optionalOptions.length > 0) {
    for (const option of optionalOptions) {
      const optionLabel = option.normalizedGroup;
      if (repaired.optionalOptions.some((option) => normalizeText(option.normalizedGroup) === normalizeText(optionLabel))) continue;
      repaired.optionalOptions.push(option);
    }
    actions.push(repairAction({ path: "optionalOptions", originalValue: source.optionalOptions ?? sourceOptions?.optional ?? source.options, repairedValue: optionalOptions, reason: "Mapped AI optional options alias into optionalOptions array.", confidenceImpact: "Template matches were not invented during repair." }));
  }

  const warnings = normalizeOptionArray(source.warnings);
  if (warnings.length > 0) {
    const repairedWarnings = warnings.slice(0, 8).map((warning) => ({
      code: normalizeText(warning).replace(/\s+/g, "_").slice(0, 60) || "ai_warning",
      message: warning,
      severity: "info" as const,
      evidence: [evidence(sourcePath, "warning", warning, "AI warning normalized into draftWarnings for review.")],
    }));
    repaired.draftWarnings = [...repaired.draftWarnings, ...repairedWarnings];
    actions.push(repairAction({ path: "draftWarnings", originalValue: source.warnings, repairedValue: repairedWarnings, reason: "Mapped warnings alias into draftWarnings array.", confidenceImpact: "Warnings remain informational and do not create catalog changes." }));
  }

  if (source.confidence !== undefined) {
    const nextConfidence = normalizeProductIntakeConfidence(source.confidence, repaired.overallConfidence);
    actions.push(repairAction({ path: "overallConfidence", originalValue: source.confidence, repairedValue: nextConfidence, reason: "Normalized AI confidence into numeric 0-100 confidence.", confidenceImpact: "Overall confidence clamped to schema range." }));
    repaired.overallConfidence = nextConfidence;
  }

  if (actions.length > 0) {
    for (const arrayPath of ["requiredOptions", "optionalOptions", "redundantFields", "templateMatches", "missingDecisions", "draftWarnings", "sourceEvidence"] as const) {
      if (!Array.isArray((repaired as any)[arrayPath])) {
        (repaired as any)[arrayPath] = [];
      }
      if ((source as any)[arrayPath] === undefined) {
        actions.push(repairAction({ path: arrayPath, originalValue: undefined, repairedValue: (repaired as any)[arrayPath], reason: "Defaulted missing schema array from deterministic brief.", confidenceImpact: null }));
      }
    }
    if (repaired.sourceEvidence.length === 0) {
      repaired.sourceEvidence = [evidence(sourcePath, "source text", null, "AI repair used the text source path convention because no JSON path was available.")];
      actions.push(repairAction({ path: "sourceEvidence", originalValue: [], repairedValue: repaired.sourceEvidence, reason: "Added source-text evidence path for repaired AI brief.", confidenceImpact: "No high confidence was inferred from this evidence placeholder." }));
    }
    repaired.aiRepair = {
      accepted: true,
      actions,
      repairedAt: new Date().toISOString(),
    };
  }

  repaired.overallConfidence = clampConfidence(Math.max(repaired.overallConfidence, deterministicBrief.overallConfidence));
  return { repaired, actions };
}

async function recordAiDiagnostic(input: ProductIntakeBriefInput, args: {
  response: Awaited<ReturnType<AiProviderAdapter["generateJson"]>>;
  validationErrors: Array<{ path: string; message: string; code?: string }>;
  repairActions?: ProductIntakeAiRepairAction[];
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

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function numericMetadata(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function providerUnavailableReason(input: ProductIntakeBriefInput, error: any): string {
  if (input.aiReadiness && !input.aiReadiness.canAttemptLiveAi) return input.aiReadiness.reason;
  return "provider_unavailable";
}

function aiRun(args: {
  attempted: boolean;
  reachedProvider: boolean;
  provider?: string | null;
  model?: string | null;
  reason: string;
  elapsedMs?: number | null;
  timeoutMs?: number | null;
  sourceResult: ProductIntakeAiRun["sourceResult"];
}): ProductIntakeAiRun {
  return {
    attempted: args.attempted,
    reachedProvider: args.reachedProvider,
    provider: args.provider ?? null,
    model: args.model ?? null,
    reason: args.reason,
    elapsedMs: args.elapsedMs ?? null,
    timeoutMs: args.timeoutMs ?? null,
    sourceResult: args.sourceResult,
  };
}

const PRODUCT_INTAKE_BRIEF_TOP_LEVEL_KEYS = [
  "workflowState",
  "source",
  "fallbackReason",
  "productIdentity",
  "materialAnalysis",
  "sizeBehavior",
  "quantityBehavior",
  "pricingAnalysis",
  "matrixReadiness",
  "requiredOptions",
  "optionalOptions",
  "templateMatches",
  "missingDecisions",
  "redundantFields",
  "draftWarnings",
  "sourceEvidence",
  "overallConfidence",
] as const;

const PRODUCT_INTAKE_BRIEF_OUTPUT_EXAMPLE: ProductIntakeBrief = {
  workflowState: "REVIEW_READY",
  source: "live_ai",
  fallbackReason: null,
  productIdentity: {
    likelyProductName: {
      value: "Coroplast Yard Signs",
      confidence: 90,
      evidence: [{ sourcePath: "$.source_text", label: "product name", value: "4mm coroplast yard signs", reason: "The source describes coroplast yard signs." }],
    },
    category: {
      value: "Yard Signs",
      confidence: 85,
      evidence: [{ sourcePath: "$.source_text", label: "category", value: "yard signs", reason: "The source explicitly identifies yard signs." }],
    },
    productType: {
      value: "rigid_signage",
      confidence: 82,
      evidence: [{ sourcePath: "$.source_text", label: "product type", value: "coroplast", reason: "Coroplast yard signs are rigid signage." }],
    },
  },
  materialAnalysis: {
    detectedMaterialReferences: ["4mm coroplast"],
    likelyMaterialMatches: [],
    confidence: 75,
    evidence: [{ sourcePath: "$.source_text", label: "material", value: "4mm coroplast", reason: "The source explicitly names the material." }],
  },
  sizeBehavior: {
    behavior: "fixed_size",
    confidence: 88,
    notes: "18x24, 24x36",
    evidence: [{ sourcePath: "$.source_text", label: "sizes", value: "18x24 and 24x36", reason: "The source lists fixed size options." }],
  },
  quantityBehavior: {
    behavior: "quantity_tiers",
    confidence: 84,
    notes: "Quantity tier pricing",
    evidence: [{ sourcePath: "$.source_text", label: "quantity", value: "Quantity tier pricing", reason: "The source describes quantity tier pricing." }],
  },
  pricingAnalysis: {
    behavior: "quantity_tiers",
    confidence: 84,
    notes: "Quantity tier pricing",
    evidence: [{ sourcePath: "$.source_text", label: "pricing", value: "Quantity tier pricing", reason: "The source describes the pricing model." }],
  },
  matrixReadiness: {
    required: true,
    matrixType: "SIZE_QUANTITY",
    matrixDimensions: ["size", "quantity"],
    matrixConfidence: 88,
    reasoning: ["Multiple fixed sizes and quantity-tier pricing were detected."],
    recommendedSetup: "Create a PBV2 pricing matrix with Size as the selectable dimension and line item quantity tiers or row-level quantity tiers before publish.",
    detectedSizes: ["18x24", "24x36"],
    detectedQuantityBreaks: [],
    detectedMaterials: ["4mm coroplast"],
    detectedPricingSignals: ["Quantity tier pricing present."],
    noMatrixRowsGenerated: true,
  },
  requiredOptions: [{
    label: "Size",
    normalizedGroup: "Size",
    required: true,
    confidence: 88,
    sampleValues: ["18x24", "24x36"],
    sourcePaths: ["$.source_text"],
    templateMatches: [],
    evidence: [{ sourcePath: "$.source_text", label: "Size", value: "18x24 and 24x36", reason: "The source lists fixed sizes." }],
  }, {
    label: "Printed Sides",
    normalizedGroup: "Printed Sides",
    required: true,
    confidence: 82,
    sampleValues: ["Single sided", "Double sided"],
    sourcePaths: ["$.source_text"],
    templateMatches: [],
    evidence: [{ sourcePath: "$.source_text", label: "Printed Sides", value: "Single sided or double sided", reason: "The source lists side options." }],
  }],
  optionalOptions: [{
    label: "H-wire Stakes",
    normalizedGroup: "H-wire Stakes",
    required: false,
    confidence: 78,
    sampleValues: ["Optional H-wire stakes"],
    sourcePaths: ["$.source_text"],
    templateMatches: [],
    evidence: [{ sourcePath: "$.source_text", label: "H-wire stakes", value: "Optional H-wire stakes", reason: "The source lists stakes as optional." }],
  }],
  templateMatches: [],
  missingDecisions: [],
  redundantFields: [],
  draftWarnings: [],
  sourceEvidence: [{ sourcePath: "$.source_text", label: "source text", value: "4mm coroplast yard signs", reason: "The brief is based on the text description." }],
  overallConfidence: 86,
};

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
      "Return JSON only: one ProductIntakeBrief object and no explanation.",
      "Do not return a wrapper object, task metadata, sourceType, description, analyzerSummary, existingOptionTemplates, deterministicBrief, or any other input metadata at the top level.",
      `The only allowed top-level keys are: ${PRODUCT_INTAKE_BRIEF_TOP_LEVEL_KEYS.join(", ")}.`,
      "Set workflowState to REVIEW_READY, source to live_ai, and fallbackReason to null when returning a validated AI brief.",
      "Phase 1 is read-only: do not create products, trees, templates, or publish actions.",
      "Every major conclusion needs source-path evidence; if evidence is weak, lower confidence and add a missing decision.",
      "Create product-specific option groups and choices whenever the user requests them, even when no existing option template matches. Never omit a requested custom option.",
      "Existing templates are suggestions only. Do not set source=reusable_template or reuseTemplateId unless the user explicitly asks to reuse that template.",
      "Do not create global reusable templates. New generated options stay product-specific.",
      "For every new option, identify required/optional, single/multi select, choices, pricing behavior, weight, workflow routing tags, and proof impact. Add a missing decision when required details or requested pricing are incomplete.",
      "Only include template matches with score >= 0.65. score >= 0.85 means suggest_reuse; 0.65-0.84 means review_required, but a match never requires reuse.",
      "Use $.source_text for text descriptions when no JSON path exists.",
    ].join(" "),
    user: [
      "Return exactly one ProductIntakeBrief JSON object that validates against this contract.",
      "",
      "Shape contract:",
      "- conclusion fields are objects: { \"value\": string|null, \"confidence\": 0-100, \"evidence\": ProductIntakeEvidence[] }.",
      "- behavior fields are objects: { \"behavior\": string, \"confidence\": 0-100, \"notes\"?: string, \"evidence\": ProductIntakeEvidence[] }.",
      "- ProductIntakeEvidence is: { \"sourcePath\": string, \"label\": string, \"value\": string|null, \"reason\": string }.",
      `- option fields are arrays of: { "label": string, "normalizedGroup": string, "required": boolean, "confidence": 0-100, "sampleValues": string[], "sourcePaths": string[], "templateMatches": ProductIntakeTemplateMatch[], "evidence": ProductIntakeEvidence[], "source"?: "product_specific"|"reusable_template", "reuseTemplateId"?: string|null, "selectionMode"?: "single"|"multi", "pricingRequired"?: boolean, "affectsWeight"?: boolean, "affectsRouting"?: boolean, "affectsProof"?: boolean, "choices"?: [{ "value": string, "label": string, "pricing"?: { "mode": "none"|"set_per_sqft"|"set_per_piece"|"add_flat"|"add_per_piece"|"add_per_sqft"|"add_percent"|"add_per_grommet", "amount"?: number|null }, "weightOz"?: number|null, "workflowTags"?: string[], "requiresProof"?: boolean|null }] }.` ,
      "- Pricing amounts are dollar values (or percentage points for add_percent). Use set_per_sqft for thickness/material choices that establish the square-foot rate.",
      "- templateMatches, missingDecisions, redundantFields, draftWarnings, sourceEvidence, requiredOptions, and optionalOptions must always be arrays, even when empty.",
      "",
      "Valid output example:",
      JSON.stringify(PRODUCT_INTAKE_BRIEF_OUTPUT_EXAMPLE),
      "",
      "Improve the draft below using the source context. If the draft is already best supported by evidence, return the same ProductIntakeBrief shape with source set to live_ai. Do not echo this input envelope.",
      "",
      "Source context:",
      JSON.stringify({
        sourceType: input.request.sourceType,
        description: input.request.description ?? null,
        analyzerSummary,
        existingOptionTemplates: templateSummary,
      }),
      "",
      "Draft ProductIntakeBrief to improve:",
      JSON.stringify(deterministicBrief),
    ].join("\n"),
  };
}

export async function generateProductIntakeBriefWithRun(input: ProductIntakeBriefInput): Promise<ProductIntakeBriefGenerationResult> {
  const startedAt = Date.now();
  const deterministicBrief = fallbackBrief(input, null);
  if (input.aiReadiness && !input.aiReadiness.canAttemptLiveAi) {
    const reason = `Live AI unavailable: ${input.aiReadiness.reason}. Analyzer fallback returned.`;
    return {
      brief: fallbackBrief(input, reason),
      aiRun: aiRun({
        attempted: false,
        reachedProvider: false,
        provider: input.aiReadiness.provider,
        model: input.aiReadiness.model,
        reason: input.aiReadiness.reason,
        elapsedMs: elapsed(startedAt),
        sourceResult: "provider_unavailable_fallback",
      }),
    };
  }
  const provider = input.provider === undefined ? createConfiguredAiProvider() : input.provider;
  if (!provider) {
    return {
      brief: deterministicBrief,
      aiRun: aiRun({
        attempted: false,
        reachedProvider: false,
        reason: "provider_not_configured",
        elapsedMs: elapsed(startedAt),
        sourceResult: "provider_unavailable_fallback",
      }),
    };
  }

  try {
    const prompt = promptForBrief(input, deterministicBrief);
    const timeoutMs = resolveProductIntakeAiTimeoutMs();
    const response = await provider.generateJson({
      orgId: input.orgId,
      feature: "feature_review",
      system: prompt.system,
      user: prompt.user,
      promptVersion: PRODUCT_INTAKE_BRIEF_PROMPT_VERSION,
      timeoutMs,
      timeoutUseCase: "product_intake",
    });
    const responseElapsedMs = numericMetadata(response.requestMetadata?.latencyMs) ?? elapsed(startedAt);
    const responseTimeoutMs = numericMetadata(response.requestMetadata?.timeoutMs) ?? timeoutMs;
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
      return {
        brief: fallbackBrief(input, "Live AI response could not be safely normalized. Analyzer fallback returned."),
        aiRun: aiRun({
          attempted: true,
          reachedProvider: true,
          provider: response.provider,
          model: response.model,
          reason: "invalid_json",
          elapsedMs: responseElapsedMs,
          timeoutMs: responseTimeoutMs,
          sourceResult: "schema_fallback",
        }),
      };
    }

    const parsed = productIntakeBriefSchema.safeParse(aiObject);
    if (!parsed.success) {
      const repair = repairProductIntakeBriefShape(aiObject, deterministicBrief, { sourcePath: repairSourcePath(input) });
      const repairedParsed = repair.actions.length > 0 ? productIntakeBriefSchema.safeParse(repair.repaired) : parsed;
      if (repairedParsed.success) {
        await recordAiDiagnostic(input, {
          response,
          validationErrors: [],
          repairActions: repair.actions,
        });
        return {
          brief: {
            ...repairedParsed.data,
            workflowState: "REVIEW_READY",
            source: "live_ai",
            fallbackReason: null,
          },
          aiRun: aiRun({
            attempted: true,
            reachedProvider: true,
            provider: response.provider,
            model: response.model,
            reason: "live_ai_repaired",
            elapsedMs: responseElapsedMs,
            timeoutMs: responseTimeoutMs,
            sourceResult: "live_ai_repaired",
          }),
        };
      }
      const validationErrors = repairedParsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      }));
      await recordAiDiagnostic(input, { response, validationErrors, repairActions: repair.actions });
      return {
        brief: fallbackBrief(input, "Live AI response could not be safely normalized. Analyzer fallback returned."),
        aiRun: aiRun({
          attempted: true,
          reachedProvider: true,
          provider: response.provider,
          model: response.model,
          reason: "schema_validation_failed",
          elapsedMs: responseElapsedMs,
          timeoutMs: responseTimeoutMs,
          sourceResult: "schema_fallback",
        }),
      };
    }
    return {
      brief: {
        ...parsed.data,
        workflowState: "REVIEW_READY",
        source: "live_ai",
        fallbackReason: null,
      },
      aiRun: aiRun({
        attempted: true,
        reachedProvider: true,
        provider: response.provider,
        model: response.model,
        reason: "live_ai",
        elapsedMs: responseElapsedMs,
        timeoutMs: responseTimeoutMs,
        sourceResult: "live_ai",
      }),
    };
  } catch (error: any) {
    const unavailableReason = error instanceof AiProviderUnavailableError ? providerUnavailableReason(input, error) : null;
    const reason = unavailableReason
      ? `Live AI unavailable: ${unavailableReason}. Analyzer fallback returned.`
      : error instanceof AiProviderTimeoutError
        ? `Live AI timed out after ${Math.round(error.timeoutMs / 1000)} seconds. Analyzer fallback returned.`
      : `AI brief generation failed; deterministic analyzer brief returned: ${error?.message ?? "unknown error"}`;
    return {
      brief: fallbackBrief(input, reason),
      aiRun: aiRun({
        attempted: true,
        reachedProvider: error instanceof AiProviderUnavailableError ? false : error instanceof AiProviderTimeoutError,
        provider: error instanceof AiProviderTimeoutError ? error.provider : null,
        model: error instanceof AiProviderTimeoutError ? error.model : null,
        reason: unavailableReason ?? (error instanceof AiProviderTimeoutError ? "timeout" : String(error?.message ?? "unknown_error")),
        elapsedMs: error instanceof AiProviderTimeoutError ? error.elapsedMs : elapsed(startedAt),
        timeoutMs: error instanceof AiProviderTimeoutError ? error.timeoutMs : null,
        sourceResult: unavailableReason ? "provider_unavailable_fallback" : error instanceof AiProviderTimeoutError ? "timeout_fallback" : "analyzer_fallback",
      }),
    };
  }
}

export async function generateProductIntakeBrief(input: ProductIntakeBriefInput): Promise<ProductIntakeBrief> {
  return (await generateProductIntakeBriefWithRun(input)).brief;
}
