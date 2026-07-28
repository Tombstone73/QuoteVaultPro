import { createHash } from "node:crypto";
import { inactiveProductDraftBulkUpdateMaxTargets, preflightBulkUpdateTargets, type InactiveProductDraftPatch } from "./productInactiveDraftBulkUpdateService";
import { inactiveProductDraftUpdateService, type InactiveProductDraftUpdateService } from "./inactiveProductDraftUpdateService";
import { productInactiveDraftBulkUpdateHistoryService, type ProductInactiveDraftBulkUpdateHistoryService } from "./productInactiveDraftBulkUpdateHistoryService";

function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`; }
function patchDomain(patch: InactiveProductDraftPatch): "pricing" | "configuration" | "relationships" { return patch.basePricing ? "pricing" : patch.configuration ? "configuration" : "relationships"; }

/**
 * Creates the immutable server-side proposal used by the high-risk command.
 * It accepts exact IDs only, loads canonical snapshots, and replaces each
 * preflight fingerprint with the canonical single-draft proposal fingerprint.
 */
export class ProductInactiveDraftBulkUpdateProposalService {
  constructor(private readonly updates: Pick<InactiveProductDraftUpdateService, "findInactiveDraftMatches" | "buildProposal"> = inactiveProductDraftUpdateService, private readonly history: Pick<ProductInactiveDraftBulkUpdateHistoryService, "createProposal"> = productInactiveDraftBulkUpdateHistoryService) {}
  async create(input: { organizationId: string; actorUserId: string; conversationId?: string; sourceTurnId?: string; sourceBatchId?: string; productIds: readonly string[]; sharedPatch: InactiveProductDraftPatch; overrides?: Readonly<Record<string, InactiveProductDraftPatch>>; selectionDescription: string }) {
    if (input.productIds.length > inactiveProductDraftBulkUpdateMaxTargets) throw new Error(`A bulk update may include at most ${inactiveProductDraftBulkUpdateMaxTargets} products; no targets were truncated.`);
    const matches = (await Promise.all(input.productIds.map(async (productId) => (await this.updates.findInactiveDraftMatches({ organizationId: input.organizationId, productId }))[0]))).filter(Boolean);
    const snapshots = matches.map((match) => ({ productId: match!.productId, sessionId: match!.sessionId, productName: match!.productName, category: match!.category, active: false, pbv2Status: "DRAFT", fingerprint: "" }));
    // buildProposal supplies the real canonical before-state and proposal hash;
    // it also rejects no-change, unsupported, or incompatible patches.
    const preflight = preflightBulkUpdateTargets({ requestedProductIds: input.productIds, snapshots, patch: input.sharedPatch, overrides: input.overrides });
    const rows = await Promise.all(preflight.map(async (target, index) => {
      if (target.status !== "eligible") return { sourceOrder: index + 1, productId: target.productId, sessionId: target.sessionId || `excluded:${target.productId}`, productName: target.productName, category: target.category, beforeSnapshot: {}, beforeFingerprint: target.beforeFingerprint || createHash("sha256").update(target.productId).digest("hex"), patch: target.patch, patchDomain: patchDomain(target.patch), provenance: { source: target.provenance, reason: target.reason ?? null }, fingerprint: createHash("sha256").update(stable(target)).digest("hex"), eligibilityState: target.status, executionState: target.status === "no_change" ? "no_change" : "excluded", warnings: target.reason ? [target.reason] : [] } as const;
      try { const proposal = await this.updates.buildProposal({ organizationId: input.organizationId, sessionId: target.sessionId, patch: target.patch as any }); return { sourceOrder: index + 1, productId: target.productId, sessionId: target.sessionId, productName: target.productName, category: target.category, beforeSnapshot: proposal.before as unknown as Record<string, unknown>, beforeFingerprint: proposal.fingerprint, patch: proposal.after as Record<string, unknown>, patchDomain: patchDomain(target.patch), provenance: { source: target.provenance }, fingerprint: proposal.fingerprint, eligibilityState: "eligible", executionState: "pending", readinessBefore: proposal.before.readiness as unknown as Record<string, unknown> } as const; }
      catch (error) { const message = error instanceof Error ? error.message : "Target could not be prepared."; return { sourceOrder: index + 1, productId: target.productId, sessionId: target.sessionId, productName: target.productName, category: target.category, beforeSnapshot: {}, beforeFingerprint: createHash("sha256").update(target.productId).digest("hex"), patch: target.patch, patchDomain: patchDomain(target.patch), provenance: { source: target.provenance }, fingerprint: createHash("sha256").update(stable(target)).digest("hex"), eligibilityState: "blocked", executionState: "excluded", warnings: [message] } as const; }
    }));
    const fingerprint = createHash("sha256").update(stable({ ids: input.productIds, sharedPatch: input.sharedPatch, overrides: input.overrides ?? {}, rows: rows.map((row) => ({ id: row.productId, fingerprint: row.fingerprint, state: row.executionState })) })).digest("hex");
    return this.history.createProposal({ organizationId: input.organizationId, actorUserId: input.actorUserId, ...(input.conversationId ? { conversationId: input.conversationId } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(input.sourceBatchId ? { sourceBatchId: input.sourceBatchId } : {}), selectionDescription: input.selectionDescription, sharedPatch: input.sharedPatch, overrides: input.overrides ?? {}, provenance: { source: "shared_patch_with_exact_product_overrides" }, fingerprint, rows: rows as any[] });
  }
}
export const productInactiveDraftBulkUpdateProposalService = new ProductInactiveDraftBulkUpdateProposalService();
