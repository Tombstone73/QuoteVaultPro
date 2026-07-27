import { eq } from "drizzle-orm";
import { materials, pbv2OptionGroupTemplates } from "@shared/schema";
import {
  productIntakeWizardAnalyzeRequestSchema,
  type ProductIntakeSessionDetail,
  type ProductIntakeAnswerPatchItem,
} from "@shared/productIntakeWizardSchemas";
import { db } from "../../db";
import {
  generateProductIntakeBriefWithRun,
  type ProductIntakeMaterialReference,
  type ProductIntakeTemplateReference,
} from "../productIntakeWizard/productIntakeBriefService";
import { createDbProductIntakeSessionStore, type ProductIntakeSessionStore } from "../productIntakeWizard/productIntakeSessionService";
import { assistantProductIntakeAdapter } from "./productIntakeAdapter";
import { inactiveProductDraftUpdateService, InactiveProductDraftUpdateError, type InactiveProductDraftPatch } from "./inactiveProductDraftUpdateService";
import { productIntakeDraftReadinessService } from "../productIntakeWizard/productIntakeDraftReadinessService";

export const productManagementSkill = Object.freeze({
  name: "product_management",
  version: "v1",
  purpose: "Conversationally create or continue one validated inactive product draft using the existing Product Intake workflow.",
  allowedReadDomains: ["products", "product_categories", "pbv2_definitions", "pricing_methods", "materials", "production_routing", "option_definitions", "formula_library_metadata"],
  allowedCommands: ["products.create_inactive_draft@v1", "products.update_inactive_draft@v1"],
  requiredPermissions: ["assistant.products.create_inactive_draft", "assistant.products.update_inactive_draft"],
  requiredContext: ["organization", "authenticated_internal_actor", "conversation"],
  confirmationPolicy: "dedicated_plan_confirmation",
  maximumProductScope: 1,
  promptVersion: "product-management-skill-v1",
  diagnosticsVersion: "product-intake-v1",
  dependencies: ["product-intake", "pbv2", "pricing", "materials", "routing"],
  dataClassification: "internal_catalog_configuration",
  devEnabled: true,
  mainEnabled: true,
});

export type ProductManagementCard = {
  kind: "product_intake_summary" | "product_missing_information" | "product_material_selection" | "product_options_summary" | "product_pricing_summary" | "product_routing_summary" | "product_validation_errors" | "product_validation_warnings" | "product_draft_preview" | "product_draft_snapshot" | "product_draft_readiness" | "product_draft_update_preview" | "product_draft_update_unsupported" | "product_active_product_unsupported" | "action_proposal";
  title: string;
  summary: string;
  sourceLinks: Array<{ label: string; href: string }>;
  details?: Record<string, unknown>;
  plan?: Record<string, unknown>;
};

export interface ProductManagementSkillDependencies {
  sessions: ProductIntakeSessionStore;
  references: (organizationId: string) => Promise<{ materials: ProductIntakeMaterialReference[]; templates: ProductIntakeTemplateReference[] }>;
}

async function loadReferences(organizationId: string) {
  const [materialRows, templateRows] = await Promise.all([
    db.select({ id: materials.id, sku: materials.sku, name: materials.name }).from(materials).where(eq(materials.organizationId, organizationId)),
    db.select({ id: pbv2OptionGroupTemplates.id, name: pbv2OptionGroupTemplates.name, slug: pbv2OptionGroupTemplates.slug, category: pbv2OptionGroupTemplates.category, tags: pbv2OptionGroupTemplates.tags, workflowMetadata: pbv2OptionGroupTemplates.workflowMetadata, templateTree: pbv2OptionGroupTemplates.templateTree }).from(pbv2OptionGroupTemplates).where(eq(pbv2OptionGroupTemplates.state, "active")),
  ]);
  return {
    materials: materialRows,
    templates: templateRows.map((template) => ({ ...template, tags: Array.isArray(template.tags) ? template.tags : [], workflowMetadata: template.workflowMetadata ?? {}, templateTree: template.templateTree ?? {} })),
  };
}

function isProductIntent(message: string): boolean {
  return /\b(create|build|add|clone|configure|continue)\b[\s\S]{0,80}\b(product|banner|sign|print|draft)\b/i.test(message);
}

function isUnsupportedProductMutation(message: string): boolean {
  return /\b(activate|publish)\b/i.test(message) || /\b(edit|update|change)\b[\s\S]{0,80}\bactive\s+product\b/i.test(message);
}

function cents(value: string): number | null {
  const number = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(number) && number >= 0 && number <= 100_000 ? Math.round(number * 100) : null;
}

function pricingPatchFromMessage(message: string): InactiveProductDraftPatch | null {
  const basePricing: NonNullable<InactiveProductDraftPatch["basePricing"]> = {};
  const minimum = message.match(/(?:minimum\s+charge|min(?:imum)?\s+price)\s*(?:to|at|of|=)?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
  const perSqft = message.match(/(?:per\s*(?:square\s*foot|sq\s*ft)|square\s*foot\s*(?:rate|price))\s*(?:to|at|of|=)?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
  const perPiece = message.match(/(?:per\s*piece|piece\s*(?:rate|price))\s*(?:to|at|of|=)?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (minimum) { const value = cents(minimum[1]); if (value !== null) basePricing.minimumChargeCents = value; }
  if (perSqft) { const value = cents(perSqft[1]); if (value !== null) basePricing.perSqftCents = value; }
  if (perPiece) { const value = cents(perPiece[1]); if (value !== null) basePricing.perPieceCents = value; }
  return Object.keys(basePricing).length ? { basePricing } : null;
}

function configurationPatchFromMessage(message: string): InactiveProductDraftPatch | null {
  const configuration: Record<string, unknown> = {};
  if (/\bquantity[-\s]?only\b/i.test(message)) configuration.measurementMode = "quantity_only";
  if (/\b(?:require|requires)\s+dimensions\b/i.test(message)) configuration.requiresDimensions = true;
  if (/\b(?:do not|don't|does not)\s+require\s+dimensions\b/i.test(message)) configuration.requiresDimensions = false;
  if (/\b(?:standard\s+production)\b/i.test(message)) configuration.workflowIntent = "standard_production";
  if (/\bfulfillment[-\s]?only\b/i.test(message)) configuration.workflowIntent = "fulfillment_only";
  if (/\bservice[-\s]?fee\b/i.test(message)) configuration.workflowIntent = "service_fee";
  if (/\b(?:not\s+taxable|tax[-\s]?exempt)\b/i.test(message)) configuration.isTaxable = false;
  else if (/\btaxable\b/i.test(message)) configuration.isTaxable = true;
  if (/\b(?:allow|enable)\s+rotation\b/i.test(message)) configuration.allowRotation = true;
  if (/\b(?:do not|don't|disable)\s+(?:allow\s+)?rotation\b/i.test(message)) configuration.allowRotation = false;
  const fixed = message.match(/\bfixed\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (fixed) configuration.fixedDimensions = { widthIn: Number(fixed[1]), heightIn: Number(fixed[2]), label: `${fixed[1]} × ${fixed[2]} in` };
  const category = message.match(/\b(?:category|in)\s*[:=]?\s*[“"]([^”"]{1,100})[”"]/i);
  if (category) configuration.category = category[1].trim();
  const description = message.match(/\bdescription\s*[:=]\s*(.+)$/i);
  if (description) configuration.description = description[1].trim();
  return Object.keys(configuration).length ? { configuration: configuration as any } : null;
}

function relationshipPatchFromMessage(message: string): InactiveProductDraftPatch | null {
  const relationships: Record<string, unknown> = {};
  if (/\bclear\s+(?:the\s+)?(?:route|routing|station)\b/i.test(message)) {
    relationships.routing = { operation: "clear" };
  } else {
    const station = message.match(/\b(?:route|routing|station)\s+(?:the\s+)?(?:draft\s+)?(?:to|for|as)?\s*(flatbed|roll|wide[\s-]?format|wide[\s-]?roll)\b|\b(flatbed|roll|wide[\s-]?format|wide[\s-]?roll)\s+production\b/i);
    const stationName = station?.[1] ?? station?.[2];
    if (stationName) relationships.routing = { operation: "set_primary", station: { name: stationName } };
  }
  const optionNames = ["lamination", "contour cutting", "white ink", "double-sided", "grommets", "rush"];
  const foundOptions = optionNames.filter((name) => new RegExp(`\\b${name.replace(/[\\-]/g, "[\\s-]?")}\\b`, "i").test(message));
  if (/\bclear\s+(?:all\s+)?options\b/i.test(message)) {
    relationships.options = { operation: "clear" };
  } else if (/\breplace\s+(?:the\s+)?options?\s+with\b/i.test(message)) {
    relationships.options = { operation: "replace", templates: foundOptions.map((name) => ({ name })) };
  } else if (/\bremove\b/i.test(message) && foundOptions.length) {
    relationships.options = { operation: "remove", templates: foundOptions.map((name) => ({ name })) };
  } else if (/\badd\b/i.test(message) && foundOptions.length) {
    relationships.options = { operation: "add", templates: foundOptions.map((name) => ({ name })) };
  }
  if (/\bclear\s+(?:the\s+)?(?:internal\s+)?(?:setup\s+)?note\b/i.test(message)) {
    relationships.setupNote = { operation: "clear" };
  } else {
    const replaceNote = message.match(/\breplace\s+(?:the\s+)?(?:internal\s+)?(?:setup\s+)?note\s+(?:with|:)\s*(.+)$/i);
    const addNote = message.match(/\b(?:add\s+(?:an?\s+)?(?:internal\s+)?(?:setup\s+)?note|note)\s+(?:that|:)?\s*(.+)$/i);
    const note = replaceNote?.[1] ?? addNote?.[1];
    if (note?.trim()) relationships.setupNote = { operation: replaceNote ? "replace" : "append", text: note.trim().replace(/[.]+$/, "") };
  }
  if (/\bclear\s+(?:all\s+)?(?:review\s+)?warnings\b/i.test(message)) {
    relationships.reviewWarnings = { operation: "clear" };
  } else {
    const replaceWarnings = message.match(/\breplace\s+(?:review\s+)?warnings?\s+(?:with|:)\s*(.+)$/i);
    const addWarning = message.match(/\b(?:add\s+(?:a\s+)?(?:review\s+)?warning|warning)\s*(?:that|:)?\s*(.+)$/i);
    const warning = replaceWarnings?.[1] ?? addWarning?.[1] ?? (/\bpricing\s+(?:needs?|requires?)\s+(?:a\s+)?final\s+review\b/i.test(message) ? "Pricing review required" : null);
    if (warning?.trim()) relationships.reviewWarnings = { operation: replaceWarnings ? "replace" : "add", warnings: [warning.trim().replace(/[.]+$/, "")] };
  }
  return Object.keys(relationships).length ? { relationships: relationships as any } : null;
}

function draftLookupFromMessage(message: string): { productId?: string; productName?: string; category?: string } | null {
  const id = message.match(/\b(?:product|draft)\s*(?:id\s*)?[#:]+\s*([a-z0-9][a-z0-9_-]{7,})\b/i);
  if (id) return { productId: id[1] };
  const namedInCategory = message.match(/\b(?:change|update|edit|configure)\s+(?:the\s+)?(.{1,255}?)\s+draft\s+in\s+([^,.]{1,100})/i);
  if (namedInCategory) return { productName: namedInCategory[1].trim(), category: namedInCategory[2].trim() };
  const categoryNamed = message.match(/\b(.{1,100}?)\s+category\s+product\s+named\s+(.{1,255})\s*$/i);
  if (categoryNamed) return { category: categoryNamed[1].trim(), productName: categoryNamed[2].trim() };
  const quoted = message.match(/\b(?:product|draft)\s*[“"]([^”"]{1,255})[”"]/i);
  if (quoted) return { productName: quoted[1].trim() };
  const namedDraft = message.match(/\b(?:change|update|edit|configure)\s+(?:the\s+)?(.{1,255}?)\s+(?:product\s+)?draft\b/i);
  if (namedDraft) return { productName: namedDraft[1].trim() };
  return null;
}

function money(centsValue: number | null | undefined): string {
  return centsValue == null ? "Not set" : `$${(centsValue / 100).toFixed(2)}`;
}

function unsupportedDraftChange(message: string): boolean {
  return /\b(option|grommet|hem|pole\s*pocket|single[-\s]?sided|double[-\s]?sided|material|route|routing|prepress|station|default)\b/i.test(message);
}

function isDraftReadinessRequest(message: string): boolean {
  return /\b(?:ready\s+to\s+activate|what(?:'s|\s+is)\s+(?:still\s+)?missing|incomplete|readiness|finish\s+before\s+activat)/i.test(message);
}

function draftReadinessListRequest(message: string): { filter: "incomplete" | "pricing" | "routing" | "material" | "dimensions" | "review_warnings" | "ready" | "needs_review"; category?: string; productName?: string } | null {
  if (!/\b(?:drafts?|products?)\b/i.test(message) || !/\b(?:incomplete|missing|need|ready|review|pricing|routing|material|dimension)\b/i.test(message)) return null;
  const category = message.match(/\bcategory\s*[=:]?\s*[“"]?([^,.”"]{1,100})/i)?.[1]?.trim();
  const productName = message.match(/\b(?:named|matching)\s*[“"]([^”"]{1,160})[”"]/i)?.[1]?.trim();
  const filter = /\bpricing\b/i.test(message) ? "pricing" : /\b(?:routing|route|station)\b/i.test(message) ? "routing" : /\bmaterials?\b/i.test(message) ? "material" : /\bdimensions?\b/i.test(message) ? "dimensions" : /\bneed(?:s)?\s+review\b/i.test(message) ? "needs_review" : /\breview\b/i.test(message) ? "review_warnings" : /\bready\b/i.test(message) ? "ready" : "incomplete";
  return { filter, ...(category ? { category } : {}), ...(productName ? { productName } : {}) };
}

function readinessCard(readiness: Awaited<ReturnType<typeof productIntakeDraftReadinessService.reviewDraft>>, editorLink: string): ProductManagementCard {
  return {
    kind: "product_draft_readiness",
    title: `Draft readiness: ${readiness.productName}`,
    summary: readiness.status === "ready_for_human_activation"
      ? "This inactive PBV2 DRAFT is ready for human activation review; the assistant did not activate it."
      : `This inactive PBV2 DRAFT is ${readiness.status.replaceAll("_", " ")}.`,
    sourceLinks: [{ label: "Open existing product editor", href: editorLink }],
    details: {
      productId: readiness.productId,
      status: readiness.status,
      blockers: readiness.blockers.map((item) => item.message),
      warnings: readiness.warnings.map((item) => item.message),
      unknowns: readiness.unknowns.map((item) => item.message),
      completed: readiness.completed,
      supportedAutomaticFixes: readiness.supportedAutomaticFixes.map((item) => ({ code: item.code, action: item.suggestedAction })),
      unsupportedManualFixes: readiness.unsupportedManualFixes.map((item) => ({ code: item.code, action: item.suggestedAction })),
      internalSetupNote: readiness.internalSetupNote,
      reviewWarnings: readiness.reviewWarnings,
      derivedMissingFieldWarnings: readiness.derivedMissingFieldWarnings,
      fingerprint: readiness.fingerprint,
    },
  };
}

function answerFor(question: ProductIntakeSessionDetail["questions"][number], message: string): ProductIntakeAnswerPatchItem | null {
  const text = message.trim();
  if (!text || /^go[.!\s]*$/i.test(text)) return null;
  if (question.questionType === "boolean") {
    if (/^(yes|y|true)$/i.test(text)) return { questionKey: question.questionKey, answer: true };
    if (/^(no|n|false)$/i.test(text)) return { questionKey: question.questionKey, answer: false };
    return null;
  }
  if (question.questionType === "number") {
    const value = Number(text.replace(/[$,]/g, ""));
    return Number.isFinite(value) ? { questionKey: question.questionKey, answer: value } : null;
  }
  const options = question.options ?? [];
  const matched = options.find((option) => String(option.value).toLowerCase() === text.toLowerCase() || option.label.toLowerCase() === text.toLowerCase());
  if (matched) return { questionKey: question.questionKey, answer: matched.value };
  return question.questionType === "text" ? { questionKey: question.questionKey, answer: text } : null;
}

async function cardsFor(detail: ProductIntakeSessionDetail): Promise<ProductManagementCard[]> {
  const missing = detail.questions.filter((question) => question.required && !detail.answers.some((answer) => answer.questionKey === question.questionKey && answer.answer !== null));
  const productName = detail.brief.productIdentity.likelyProductName.value || "New product";
  const common = { productName, category: detail.brief.productIdentity.category.value, draftStatus: detail.session.status };
  const cards: ProductManagementCard[] = [{
    kind: "product_intake_summary", title: "Product Intake", summary: `Structured Product Intake session for ${productName}.`, sourceLinks: [{ label: "Open existing Product Intake review", href: `/admin/catalog-migration-lab/${detail.session.id}` }],
    details: { ...common, sessionId: detail.session.id, assumptions: detail.brief.draftWarnings.map((warning) => warning.message).slice(0, 10) },
  }];
  if (missing.length) {
    cards.push({ kind: "product_missing_information", title: "Information needed", summary: "Answer the unresolved required Product Intake question in your next message.", sourceLinks: [], details: { questions: missing.slice(0, 1).map((question) => question.helpText ? `${question.label} — ${question.helpText}` : question.label) } });
  }
  if (detail.brief.materialAnalysis.likelyMaterialMatches.length) cards.push({ kind: "product_material_selection", title: "Material references", summary: "Existing materials are only proposed for reuse; no material record will be created.", sourceLinks: [], details: { items: detail.brief.materialAnalysis.likelyMaterialMatches.map((material) => material.name) } });
  if (detail.brief.requiredOptions.length) cards.push({ kind: "product_options_summary", title: "Options", summary: "Existing Product Intake and PBV2 validation remain authoritative.", sourceLinks: [], details: { items: detail.brief.requiredOptions.map((option) => option.label) } });
  cards.push({ kind: "product_pricing_summary", title: "Pricing basis", summary: "Pricing is server-validated. High-impact pricing assumptions are never silently inferred.", sourceLinks: [], details: { pricingBasis: detail.brief.pricingAnalysis.behavior || "Unresolved" } });
  cards.push({ kind: "product_routing_summary", title: "Production routing", summary: "Existing routing is reused only after Product Intake validation.", sourceLinks: [], details: { routing: detail.brief.quantityBehavior.behavior || "Unresolved" } });
  const blockers = (detail.readiness.penalties ?? []).filter((penalty) => penalty.severity === "blocker").map((penalty) => penalty.label);
  if (blockers.length) cards.push({ kind: "product_validation_errors", title: "Validation blocks draft creation", summary: "Resolve these server-derived checks before confirmation is available.", sourceLinks: [], details: { errors: blockers } });
  const warnings = detail.brief.draftWarnings.map((warning) => warning.message);
  if (warnings.length) cards.push({ kind: "product_validation_warnings", title: "Draft warnings", summary: "Review these assumptions before creating an inactive draft.", sourceLinks: [], details: { warnings } });
  if (!missing.length && detail.readiness.canCreateDraft && detail.session.status === "ready_for_draft") {
    const proposal = await assistantProductIntakeAdapter.buildProposal({ organizationId: detail.session.organizationId, sessionId: detail.session.id });
    cards.push({ kind: "product_draft_preview", title: "Inactive product draft preview", summary: proposal.preview.summary, sourceLinks: [proposal.sourceLink], details: { ...common, statusToCreate: "inactive_draft", reusedRecords: ["validated materials", "validated routing"], assumptions: warnings } });
    cards.push({ kind: "action_proposal", title: "Create inactive product draft", summary: "Review the server-generated plan and use its dedicated GO control to create one inactive draft.", sourceLinks: [], plan: { action: "products.create_inactive_draft", intakeSessionId: detail.session.id, proposalFingerprint: proposal.fingerprint } });
  }
  return cards;
}

export class ProductManagementSkillService {
  constructor(private readonly deps: ProductManagementSkillDependencies = { sessions: createDbProductIntakeSessionStore(), references: loadReferences }) {}

  async respond(input: { organizationId: string; userId: string; message: string; activeSessionId?: string | null }): Promise<{ handled: boolean; response: string; cards: ProductManagementCard[] }> {
    if (isUnsupportedProductMutation(input.message)) return { handled: true, response: "Product activation, publication, and active-product editing are not available through the assistant. I can prepare a new inactive draft instead.", cards: [{ kind: "product_validation_errors", title: "Unsupported product action", summary: "Only a new inactive product draft can be proposed.", sourceLinks: [], details: { errors: ["Activation, publication, and active-product editing are disabled."] } }] };
    const listRequest = draftReadinessListRequest(input.message);
    if (listRequest && !input.activeSessionId) {
      const result = await productIntakeDraftReadinessService.listDrafts({ organizationId: input.organizationId, ...listRequest });
      return {
        handled: true,
        response: result.items.length ? `Found ${result.items.length} inactive PBV2 DRAFT product(s) matching this readiness filter. No product was changed.` : "No inactive PBV2 DRAFT products matched this readiness filter.",
        cards: [{ kind: "product_draft_readiness", title: "Inactive draft readiness", summary: "Read-only readiness list. Products remain inactive DRAFT.", sourceLinks: [], details: { filter: listRequest.filter, items: result.items, hasMore: result.hasMore, limit: result.limit, offset: result.offset } }],
      };
    }
    if (!input.activeSessionId) {
      const lookup = draftLookupFromMessage(input.message);
      if (lookup) {
        const matches = await inactiveProductDraftUpdateService.findInactiveDraftMatches({ organizationId: input.organizationId, ...lookup });
        if (matches.length === 1) return this.respond({ ...input, activeSessionId: matches[0].sessionId });
        if (matches.length > 1) return {
          handled: true,
          response: "More than one inactive draft matches. Specify the product ID to choose one; no draft was changed.",
          cards: [{ kind: "product_draft_update_unsupported", title: "Choose one inactive draft", summary: "The assistant will not guess when multiple inactive drafts match.", sourceLinks: [], details: { matches: matches.map((match) => ({ productId: match.productId, productName: match.productName, category: match.category })) } }],
        };
        return { handled: true, response: "No eligible inactive Product Intake draft matched that identifier. Active or published products cannot be updated here.", cards: [{ kind: "product_active_product_unsupported", title: "Inactive draft not found", summary: "Only an organization-owned inactive product with a PBV2 DRAFT tree can be edited.", sourceLinks: [], details: { lookup } }] };
      }
    }
    if (input.activeSessionId) {
      const existing = await this.deps.sessions.getSessionDetail(input.organizationId, input.activeSessionId);
      if (existing?.session.status === "draft_created") {
        try {
          const snapshot = await inactiveProductDraftUpdateService.loadSnapshot({ organizationId: input.organizationId, sessionId: existing.session.id });
          const snapshotCard: ProductManagementCard = { kind: "product_draft_snapshot", title: "Current inactive draft", summary: `Loaded the current inactive draft for ${snapshot.productName}.`, sourceLinks: [{ label: "Open existing product editor", href: snapshot.editorLink }], details: { productName: snapshot.productName, draftStatus: "inactive_draft", editorPath: snapshot.editorLink, fields: { "PBV2 status": snapshot.pbv2Status, "Readiness": snapshot.readiness.status, "Base rate / sq ft": money(snapshot.pricingBase.perSqftCents), "Base rate / piece": money(snapshot.pricingBase.perPieceCents), "Minimum charge": money(snapshot.pricingBase.minimumChargeCents), "Primary routing station": snapshot.relationships.routing?.stationName ?? "Not set", "Option templates": snapshot.relationships.optionTemplates.map((item) => item.name).join(", ") || "None", "Internal setup note": snapshot.relationships.setupNote ?? "None" }, warnings: [...snapshot.readiness.warnings, ...snapshot.relationships.reviewWarnings, ...snapshot.relationships.missingFieldWarnings], validationErrors: snapshot.readiness.findings } };
          if (isDraftReadinessRequest(input.message)) {
            const readiness = await productIntakeDraftReadinessService.reviewDraft({ organizationId: input.organizationId, sessionId: existing.session.id });
            const response = readiness.status === "ready_for_human_activation"
              ? `${readiness.productName} is ready for human activation review. It remains inactive with a PBV2 DRAFT tree; activation must use the normal product administration workflow.`
              : `${readiness.productName} is not ready for human activation. I found ${readiness.blockers.length} blocker(s), ${readiness.warnings.length} warning(s), and ${readiness.unknowns.length} unknown check(s).`;
            return { handled: true, response, cards: [snapshotCard, readinessCard(readiness, snapshot.editorLink)] };
          }
          if (/\bfix\s+(?:everything|all)\s+safe\b/i.test(input.message)) {
            const readiness = await productIntakeDraftReadinessService.reviewDraft({ organizationId: input.organizationId, sessionId: existing.session.id });
            const fixable = readiness.supportedAutomaticFixes;
            const response = fixable.length
              ? "I reviewed the draft. The remaining supported changes must use separate confirmation plans for pricing, core configuration, and routing/options. I need explicit safe values for missing prices, materials, or stations before I can prepare any plan; nothing was changed."
              : "I found no safely inferable change to plan. The draft remains inactive DRAFT and any manual findings should be resolved in the product editor.";
            return { handled: true, response, cards: [snapshotCard, readinessCard(readiness, snapshot.editorLink)] };
          }
          const patch = pricingPatchFromMessage(input.message);
          const configurationPatch = patch ? null : configurationPatchFromMessage(input.message);
          const relationshipPatch = patch || configurationPatch ? null : relationshipPatchFromMessage(input.message);
          const requestedPatch = patch ?? configurationPatch ?? relationshipPatch;
          if (requestedPatch) {
            const proposal = await inactiveProductDraftUpdateService.buildProposal({ organizationId: input.organizationId, sessionId: existing.session.id, patch: requestedPatch });
            const changes = requestedPatch.basePricing ? (Object.keys(requestedPatch.basePricing) as Array<keyof typeof requestedPatch.basePricing>).map((key) => ({ field: key === "minimumChargeCents" ? "Minimum charge" : key === "perSqftCents" ? "Base rate per square foot" : "Base rate per piece", before: money(proposal.before.pricingBase[key]), after: money(requestedPatch.basePricing![key]) })) : requestedPatch.configuration ? (Object.keys(requestedPatch.configuration) as string[]).map((key) => ({ field: key, before: (proposal.before.configuration as any)[key] ?? null, after: (requestedPatch.configuration as any)[key] ?? null })) : [
              requestedPatch.relationships?.routing ? { field: "Production routing", before: proposal.before.relationships.routing?.stationName ?? null, after: requestedPatch.relationships.routing.operation === "clear" ? null : requestedPatch.relationships.routing.station?.id ?? requestedPatch.relationships.routing.station?.key ?? requestedPatch.relationships.routing.station?.name ?? null } : null,
              requestedPatch.relationships?.options ? { field: "Option templates", before: proposal.before.relationships.optionTemplates.map((item) => item.name).join(", ") || null, after: `${requestedPatch.relationships.options.operation}: ${(requestedPatch.relationships.options.templates ?? []).map((item) => item.id ?? item.key ?? item.name).join(", ")}` } : null,
              requestedPatch.relationships?.setupNote ? { field: "Internal setup note", before: proposal.before.relationships.setupNote, after: requestedPatch.relationships.setupNote.operation === "clear" ? null : requestedPatch.relationships.setupNote.text ?? null } : null,
              requestedPatch.relationships?.reviewWarnings ? { field: "Review warnings", before: proposal.before.relationships.reviewWarnings.join("; ") || null, after: requestedPatch.relationships.reviewWarnings.operation === "clear" ? null : (requestedPatch.relationships.reviewWarnings.warnings ?? []).join("; ") } : null,
            ].filter(Boolean);
            const preview: ProductManagementCard = { kind: "product_draft_update_preview", title: "Proposed inactive-draft update", summary: "This is a server-built before-and-after preview. The product remains inactive and its PBV2 tree remains DRAFT.", sourceLinks: [{ label: "Open existing product editor", href: proposal.before.editorLink }], details: { productName: proposal.before.productName, draftStatus: "inactive_draft", editorPath: proposal.before.editorLink, changes, warnings: proposal.before.readiness.warnings, validationErrors: proposal.before.readiness.findings } };
            return { handled: true, response: "I prepared a precise inactive-draft patch. Review the before-and-after values and create a dedicated confirmation plan.", cards: [snapshotCard, preview, { kind: "action_proposal", title: "Update inactive product draft", summary: "Review the server-generated plan and use its dedicated GO control to apply this patch once.", sourceLinks: [], plan: { action: "products.update_inactive_draft", productIntakeSessionId: existing.session.id, intakeSessionId: existing.session.id, proposalFingerprint: proposal.fingerprint, patch: requestedPatch } }] };
          }
          if (unsupportedDraftChange(input.message)) return { handled: true, response: "That draft change is not available through the assistant because there is not yet a narrow canonical patch service for it. Use the existing editor for this precision change.", cards: [snapshotCard, { kind: "product_draft_update_unsupported", title: "Draft change requires the existing editor", summary: "The assistant only supports the canonical transactional base-pricing patch for inactive drafts in this milestone.", sourceLinks: [{ label: "Open existing product editor", href: snapshot.editorLink }], details: { editorPath: snapshot.editorLink, unsupportedReasons: ["Options/defaults, materials, and routing do not have a safe assistant-facing canonical update service yet."] } }] };
          return { handled: true, response: "I loaded this inactive draft. Specify a base rate per square foot, base rate per piece, or minimum charge to prepare a safe pricing update; other draft changes remain available in the existing editor.", cards: [snapshotCard] };
        } catch (error) {
          const message = error instanceof InactiveProductDraftUpdateError ? error.message : "This product draft is not eligible for conversational editing.";
          return { handled: true, response: message, cards: [{ kind: "product_active_product_unsupported", title: "Draft editing unavailable", summary: message, sourceLinks: [], details: { unsupportedReasons: ["Only organization-owned inactive Product Intake drafts with a PBV2 DRAFT tree are eligible."] } }] };
        }
      }
      if (existing && !["draft_created", "abandoned"].includes(existing.session.status)) {
        const next = existing.questions.find((question) => question.required && !existing.answers.some((answer) => answer.questionKey === question.questionKey && answer.answer !== null));
        const answer = next ? answerFor(next, input.message) : null;
        if (next && !answer && !isProductIntent(input.message)) return { handled: true, response: `I still need: ${next.label}`, cards: await cardsFor(existing) };
        const detail = answer ? await this.deps.sessions.upsertAnswers({ organizationId: input.organizationId, sessionId: existing.session.id, userId: input.userId, answers: [answer] }) : existing;
        if (detail) return { handled: true, response: detail.readiness.canCreateDraft ? "The Product Intake proposal is ready for a dedicated inactive-draft plan review." : "I saved that answer. I will ask only the next required Product Intake question.", cards: await cardsFor(detail) };
      }
    }
    if (!isProductIntent(input.message)) return { handled: false, response: "", cards: [] };
    const request = productIntakeWizardAnalyzeRequestSchema.parse({ sourceType: "text_description", description: input.message });
    const references = await this.deps.references(input.organizationId);
    const generated = await generateProductIntakeBriefWithRun({ orgId: input.organizationId, request, analyzer: null, templates: references.templates, materials: references.materials, createdByUserId: input.userId });
    const detail = await this.deps.sessions.createFromAnalysis({ organizationId: input.organizationId, userId: input.userId, request, analyzer: null, brief: generated.brief });
    return { handled: true, response: detail.readiness.canCreateDraft ? "I prepared a server-validated Product Intake proposal for one inactive draft." : "I created a structured Product Intake session and will ask only the required follow-up questions.", cards: await cardsFor(detail) };
  }
}

export const productManagementSkillService = new ProductManagementSkillService();
