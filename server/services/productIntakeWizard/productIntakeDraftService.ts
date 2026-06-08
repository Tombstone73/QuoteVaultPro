import { randomUUID } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  auditLogs,
  pbv2OptionGroupTemplates,
  pbv2TreeVersions,
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
  type ProductIntakeOption,
  type ProductIntakeSession,
} from "@shared/productIntakeWizardSchemas";
import { validateOptionTreeV2, type OptionTreeV2 } from "@shared/optionTreeV2";
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
  matrixEvidence: string[];
};

type ProductIntakeAnswerLike = {
  questionKey: string;
  answer: unknown;
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

function detectMatrixPricing(brief: ProductIntakeBrief, text: string): Pick<IntakePricingAnalysis, "likelyMatrixPricing" | "candidateDimensions" | "matrixEvidence"> {
  const lower = text.toLowerCase();
  const dimensions = new Set<string>();
  const evidence: string[] = [];
  const addEvidence = (value: string) => {
    if (value && !evidence.includes(value)) evidence.push(value);
  };
  const hasQuantity = /\b(qty|quantity|quantities|breaks?|tiers?|price\s*breaks?)\b/.test(lower) ||
    /quantity|tier|matrix/i.test(`${brief.quantityBehavior.behavior} ${brief.quantityBehavior.notes ?? ""}`);
  const hasMatrixLanguage = /\b(matrix|rate\s*table|price\s*grid|pricing\s*grid|price\s*table|size\s*x\s*quantity|quantity\s*x\s*size|stock\s*x|coating\s*x)\b/i.test(text) ||
    /matrix|tier/i.test(`${brief.pricingAnalysis.behavior} ${brief.pricingAnalysis.notes ?? ""}`);
  const optionText = [...brief.requiredOptions, ...brief.optionalOptions]
    .map((option) => `${option.label} ${option.normalizedGroup}`)
    .join(" ")
    .toLowerCase();
  if (/\b(size|width|height|dimension)\b/.test(optionText) || /fixed|custom|size|dimension/i.test(brief.sizeBehavior.behavior)) dimensions.add("size");
  if (hasQuantity) dimensions.add("quantity");
  if (/\b(coating|laminate|lamination)\b/.test(optionText)) dimensions.add("coating");
  if (/\b(stock|paper|material|substrate)\b/.test(optionText)) dimensions.add("stock");
  if (/\b(side|sides|printed)\b/.test(optionText)) dimensions.add("printed_sides");
  if (/\b(size\s*x\s*quantity|quantity\s*x\s*size)\b/i.test(text)) addEvidence("Source references size x quantity pricing.");
  if (/\b(rate\s*table|price\s*grid|pricing\s*grid|matrix)\b/i.test(text)) addEvidence("Source references a pricing matrix or rate table.");
  if (/business\s*cards?|postcards?|yard\s*signs?/i.test(text) && hasQuantity && dimensions.size >= 2) addEvidence("Product category and quantity signals suggest matrix pricing.");
  return {
    likelyMatrixPricing: hasMatrixLanguage && dimensions.size >= 2,
    candidateDimensions: Array.from(dimensions),
    matrixEvidence: evidence,
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
    warnings.push("Likely matrix pricing detected. No pricing matrix was generated; configure rows in the existing PBV2 Pricing Matrix editor before publish.");
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

type DraftGroupKey = "size_quantity" | "print_setup" | "finishing" | "hardware" | "materials" | "review";
type SizeMode = "fixed_dropdown" | "custom_dimension" | "none";

const DRAFT_GROUPS: Record<DraftGroupKey, { id: string; label: string; sortOrder: number }> = {
  size_quantity: { id: "group_size_quantity", label: "Size & Quantity", sortOrder: 10 },
  print_setup: { id: "group_print_setup", label: "Print Setup", sortOrder: 20 },
  finishing: { id: "group_finishing", label: "Finishing", sortOrder: 30 },
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
  choices?: Array<{ value: string; label: string; sortOrder?: number }>;
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
  if (/grommet|pole pocket|pocket|laminate|lamination|contour|cut|rounded|corner|hem|sew|finish|shape/.test(text)) return "finishing";
  return "finishing";
}

function conceptKeyForOption(option: ProductIntakeOption): string {
  const key = safeKey(option.normalizedGroup || option.label, "option");
  if (/qty|quantity|quantities|tier|tiers/.test(key)) return "quantity";
  if (/printed?_?sides?|sides?/.test(key)) return "printed_sides";
  if (/grommet/.test(key)) return "grommets";
  if (/pole.*pocket|pocket/.test(key)) return "pole_pockets";
  if (/laminat/.test(key)) return "laminate";
  if (/contour|cut_type|die_cut|kiss_cut/.test(key)) return "cut_type";
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
    if (raw) concepts.add(safeKey(raw, "concept"));
  }
  return concepts;
}

function bestMaterialMatch(brief: ProductIntakeBrief) {
  return brief.materialAnalysis.likelyMaterialMatches
    .filter((match) => match.materialId)
    .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
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
    score -= 10;
    warnings.push("Base pricing is missing and must be configured before publish.");
  }
  if (args.pricingReadiness.likelyMatrixPricing) {
    score -= 10;
    warnings.push("Likely matrix pricing needs PBV2 pricing matrix review.");
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

  if (args.sizeMode === "fixed_dropdown") reasons.push("Fixed size list produced a Size dropdown only.");
  if (args.sizeMode === "custom_dimension") reasons.push("Custom size behavior produced a Size dimension input only.");
  if (args.skippedTemplateOptionCount > 0) reasons.push(`${args.skippedTemplateOptionCount} generic option(s) skipped because reusable templates were applied.`);
  if (groupNodes.length >= 2 && !invalidRootGroups) reasons.push("Options were organized into logical PBV2 groups.");
  reasons.push("Quote/order line item quantity remains outside customer-facing PBV2 options.");
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
  now?: Date;
}): OptionTreeV2 {
  const now = args.now ?? new Date();
  const usedNodeIds = new Set<string>();
  const usedEdgeIds = new Set<string>();
  const sizeOption = [...args.brief.requiredOptions, ...args.brief.optionalOptions].find(isSizeOption) ?? null;
  const sizeMode = resolveSizeMode(args.brief, sizeOption);
  const materialMatch = bestMaterialMatch(args.brief);
  const pricingReadiness = analyzeDraftPricing({
    brief: args.brief,
    sourceText: args.sourceText,
    sourceJson: args.sourceJson,
    answers: args.answers,
  });
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
      productIntake: {
        sessionId: args.sessionId,
        productName: args.productName,
        confidence: args.brief.overallConfidence,
        sizeMode,
        quantity: quantityMetadataForBrief(args.brief),
        pricingReadiness: {
          base: pricingReadiness.base,
          sources: pricingReadiness.sources,
          warnings: pricingReadiness.warnings,
          basePricingConfigured: hasBasePricing(pricingReadiness.base),
          likelyMatrixPricing: pricingReadiness.likelyMatrixPricing,
          candidateDimensions: pricingReadiness.candidateDimensions,
          matrixEvidence: pricingReadiness.matrixEvidence,
        },
        pricingWarnings: pricingReadiness.warnings,
        materialMatch: materialMatch ? {
          materialId: materialMatch.materialId,
          sku: materialMatch.sku,
          name: materialMatch.name,
          confidence: materialMatch.confidence,
        } : null,
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
  } else if (sizeMode === "fixed_dropdown" && sizeOption) {
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
}) {
  const productName = compactText(args.brief.productIdentity.likelyProductName.value, "Product Intake Draft");
  const material = args.brief.materialAnalysis.likelyMaterialMatches
    .filter((match) => match.materialId)
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
    pricingEngine: "pricingProfile" as const,
    pricingProfileKey: "default",
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
        const productValues = buildProductIntakeProductValues({ organizationId, productId, brief, productTypeId });
        const treeJson = buildProductIntakeDraftTree({
          brief,
          sessionId,
          productName,
          userId,
          templates: templateRows,
          sourceText: sessionRow.sourceText,
          sourceJson: sessionRow.sourceJson,
          answers: answerRows,
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
