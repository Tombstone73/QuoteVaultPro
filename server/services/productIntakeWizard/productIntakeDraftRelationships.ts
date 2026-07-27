import { z } from "zod";

const namedReferenceSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  key: z.string().trim().min(1).max(80).optional(),
}).strict().refine((value) => Boolean(value.id || value.name || value.key), "A deterministic ID, name, or key is required.");

export const productDraftRelationshipPatchSchema = z.object({
  routing: z.object({
    operation: z.enum(["set_primary", "clear"]),
    station: namedReferenceSchema.optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.operation === "set_primary" && !value.station) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A station is required when setting routing." });
    if (value.operation === "clear" && value.station) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A station cannot be supplied when clearing routing." });
  }).optional(),
  options: z.object({
    operation: z.enum(["add", "remove", "replace", "clear"]),
    templates: z.array(namedReferenceSchema).max(25).optional(),
  }).strict().superRefine((value, ctx) => {
    const needsTemplates = value.operation === "add" || value.operation === "remove" || value.operation === "replace";
    if (needsTemplates && !value.templates) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option templates are required for this option operation." });
    if (value.operation === "clear" && value.templates) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Templates cannot be supplied when clearing options." });
  }).optional(),
  setupNote: z.object({
    operation: z.enum(["append", "replace", "clear"]),
    text: z.string().trim().min(1).max(4_000).optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.operation !== "clear" && !value.text) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Note text is required." });
    if (value.operation === "clear" && value.text) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Text cannot be supplied when clearing a note." });
  }).optional(),
  reviewWarnings: z.object({
    operation: z.enum(["add", "remove", "replace", "clear"]),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(50).optional(),
  }).strict().superRefine((value, ctx) => {
    const needsWarnings = value.operation !== "clear";
    if (needsWarnings && !value.warnings) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Warnings are required for this warning operation." });
    if (!needsWarnings && value.warnings) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Warnings cannot be supplied when clearing." });
  }).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "At least one relationship operation is required.");

export type ProductDraftRelationshipPatch = z.infer<typeof productDraftRelationshipPatchSchema>;

export type DraftRelationshipSnapshot = {
  routing: { stationId: string; stationKey: string; stationName: string } | null;
  optionTemplates: Array<{ templateId: string; name: string; importInstanceId: string }>;
  setupNote: string | null;
  reviewWarnings: string[];
  missingFieldWarnings: string[];
};

export function normalizeRelationshipText(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

export function relationshipSnapshotFromTree(treeJson: any): Omit<DraftRelationshipSnapshot, "missingFieldWarnings"> {
  const intake = treeJson?.meta?.productIntake && typeof treeJson.meta.productIntake === "object" ? treeJson.meta.productIntake : {};
  const routing = intake.draftRouting && typeof intake.draftRouting === "object" ? intake.draftRouting : null;
  const optionTemplates = Array.isArray(intake.draftOptionTemplates) ? intake.draftOptionTemplates : [];
  return {
    routing: routing && typeof routing.stationId === "string" && typeof routing.stationKey === "string" && typeof routing.stationName === "string"
      ? { stationId: routing.stationId, stationKey: routing.stationKey, stationName: routing.stationName }
      : null,
    optionTemplates: optionTemplates
      .filter((item: any) => item && typeof item.templateId === "string" && typeof item.name === "string" && typeof item.importInstanceId === "string")
      .map((item: any) => ({ templateId: item.templateId, name: item.name, importInstanceId: item.importInstanceId })),
    setupNote: typeof intake.internalSetupNote === "string" && intake.internalSetupNote.trim() ? intake.internalSetupNote.trim() : null,
    reviewWarnings: Array.isArray(intake.reviewWarnings) ? intake.reviewWarnings.map(String).map((value: string) => value.trim()).filter(Boolean) : [],
  };
}

export function removeTemplateImport(treeJson: any, importInstanceId: string): any {
  const tree = JSON.parse(JSON.stringify(treeJson ?? {}));
  const nodes = tree.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
  const removed = new Set(Object.values(nodes)
    .filter((node: any) => node?.meta?.templateSource?.importInstanceId === importInstanceId)
    .map((node: any) => String(node.id)));
  if (!removed.size) return tree;
  for (const nodeId of Array.from(removed)) delete nodes[nodeId];
  tree.nodes = nodes;
  tree.edges = Array.isArray(tree.edges)
    ? tree.edges.filter((edge: any) => !removed.has(String(edge?.fromNodeId)) && !removed.has(String(edge?.toNodeId)) && !String(edge?.id ?? "").includes(importInstanceId))
    : [];
  tree.rules = Array.isArray(tree.rules) ? tree.rules.filter((rule: any) => !String(rule?.id ?? "").includes(importInstanceId)) : [];
  const incoming = new Set(tree.edges.map((edge: any) => edge?.toNodeId).filter(Boolean));
  tree.rootNodeIds = Object.values(nodes)
    .filter((node: any) => node?.id && String(node?.type ?? "").toUpperCase() !== "GROUP" && !incoming.has(node.id))
    .map((node: any) => node.id);
  return tree;
}
