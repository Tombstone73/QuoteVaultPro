import { z } from "zod";
import { AssistantOrderProductRepository } from "../../storage/assistantOrderProduct.repo";
import { CloneInactiveProductDraftError, CloneInactiveProductDraftService, cloneInactiveProductRequestedChangesSchema, type CloneInactiveProductDraftStore, type CloneInactiveProductProposal } from "./cloneInactiveProductDraftService";
import { createDrizzleCloneInactiveProductDraftStore } from "./cloneInactiveProductDraftPersistence";
import { ProductCandidateSelectionContinuationError, ProductCandidateSelectionContinuationService, type ProductCandidateSelectionCandidate } from "./productCandidateSelectionContinuation";
import { createDrizzleProductCandidateSelectionContinuationStore } from "./productCandidateSelectionContinuationPersistence";
import { cloneInactiveProductDraftCommandName } from "./execution/cloneInactiveProductDraftCommand";
import { existingProductIdForMutation } from "./trustedProductState";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";

const permission = "assistant.products.clone_to_inactive_draft";
const argumentsSchema = z.union([
  z.object({ sourceQuery: z.string().trim().min(1).max(160).optional(), requestedChanges: cloneInactiveProductRequestedChangesSchema }).strict(),
  z.object({ candidateId: z.string().trim().min(1).max(256) }).strict(),
]);

/** A preparation entry point to the existing clone operation. The provider
 * supplies business changes only; configuration is loaded by the clone service. */
export function createProductCloneApplicationTool(deps: {
  store?: CloneInactiveProductDraftStore;
  repository?: Pick<AssistantOrderProductRepository, "getProduct">;
  selections?: ProductCandidateSelectionContinuationService;
} = {}): AssistantOperatorSemanticTool {
  const store = deps.store ?? createDrizzleCloneInactiveProductDraftStore();
  const clones = new CloneInactiveProductDraftService(store);
  const repository = deps.repository ?? new AssistantOrderProductRepository();
  const selections = deps.selections ?? new ProductCandidateSelectionContinuationService(createDrizzleProductCandidateSelectionContinuationStore());
  const proposalResult = (proposal: CloneInactiveProductProposal) => {
    const source = proposal.preview.source.product;
    const changes = proposal.preview.requestedChanges;
    const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
    const changeSummary = [`Name: ${changes.newName}`, ...(changes.description !== undefined ? [`Description: ${changes.description}`] : []), ...(changes.category !== undefined ? [`Category: ${changes.category ?? "none"}`] : []), ...Object.entries(changes.basePricing ?? {}).map(([field, cents]) => `${({ perSqftCents: "Base per square foot", perPieceCents: "Base per piece", minimumChargeCents: "Minimum charge" } as Record<string, string>)[field]}: ${money(cents)}`)].join("; ");
    const summary = `Clone ${source.name} as ${proposal.preview.result.product.name}. Preserve inherited pricing, options, requirements, routing, material references and PBV2 configuration; explicit changes: ${changeSummary}. Destination: inactive Product with a PBV2 DRAFT. Source unchanged. ${proposal.status === "succeeded" ? "This proposal already executed; reopen its existing GO result. Repeated GO returns that same clone." : "No Product has been created; GO is required."}`;
    const links = [{ label: source.name, href: `/products/${encodeURIComponent(source.id)}/edit`, entityType: "product" as const, entityId: source.id }];
    return { status: "succeeded" as const, result: { status: "succeeded" as const, data: { response: summary, taskDomain: "products", cloneProposalId: proposal.id, sourceProductId: source.id }, provenance: { sourceLinks: links, freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: [{ kind: "action_proposal", title: `Review Product clone: ${proposal.preview.result.product.name}`, summary, sourceLinks: links, plan: { action: cloneInactiveProductDraftCommandName, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint } } as any] } };
  };
  const candidate = async (organizationId: string, productId: string): Promise<ProductCandidateSelectionCandidate> => {
    const record = await repository.getProduct(organizationId, { productId });
    if (!record || record.resolution === "ambiguous") throw new CloneInactiveProductDraftError("CLONE_SOURCE_NOT_FOUND", "The source Product is no longer available in this organization.");
    let source = null; let blockingReason: string | null = null;
    try { source = await store.loadSource({ organizationId, productId }); }
    catch (error) { if (!(error instanceof CloneInactiveProductDraftError)) throw error; blockingReason = error.message; }
    return { candidateId: productId, productId, productName: record.product.name, isActive: record.product.isActive, pricingMode: record.product.pricingMode, productUpdatedAt: record.product.updatedAt.toISOString(), pbv2TreeVersionId: source?.pbv2Tree.id ?? null, pbv2TreeStatus: source?.pbv2Tree.status ?? null, pbv2TreeUpdatedAt: source?.pbv2Tree.updatedAt ?? null, selectable: Boolean(source), blockingReason: source ? null : blockingReason ?? "No single supported PBV2 source tree is available." };
  };
  return {
    name: cloneInactiveProductDraftCommandName,
    description: "Prepare the existing canonical Product clone for duplicate, clone, copy/rename, identical Product, or use an existing Product as a starting point. Never reconstruct inherited settings with products.begin_draft/apply_operations. For a named source pass sourceQuery (current name overrides retained context); omit only for this Product in trusted context. An ambiguous source returns saved candidates: ask the user to select, then pass only candidateId to resume the saved changes. Rename-only: requestedChanges contains newName only. Supported explicit changes: description, category, basePricing in integer cents. Unsupported changes must be reported, never silently omitted. This prepares a proposal only; existing GO executes the clone.",
    inputSchema: { type: "object", additionalProperties: false, properties: { sourceQuery: { type: "string", minLength: 1, maxLength: 160 }, requestedChanges: { type: "object", additionalProperties: false, required: ["newName"], properties: { newName: { type: "string", minLength: 1, maxLength: 255 }, description: { type: "string", minLength: 1, maxLength: 20000 }, category: { type: ["string", "null"] }, basePricing: { type: "object", additionalProperties: false, properties: { perSqftCents: { type: "integer", minimum: 0 }, perPieceCents: { type: "integer", minimum: 0 }, minimumChargeCents: { type: "integer", minimum: 0 } } } } }, candidateId: { type: "string", minLength: 1, maxLength: 256 } }, anyOf: [{ required: ["requestedChanges"] }, { required: ["candidateId"] }] },
    async execute({ arguments: raw, context }) {
      if (!context.permissions.includes(permission)) return { status: "permission_denied", warning: "You are not authorized to clone Products.", failureCode: "PERMISSION_DENIED" };
      try {
        const args = argumentsSchema.parse(raw);
        const scope = { organizationId: context.scope.organizationId, actorUserId: context.actor.userId, conversationId: context.conversationId };
        if ("candidateId" in args) {
          const selected = await selections.select({ ...scope, candidateId: args.candidateId, revalidate: async (previous, operation) => {
            if (operation !== "clone_inactive_product_draft") return false;
            const current = await candidate(scope.organizationId, previous.productId);
            return current.selectable && current.productUpdatedAt === previous.productUpdatedAt && current.pbv2TreeVersionId === previous.pbv2TreeVersionId && current.pbv2TreeUpdatedAt === previous.pbv2TreeUpdatedAt;
          } });
          if (selected.operation !== "clone_inactive_product_draft") throw new CloneInactiveProductDraftError("CLONE_SELECTION_INVALID", "This saved selection is not for Product cloning.");
          if (selected.resultProposal) return proposalResult(await clones.revalidateProposal({ ...scope, proposalId: selected.resultProposal.id, proposalFingerprint: selected.resultProposal.fingerprint }));
          const source = selected.candidates.find((item) => item.candidateId === args.candidateId)!;
          const proposal = await clones.prepareProposal({ ...scope, sourceProductId: source.productId, requestedChanges: cloneInactiveProductRequestedChangesSchema.parse(selected.requestedChanges) });
          await selections.attachResult({ ...scope, candidateId: args.candidateId, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint });
          return proposalResult(proposal);
        }
        // The existing canonical detail resolver owns name matching. A current
        // name never falls back to an old Product id, even on lookup failure.
        const trustedId = args.sourceQuery ? null : existingProductIdForMutation(context);
        if (!args.sourceQuery && !trustedId) throw new CloneInactiveProductDraftError("CLONE_SOURCE_UNRESOLVED", "Name the source Product or select one authoritative Product first.");
        const record = await repository.getProduct(scope.organizationId, args.sourceQuery ? { query: args.sourceQuery } : { productId: trustedId! });
        if (!record) throw new CloneInactiveProductDraftError("CLONE_SOURCE_NOT_FOUND", "The requested source Product was not found in this organization. No replacement draft was created.");
        if (record.resolution === "ambiguous") {
          const candidates = await Promise.all(record.candidates.map((item) => candidate(scope.organizationId, item.id)));
          await selections.begin({ ...scope, operation: "clone_inactive_product_draft", originalMessage: context.goal, requestedChanges: args.requestedChanges, candidates });
          return { status: "succeeded", result: { status: "succeeded", data: { taskDomain: "products", response: `Multiple Products match. Select one source before a clone proposal can be prepared. The requested name and changes are saved.\n${candidates.map((item) => `${item.productName} (${item.isActive ? "active" : "inactive"}); select ${item.candidateId}${item.blockingReason ? `; unavailable: ${item.blockingReason}` : ""}`).join("\n")}`, candidates }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: [{ kind: "product_candidate_selection", title: "Select the source Product to clone", summary: "No Product has been created. Reply with the candidate ID for the intended source; the requested name and changes are saved.", details: { candidates } } as any] } };
        }
        return proposalResult(await clones.prepareProposal({ ...scope, sourceProductId: record.product.id, requestedChanges: args.requestedChanges }));
      } catch (error) {
        const known = error instanceof CloneInactiveProductDraftError || error instanceof ProductCandidateSelectionContinuationError;
        return { status: "rejected", warning: known ? error.message : error instanceof z.ZodError ? "Unsupported or invalid clone changes. Only newName, description, category and explicit basePricing are supported; no Product was created. Review the requested changes before retrying." : "The clone proposal could not be prepared. Retry after checking the source Product.", failureCode: known ? error.code : error instanceof z.ZodError ? "CLONE_ARGUMENTS_INVALID" : "CLONE_PREPARATION_FAILED", failureCategory: "operation_preparation" };
      }
    },
  };
}
