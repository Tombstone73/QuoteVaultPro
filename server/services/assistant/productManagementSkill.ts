import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { materials, pbv2OptionGroupTemplates, pbv2TreeVersions, products, productTypes, stations } from "@shared/schema";
import { CanonicalProductIntentService, type CanonicalProductIntentInspection, type CanonicalProductIntentOutcome, type CanonicalProductIntentRecovery } from "../productIntentCompiler/canonicalProductIntentService";
import type { ProductDraftIntent } from "@shared/productDraftIntent";
import { projectProductDraftIntentToProductBuilderDraft } from "../productIntentCompiler/productIntentProjection";
import { evaluatePricingPreviewFromTree } from "../pricing/PricingService";
import { createConfiguredProductIntentCompiler, type ProductIntentCompilerInput } from "../productIntentCompiler/productIntentCompiler";
import { DrizzleCanonicalProductIntentProposalStore, ProductIntentPersistenceService, type CanonicalProductIntentSession } from "../productIntentCompiler/productIntentPersistence";
import {
  productIntakeWizardAnalyzeRequestSchema,
  type ProductIntakeSessionDetail,
  type ProductIntakeAnswerPatchItem,
  type ProductIntakeBrief,
} from "@shared/productIntakeWizardSchemas";
import { db } from "../../db";
import {
  generateProductIntakeBrief,
  generateProductIntakeBriefWithRun,
  type ProductIntakeMaterialReference,
  type ProductIntakeTemplateReference,
} from "../productIntakeWizard/productIntakeBriefService";
import { createDbProductIntakeSessionStore, type ProductIntakeSessionStore } from "../productIntakeWizard/productIntakeSessionService";
import { assistantProductIntakeAdapter } from "./productIntakeAdapter";
import { inactiveProductDraftUpdateService, InactiveProductDraftUpdateError, type InactiveProductDraftPatch } from "./inactiveProductDraftUpdateService";
import { clonePricingPatchFromMessage, pricingPatchFromMessage } from "./productManagementPricingParsing";
import { productIntakeDraftReadinessService } from "../productIntakeWizard/productIntakeDraftReadinessService";
import { applyProductDraftBatchCollisions, classifyProductIntakeRouting, fingerprintProductInactiveDraftBatch, parseProductInactiveDraftBatch } from "./productInactiveDraftBatchService";
import { productInactiveDraftBatchCommandName } from "./execution/productInactiveDraftBatchCommand";
import { productInactiveDraftBulkUpdateCommandName } from "./execution/productInactiveDraftBulkUpdateCommand";
import { productInactiveDraftBulkUpdateProposalService } from "./productInactiveDraftBulkUpdateProposalService";
import { productDraftBulkUpdateResumeEligibility } from "./productInactiveDraftBulkUpdateRecovery";
import { productInactiveDraftBulkUpdateHistoryService } from "./productInactiveDraftBulkUpdateHistoryService";
import { productInactiveDraftBatchHistoryService } from "./productInactiveDraftBatchHistoryService";
import { productDraftBatchResumeEligibility, summarizeProductDraftBatch } from "./productInactiveDraftBatchPresentation";
import { productPricingChangeSetCommandName, productPricingRollbackCommandName } from "./execution/productPricingChangeSetCommand";
import { productPricingChangeSetService } from "./execution/productPricingChangeSetAdapter";
import { pricingChangeRequestFromMessage } from "./productPricingChangeSetParsing";
import { productPricingChangeSetStore } from "./productPricingChangeSetDb";
import { configurableProductDraftCommandName } from "./execution/configurableProductDraftCommand";
import { canonicalProductIntentDraftCommandName } from "./execution/canonicalProductIntentDraftCommand";
import { measurementModeQuestion } from "./complexProductSpecification";
import { getComplexProductConfirmation, persistComplexProductProposal, resolveConfigurableProductContinuation, updateComplexProductProposal } from "./complexProductDraftPersistence";
import { CloneInactiveProductDraftError, CloneInactiveProductDraftService } from "./cloneInactiveProductDraftService";
import { createDrizzleCloneInactiveProductDraftStore } from "./cloneInactiveProductDraftPersistence";
import { cloneInactiveProductDraftCommandName } from "./execution/cloneInactiveProductDraftCommand";
import { InactivePbv2PricingMatrixEditService } from "./inactivePbv2PricingMatrixEditService";
import { createDrizzleInactivePbv2PricingMatrixEditStore } from "./inactivePbv2PricingMatrixEditPersistence";
import { inactivePbv2PricingMatrixEditCommandName } from "./execution/inactivePbv2PricingMatrixEditCommand";
import { matrixReplacementFromTable } from "./inactivePbv2PricingMatrixTableParser";
import { InactivePbv2QuantityTierEditService } from "./inactivePbv2QuantityTierEditService";
import { createDrizzleInactivePbv2QuantityTierEditStore } from "./inactivePbv2QuantityTierEditPersistence";
import { inactivePbv2QuantityTierEditCommandName } from "./execution/inactivePbv2QuantityTierEditCommand";
import { ProductCandidateSelectionContinuationError, ProductCandidateSelectionContinuationService, type ProductCandidateSelectionCandidate } from "./productCandidateSelectionContinuation";
import { createDrizzleProductCandidateSelectionContinuationStore } from "./productCandidateSelectionContinuationPersistence";
import { hasCompleteNaturalLanguageQuantityTiers } from "../productIntakeWizard/quantityTierParsing";

export const productManagementSkill = Object.freeze({
  name: "product_management",
  version: "v1",
  purpose: "Conversationally create or continue validated inactive product drafts using the existing Product Intake workflow.",
  allowedReadDomains: ["products", "product_categories", "pbv2_definitions", "pricing_methods", "materials", "production_routing", "option_definitions", "formula_library_metadata"],
  allowedCommands: ["products.create_inactive_draft@v1", "products.create_inactive_draft_batch@v1", "products.update_inactive_draft@v1", "products.update_inactive_draft_batch@v1", "products.adjust_pricing@v1", "products.rollback_pricing_change_set@v1", "products.create_configurable_draft@v1", "products.create_from_canonical_intent@v1", "products.clone_to_inactive_draft@v1", "products.replace_inactive_matrix@v1", "products.replace_inactive_quantity_tiers@v1"],
  requiredPermissions: ["assistant.products.create_inactive_draft", "assistant.products.create_inactive_draft_batch", "assistant.products.update_inactive_draft", "assistant.products.update_inactive_draft_batch", "assistant.products.adjust_pricing"],
  requiredContext: ["organization", "authenticated_internal_actor", "conversation"],
  confirmationPolicy: "dedicated_plan_confirmation",
  maximumProductScope: 25,
  promptVersion: "product-management-skill-v1",
  diagnosticsVersion: "product-intake-v1",
  dependencies: ["product-intake", "pbv2", "pricing", "materials", "routing"],
  dataClassification: "internal_catalog_configuration",
  devEnabled: true,
  mainEnabled: true,
});

export type ProductManagementCard = {
  kind: "product_intake_summary" | "product_missing_information" | "product_material_selection" | "product_options_summary" | "product_pricing_summary" | "product_routing_summary" | "product_validation_errors" | "product_validation_warnings" | "product_draft_preview" | "product_draft_snapshot" | "product_draft_readiness" | "product_draft_update_preview" | "product_draft_update_unsupported" | "product_active_product_unsupported" | "product_batch_preview" | "product_candidate_selection" | "canonical_product_intent_proposal" | "action_proposal";
  title: string;
  summary: string;
  sourceLinks: Array<{ label: string; href: string }>;
  details?: Record<string, unknown>;
  plan?: Record<string, unknown>;
};

function unsupportedProductDetailNotice(operations: unknown): string {
  return Array.isArray(operations) && operations.some((operation) => operation && typeof operation === "object"
    && (operation as { op?: unknown; detail?: unknown }).op === "record_unsupported_detail"
    && (operation as { detail?: unknown }).detail === "customer_specific_availability")
    ? " Customer-specific availability cannot currently be encoded, but I kept the supported product details in this draft."
    : "";
}

/** Reduced server-derived product state for a later Operator turn. It carries
 * only business labels and outstanding decisions, never canonical patches,
 * tenant record IDs, fingerprints, or PBV2 structures. */
export type ActiveSemanticProductDraftContext = {
  name: string;
  category: { state: "resolved" | "unresolved"; label: string; provenance: "explicit_user" | "structured_candidate" | "ai_interpreted" | "selected_template" | "canonical_default" | "unresolved" };
  material: { state: "resolved" | "unresolved" | "explicitly_unset"; label: string | null; provenance: string };
  measurementMode: "dimensions_required" | "quantity_only" | "fixed_size";
  pricing: { model: string; basis: string | null; optionGroup: string | null; rates: Array<{ option: string; priceCents: number }> };
  optionGroups: Array<{ label: string; required: boolean; selectionMode: "single" | "multiple"; defaultValue: string | null; values: Array<{ label: string; priceImpactPercent: number | null; totalPercentWhenEnabled: { percent: number; prerequisite: { optionGroup: string; value: string } } | null }>; availableWhen: { optionGroup: string; value: string } | null }>;
  outstandingDecisions: Array<{ path: string; question: string; choices: string[] }>;
  unsupportedDetails: string[];
  /** Server-derived labels of the business fields most recently established
   * in this draft. This is reflection context, never a patch/revision API. */
  recentBusinessOperations: string[];
  trustedSelections: Array<{ field: string; label: string; provenance: string }>;
  readyForReview: boolean;
};

export interface ProductManagementSkillDependencies {
  sessions: ProductIntakeSessionStore;
  references: (organizationId: string) => Promise<{ materials: ProductIntakeMaterialReference[]; templates: ProductIntakeTemplateReference[] }>;
  findProductsByNormalizedName?: (organizationId: string, normalizedName: string) => Promise<Array<{ id: string; name: string; isActive: boolean }>>;
  canonicalProductIntent?: CanonicalProductIntentRouter;
}

/** Small routing boundary: canonical compiler/persistence stays independently
 * testable, while this skill only selects it after operation classification. */
export interface CanonicalProductIntentRouter {
  loadForConversation(input: { organizationId: string; actorUserId: string; conversationId: string }): Promise<CanonicalProductIntentSession | null>;
  begin?(input: { organizationId: string; actorUserId: string; conversationId: string }): Promise<CanonicalProductIntentOutcome>;
  create(input: { organizationId: string; actorUserId: string; conversationId: string; request: string }): Promise<CanonicalProductIntentOutcome>;
  continue(input: { organizationId: string; actorUserId: string; proposalId: string; request: string }): Promise<CanonicalProductIntentOutcome>;
  /** Semantic active-draft changes bypass the provider-only compiler protocol.
   * The router still reloads tenant-scoped canonical state server-side. */
  applySemanticOperations?(input: { organizationId: string; actorUserId: string; proposalId: string; request: string; operations: unknown }): Promise<CanonicalProductIntentOutcome>;
  inspect?(input: { organizationId: string; actorUserId: string; proposalId: string }): Promise<CanonicalProductIntentInspection>;
  interact?(input: { organizationId: string; actorUserId: string; proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }): Promise<CanonicalProductIntentOutcome | { navigation: { href: string; abandon: boolean; conversationId: string; cloneProductId?: string } }>;
}

function compilerInput(orgId: string, request: string, candidates: { categories: Array<{ label: string }>; materials: Array<{ label: string }>; productionRoutes: Array<{ label: string }> }): ProductIntentCompilerInput {
  return {
    orgId, request, operationContext: { operation: "new_product" },
    schemaDescription: "Strict ProductIntentCompilerResult JSON for ProductDraftIntent contract version 1.",
    allowedEnums: { operation: ["new_product"], lifecycleStatus: ["inactive"], pricingUnit: ["per_piece", "per_square_foot", "per_hour", "flat_fee", "unresolved"], workflow: ["standard_production", "fulfillment_only", "service_fee"] },
    supportedArchetypes: ["standard_production", "fulfillment_only", "service_fee"],
    candidateLabels: { categories: candidates.categories.map((item) => item.label), materials: candidates.materials.map((item) => item.label), productionRoutes: candidates.productionRoutes.map((item) => item.label) },
    serverConstraints: ["Create one inactive, unpublished product only.", "Do not invent tenant IDs; use supplied labels only."],
  };
}

/** Production composition is deliberately lazy so pure routing tests never
 * initialize a provider or a database connection. */
export class ConfiguredCanonicalProductIntentRouter implements CanonicalProductIntentRouter {
  private readonly persistence = new ProductIntentPersistenceService(new DrizzleCanonicalProductIntentProposalStore());
  private async candidates(organizationId: string): Promise<{ categories: Array<{ id: string; label: string }>; materials: Array<{ id: string; label: string }>; productionRoutes: Array<{ id: string; label: string }>; existingProducts: Array<{ id: string; name: string; isActive: boolean; cloneSupported: boolean }> }> {
    const [categoryRows, materialRows, routeRows, existingProducts] = await Promise.all([
      db.select({ id: productTypes.id, label: productTypes.name }).from(productTypes).where(eq(productTypes.organizationId, organizationId)),
      db.select({ id: materials.id, label: materials.name }).from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.isActive, true))),
      db.select({ id: stations.id, label: stations.name }).from(stations).where(and(eq(stations.organizationId, organizationId), eq(stations.active, true))),
      db.select({ id: products.id, name: products.name, isActive: products.isActive }).from(products).where(eq(products.organizationId, organizationId)),
    ]);
    // Canonical duplicate resolution only advertises cloning after a dedicated
    // clone proposal has been prepared. This listing has not done that work,
    // so it must not imply that a source can be cloned yet.
    return { categories: categoryRows, materials: materialRows, productionRoutes: routeRows, existingProducts: existingProducts.map((product) => ({ ...product, cloneSupported: false })) };
  }
  private async service(organizationId: string): Promise<{ service: CanonicalProductIntentService; candidates: { categories: Array<{ id: string; label: string }>; materials: Array<{ id: string; label: string }>; productionRoutes: Array<{ id: string; label: string }>; existingProducts: Array<{ id: string; name: string; isActive: boolean; cloneSupported: boolean }> } } | null> {
    const compiler = await createConfiguredProductIntentCompiler();
    if (!compiler) return null;
    const candidates = await this.candidates(organizationId);
    return { candidates, service: new CanonicalProductIntentService(compiler, this.persistence, candidates, {
      duplicateName: async (name) => candidates.existingProducts.some((product) => normalizeProductReference(product.name) === normalizeProductReference(name)),
    }) };
  }
  private async semanticService(organizationId: string) {
    const candidates = await this.candidates(organizationId);
    return new CanonicalProductIntentService(null, this.persistence, candidates, {
      duplicateName: async (name) => candidates.existingProducts.some((product) => normalizeProductReference(product.name) === normalizeProductReference(name)),
    });
  }
  loadForConversation(input: { organizationId: string; actorUserId: string; conversationId: string }) { return this.persistence.loadForConversation(input); }
  async begin(input: { organizationId: string; actorUserId: string; conversationId: string }): Promise<CanonicalProductIntentOutcome> {
    return (await this.semanticService(input.organizationId)).begin(input);
  }
  async inspect(input: { organizationId: string; actorUserId: string; proposalId: string }) {
    // Inspection deliberately avoids provider configuration and compiler use.
    const candidates = await this.candidates(input.organizationId);
    return new CanonicalProductIntentService(null, this.persistence, candidates, {
      duplicateName: async (name) => candidates.existingProducts.some((product) => normalizeProductReference(product.name) === normalizeProductReference(name)),
    }).inspect(input);
  }
  async create(input: { organizationId: string; actorUserId: string; conversationId: string; request: string }): Promise<CanonicalProductIntentOutcome> {
    const configured = await this.service(input.organizationId);
    if (!configured) return { ok: false, code: "PRODUCT_INTENT_PROVIDER_UNAVAILABLE", message: "Product interpretation is unavailable until a compatible AI provider is configured." };
    return configured.service.create({ ...input, compilerInput: compilerInput(input.organizationId, input.request, configured.candidates) });
  }
  async continue(input: { organizationId: string; actorUserId: string; proposalId: string; request: string }): Promise<CanonicalProductIntentOutcome> {
    const configured = await this.service(input.organizationId);
    if (!configured) return { ok: false, code: "PRODUCT_INTENT_PROVIDER_UNAVAILABLE", message: "Product interpretation is unavailable until a compatible AI provider is configured." };
    return configured.service.continue({ ...input, compilerInput: compilerInput(input.organizationId, input.request, configured.candidates) });
  }
  async applySemanticOperations(input: { organizationId: string; actorUserId: string; proposalId: string; request: string; operations: unknown }): Promise<CanonicalProductIntentOutcome> {
    return (await this.semanticService(input.organizationId)).applySemanticOperations(input);
  }
  async interact(input: { organizationId: string; actorUserId: string; proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }): Promise<CanonicalProductIntentOutcome | { navigation: { href: string; abandon: boolean; conversationId: string; cloneProductId?: string } }> {
    // Candidate actions and recommendations are server-authored revisions of
    // an existing draft. They must remain available to the direct Operator
    // creation path even when no compiler provider is configured.
    const service = await this.semanticService(input.organizationId);
    if (input.action === "accept_recommendation") return service.acceptRecommendation({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, recommendationId: input.actionId });
    if (input.action === "dismiss_recommendation") return service.dismissRecommendation({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, recommendationId: input.actionId });
    const result = await service.applyCandidateAction(input);
    return result.outcome ?? { navigation: result.navigation! };
  }
}

export function canonicalProductIntentCards(outcome: Extract<CanonicalProductIntentOutcome, { ok: true }>): ProductManagementCard[] {
  const proposal = { proposalId: outcome.session.proposalId, revision: outcome.card.revision, fingerprint: outcome.card.fingerprint };
  const title = outcome.card.title.replace(/^Create inactive draft:\s*/i, "Product draft: ");
  const cards: ProductManagementCard[] = [{ kind: "canonical_product_intent_proposal", title, summary: outcome.card.readiness.ready ? "The product draft is ready for review." : "The product draft needs the remaining business decisions.", sourceLinks: [], details: { canonicalProductIntent: outcome.card, ...proposal } }];
  // The action payload is server-authored and intentionally contains only the
  // persisted proposal identity. The browser can request a plan by turn id,
  // but never selects an operation or reconstructs a product from this card.
  if (outcome.card.readiness.ready) cards.push({ kind: "action_proposal", title: outcome.card.title, summary: "Review this product draft, then use the dedicated GO control to create one inactive PBV2 draft.", sourceLinks: [], plan: { action: canonicalProductIntentDraftCommandName, ...proposal } });
  return cards;
}

function canonicalCardsFromInspection(inspection: CanonicalProductIntentInspection): ProductManagementCard[] {
  return canonicalProductIntentCards({ ok: true, session: inspection.session, issues: inspection.issues, card: inspection.card });
}

function activeSemanticProductDraftContext(intent: ProductDraftIntent, inspection: CanonicalProductIntentInspection | null): ActiveSemanticProductDraftContext {
  const groups = new Map(intent.optionGroups.map((group) => [group.key, group]));
  const labelFor = (groupKey: string, valueKey: string) => {
    const group = groups.get(groupKey);
    const value = group?.values.find((candidate) => candidate.key === valueKey);
    return { optionGroup: group?.label ?? groupKey, value: value?.label ?? valueKey };
  };
  let pricing: ActiveSemanticProductDraftContext["pricing"];
  const pricingIntent = intent.pricing;
  if (pricingIntent.model === "one_dimensional_matrix") {
    pricing = { model: pricingIntent.model, basis: pricingIntent.unit === "unresolved" ? null : pricingIntent.unit, optionGroup: groups.get(pricingIntent.optionKey)?.label ?? pricingIntent.optionKey, rates: pricingIntent.cells.map((cell) => ({ option: labelFor(pricingIntent.optionKey, cell.option).value, priceCents: cell.priceCents })) };
  } else if (pricingIntent.model === "scalar") {
    pricing = { model: pricingIntent.model, basis: pricingIntent.unit, optionGroup: null, rates: [{ option: "Base", priceCents: pricingIntent.priceCents }] };
  } else {
    pricing = { model: pricingIntent.model, basis: "unit" in pricingIntent && pricingIntent.unit && pricingIntent.unit !== "unresolved" ? pricingIntent.unit : null, optionGroup: null, rates: [] };
  }
  return {
    name: intent.identity.name,
    category: { state: intent.identity.category.state, label: intent.identity.category.label, provenance: intent.fieldMetadata["identity.category"]?.source ?? "unresolved" },
    material: { state: intent.material.state, label: intent.material.state === "explicitly_unset" ? null : intent.material.label, provenance: intent.fieldMetadata.material?.source ?? (intent.material.state === "explicitly_unset" ? "canonical_default" : "unresolved") },
    measurementMode: intent.measurement.mode,
    pricing,
    optionGroups: intent.optionGroups.map((group) => ({
      label: group.label, required: group.required, selectionMode: group.selectionMode,
      defaultValue: group.values.find((value) => value.isDefault)?.label ?? null,
      values: group.values.map((value) => ({ label: value.label, priceImpactPercent: value.priceImpact?.percent ?? null, totalPercentWhenEnabled: value.totalPercentOfBaseWhenEnabled ? { percent: value.totalPercentOfBaseWhenEnabled.percent, prerequisite: labelFor(value.totalPercentOfBaseWhenEnabled.prerequisite.optionGroupKey, value.totalPercentOfBaseWhenEnabled.prerequisite.optionValueKey) } : null })),
      availableWhen: group.availableWhen ? labelFor(group.availableWhen.optionGroupKey, group.availableWhen.optionValueKey) : null,
    })),
    outstandingDecisions: (inspection?.card.requiredQuestions ?? []).map((question) => ({
      path: question.path, question: question.question,
      choices: question.answer?.allowedChoices.map((choice) => choice.displayLabel) ?? [],
    })),
    unsupportedDetails: [
      ...(intent.fieldMetadata["unsupportedDetails.customer_specific_availability"] ? ["customer_specific_availability"] : []),
      ...(intent.fieldMetadata["unsupportedDetails.grommet_quantity"] ? ["grommet_quantity"] : []),
    ],
    recentBusinessOperations: Object.entries(intent.fieldMetadata)
      .filter(([, metadata]) => metadata.source !== "unresolved")
      .map(([path]) => path)
      .slice(-16),
    trustedSelections: [
      ...(intent.identity.category.state === "resolved" ? [{ field: "category", label: intent.identity.category.label, provenance: intent.fieldMetadata["identity.category"]?.source ?? "structured_candidate" }] : []),
      ...(intent.material.state === "resolved" ? [{ field: "material", label: intent.material.label, provenance: intent.fieldMetadata.material?.source ?? "structured_candidate" }] : []),
      ...intent.optionGroups.flatMap((group) => group.values.filter((value) => value.isDefault).map((value) => ({ field: `${group.label} default`, label: value.label, provenance: intent.fieldMetadata[`optionGroups.${group.key}.default`]?.source ?? "explicit_user" }))),
    ],
    readyForReview: inspection?.card.readiness.ready ?? false,
  };
}

function normalizeProductReference(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
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

export class ProductManagementSkillService {
  constructor(private readonly deps: ProductManagementSkillDependencies = { sessions: createDbProductIntakeSessionStore(), references: loadReferences, canonicalProductIntent: new ConfiguredCanonicalProductIntentRouter() }) {}

  /**
   * AI-first entrypoint for a plan that has already selected the canonical
   * compiler.  In particular, a planned new-product request must not pass
   * through the legacy product keyword router before reaching the canonical
   * compiler.  The original request text is intentionally forwarded verbatim
   * to the compiler.
   */
  async respondPlannedCanonicalProductIntent(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    message: string;
    operation: "create" | "continue_session" | "correct" | "select_candidate" | "accept_recommendation" | "request_confirmation" | "execute_go";
  }): Promise<{ handled: boolean; response: string; cards: ProductManagementCard[] }> {
    const router = this.deps.canonicalProductIntent;
    if (!router) return { handled: true, response: "Product interpretation is unavailable until the canonical service is configured.", cards: [] };

    if (input.operation === "create") {
      try {
        const outcome = await router.create({
          organizationId: input.organizationId,
          actorUserId: input.userId,
          conversationId: input.conversationId,
          request: input.message,
        });
        return outcome.ok
          ? { handled: true, response: outcome.card.readiness.ready ? "I prepared the product draft for review. No product has been created yet." : "I started the product draft and will ask only for the business information still needed.", cards: canonicalProductIntentCards(outcome) }
          : { handled: true, response: outcome.message, cards: [{ kind: "product_validation_errors", title: "Product draft could not be created", summary: "No legacy Product Intake session or product was created.", sourceLinks: [], details: { errors: [outcome.message], code: outcome.code } }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The canonical product intent could not be created safely.";
        return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Canonical product intent unavailable", summary: "No product intent was changed.", sourceLinks: [], details: { errors: [message] } }] };
      }
    }

    let current: CanonicalProductIntentSession | null;
    try {
      current = await router.loadForConversation({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The product session could not be loaded safely.";
      return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Product session unavailable", summary: "No product was changed.", sourceLinks: [], details: { errors: [message] } }] };
    }
    if (!current) return { handled: true, response: "No canonical product-intent session was found for this continuation. No product was changed.", cards: [] };
    if (["executed", "expired", "abandoned"].includes(current.specification.session.state)) return { handled: true, response: `This canonical product-intent session is ${current.specification.session.state} and cannot be changed.`, cards: [] };
    try {
      const outcome = await router.continue({ organizationId: input.organizationId, actorUserId: input.userId, proposalId: current.proposalId, request: input.message });
      return outcome.ok
        ? { handled: true, response: outcome.card.readiness.ready ? "I updated the product draft. It is ready for review." : "I updated the product draft and kept only its remaining business questions.", cards: canonicalProductIntentCards(outcome) }
        : { handled: true, response: outcome.message, cards: [{ kind: "product_validation_errors", title: "Product draft needs correction", summary: "No new revision was created.", sourceLinks: [], details: { errors: [outcome.message], code: outcome.code } }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The canonical product intent could not be updated safely.";
      return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Canonical product intent needs correction", summary: "No new revision was created.", sourceLinks: [], details: { errors: [message] } }] };
    }
  }

  /** Active Product Builder semantic boundary for the Operator Runtime. This
   * keeps a provider's operation list separate from canonical patching and
   * allows direct server translation even if a compiler provider is down. */
  async applyCanonicalProductOperations(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    message: string;
    operations: unknown;
  }): Promise<{ handled: boolean; response: string; cards: ProductManagementCard[]; recovery?: CanonicalProductIntentRecovery }> {
    const router = this.deps.canonicalProductIntent;
    if (!router?.applySemanticOperations) return { handled: true, response: "Semantic Product Builder changes are not available in this deployment.", cards: [] };
    let current: CanonicalProductIntentSession | null;
    try {
      current = await router.loadForConversation({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The active product draft could not be loaded safely.";
      return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Product draft unavailable", summary: "No product revision was created.", sourceLinks: [], details: { errors: [message] } }] };
    }
    if (!current) return { handled: true, response: "No unfinished product draft is active for this conversation.", cards: [] };
    if (["executed", "expired", "abandoned"].includes(current.specification.session.state)) return { handled: true, response: `This product draft is ${current.specification.session.state} and cannot be changed.`, cards: [] };
    try {
      const outcome = await router.applySemanticOperations({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        proposalId: current.proposalId,
        request: input.message,
        operations: input.operations,
      });
      return outcome.ok
        ? { handled: true, response: `${outcome.changed === false ? "I confirmed the requested product detail is already in the active draft." : outcome.card.readiness.ready ? "I saved the product revision. It is ready for review." : "I saved the product revision and kept only its remaining questions."}${unsupportedProductDetailNotice(input.operations)}`, cards: canonicalProductIntentCards(outcome) }
        : { handled: true, response: outcome.message, cards: [{ kind: "product_validation_errors", title: "Product change could not be applied", summary: "No new revision was created.", sourceLinks: [], details: { errors: [outcome.message], code: outcome.code } }], ...(outcome.recovery ? { recovery: outcome.recovery } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The semantic product change could not be applied safely.";
      return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Product change unavailable", summary: "No new revision was created.", sourceLinks: [], details: { errors: [message] } }] };
    }
  }

  /** Loads the durable business context for an active direct Product Builder
   * task. The model receives this reduced read, never canonical state. */
  async getActiveSemanticProductDraftContext(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    proposalId: string;
  }): Promise<ActiveSemanticProductDraftContext | null> {
    const router = this.deps.canonicalProductIntent;
    if (!router) return null;
    const current = await router.loadForConversation({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
    if (!current || current.proposalId !== input.proposalId || current.specification.resolutionMetadata.architecture !== "operator_business_operations") return null;
    if (["executed", "expired", "abandoned"].includes(current.specification.session.state)) return null;
    const inspection = router.inspect
      ? await router.inspect({ organizationId: input.organizationId, actorUserId: input.userId, proposalId: input.proposalId })
      : null;
    return activeSemanticProductDraftContext(current.specification.session.revisions.at(-1)!.intent, inspection);
  }

  /** Read-only authoritative preview: it reloads the unfinished draft but
   * never writes a revision, proposal, GO state, or product record. */
  async previewActiveSemanticProductDraftPricing(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    proposalId: string;
    scenarios: Array<{ squareFeet: number; quantity?: number; selections?: Array<{ optionGroup: string; value: string }> }>;
    correlationId?: string;
  }) {
    const trace = (stage: string, extra: Record<string, unknown> = {}) => console.info("[AI_OPERATOR_TRACE]", {
      stage, correlationId: input.correlationId ?? null, toolName: "products.preview_draft_pricing", scenarioCount: input.scenarios.length, ...extra,
    });
    const router = this.deps.canonicalProductIntent;
    if (!router) {
      trace("active_draft_resolved", { succeeded: false });
      throw new Error("The active product draft is unavailable.");
    }
    const current = await router.loadForConversation({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
    if (!current || current.proposalId !== input.proposalId || current.specification.resolutionMetadata.architecture !== "operator_business_operations" || ["executed", "expired", "abandoned"].includes(current.specification.session.state)) {
      trace("active_draft_resolved", { succeeded: false });
      throw new Error("The active product draft is unavailable.");
    }
    trace("active_draft_resolved", { succeeded: true });
    const intent = current.specification.session.revisions.at(-1)!.intent;
    const groups = new Map(intent.optionGroups.map((group) => [group.label.trim().toLocaleLowerCase(), group]));
    const projected = projectProductDraftIntentToProductBuilderDraft(intent);
    const scenarios = input.scenarios.map((scenario, scenarioIndex) => {
      const selected: Record<string, { value: string }> = {};
      for (const selection of scenario.selections ?? []) {
        const group = groups.get(selection.optionGroup.trim().toLocaleLowerCase());
        const value = group?.values.find((candidate) => candidate.label.trim().toLocaleLowerCase() === selection.value.trim().toLocaleLowerCase());
        if (!group || !value) throw new Error("A requested pricing selection is not available on the active product draft.");
        selected[group.key] = { value: value.key };
      }
      trace("pbv2_evaluation_started", { scenarioIndex: scenarioIndex + 1 });
      let result: ReturnType<typeof evaluatePricingPreviewFromTree>;
      try {
        result = evaluatePricingPreviewFromTree({
          treeJson: projected.treeJson,
          widthIn: scenario.squareFeet * 144,
          heightIn: 1,
          quantity: scenario.quantity ?? 1,
          pbv2ExplicitSelections: selected,
          pricingProfileKey: projected.product.pricingProfileKey,
          measurementMode: projected.product.measurementMode,
        });
      } catch (error) {
        trace("pbv2_evaluation_completed", { scenarioIndex: scenarioIndex + 1, succeeded: false });
        throw error;
      }
      trace("pbv2_evaluation_completed", { scenarioIndex: scenarioIndex + 1, succeeded: true });
      return {
        scenarioIndex: scenarioIndex + 1,
        input: { squareFeet: scenario.squareFeet, quantity: scenario.quantity ?? 1, selections: scenario.selections ?? [] },
        baseCents: Math.round(result.breakdown.basePrice * 100),
        optionsCents: Math.round(result.breakdown.optionsPrice * 100),
        totalCents: Math.round(result.totalPrice * 100),
      };
    });
    return { productName: intent.identity.name, revision: intent.revision, scenarioCount: scenarios.length, scenarios };
  }

  /** Starts an unfinished inactive product intent owned by the server. The
   * Operator follows with business operations; this path never invokes the
   * ProductIntentCompiler or asks a provider for canonical structures. */
  async beginCanonicalProductDraft(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    message: string;
    initialOperations?: unknown;
  }): Promise<{ handled: boolean; response: string; cards: ProductManagementCard[]; draftState?: "resumed" }> {
    const router = this.deps.canonicalProductIntent;
    if (!router?.begin) return { handled: true, response: "Incremental Product Builder creation is not available in this deployment.", cards: [] };
    try {
      const current = await router.loadForConversation({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
      if (current && !["executed", "expired", "abandoned"].includes(current.specification.session.state)) {
        const inspection = router.inspect
          ? await router.inspect({ organizationId: input.organizationId, actorUserId: input.userId, proposalId: current.proposalId }).catch(() => null)
          : null;
        return {
          handled: true,
          response: "An unfinished product draft is already active in this conversation. Continue that draft instead of starting another one.",
          cards: inspection ? canonicalCardsFromInspection(inspection) : [],
          draftState: "resumed",
        };
      }
      const outcome = await router.begin({ organizationId: input.organizationId, actorUserId: input.userId, conversationId: input.conversationId });
      if (outcome.ok && input.initialOperations) {
        if (!router.applySemanticOperations) return { handled: true, response: "The initial product details could not be applied in this deployment.", cards: canonicalProductIntentCards(outcome) };
        const applied = await router.applySemanticOperations({ organizationId: input.organizationId, actorUserId: input.userId, proposalId: outcome.session.proposalId, request: input.message, operations: input.initialOperations });
        if (applied.ok) return { handled: true, response: `${applied.card.readiness.ready ? "I prepared the product draft for review. No product has been created yet." : "I started the product draft and applied the supplied business details."}${unsupportedProductDetailNotice(input.initialOperations)}`, cards: canonicalProductIntentCards(applied) };
        return { handled: true, response: applied.message, cards: [...canonicalProductIntentCards(outcome), { kind: "product_validation_errors", title: "Product draft needs correction", summary: "The initial business details were not applied; the unfinished draft remains available for correction.", sourceLinks: [], details: { errors: [applied.message], code: applied.code } }] };
      }
      return outcome.ok
        ? { handled: true, response: "I started an unfinished product draft. I’ll add the requested business details and ask only for information that is still needed.", cards: canonicalProductIntentCards(outcome) }
        : { handled: true, response: outcome.message, cards: [{ kind: "product_validation_errors", title: "Product draft could not be started", summary: "No product or draft was created.", sourceLinks: [], details: { errors: [outcome.message], code: outcome.code } }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The unfinished product draft could not be started safely.";
      return { handled: true, response: message, cards: [{ kind: "product_validation_errors", title: "Product draft unavailable", summary: "No product or draft was created.", sourceLinks: [], details: { errors: [message] } }] };
    }
  }

}

export const productManagementSkillService = new ProductManagementSkillService();
