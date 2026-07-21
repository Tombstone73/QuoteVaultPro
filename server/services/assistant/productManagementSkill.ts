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

export const productManagementSkill = Object.freeze({
  name: "product_management",
  version: "v1",
  purpose: "Conversationally prepare one validated inactive product draft using the existing Product Intake workflow.",
  allowedReadDomains: ["products", "product_categories", "pbv2_definitions", "pricing_methods", "materials", "production_routing", "option_definitions", "formula_library_metadata"],
  allowedCommands: ["products.create_inactive_draft@v1"],
  requiredPermissions: ["assistant.products.create_inactive_draft"],
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
  kind: "product_intake_summary" | "product_missing_information" | "product_material_selection" | "product_options_summary" | "product_pricing_summary" | "product_routing_summary" | "product_validation_errors" | "product_validation_warnings" | "product_draft_preview" | "action_proposal";
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
  return /\b(activate|publish|edit|update)\b[\s\S]{0,80}\b(active\s+product|product)\b/i.test(message);
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
    if (input.activeSessionId) {
      const existing = await this.deps.sessions.getSessionDetail(input.organizationId, input.activeSessionId);
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
