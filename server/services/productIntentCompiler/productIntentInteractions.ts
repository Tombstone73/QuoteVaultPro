import { createHash } from "node:crypto";
import { z } from "zod";
import { productDraftIntentPatchSchema, type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";
import type { ProductIntentIssue, TenantIntentReference } from "./productIntentResolver";

const nonEmpty = z.string().trim().min(1);
const revision = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);
const actionId = z.string().regex(/^[a-z][a-z0-9_-]{2,120}$/);

export const productIntentRecommendationSchema = z.object({
  id: actionId, revision, fingerprint, kind: z.enum(["add_minimum_charge", "enable_proof_approval", "enable_production_job", "select_material"]),
  title: nonEmpty, description: nonEmpty, reason: nonEmpty, source: z.literal("canonical_rule"), dismissible: z.literal(true), patch: productDraftIntentPatchSchema,
}).strict();
export type ProductIntentRecommendation = z.infer<typeof productIntentRecommendationSchema>;

export const productIntentCandidateActionSchema = z.object({
  id: actionId, issueId: nonEmpty, revision, fingerprint,
  kind: z.enum(["select_category", "select_material", "confirm_no_material", "select_production_route", "rename_new_product", "open_existing_product", "clone_existing_product_to_inactive_draft", "cancel_product_creation"]),
  label: nonEmpty, description: nonEmpty, blocksConfirmation: z.boolean(), candidate: z.object({ id: nonEmpty, label: nonEmpty, href: z.string().startsWith("/").optional(), isActive: z.boolean().optional() }).strict().optional(),
  patch: productDraftIntentPatchSchema.optional(), input: z.enum(["new_product_name"]).optional(), navigationOnly: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (!value.navigationOnly && !value.patch && !value.input) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A mutating candidate action needs a server-owned patch or typed input." });
});
export type ProductIntentCandidateAction = z.infer<typeof productIntentCandidateActionSchema>;

export type ExistingProductCandidate = { id: string; name: string; isActive: boolean; cloneSupported?: boolean };
export type ProductIntentInteractionContext = { categories: readonly TenantIntentReference[]; materials: readonly TenantIntentReference[]; productionRoutes: readonly TenantIntentReference[]; existingProducts?: readonly ExistingProductCandidate[] };
export type ProductIntentRecommendationContext = Pick<ProductIntentInteractionContext, "materials"> & { materialRequired?: boolean };

function id(prefix: string, revisionValue: number, fingerprintValue: string, discriminator: string) {
  return `${prefix}_${createHash("sha256").update(`${revisionValue}:${fingerprintValue}:${discriminator}`).digest("hex").slice(0, 24)}`;
}
function patch(intent: ProductDraftIntent, operations: ProductDraftIntentPatch["operations"]): ProductDraftIntentPatch {
  return productDraftIntentPatchSchema.parse({ contractVersion: 1, baseRevision: intent.revision, preserveUnchanged: true, operations });
}

const materialFamilyTerms = new Set(["coroplast", "vinyl", "acrylic", "banner", "paper", "pvc"]);
const materialPlaceholders = new Set(["", "material", "not selected", "unknown", "unspecified"]);

function normalized(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function tokens(value: string): string[] { return normalized(value).split(" ").filter(Boolean); }

/** A material hint is only a search key, never an authorization to select a
 * tenant record. Keep the matching deliberately small and deterministic so a
 * generic family cannot leak the entire tenant material catalog. */
export function relevantMaterialCandidates(intent: ProductDraftIntent, materials: readonly TenantIntentReference[]): TenantIntentReference[] {
  if (intent.material.state !== "unresolved") return [];
  const hint = normalized(intent.material.label);
  const metadata = intent.fieldMetadata.material;
  const familyTokens = Array.from(new Set([
    ...tokens(intent.material.label), ...tokens(intent.identity.name), ...tokens(intent.identity.description),
  ].filter((token) => materialFamilyTerms.has(token))));
  const authoritativeExact = !materialPlaceholders.has(hint) && ["explicit_user", "selected_template"].includes(metadata?.source ?? "");
  const requestedTokens = authoritativeExact ? tokens(intent.material.label) : familyTokens;
  if (!requestedTokens.length) return [];
  return materials.flatMap((candidate) => {
    const label = normalized(candidate.label);
    const candidateTokens = new Set(tokens(candidate.label));
    const exact = authoritativeExact && label === hint;
    const matches = requestedTokens.every((token) => candidateTokens.has(token));
    if (!exact && !matches) return [];
    return [{ candidate, score: exact ? 2 : 1 }];
  }).sort((left, right) => right.score - left.score || left.candidate.label.localeCompare(right.candidate.label, undefined, { numeric: true, sensitivity: "base" }))
    .slice(0, 5)
    .map(({ candidate }) => candidate);
}

/** Deterministic optional improvements. They never change readiness. Material
 * suggestions are explicit user choices with server-owned typed patches; they
 * are not candidate actions under the blocking-resolution section. */
export function generateProductIntentRecommendations(intent: ProductDraftIntent, fingerprintValue: string, dismissed: readonly string[] = [], context: ProductIntentRecommendationContext = { materials: [] }): ProductIntentRecommendation[] {
  if (intent.workflow.kind === "service_fee") return [];
  const items: ProductIntentRecommendation[] = [];
  if (intent.material.state === "unresolved" && !context.materialRequired) {
    for (const material of relevantMaterialCandidates(intent, context.materials)) {
      const recommendationId = id("rec", intent.revision, fingerprintValue, `select_material:${material.id}`);
      items.push(productIntentRecommendationSchema.parse({
        id: recommendationId, revision: intent.revision, fingerprint: fingerprintValue, kind: "select_material",
        title: `Select ${material.label}`, description: `Use the tenant material ${material.label}.`,
        reason: "This optional material matches the canonical material-family hint.", source: "canonical_rule", dismissible: true,
        patch: patch(intent, [
          { op: "set_material", value: { state: "resolved", id: material.id, label: material.label } },
          { op: "merge_field_metadata", value: { material: { source: "explicit_user" } } },
        ]),
      }));
    }
  }
  if (intent.workflow.kind === "standard_production" && !intent.workflow.requiresProofApproval) {
    const recommendationId = id("rec", intent.revision, fingerprintValue, "enable_proof_approval");
    items.push(productIntentRecommendationSchema.parse({ id: recommendationId, revision: intent.revision, fingerprint: fingerprintValue, kind: "enable_proof_approval", title: "Require proof approval", description: "Add proof approval before production begins.", reason: "This is an optional safeguard for a production product.", source: "canonical_rule", dismissible: true, patch: patch(intent, [{ op: "set_workflow", value: { ...intent.workflow, requiresProofApproval: true } }]) }));
  }
  if (intent.pricing.model === "scalar" && intent.pricing.unit !== "flat_fee" && intent.pricing.minimumChargeCents == null) {
    const recommendationId = id("rec", intent.revision, fingerprintValue, "add_minimum_charge_2500");
    items.push(productIntentRecommendationSchema.parse({ id: recommendationId, revision: intent.revision, fingerprint: fingerprintValue, kind: "add_minimum_charge", title: "Add a $25.00 minimum charge", description: "Set a $25.00 minimum charge for this product.", reason: "A minimum charge can protect small production orders without changing the listed rate.", source: "canonical_rule", dismissible: true, patch: patch(intent, [{ op: "set_pricing", value: { ...intent.pricing, minimumChargeCents: 2500 } }]) }));
  }
  // At most five material choices plus the two pre-existing safety/value
  // suggestions keeps the card compact while never truncating a relevant
  // material family to the first catalog entry.
  return items.filter((item) => !dismissed.includes(item.id)).slice(0, 7);
}

function referenceActions(input: { intent: ProductDraftIntent; fingerprint: string; issue: ProductIntentIssue; kind: "category" | "material" | "route"; values: readonly TenantIntentReference[] }): ProductIntentCandidateAction[] {
  const { intent, fingerprint: fingerprintValue, issue, kind, values } = input;
  const action = kind === "category" ? "select_category" : kind === "material" ? "select_material" : "select_production_route";
  const apply = (value: TenantIntentReference) => kind === "category"
    ? patch(intent, [
      { op: "set_identity", value: { ...intent.identity, category: { state: "resolved", id: value.id, label: value.label } } },
      // A candidate click is a structured user choice, so it must supersede
      // any low-confidence provider metadata during reference resolution.
      { op: "merge_field_metadata", value: { "identity.category": { source: "explicit_user" } } },
    ])
    : kind === "material"
      ? patch(intent, [
        { op: "set_material", value: { state: "resolved", id: value.id, label: value.label } },
        { op: "merge_field_metadata", value: { material: { source: "explicit_user" } } },
      ])
      : patch(intent, [{ op: "set_production", value: { ...intent.production, route: { state: "resolved", id: value.id, label: value.label } } }]);
  const issueId = issue.id ?? issue.code;
  const relevantValues = kind === "material" ? relevantMaterialCandidates(intent, values) : values.slice(0, 10);
  const actions = relevantValues.map((value) => productIntentCandidateActionSchema.parse({ id: id("cand", intent.revision, fingerprintValue, `${issueId}:${action}:${value.id}`), issueId, revision: intent.revision, fingerprint: fingerprintValue, kind: action, label: `Use ${value.label}`, description: `Use the tenant ${kind === "route" ? "production route" : kind} ${value.label}.`, blocksConfirmation: true, candidate: { id: value.id, label: value.label }, patch: apply(value), navigationOnly: false }));
  return actions;
}

export function generateProductIntentCandidateActions(intent: ProductDraftIntent, fingerprintValue: string, issues: readonly ProductIntentIssue[], context: ProductIntentInteractionContext): ProductIntentCandidateAction[] {
  const actions: ProductIntentCandidateAction[] = [];
  for (const issue of issues) {
    if (issue.code === "CATEGORY_UNRESOLVED" || issue.code === "CATEGORY_NOT_FOUND") actions.push(...referenceActions({ intent, fingerprint: fingerprintValue, issue, kind: "category", values: context.categories }));
    if (issue.code === "MATERIAL_UNRESOLVED" || issue.code === "MATERIAL_NOT_FOUND") actions.push(...referenceActions({ intent, fingerprint: fingerprintValue, issue, kind: "material", values: context.materials }));
    if (issue.code === "ROUTE_UNRESOLVED" || issue.code === "ROUTE_NOT_FOUND") actions.push(...referenceActions({ intent, fingerprint: fingerprintValue, issue, kind: "route", values: context.productionRoutes }));
    if (issue.code === "DUPLICATE_PRODUCT_NAME") {
      const issueId = issue.id ?? issue.code;
      actions.push(productIntentCandidateActionSchema.parse({ id: id("cand", intent.revision, fingerprintValue, "duplicate:rename"), issueId, revision: intent.revision, fingerprint: fingerprintValue, kind: "rename_new_product", label: "Rename the new product", description: "Provide a different product name; the server will recheck duplicates.", blocksConfirmation: true, input: "new_product_name", navigationOnly: false }));
      for (const existing of (context.existingProducts ?? []).filter((item) => item.name.localeCompare(intent.identity.name, undefined, { sensitivity: "accent" }) === 0).slice(0, 5)) {
        actions.push(productIntentCandidateActionSchema.parse({ id: id("cand", intent.revision, fingerprintValue, `duplicate:open:${existing.id}`), issueId: issue.code, revision: intent.revision, fingerprint: fingerprintValue, kind: "open_existing_product", label: `Open ${existing.name}`, description: `Open the existing ${existing.isActive ? "active" : "inactive"} product. No product will be created.`, blocksConfirmation: true, candidate: { id: existing.id, label: existing.name, href: `/products/${existing.id}`, isActive: existing.isActive }, navigationOnly: true }));
        if (existing.cloneSupported) actions.push(productIntentCandidateActionSchema.parse({ id: id("cand", intent.revision, fingerprintValue, `duplicate:clone:${existing.id}`), issueId: issue.code, revision: intent.revision, fingerprint: fingerprintValue, kind: "clone_existing_product_to_inactive_draft", label: `Clone ${existing.name} to an inactive draft`, description: "Starts the dedicated clone workflow; the existing product is not modified.", blocksConfirmation: true, candidate: { id: existing.id, label: existing.name, isActive: existing.isActive }, navigationOnly: true }));
      }
    }
  }
  return actions.slice(0, 20);
}

export function parseProductIntentRecommendation(value: unknown) { return productIntentRecommendationSchema.parse(value); }
export function parseProductIntentCandidateAction(value: unknown) { return productIntentCandidateActionSchema.parse(value); }
