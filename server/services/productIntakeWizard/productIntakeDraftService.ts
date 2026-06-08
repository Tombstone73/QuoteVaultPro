import { randomUUID } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  auditLogs,
  pbv2OptionGroupTemplates,
  pbv2TreeVersions,
  productIntakeSessions,
  products,
  productTypes,
} from "@shared/schema";
import {
  productIntakeBriefSchema,
  productIntakeSessionSchema,
  type ProductIntakeBrief,
  type ProductIntakeOption,
  type ProductIntakeSession,
} from "@shared/productIntakeWizardSchemas";
import { validateOptionTreeV2, type OptionTreeV2 } from "@shared/optionTreeV2";
import { cloneTemplateIntoTree } from "@shared/pbv2/optionGroupTemplates";
import { db as defaultDb } from "../../db";
import { ProductIntakeSessionError } from "./productIntakeSessionService";

type TemplateRow = {
  id: string;
  templateTree: Record<string, any>;
};

export type ProductIntakeDraftCreationResult = {
  productId: string;
  pbv2TreeVersionId: string;
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

function addQuestionNode(args: {
  tree: OptionTreeV2;
  key: string;
  label: string;
  inputType: "boolean" | "select" | "number" | "dimension";
  required: boolean;
  choices?: Array<{ value: string; label: string; sortOrder?: number }>;
  usedNodeIds: Set<string>;
  sortOrder: number;
}) {
  const nodeId = uniqueKey(`intake_${safeKey(args.key, "option")}`, args.usedNodeIds);
  args.tree.nodes[nodeId] = {
    id: nodeId,
    kind: "question",
    type: "INPUT",
    status: "ENABLED",
    key: args.key,
    label: args.label,
    ui: { sortOrder: args.sortOrder },
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
  args.tree.rootNodeIds.push(nodeId);
}

function shouldCollectDimensions(brief: ProductIntakeBrief): boolean {
  const text = `${brief.sizeBehavior.behavior} ${brief.sizeBehavior.notes ?? ""}`.toLowerCase();
  return /custom|size|dimension|area|sqft|square|width|height|sheet/.test(text);
}

function shouldCollectQuantity(brief: ProductIntakeBrief): boolean {
  const text = `${brief.quantityBehavior.behavior} ${brief.quantityBehavior.notes ?? ""}`.toLowerCase();
  return !/unknown|none|not applicable|fixed/.test(text);
}

function pricingModeForBrief(brief: ProductIntakeBrief): "area" | "quantity" | "flat" {
  const text = `${brief.pricingAnalysis.behavior} ${brief.pricingAnalysis.notes ?? ""}`.toLowerCase();
  if (/flat|fixed/.test(text)) return "flat";
  if (/qty|quantity|tier|piece|each/.test(text)) return "quantity";
  return "area";
}

function collectTemplateIds(brief: ProductIntakeBrief): string[] {
  const ids = new Set<string>();
  const collect = (matches: ProductIntakeBrief["templateMatches"]) => {
    for (const match of matches) {
      if (match.recommendation === "suggest_reuse") ids.add(match.templateId);
    }
  };
  collect(brief.templateMatches);
  for (const option of [...brief.requiredOptions, ...brief.optionalOptions]) collect(option.templateMatches);
  return Array.from(ids).slice(0, 20);
}

function applyTemplateMatches(tree: OptionTreeV2, brief: ProductIntakeBrief, templates: TemplateRow[]): OptionTreeV2 {
  let current: OptionTreeV2 = tree;
  for (const template of templates) {
    const cloned = cloneTemplateIntoTree(current, template.templateTree, { sourceTemplateId: template.id });
    if (!cloned.ok) continue;
    current = cloned.tree as OptionTreeV2;
  }
  return current;
}

export function buildProductIntakeDraftTree(args: {
  brief: ProductIntakeBrief;
  sessionId: string;
  productName: string;
  userId: string | null;
  templates?: TemplateRow[];
  now?: Date;
}): OptionTreeV2 {
  const now = args.now ?? new Date();
  const usedNodeIds = new Set<string>();
  let tree: OptionTreeV2 = {
    schemaVersion: 2,
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
        base: {},
      },
      requiresDimensions: shouldCollectDimensions(args.brief),
    },
  };

  tree = applyTemplateMatches(tree, args.brief, args.templates ?? []);
  usedNodeIds.clear();
  Object.keys(tree.nodes).forEach((nodeId) => usedNodeIds.add(nodeId));

  let sortOrder = tree.rootNodeIds.length + 1;
  if (shouldCollectDimensions(args.brief)) {
    addQuestionNode({
      tree,
      key: "size",
      label: "Size",
      inputType: "dimension",
      required: true,
      usedNodeIds,
      sortOrder: sortOrder++,
    });
  }

  if (shouldCollectQuantity(args.brief)) {
    addQuestionNode({
      tree,
      key: "quantity",
      label: "Quantity",
      inputType: "number",
      required: true,
      usedNodeIds,
      sortOrder: sortOrder++,
    });
  }

  for (const option of [...args.brief.requiredOptions, ...args.brief.optionalOptions]) {
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
      sortOrder,
    });
  }

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
          now,
        });

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
          },
        });

        return {
          productId,
          pbv2TreeVersionId,
          session: mapSession(updatedSessionRow),
        };
      });
    },
  };
}
