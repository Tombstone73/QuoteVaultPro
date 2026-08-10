import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The clone flow deliberately has its own narrow boundary.  It is not a
 * generic product patch: all PBV2 configuration is inherited as a snapshot,
 * while the requested clone changes stay separately represented and visible
 * in the confirmation preview.
 */
export const cloneInactiveProductRequestedChangesSchema = z.object({
  newName: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(20_000).optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
  /** Explicit base-rate changes only; no matrix or tier inference occurs here. */
  basePricing: z.object({
    perSqftCents: z.number().int().nonnegative().optional(),
    perPieceCents: z.number().int().nonnegative().optional(),
    minimumChargeCents: z.number().int().nonnegative().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one explicit base-pricing value.").optional(),
}).strict();
export type CloneInactiveProductRequestedChanges = z.infer<typeof cloneInactiveProductRequestedChangesSchema>;

export const cloneInactiveProductSourceSnapshotSchema = z.object({
  organizationId: z.string().trim().min(1),
  product: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(255),
    description: z.string(),
    category: z.string().nullable(),
    isActive: z.boolean(),
    measurementMode: z.enum(["dimensions_required", "quantity_only"]),
    workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]),
    isTaxable: z.boolean(),
    pricingMode: z.enum(["area", "quantity", "flat"]),
    primaryMaterialId: z.string().nullable(),
    pbv2ActiveTreeVersionId: z.string().nullable(),
    configuration: z.record(z.unknown()),
  }).strict(),
  pbv2Tree: z.object({
    id: z.string().trim().min(1),
    productId: z.string().trim().min(1),
    status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED", "ARCHIVED"]),
    schemaVersion: z.literal(2),
    updatedAt: z.string().datetime({ offset: true }),
    treeJson: z.record(z.unknown()),
  }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.product.id !== snapshot.pbv2Tree.productId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pbv2Tree", "productId"], message: "PBV2 tree must belong to the bound source product." });
  }
});
export type CloneInactiveProductSourceSnapshot = z.infer<typeof cloneInactiveProductSourceSnapshotSchema>;

export const cloneInactiveProductPreviewSchema = z.object({
  source: cloneInactiveProductSourceSnapshotSchema,
  requestedChanges: cloneInactiveProductRequestedChangesSchema,
  result: z.object({
    product: z.object({
      name: z.string(), description: z.string(), category: z.string().nullable(), inactive: z.literal(true),
      measurementMode: z.enum(["dimensions_required", "quantity_only"]), workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]),
      isTaxable: z.boolean(), pricingMode: z.enum(["area", "quantity", "flat"]), primaryMaterialId: z.string().nullable(), configuration: z.record(z.unknown()),
    }).strict(),
    pbv2Tree: z.object({
      status: z.literal("DRAFT"), schemaVersion: z.literal(2), treeJson: z.record(z.unknown()),
    }).strict(),
  }).strict(),
  basePricing: z.object({
    before: z.object({ perSqftCents: z.number().nullable(), perPieceCents: z.number().nullable(), minimumChargeCents: z.number().nullable() }).strict(),
    after: z.object({ perSqftCents: z.number().nullable(), perPieceCents: z.number().nullable(), minimumChargeCents: z.number().nullable() }).strict(),
  }).strict(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  warnings: z.array(z.string()).max(20),
}).strict();
export type CloneInactiveProductPreview = z.infer<typeof cloneInactiveProductPreviewSchema>;

export const cloneInactiveProductProposalSchema = z.object({
  id: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
  sourceProductId: z.string().trim().min(1),
  sourcePbv2TreeVersionId: z.string().trim().min(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  preview: cloneInactiveProductPreviewSchema,
  status: z.enum(["proposed", "succeeded"]),
}).strict();
export type CloneInactiveProductProposal = z.infer<typeof cloneInactiveProductProposalSchema>;

export const cloneInactiveProductExecutionResultSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  pbv2TreeVersionId: z.string().trim().min(1),
  inactive: z.literal(true),
  pbv2Status: z.literal("DRAFT"),
  reused: z.boolean(),
}).strict();
export type CloneInactiveProductExecutionResult = z.infer<typeof cloneInactiveProductExecutionResultSchema>;

export class CloneInactiveProductDraftError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Persistence is intentionally injected.  The production implementation must
 * perform `executeCloneIdempotently` in one database transaction: reload the
 * product/tree, compare `expectedSourceFingerprint`, recheck the normalized
 * name, create only an inactive product + PBV2 DRAFT, then persist the result
 * against this proposal/idempotency key.  This keeps the safety contract
 * reusable without introducing a competing proposal table or migration.
 */
export interface CloneInactiveProductDraftStore {
  loadSource(input: { organizationId: string; productId: string }): Promise<CloneInactiveProductSourceSnapshot | null>;
  findProductsByNormalizedName(input: { organizationId: string; normalizedName: string }): Promise<Array<{ id: string; name: string }>>;
  createProposal(input: Omit<CloneInactiveProductProposal, "id">): Promise<CloneInactiveProductProposal>;
  getProposal(input: { organizationId: string; proposalId: string }): Promise<CloneInactiveProductProposal | null>;
  executeCloneIdempotently(input: {
    organizationId: string;
    actorUserId: string;
    proposalId: string;
    proposalFingerprint: string;
    expectedSourceFingerprint: string;
    idempotencyKey: string;
    preview: CloneInactiveProductPreview;
  }): Promise<CloneInactiveProductExecutionResult>;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function cloneJson<T>(value: T): T {
  const structured = globalThis.structuredClone as ((input: T) => T) | undefined;
  return structured ? structured(value) : JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeCloneProductName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Shared with the transactional store so the write boundary repeats the exact
 * snapshot check performed during plan creation. */
export function cloneInactiveProductSourceFingerprint(source: CloneInactiveProductSourceSnapshot): string {
  return fingerprint(source);
}

type BasePricing = { perSqftCents: number | null; perPieceCents: number | null; minimumChargeCents: number | null };
function basePricing(treeJson: Record<string, unknown>, requireCanonicalPath: boolean): BasePricing {
  const meta = treeJson.meta;
  const pricingV2 = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).pricingV2 : null;
  const base = pricingV2 && typeof pricingV2 === "object" && !Array.isArray(pricingV2) ? (pricingV2 as Record<string, unknown>).base : null;
  if ((!base || typeof base !== "object" || Array.isArray(base)) && requireCanonicalPath) throw new CloneInactiveProductDraftError("CLONE_BASE_PRICING_UNSUPPORTED", "The source PBV2 tree has no canonical meta.pricingV2.base block for this requested price change.");
  const values = base && typeof base === "object" && !Array.isArray(base) ? base as Record<string, unknown> : {};
  const rate = (key: keyof BasePricing) => typeof values[key] === "number" && Number.isFinite(values[key]) && values[key] >= 0 ? values[key] : null;
  return { perSqftCents: rate("perSqftCents"), perPieceCents: rate("perPieceCents"), minimumChargeCents: rate("minimumChargeCents") };
}

function applyBasePricing(treeJson: Record<string, unknown>, changes: CloneInactiveProductRequestedChanges): { treeJson: Record<string, unknown>; before: BasePricing; after: BasePricing } {
  const before = basePricing(treeJson, Boolean(changes.basePricing));
  if (!changes.basePricing) return { treeJson, before, after: before };
  const updated = cloneJson(treeJson); const meta = updated.meta as Record<string, unknown>; const pricingV2 = meta.pricingV2 as Record<string, unknown>; const base = pricingV2.base as Record<string, unknown>;
  const after = { ...before, ...changes.basePricing };
  pricingV2.base = { ...base, ...changes.basePricing };
  return { treeJson: updated, before, after };
}

function buildPreview(source: CloneInactiveProductSourceSnapshot, changes: CloneInactiveProductRequestedChanges): CloneInactiveProductPreview {
  const sourceHash = cloneInactiveProductSourceFingerprint(source);
  const inheritedTree = cloneJson(source.pbv2Tree.treeJson);
  const pricing = applyBasePricing(inheritedTree, changes);
  const result = {
    product: {
      name: changes.newName,
      description: changes.description ?? source.product.description,
      category: Object.prototype.hasOwnProperty.call(changes, "category") ? changes.category ?? null : source.product.category,
      inactive: true as const,
      measurementMode: source.product.measurementMode,
      workflowIntent: source.product.workflowIntent,
      isTaxable: source.product.isTaxable,
      pricingMode: source.product.pricingMode,
      primaryMaterialId: source.product.primaryMaterialId,
      configuration: cloneJson(source.product.configuration),
    },
    pbv2Tree: {
      status: "DRAFT" as const,
      schemaVersion: 2 as const,
      treeJson: { ...pricing.treeJson, status: "DRAFT" },
    },
  };
  return cloneInactiveProductPreviewSchema.parse({
    source: cloneJson(source), requestedChanges: cloneJson(changes), result, basePricing: { before: pricing.before, after: pricing.after },
    sourceFingerprint: sourceHash,
    proposalFingerprint: fingerprint({ sourceHash, requestedChanges: changes, result }),
    warnings: source.product.isActive ? ["The source product remains unchanged; only the new inactive PBV2 DRAFT will be created."] : [],
  });
}

export class CloneInactiveProductDraftService {
  constructor(private readonly store: CloneInactiveProductDraftStore) {}

  private async requireUniqueName(organizationId: string, name: string): Promise<void> {
    const matches = await this.store.findProductsByNormalizedName({ organizationId, normalizedName: normalizeCloneProductName(name) });
    if (matches.length) throw new CloneInactiveProductDraftError("CLONE_NAME_CONFLICT", `A product named \"${name}\" already exists in this organization. Choose a distinct clone name.`);
  }

  async prepareProposal(input: { organizationId: string; actorUserId: string; sourceProductId: string; requestedChanges: CloneInactiveProductRequestedChanges }): Promise<CloneInactiveProductProposal> {
    const changes = cloneInactiveProductRequestedChangesSchema.parse(input.requestedChanges);
    const source = await this.store.loadSource({ organizationId: input.organizationId, productId: input.sourceProductId });
    if (!source) throw new CloneInactiveProductDraftError("CLONE_SOURCE_NOT_FOUND", "The source product was not found in this organization.");
    const parsedSource = cloneInactiveProductSourceSnapshotSchema.parse(source);
    if (parsedSource.organizationId !== input.organizationId || parsedSource.product.id !== input.sourceProductId) {
      throw new CloneInactiveProductDraftError("CLONE_SOURCE_BINDING_INVALID", "The source product could not be bound exactly to this organization.");
    }
    await this.requireUniqueName(input.organizationId, changes.newName);
    const preview = buildPreview(parsedSource, changes);
    return this.store.createProposal({
      organizationId: input.organizationId, actorUserId: input.actorUserId,
      sourceProductId: parsedSource.product.id, sourcePbv2TreeVersionId: parsedSource.pbv2Tree.id,
      sourceFingerprint: preview.sourceFingerprint, fingerprint: preview.proposalFingerprint, preview, status: "proposed",
    });
  }

  private async requireBoundProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }): Promise<CloneInactiveProductProposal> {
    const proposal = await this.store.getProposal({ organizationId: input.organizationId, proposalId: input.proposalId });
    if (!proposal) throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_NOT_FOUND", "The clone proposal was not found in this organization.");
    const parsed = cloneInactiveProductProposalSchema.parse(proposal);
    if (parsed.organizationId !== input.organizationId || parsed.actorUserId !== input.actorUserId) {
      throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_ACTOR_MISMATCH", "This clone proposal is bound to a different actor or organization.");
    }
    if (parsed.fingerprint !== input.proposalFingerprint || parsed.preview.proposalFingerprint !== input.proposalFingerprint) {
      throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_STALE", "The clone proposal changed; create a new confirmation plan.");
    }
    return parsed;
  }

  async revalidateProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }): Promise<CloneInactiveProductProposal> {
    const proposal = await this.requireBoundProposal(input);
    // A succeeded proposal has a persisted idempotent result.  Replays must
    // return that result even though the new product now intentionally owns
    // the requested name (or the source later changed).
    if (proposal.status === "succeeded") return proposal;
    const source = await this.store.loadSource({ organizationId: input.organizationId, productId: proposal.sourceProductId });
    if (!source) throw new CloneInactiveProductDraftError("CLONE_SOURCE_NOT_FOUND", "The source product is no longer available in this organization.");
    const current = cloneInactiveProductSourceSnapshotSchema.parse(source);
    if (current.organizationId !== input.organizationId || current.pbv2Tree.id !== proposal.sourcePbv2TreeVersionId || cloneInactiveProductSourceFingerprint(current) !== proposal.sourceFingerprint) {
      throw new CloneInactiveProductDraftError("CLONE_SOURCE_STALE", "The source product or its PBV2 tree changed; review a new clone preview.");
    }
    await this.requireUniqueName(input.organizationId, proposal.preview.result.product.name);
    return proposal;
  }

  async execute(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string; idempotencyKey: string }): Promise<CloneInactiveProductExecutionResult> {
    const proposal = await this.revalidateProposal(input);
    // The store repeats these checks in the write transaction to close the
    // revalidation-to-execution race and to retain idempotent replay state.
    return cloneInactiveProductExecutionResultSchema.parse(await this.store.executeCloneIdempotently({
      organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: proposal.id,
      proposalFingerprint: proposal.fingerprint, expectedSourceFingerprint: proposal.sourceFingerprint,
      idempotencyKey: input.idempotencyKey, preview: proposal.preview,
    }));
  }
}
