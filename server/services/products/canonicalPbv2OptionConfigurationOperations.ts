import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { pbv2TreeVersions, products } from "@shared/schema";
import { visibilityRuleSchema, type VisibilityRule } from "@shared/optionTreeV2";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { normalizePbv2ChoiceConsumptionMaterialAuthority } from "@shared/pbv2/materialAuthority";
import { normalizeCanonicalProductPricingTree } from "./canonicalProductPricingOperations";

const referenceSchema = z.string().trim().min(1).max(160);
const inputTypeSchema = z.enum(["boolean", "select", "multiselect", "number", "text", "textarea", "dimension"]);
const defaultValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable();
const choiceSchema = z.object({
  value: z.string().trim().min(1).max(160), label: z.string().trim().min(1).max(255),
  description: z.string().max(10_000).optional(), sortOrder: z.number().int().min(0).optional(),
  visibilityRules: z.array(visibilityRuleSchema).max(20).optional(),
}).strict();
const choiceChangesSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(), description: z.string().max(10_000).optional(),
  sortOrder: z.number().int().min(0).optional(), visibilityRules: z.array(visibilityRuleSchema).max(20).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choice changes are required");

export const pbv2OptionConfigurationMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_group"), group: z.object({ key: referenceSchema, label: referenceSchema, description: z.string().max(10_000).optional(), required: z.boolean().optional(), multiSelect: z.boolean().optional(), visibilityRules: z.array(visibilityRuleSchema).max(20).optional() }).strict() }).strict(),
  z.object({ kind: z.literal("update_group"), group: referenceSchema, changes: z.object({ label: referenceSchema.optional(), description: z.string().max(10_000).optional(), required: z.boolean().optional(), multiSelect: z.boolean().optional(), visibilityRules: z.array(visibilityRuleSchema).max(20).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Group changes are required") }).strict(),
  z.object({ kind: z.literal("add_input"), group: referenceSchema, input: z.object({ selectionKey: referenceSchema.regex(/^[A-Za-z][A-Za-z0-9_-]*$/), label: referenceSchema, description: z.string().max(10_000).optional(), type: inputTypeSchema, required: z.boolean().optional(), defaultValue: defaultValueSchema.optional(), choices: z.array(choiceSchema).max(100).optional(), visibilityRules: z.array(visibilityRuleSchema).max(20).optional() }).strict() }).strict(),
  z.object({ kind: z.literal("update_input"), input: referenceSchema, changes: z.object({ label: referenceSchema.optional(), description: z.string().max(10_000).optional(), type: inputTypeSchema.optional(), required: z.boolean().optional(), defaultValue: defaultValueSchema.optional(), visibilityRules: z.array(visibilityRuleSchema).max(20).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Input changes are required") }).strict(),
  z.object({ kind: z.literal("set_default"), input: referenceSchema, choice: referenceSchema.nullable() }).strict(),
  z.object({ kind: z.literal("add_choice"), input: referenceSchema, choice: choiceSchema }).strict(),
  z.object({ kind: z.literal("update_choice"), input: referenceSchema, choice: referenceSchema, changes: choiceChangesSchema }).strict(),
  z.object({ kind: z.literal("reorder_groups"), orderedGroups: z.array(referenceSchema).min(1).max(100) }).strict(),
  z.object({ kind: z.literal("reorder_choices"), input: referenceSchema, orderedValues: z.array(referenceSchema).min(1).max(100) }).strict(),
]);
export const pbv2OptionConfigurationMutationsSchema = z.array(pbv2OptionConfigurationMutationSchema).min(1).max(24);
export type Pbv2OptionConfigurationMutation = z.infer<typeof pbv2OptionConfigurationMutationSchema>;
export type Pbv2OptionConfigurationMutations = z.infer<typeof pbv2OptionConfigurationMutationsSchema>;

export class CanonicalPbv2OptionConfigurationError extends Error {
  constructor(readonly code: "ACTOR_REQUIRED" | "PRODUCT_NOT_FOUND" | "PBV2_DRAFT_UNAVAILABLE" | "PBV2_DRAFT_INVALID" | "PBV2_DRAFT_STALE" | "PBV2_LIFECYCLE_RESTRICTED" | "PBV2_REFERENCE_UNRESOLVED" | "PBV2_CONFIGURATION_INVALID" | "PBV2_UNSUPPORTED_MODEL" | "NO_PBV2_OPTION_CHANGES", message: string, readonly findings?: readonly unknown[]) {
    super(message); this.name = "CanonicalPbv2OptionConfigurationError";
  }
}

type TreeRow = typeof pbv2TreeVersions.$inferSelect;
type ProductRow = Pick<typeof products.$inferSelect, "id" | "organizationId" | "name" | "isActive" | "pbv2ActiveTreeVersionId">;
type Store = {
  getProduct(input: { organizationId: string; productId: string }): Promise<ProductRow | null>;
  getLatestDraft(input: { organizationId: string; productId: string }): Promise<TreeRow | null>;
  getTree(input: { organizationId: string; productId: string; treeId: string }): Promise<TreeRow | null>;
  saveEditorDraft(input: { organizationId: string; productId: string; actorUserId: string; treeJson: Record<string, any> }): Promise<TreeRow>;
  saveOptionMutation(input: { organizationId: string; productId: string; actorUserId: string; source: TreeRow; treeJson: Record<string, any> }): Promise<TreeRow | null>;
};

const store: Store = {
  async getProduct({ organizationId, productId }) {
    const { db } = await import("../../db");
    const [row] = await db.select({ id: products.id, organizationId: products.organizationId, name: products.name, isActive: products.isActive, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId }).from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, productId))).limit(1);
    return row ?? null;
  },
  async getLatestDraft({ organizationId, productId }) {
    const { db } = await import("../../db");
    const [row] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
    return row ?? null;
  },
  async getTree({ organizationId, productId, treeId }) {
    const { db } = await import("../../db");
    const [row] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.id, treeId))).limit(1);
    return row ?? null;
  },
  async saveEditorDraft({ organizationId, productId, actorUserId, treeJson }) {
    const { db } = await import("../../db");
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
      if (existing) {
        const [updated] = await tx.update(pbv2TreeVersions).set({ treeJson, schemaVersion: Number(treeJson.schemaVersion ?? 2), updatedByUserId: actorUserId, updatedAt: new Date() }).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, existing.id), eq(pbv2TreeVersions.status, "DRAFT"))).returning();
        if (!updated) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_STALE", "The PBV2 DRAFT changed while it was being saved.");
        return updated;
      }
      const [created] = await tx.insert(pbv2TreeVersions).values({ organizationId, productId, status: "DRAFT", schemaVersion: Number(treeJson.schemaVersion ?? 2), treeJson, createdByUserId: actorUserId, updatedByUserId: actorUserId }).returning();
      if (!created) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_INVALID", "The PBV2 DRAFT could not be created.");
      return created;
    });
  },
  async saveOptionMutation({ organizationId, productId, actorUserId, source, treeJson }) {
    const { db } = await import("../../db");
    return db.transaction(async (tx) => {
      if (source.status === "DRAFT") {
        const [latest] = await tx.select({ id: pbv2TreeVersions.id }).from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
        if (latest?.id !== source.id) return null;
        const [updated] = await tx.update(pbv2TreeVersions).set({ treeJson, schemaVersion: 2, updatedByUserId: actorUserId, updatedAt: new Date() }).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.id, source.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.updatedAt, source.updatedAt))).returning();
        return updated ?? null;
      }
      const [newerDraft] = await tx.select({ id: pbv2TreeVersions.id }).from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
      if (newerDraft) return null;
      const [linked] = await tx.select({ id: products.id }).from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, productId), eq(products.pbv2ActiveTreeVersionId, source.id))).limit(1);
      if (!linked) return null;
      const [created] = await tx.insert(pbv2TreeVersions).values({ organizationId, productId, status: "DRAFT", schemaVersion: 2, treeJson, createdByUserId: actorUserId, updatedByUserId: actorUserId }).returning();
      return created ?? null;
    });
  },
};

function normalized(value: unknown): string { return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}
function fingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function cloneTree(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_INVALID", "PBV2 treeJson must be an object.");
  const next = structuredClone(value as Record<string, any>);
  const rawNodes = next.nodes;
  if (Array.isArray(rawNodes)) next.nodes = Object.fromEntries(rawNodes.filter((node) => node && typeof node === "object" && typeof node.id === "string").map((node) => [node.id, node]));
  if (!next.nodes || typeof next.nodes !== "object" || Array.isArray(next.nodes)) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_INVALID", "PBV2 nodes must be a record or array.");
  next.edges = Array.isArray(next.edges) ? next.edges : [];
  next.schemaVersion = Number(next.schemaVersion ?? 2);
  next.status = "DRAFT";
  return next;
}
function liveNodes(tree: Record<string, any>): any[] { return Object.values(tree.nodes).filter((node: any) => node && typeof node === "object" && String(node.status ?? "ENABLED").toUpperCase() !== "DELETED"); }
function uniqueNode(tree: Record<string, any>, reference: string, type: "GROUP" | "INPUT"): any {
  const needle = normalized(reference);
  const matches = liveNodes(tree).filter((node) => String(node.type ?? "").toUpperCase() === type && [node.id, node.key, node.label, node.input?.selectionKey].some((value) => normalized(value) === needle));
  if (matches.length !== 1) throw new CanonicalPbv2OptionConfigurationError("PBV2_REFERENCE_UNRESOLVED", `The ${type === "GROUP" ? "option group" : "input"} '${reference}' is not uniquely available.`);
  return matches[0];
}
function uniqueChoice(node: any, reference: string): any {
  const needle = normalized(reference); const matches = (Array.isArray(node.choices) ? node.choices : []).filter((choice: any) => [choice?.value, choice?.label].some((value) => normalized(value) === needle));
  if (matches.length !== 1) throw new CanonicalPbv2OptionConfigurationError("PBV2_REFERENCE_UNRESOLVED", `The option value '${reference}' is not uniquely available.`);
  return matches[0];
}
function nextId(prefix: string, seed: string, tree: Record<string, any>): string {
  const base = `${prefix}_${seed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item"}`;
  let candidate = base; let index = 2;
  const ids = new Set([...Object.keys(tree.nodes), ...tree.edges.map((edge: any) => edge?.id).filter(Boolean)]);
  while (ids.has(candidate)) candidate = `${base}_${index++}`;
  return candidate;
}
function setVisibility(target: any, rules: VisibilityRule[] | null | undefined): void {
  if (rules === undefined) return;
  if (rules === null || rules.length === 0) {
    const { rules: _rules, ...rest } = target.visibility && typeof target.visibility === "object" ? target.visibility : {};
    target.visibility = Object.keys(rest).length ? rest : undefined;
  } else target.visibility = { ...(target.visibility && typeof target.visibility === "object" ? target.visibility : {}), rules };
}
function describeDefault(node: any): string {
  const value = node.input?.defaultValue;
  if (value === undefined) return "(none)";
  if (Array.isArray(value)) return value.join(", ");
  const choice = Array.isArray(node.choices) ? node.choices.find((item: any) => item?.value === value) : null;
  return String(choice?.label ?? value);
}
function change(changes: Array<{ field: string; before: string; after: string }>, field: string, before: unknown, after: unknown): void {
  const left = before === undefined || before === null || before === "" ? "(none)" : String(before);
  const right = after === undefined || after === null || after === "" ? "(none)" : String(after);
  if (left !== right) changes.push({ field, before: left, after: right });
}

export function applyPbv2OptionConfigurationMutations(treeValue: unknown, rawMutations: unknown): { tree: Record<string, any>; changes: Array<{ field: string; before: string; after: string }> } {
  const mutations = pbv2OptionConfigurationMutationsSchema.parse(rawMutations);
  const tree = cloneTree(treeValue); const changes: Array<{ field: string; before: string; after: string }> = [];
  for (const mutation of mutations) {
    if (mutation.kind === "add_group") {
      if (liveNodes(tree).some((node) => [node.key, node.label].some((value) => [mutation.group.key, mutation.group.label].some((candidate) => normalized(value) === normalized(candidate))))) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", `Option group key or label '${mutation.group.key}' already exists.`);
      const id = nextId("group", mutation.group.key, tree); const order = liveNodes(tree).filter((node) => String(node.type).toUpperCase() === "GROUP").length;
      tree.nodes[id] = { id, kind: "group", type: "GROUP", status: "ENABLED", key: mutation.group.key, label: mutation.group.label, description: mutation.group.description ?? "", input: { type: mutation.group.multiSelect ? "multiselect" : "select", required: mutation.group.required ?? false }, displayOrder: order, ui: { sortOrder: order }, ...(mutation.group.visibilityRules?.length ? { visibility: { rules: mutation.group.visibilityRules } } : {}) };
      changes.push({ field: `Option group ${mutation.group.label}`, before: "(missing)", after: "created" }); continue;
    }
    if (mutation.kind === "reorder_groups") {
      const groups = liveNodes(tree).filter((node) => String(node.type).toUpperCase() === "GROUP").sort((left, right) => Number(left.displayOrder ?? left.ui?.sortOrder ?? 0) - Number(right.displayOrder ?? right.ui?.sortOrder ?? 0));
      const requested = mutation.orderedGroups.map((reference) => uniqueNode(tree, reference, "GROUP"));
      if (new Set(requested.map((group) => group.id)).size !== groups.length || requested.length !== groups.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "Group ordering must contain every current group exactly once.");
      requested.forEach((group, index) => { group.displayOrder = index; group.ui = { ...(group.ui ?? {}), sortOrder: index }; });
      change(changes, "Option group order", groups.map((group) => group.label).join(", "), requested.map((group) => group.label).join(", ")); continue;
    }
    if (mutation.kind === "update_group") {
      const group = uniqueNode(tree, mutation.group, "GROUP"); const label = group.label ?? mutation.group;
      if (mutation.changes.label !== undefined) { change(changes, `${label} label`, group.label, mutation.changes.label); group.label = mutation.changes.label; }
      if (mutation.changes.description !== undefined) { change(changes, `${label} description`, group.description, mutation.changes.description); group.description = mutation.changes.description; }
      if (mutation.changes.required !== undefined) { change(changes, `${label} required`, Boolean(group.input?.required), mutation.changes.required); group.input = { ...(group.input ?? {}), type: group.input?.type ?? "select", required: mutation.changes.required }; }
      if (mutation.changes.multiSelect !== undefined) { change(changes, `${label} selection mode`, group.input?.type === "multiselect" ? "multi-select" : "single-select", mutation.changes.multiSelect ? "multi-select" : "single-select"); group.input = { ...(group.input ?? {}), type: mutation.changes.multiSelect ? "multiselect" : "select" }; }
      if (mutation.changes.visibilityRules !== undefined) { change(changes, `${label} visibility`, JSON.stringify(group.visibility?.rules ?? []), JSON.stringify(mutation.changes.visibilityRules ?? [])); setVisibility(group, mutation.changes.visibilityRules); }
      continue;
    }
    if (mutation.kind === "add_input") {
      const group = uniqueNode(tree, mutation.group, "GROUP");
      if (liveNodes(tree).some((node) => String(node.type).toUpperCase() === "INPUT" && normalized(node.input?.selectionKey) === normalized(mutation.input.selectionKey))) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", `Selection key '${mutation.input.selectionKey}' already exists.`);
      const id = nextId("input", mutation.input.selectionKey, tree); const edgeId = nextId("edge", `${group.id}_${id}`, tree);
      tree.nodes[id] = { id, kind: "question", type: "INPUT", status: "ENABLED", key: mutation.input.selectionKey, label: mutation.input.label, description: mutation.input.description ?? "", input: { type: mutation.input.type, valueType: mutation.input.type === "boolean" ? "BOOLEAN" : mutation.input.type === "number" || mutation.input.type === "dimension" ? "NUMBER" : mutation.input.type === "select" || mutation.input.type === "multiselect" ? "ENUM" : "TEXT", selectionKey: mutation.input.selectionKey, required: mutation.input.required ?? false, ...(mutation.input.defaultValue !== undefined && mutation.input.defaultValue !== null ? { defaultValue: mutation.input.defaultValue } : {}) }, ...(mutation.input.choices ? { choices: mutation.input.choices.map((item, index) => ({ ...item, sortOrder: item.sortOrder ?? index })) } : {}), ...(mutation.input.visibilityRules?.length ? { visibility: { rules: mutation.input.visibilityRules } } : {}), pricingImpact: [], weightImpact: [] };
      tree.edges.push({ id: edgeId, fromNodeId: group.id, toNodeId: id, status: "DISABLED", priority: tree.edges.filter((edge: any) => edge?.fromNodeId === group.id).length, condition: { op: "EXISTS", value: { op: "literal", value: true } } });
      tree.rootNodeIds = Array.from(new Set([...(Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : []), id]));
      changes.push({ field: `Input ${mutation.input.label}`, before: "(missing)", after: `${mutation.input.type} created` }); continue;
    }
    const input = uniqueNode(tree, mutation.input, "INPUT"); const label = input.label ?? mutation.input;
    if (mutation.kind === "set_default") {
      const before = describeDefault(input); input.input = { ...(input.input ?? {}) };
      if (mutation.choice === null) delete input.input.defaultValue;
      else input.input.defaultValue = uniqueChoice(input, mutation.choice).value;
      change(changes, `${label} default`, before, describeDefault(input)); continue;
    }
    if (mutation.kind === "update_input") {
      if (mutation.changes.label !== undefined) { change(changes, `${label} label`, input.label, mutation.changes.label); input.label = mutation.changes.label; }
      if (mutation.changes.description !== undefined) { change(changes, `${label} description`, input.description, mutation.changes.description); input.description = mutation.changes.description; }
      if (mutation.changes.type !== undefined) { change(changes, `${label} input type`, input.input?.type, mutation.changes.type); input.input = { ...(input.input ?? {}), type: mutation.changes.type, valueType: mutation.changes.type === "boolean" ? "BOOLEAN" : mutation.changes.type === "number" || mutation.changes.type === "dimension" ? "NUMBER" : mutation.changes.type === "select" || mutation.changes.type === "multiselect" ? "ENUM" : "TEXT" }; }
      if (mutation.changes.required !== undefined) { change(changes, `${label} required`, Boolean(input.input?.required), mutation.changes.required); input.input = { ...(input.input ?? {}), required: mutation.changes.required }; }
      if (mutation.changes.defaultValue !== undefined) { const before = describeDefault(input); input.input = { ...(input.input ?? {}) }; if (mutation.changes.defaultValue === null) delete input.input.defaultValue; else input.input.defaultValue = mutation.changes.defaultValue; change(changes, `${label} default`, before, describeDefault(input)); }
      if (mutation.changes.visibilityRules !== undefined) { change(changes, `${label} visibility`, JSON.stringify(input.visibility?.rules ?? []), JSON.stringify(mutation.changes.visibilityRules ?? [])); setVisibility(input, mutation.changes.visibilityRules); }
      continue;
    }
    if (mutation.kind === "add_choice") {
      if (!new Set(["select", "multiselect"]).has(input.input?.type)) throw new CanonicalPbv2OptionConfigurationError("PBV2_UNSUPPORTED_MODEL", "Choices can only be added to select or multiselect inputs.");
      if ((input.choices ?? []).some((item: any) => normalized(item.value) === normalized(mutation.choice.value))) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", `Choice value '${mutation.choice.value}' already exists.`);
      input.choices = [...(input.choices ?? []), { ...mutation.choice, sortOrder: mutation.choice.sortOrder ?? (input.choices ?? []).length }]; changes.push({ field: `${label} option value`, before: "(missing)", after: mutation.choice.label }); continue;
    }
    if (mutation.kind === "update_choice") {
      const choice = uniqueChoice(input, mutation.choice); const choiceLabel = choice.label ?? choice.value;
      if (mutation.changes.label !== undefined) { change(changes, `${label} choice ${choiceLabel} label`, choice.label, mutation.changes.label); choice.label = mutation.changes.label; }
      if (mutation.changes.description !== undefined) { change(changes, `${label} choice ${choiceLabel} description`, choice.description, mutation.changes.description); choice.description = mutation.changes.description; }
      if (mutation.changes.sortOrder !== undefined) { change(changes, `${label} choice ${choiceLabel} order`, choice.sortOrder, mutation.changes.sortOrder); choice.sortOrder = mutation.changes.sortOrder; }
      if (mutation.changes.visibilityRules !== undefined) { change(changes, `${label} choice ${choiceLabel} visibility`, JSON.stringify(choice.visibilityRules ?? []), JSON.stringify(mutation.changes.visibilityRules)); choice.visibilityRules = mutation.changes.visibilityRules; }
      continue;
    }
    const current = (input.choices ?? []).map((item: any) => item.value); const requested = mutation.orderedValues;
    if (new Set(current).size !== requested.length || new Set(requested).size !== requested.length || requested.some((value) => !current.includes(value))) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "Choice ordering must contain every current value exactly once.");
    input.choices = requested.map((value, index) => ({ ...input.choices.find((item: any) => item.value === value), sortOrder: index })); change(changes, `${label} option order`, current.join(", "), requested.join(", "));
  }
  if (!changes.length) throw new CanonicalPbv2OptionConfigurationError("NO_PBV2_OPTION_CHANGES", "The requested PBV2 option configuration already matches the DRAFT.");
  return { tree, changes };
}

function referencedSelectionKeys(rule: VisibilityRule): string[] {
  if (rule.type === "and" || rule.type === "or") return rule.rules.flatMap(referencedSelectionKeys);
  if (rule.type === "not") return referencedSelectionKeys(rule.rule);
  return [rule.selectionKey];
}
function simpleRules(rule: VisibilityRule): VisibilityRule[] {
  if (rule.type === "and" || rule.type === "or") return rule.rules.flatMap(simpleRules);
  if (rule.type === "not") return simpleRules(rule.rule);
  return [rule];
}
function validateOptionConfiguration(tree: Record<string, any>, strict: boolean): readonly unknown[] {
  const nodes = liveNodes(tree); const inputByKey = new Map<string, any>(); const findings: Array<{ code: string; message: string; path?: string }> = [];
  for (const node of nodes) {
    if (!String(node.label ?? "").trim()) findings.push({ code: "PBV2_OPTION_LABEL_REQUIRED", message: "Every option group/input must have a label.", path: `nodes.${node.id}.label` });
    if (String(node.type).toUpperCase() !== "INPUT") continue;
    const key = String(node.input?.selectionKey ?? "").trim();
    if (!key || inputByKey.has(key)) findings.push({ code: "PBV2_SELECTION_KEY_INVALID", message: `Selection key '${key || "(missing)"}' must be present and unique.`, path: `nodes.${node.id}.input.selectionKey` }); else inputByKey.set(key, node);
    const choices = Array.isArray(node.choices) ? node.choices : [];
    const values = choices.map((item: any) => String(item?.value ?? ""));
    if (new Set(values).size !== values.length || values.some((value: string) => !value.trim()) || choices.some((item: any) => !String(item?.label ?? "").trim())) findings.push({ code: "PBV2_CHOICE_VALUES_INVALID", message: `Choices for '${node.label}' require unique non-empty values and labels.` });
    if (strict && ["select", "multiselect"].includes(node.input?.type) && node.input?.required && choices.length === 0) findings.push({ code: "PBV2_REQUIRED_SELECT_EMPTY", message: `Required input '${node.label}' needs at least one choice.` });
    const defaultValue = node.input?.defaultValue;
    if (defaultValue !== undefined && ["select", "multiselect"].includes(node.input?.type)) {
      const defaults = Array.isArray(defaultValue) ? defaultValue : [defaultValue];
      if (defaults.some((value) => !values.includes(String(value)))) findings.push({ code: "PBV2_DEFAULT_INVALID", message: `Default for '${node.label}' must reference an existing choice.` });
      if (strict && node.input?.type === "select" && Array.isArray(defaultValue)) findings.push({ code: "PBV2_DEFAULT_TYPE_INVALID", message: `Single-select default for '${node.label}' must be one choice value.` });
      if (strict && node.input?.type === "multiselect" && !Array.isArray(defaultValue)) findings.push({ code: "PBV2_DEFAULT_TYPE_INVALID", message: `Multiselect default for '${node.label}' must be an array of choice values.` });
    }
    if (strict && defaultValue !== undefined && node.input?.type === "boolean" && typeof defaultValue !== "boolean") findings.push({ code: "PBV2_DEFAULT_TYPE_INVALID", message: `Boolean default for '${node.label}' must be true or false.` });
    if (strict && defaultValue !== undefined && ["number", "dimension"].includes(node.input?.type) && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) findings.push({ code: "PBV2_DEFAULT_TYPE_INVALID", message: `Numeric default for '${node.label}' must be a finite number.` });
    if (strict && defaultValue !== undefined && ["text", "textarea"].includes(node.input?.type) && typeof defaultValue !== "string") findings.push({ code: "PBV2_DEFAULT_TYPE_INVALID", message: `Text default for '${node.label}' must be text.` });
  }
  for (const node of nodes) {
    const ruleSets: VisibilityRule[][] = [Array.isArray(node.visibility?.rules) ? node.visibility.rules : [], ...(Array.isArray(node.choices) ? node.choices.map((choice: any) => Array.isArray(choice.visibilityRules) ? choice.visibilityRules : []) : [])];
    for (const rules of ruleSets) for (const rule of rules) for (const simple of simpleRules(rule)) {
      const key = "selectionKey" in simple ? simple.selectionKey : ""; const provider = inputByKey.get(key);
      if (!provider) { findings.push({ code: "PBV2_CONDITION_REFERENCE_INVALID", message: `Visibility condition references missing selection key '${key}'.` }); continue; }
      if (!["select", "multiselect", "boolean"].includes(provider.input?.type) || simple.type === "truthy") continue;
      const values = simple.type === "in" ? simple.values : "value" in simple ? [simple.value] : [];
      const allowed = provider.input?.type === "boolean" ? [true, false] : (provider.choices ?? []).map((choice: any) => choice.value);
      if (values.some((value) => !allowed.includes(value))) findings.push({ code: "PBV2_CONDITION_VALUE_INVALID", message: `Visibility condition value is not valid for selection key '${key}'.` });
    }
  }
  const existingFindings = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS).findings.filter((finding: any) => {
    const code = String(finding?.code ?? "");
    return code.startsWith("PBV2_E_TREE_DUPLICATE") || code === "PBV2_E_TREE_KEY_COLLISION" || code.startsWith("PBV2_E_INPUT_") || code === "PBV2_E_SELECTION_KEY_COLLISION" || code === "PBV2_E_CHOICE_VALUE_DUPLICATE";
  });
  return [...findings, ...existingFindings];
}

/** Persistence-free canonical PBV2 validation for pre-persistence proposals.
 * Draft mode permits genuinely missing choices while still enforcing keys,
 * defaults, ordering structure, and visibility references. */
export function validateCanonicalPbv2OptionConfigurationTree(tree: Record<string, any>, strict = false): readonly unknown[] {
  return validateOptionConfiguration(tree, strict);
}

export type CanonicalPbv2OptionConfigurationProposal = { productId: string; productName: string; productActive: boolean; sourceTreeId: string; sourceTreeStatus: "DRAFT" | "ACTIVE"; expectedTreeUpdatedAt: string; changes: Array<{ field: string; before: string; after: string }>; fingerprint: string; operationReference: "products.update_option_configuration.v1" };
export type CanonicalPbv2OptionConfigurationResult = { draft: TreeRow; appliedChanges: readonly { field: string; before: string; after: string }[]; resultingVersion: string; operationReference: "products.update_option_configuration.v1"; auditReference: string };

export class CanonicalPbv2OptionConfigurationOperations {
  constructor(private readonly repository: Store = store) {}
  private async source(input: { organizationId: string; productId: string }): Promise<{ product: ProductRow; tree: TreeRow }> {
    const product = await this.repository.getProduct(input); if (!product) throw new CanonicalPbv2OptionConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available.");
    const draft = await this.repository.getLatestDraft(input); if (draft) return { product, tree: draft };
    if (!product.pbv2ActiveTreeVersionId) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_UNAVAILABLE", "This product has no PBV2 configuration to edit.");
    const active = await this.repository.getTree({ ...input, treeId: product.pbv2ActiveTreeVersionId });
    if (!active || active.status !== "ACTIVE") throw new CanonicalPbv2OptionConfigurationError("PBV2_LIFECYCLE_RESTRICTED", "The current active PBV2 configuration is unavailable for draft creation.");
    return { product, tree: active };
  }
  async saveEditorDraft(input: { organizationId: string; actorUserId: string; productId: string; treeJson: unknown }): Promise<{ draft: TreeRow; sanitizerChanges: readonly unknown[] }> {
    if (!input.actorUserId) throw new CanonicalPbv2OptionConfigurationError("ACTOR_REQUIRED", "An authenticated actor is required.");
    if (!await this.repository.getProduct(input)) throw new CanonicalPbv2OptionConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available.");
    const candidate = cloneTree(input.treeJson);
    const materialAuthority = normalizePbv2ChoiceConsumptionMaterialAuthority(candidate);
    const sanitized = sanitizePbv2PricingMatrix(materialAuthority.tree, { allowIncompleteMatrix: true });
    const pricingFindings = validateTreeForPublish(sanitized.tree as any, DEFAULT_VALIDATE_OPTS).errors.filter((finding: any) => {
      if (!String(finding?.code ?? "").startsWith("PBV2_E_PRICING_MATRIX")) return false;
      if (finding?.code !== "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE" || !String(finding?.path ?? "").endsWith(".rows")) return true;
      const matrix = String(finding.path).startsWith("tree.meta.") ? sanitized.tree?.meta?.pricingMatrix : sanitized.tree?.pricingMatrix;
      return !(Array.isArray(matrix?.dimensions) && matrix.dimensions.length > 0 && Array.isArray(matrix?.rows) && matrix.rows.length === 0);
    });
    if (pricingFindings.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "PBV2 pricing matrix still has invalid references after cleanup.", pricingFindings);
    const findings = validateOptionConfiguration(sanitized.tree, false); if (findings.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "The PBV2 DRAFT option structure is invalid.", findings);
    const pricing = normalizeCanonicalProductPricingTree(sanitized.tree, { allowIncompleteMatrix: true });
    return { draft: await this.repository.saveEditorDraft({ ...input, treeJson: pricing.tree }), sanitizerChanges: [...materialAuthority.changes, ...sanitized.changes, ...pricing.sanitizerChanges] };
  }
  async propose(input: { organizationId: string; productId: string; mutations: unknown }): Promise<CanonicalPbv2OptionConfigurationProposal> {
    const source = await this.source(input); const applied = applyPbv2OptionConfigurationMutations(source.tree.treeJson, input.mutations); const findings = validateOptionConfiguration(applied.tree, true);
    if (findings.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "The proposed PBV2 option configuration is invalid.", findings);
    const expectedTreeUpdatedAt = new Date(source.tree.updatedAt).toISOString(); const mutations = pbv2OptionConfigurationMutationsSchema.parse(input.mutations);
    return { productId: source.product.id, productName: source.product.name, productActive: source.product.isActive, sourceTreeId: source.tree.id, sourceTreeStatus: source.tree.status as "DRAFT" | "ACTIVE", expectedTreeUpdatedAt, changes: applied.changes, fingerprint: fingerprint({ productId: source.product.id, sourceTreeId: source.tree.id, expectedTreeUpdatedAt, mutations }), operationReference: "products.update_option_configuration.v1" };
  }
  async execute(input: { organizationId: string; actorUserId: string; productId: string; mutations: unknown; expectedTreeId: string; expectedTreeUpdatedAt: string; auditContext?: { source: "assistant_go"; reference?: string } }): Promise<CanonicalPbv2OptionConfigurationResult> {
    if (!input.actorUserId) throw new CanonicalPbv2OptionConfigurationError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const current = await this.source(input);
    if (current.tree.id !== input.expectedTreeId || new Date(current.tree.updatedAt).toISOString() !== input.expectedTreeUpdatedAt) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_STALE", "The PBV2 DRAFT changed before this update could be applied. Review it again.");
    const applied = applyPbv2OptionConfigurationMutations(current.tree.treeJson, input.mutations); const findings = validateOptionConfiguration(applied.tree, true);
    if (findings.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "The PBV2 option configuration is invalid.", findings);
    const updated = await this.repository.saveOptionMutation({ organizationId: input.organizationId, productId: input.productId, actorUserId: input.actorUserId, source: current.tree, treeJson: applied.tree });
    if (!updated) throw new CanonicalPbv2OptionConfigurationError("PBV2_DRAFT_STALE", "The PBV2 DRAFT changed before this update could be applied. Review it again.");
    return { draft: updated, appliedChanges: applied.changes, resultingVersion: new Date(updated.updatedAt).toISOString(), operationReference: "products.update_option_configuration.v1", auditReference: input.auditContext?.reference ?? `assistant_go:${updated.id}:${new Date(updated.updatedAt).toISOString()}` };
  }
}

export const canonicalPbv2OptionConfigurationOperations = new CanonicalPbv2OptionConfigurationOperations();

export function renderCanonicalPbv2OptionMigrationMarkdown(): string {
  return `# Shared canonical PBV2 option migration\n\n> Generated from \`server/services/products/canonicalPbv2OptionConfigurationOperations.ts\`. Pricing is delegated to the shared Product pricing boundary; Product lifecycle mutations are excluded.\n\n| Operation | Shared users | Supported PBV2 representation | Compatibility | Deferred |\n|---|---|---|---|---|\n| \`products.update_option_configuration.v1\` | Product Editor DRAFT save; confirmed \`products.update_existing_product\` command | GROUP/INPUT labels and descriptions, required state, input type, choice metadata/order, defaults, node/group/choice visibility rules | Legacy \`set_option_default\` is accepted and translated to this operation | Publish/activate, deletion, customer-specific configuration |\n\n## Parity classification\n\n| Product area | Classification | Evidence |\n|---|---|---|\n| Group/input/choice metadata, required/default, text inputs, simple visibility | \`shared_canonical\` | Product Editor DRAFT save and confirmed Operator use the shared operation |\n| \`set_option_default\` identifier | \`compatibility_only\` | Accepted for persisted plans; translated to the canonical PBV2 mutation |\n| Option deletion and complex nested visibility authoring | \`ui_only_not_migrated\` | Existing editor/model paths remain; not model-facing in this operation |\n| ProductIntentCompiler semantic PBV2 construction | \`shared_canonical\` | New-product proposals use the same option and pricing schemas before persistence |\n| Dedicated first-class conditional-input entity | \`unsupported_underlying_model\` | PBV2 represents conditional input through generic INPUT visibility rules |\n| Pricing | \`shared_canonical\` | DRAFT saves delegate validation to \`CanonicalProductPricingOperations\`; dedicated pricing commands share the same boundary |\n| Product lifecycle | \`ui_only_not_migrated\` | Publish and activate remain outside this operation |\n`;
}
