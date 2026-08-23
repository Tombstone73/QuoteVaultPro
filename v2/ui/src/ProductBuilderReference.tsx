import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newBusinessRequestId,
  formulaApi,
  productApi,
  routingApi,
  type FormulaDomainListEntry,
  type ProductDraftFormulaPricing,
  type ProductDraftGeneral,
  type ProductDraftOption,
  type ProductDraftOptionPricing,
  type ProductDraftPricing,
  type ProductDraftPricingMatrix,
  type ProductDraftRouting,
  type ProductRecipeComponent,
  type ProductWorkspaceDetail,
} from "./api";
import { LovableProductBuilderRoot } from "./productBuilder/lovableRoot";
import { OptionGroupsSection } from "./productBuilder/optionGroups";
import { RecipeEditor } from "./productBuilder/recipe";
import { ProductionUnits, RoutingSection } from "./productBuilder/production-routing";
import { PricingEngine, OptionImpactsEditor } from "./productBuilder/pricing-engine";
import { MatrixPricing } from "./productBuilder/matrix-pricing";
import { PricingPreviewRail } from "./productBuilder/pricing-preview";
import { BasicsSection } from "./productBuilder/basics";
import { RuleCards, projectCanonicalConditions } from "./productBuilder/ruleCards";
import { ReviewSummary } from "./productBuilder/review";
import type { ProductBuilderSection } from "./productBuilder/lovableRoot";
import { Chip, Disclosure, Sub } from "./productBuilder/referencePrimitives";
import { pushWorkspaceLocation } from "./productRouting";

/*
 * This file is a direct production port of reference/lovable-ui's
 * _shell.product-builder.tsx composition.  It deliberately retains the
 * reference header, sticky navigation, section, sub-section and rail DOM
 * hierarchy while replacing its mock ProductDraft and calculator with the
 * canonical V2 draft read/mutate contracts.
 */

export type DirtySection = "general" | "options" | "pricing" | "matrix" | "formula" | "impacts" | "recipe" | "routing";
export type PublishDraftRevision = Readonly<{ draftVersionId: string; expectedDraftUpdatedAt: string }>;
export type PublishGate = Readonly<{ allowed: boolean; reason?: string }>;

/** Pure client-side guard only. The canonical publisher remains the readiness
 * and revision authority once this gate permits an attempt. */
export const publishGateForDraft = (input: Readonly<{
  canEdit: boolean; persisted: boolean; dirty: ReadonlySet<DirtySection>; saving: boolean; publishing: boolean;
  localErrors: number; saveError: string | null; requiresReconciliation: boolean;
}>): PublishGate => {
  if (!input.canEdit) return { allowed: false, reason: "You do not have permission to publish this Product." };
  if (!input.persisted) return { allowed: false, reason: "Save Changes must create the Product Draft before it can be published." };
  if (input.saving) return { allowed: false, reason: "Save Changes is still persisting this Draft." };
  if (input.publishing) return { allowed: false, reason: "Publishing is already in progress." };
  if (input.requiresReconciliation) return { allowed: false, reason: "This Draft changed elsewhere. Refresh and reconcile before publishing." };
  if (input.saveError) return { allowed: false, reason: "Resolve the latest Save Changes error before publishing." };
  if (input.dirty.size) return { allowed: false, reason: "Save Changes before publishing. Unsaved edits are not part of the canonical Draft." };
  if (input.localErrors) return { allowed: false, reason: "Fix local blocking issues before publishing." };
  return { allowed: true };
};
export type ProductBuilderDraftState = Readonly<{
  general: ProductDraftGeneral;
  options: readonly ProductDraftOption[];
  pricing: ProductDraftPricing["base"] & Readonly<{ flatFeeCents: number | null; tierBasis: ProductDraftPricing["tierBasis"]; tiers: ProductDraftPricing["tiers"]; tierSets: ProductDraftPricing["tierSets"] }>;
  /** Formula expressions are Formula-domain owned. A Product Draft stages
   * only an intentionally selected immutable revision and declared input
   * values; it never owns a second Formula expression. */
  formula: Readonly<{
    source: "formula_revision";
    formulaId?: string;
    formulaRevisionId?: string;
    expression: string;
    inputValues: Record<string, number | boolean>;
    allowRotation: boolean;
    rotationControl?: ProductDraftFormulaPricing["rotationControl"];
  }>;
  matrix: ProductDraftPricingMatrix | null;
  impacts: ProductDraftOptionPricing["options"];
  recipe: readonly ProductRecipeComponent[];
  routing: ProductDraftRouting["routing"];
}>;
type DraftState = ProductBuilderDraftState;

/**
 * The options transaction owns replacement of `new:` option identities.  All
 * dependent Draft sections must use those returned identities before their
 * own revision-aware writes run.  The transaction preserves option order, so
 * the index is a stable correlation boundary; existing identities are also
 * checked directly to avoid remapping a persisted option.
 */
export const optionIdMappingFromSaved = (
  submitted: readonly ProductDraftOption[],
  saved: readonly ProductDraftOption[],
): Readonly<Record<string, string>> => Object.fromEntries(submitted.flatMap((option, index) => {
  const persisted = saved[index];
  if (!option.optionId.startsWith("new:") || !persisted || persisted.optionId.startsWith("new:")) return [];
  return [[option.optionId, persisted.optionId] as const];
}));

const remapKey = (value: string, mapping: Readonly<Record<string, string>>): string => mapping[value] ?? value;

/** Remap only stable option/selection-key references; choice values remain
 * canonical and therefore are deliberately never rewritten. */
export const remapProductBuilderDraftOptionReferences = (
  draft: DraftState,
  mapping: Readonly<Record<string, string>>,
): DraftState => {
  if (!Object.keys(mapping).length) return draft;
  const remapCombination = (combination: Record<string, string | number | boolean>) => Object.fromEntries(
    Object.entries(combination).map(([selectionKey, value]) => [remapKey(selectionKey, mapping), value]),
  ) as Record<string, string | number | boolean>;
  return {
    ...draft,
    general: {
      ...draft.general,
      ...(draft.general.productionUnitSpecification ? {
        productionUnitSpecification: {
          ...draft.general.productionUnitSpecification,
          rules: draft.general.productionUnitSpecification.rules.map((rule) => ({
            ...rule,
            ...(rule.when ? { when: { ...rule.when, selectionKey: remapKey(rule.when.selectionKey, mapping) } } : {}),
          })),
        },
      } : {}),
    },
    options: draft.options.map((option) => ({ ...option, optionId: remapKey(option.optionId, mapping) })),
    formula: {
      ...draft.formula,
      ...(draft.formula.rotationControl ? {
        rotationControl: { ...draft.formula.rotationControl, optionId: remapKey(draft.formula.rotationControl.optionId, mapping) },
      } : {}),
    },
    matrix: draft.matrix ? {
      ...draft.matrix,
      dimensions: draft.matrix.dimensions.map((dimension) => ({ ...dimension, selectionKey: remapKey(dimension.selectionKey, mapping) })),
      rows: draft.matrix.rows.map((row) => ({ ...row, combination: remapCombination(row.combination) })),
    } : null,
    impacts: draft.impacts.map((option) => ({
      ...option,
      optionId: remapKey(option.optionId, mapping),
      selectionKey: remapKey(option.selectionKey, mapping),
    })),
    recipe: draft.recipe.map((component) => ({
      ...component,
      ...(component.condition ? { condition: { ...component.condition, optionId: remapKey(component.condition.optionId, mapping) } } : {}),
    })),
  };
};

const blankGeneral = (name = ""): ProductDraftGeneral => ({
  displayName: name,
  category: null,
  description: null,
  storefrontVisible: true,
  measurementMode: "dimensions_required",
  workflowIntent: "standard_production",
  requiresProofApproval: false,
  requiresProductionJob: false,
  productionUnitSpecification: null,
});
const blankState = (name = ""): DraftState => ({
  general: blankGeneral(name),
  options: [],
  pricing: { perPieceCents: null, perSqftCents: null, minimumChargeCents: null, flatFeeCents: null, tierBasis: null, tiers: [], tierSets: { quantity: [], squareFoot: [], computedSheetUsage: [] } },
  formula: { source: "formula_revision", expression: "", inputValues: {}, allowRotation: false },
  matrix: null,
  impacts: [],
  recipe: [],
  routing: { kind: "unconfigured" },
});
const clone = <T,>(value: T): T => structuredClone(value);

const key = (scope: string, org: string, id: string, part: string) => ["v2", scope, org, "reference-product-builder", id, part] as const;

export const ProductBuilderReference = ({
  organizationId, sessionScope, product, canEdit, publish, publishing, publishError, openCreatedProduct, newProduct = false,
}: Readonly<{
  organizationId: string; sessionScope: string; product?: ProductWorkspaceDetail; canEdit: boolean;
  publish?: (revision: PublishDraftRevision) => void; publishing?: boolean; publishError?: { code?: string; message?: string } | null; openCreatedProduct?: (id: string) => void; newProduct?: boolean;
}>) => {
  const productId = product?.productId;
  const client = useQueryClient();
  const generalRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "general"), queryFn: () => productApi.draftGeneral(organizationId, productId!), enabled: Boolean(productId) });
  const optionsRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "options"), queryFn: () => productApi.draftOptions(organizationId, productId!), enabled: Boolean(productId) });
  const pricingRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "pricing"), queryFn: () => productApi.draftPricing(organizationId, productId!), enabled: Boolean(productId) });
  const formulaRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "formula"), queryFn: () => productApi.draftFormula(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const formulaLibrary = useQuery<readonly FormulaDomainListEntry[]>({
    queryKey: ["v2", sessionScope, organizationId, "formulas", "picker"],
    queryFn: () => formulaApi.list(organizationId, { includeInactive: true }),
    enabled: Boolean(organizationId && sessionScope),
    retry: false,
  });
  const matrixRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "matrix"), queryFn: () => productApi.draftPricingMatrix(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const impactsRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "impacts"), queryFn: () => productApi.draftOptionPricing(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const recipeRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "recipe"), queryFn: () => productApi.draftRecipe(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const routingRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "routing"), queryFn: () => productApi.draftRouting(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const materials = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "materials"), queryFn: () => productApi.materials(organizationId, productId!), enabled: Boolean(productId) });
  const templates = useQuery({ queryKey: ["v2", sessionScope, organizationId, "routing", "picker"], queryFn: () => routingApi.workspace(organizationId), retry: false });
  const [draft, setDraft] = useState<DraftState>(() => blankState());
  const selectedFormulaId = draft.formula.formulaId ?? formulaRead.data?.formulaId ?? "";
  const formulaRevisions = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "formulas", selectedFormulaId, "revisions", "picker"],
    queryFn: () => formulaApi.revisions(organizationId, selectedFormulaId),
    enabled: Boolean(organizationId && sessionScope && selectedFormulaId),
    retry: false,
  });
  const [dirty, setDirty] = useState<ReadonlySet<DirtySection>>(() => new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewInputs, setPreviewInputs] = useState({ quantity: "1", width: "24", height: "18", selections: {} as Record<string, unknown> });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof productApi.previewDraftPricing>> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sectionJumpRef = useRef<((section: ProductBuilderSection) => void) | null>(null);
  const initialised = useRef<string | null>(null);
  const authoritativeDraft = useRef<PublishDraftRevision | null>(null);

  const sourceReady = !productId || Boolean(
    generalRead.data && optionsRead.data && pricingRead.data && recipeRead.data && routingRead.data
    && formulaRead.isFetched && matrixRead.isFetched && impactsRead.isFetched,
  );
  useEffect(() => {
    if (!productId) { if (initialised.current !== "new") { setDraft(blankState()); initialised.current = "new"; } return; }
    if (!sourceReady || initialised.current === productId) return;
    setDraft({
      general: clone(generalRead.data!.general), options: clone(optionsRead.data!.options),
      pricing: { ...clone(pricingRead.data!.base), flatFeeCents: pricingRead.data!.flatFeeCents, tierBasis: pricingRead.data!.tierBasis, tiers: clone(pricingRead.data!.tiers), tierSets: clone(pricingRead.data!.tierSets) },
      formula: formulaRead.data ? {
        source: "formula_revision",
        ...(formulaRead.data.formulaId ? { formulaId: formulaRead.data.formulaId } : {}),
        ...(formulaRead.data.formulaRevisionId ? { formulaRevisionId: formulaRead.data.formulaRevisionId } : {}),
        expression: formulaRead.data.expression,
        inputValues: clone(formulaRead.data.inputValues ?? {}),
        allowRotation: formulaRead.data.allowRotation,
        ...(formulaRead.data.rotationControl ? { rotationControl: clone(formulaRead.data.rotationControl) } : {}),
      } : { source: "formula_revision", expression: "", inputValues: {}, allowRotation: false },
      matrix: matrixRead.data ? clone(matrixRead.data) : null,
      impacts: impactsRead.data ? clone(impactsRead.data.options) : [], recipe: clone(recipeRead.data!.components), routing: clone(routingRead.data!.routing),
    });
    initialised.current = productId;
    setDirty(new Set()); setSaveError(null);
    authoritativeDraft.current = { draftVersionId: generalRead.data!.draftVersionId, expectedDraftUpdatedAt: generalRead.data!.draftUpdatedAt };
    setRequiresReconciliation(false);
  }, [productId, sourceReady, generalRead.data, optionsRead.data, pricingRead.data, formulaRead.data, matrixRead.data, impactsRead.data, recipeRead.data, routingRead.data]);
  useEffect(() => {
    if (!publishError) return;
    setSaveError(publishError.message ?? "Canonical publication readiness failed. Save and reconcile before trying again.");
    if (publishError.code === "STALE_STATE") setRequiresReconciliation(true);
  }, [publishError]);

  const patch = useCallback((section: DirtySection, update: (current: DraftState) => DraftState) => {
    setDraft((current) => update(clone(current)));
    setDirty((current) => new Set([...current, section]));
  }, []);
  const runSave = async (): Promise<boolean> => {
    if (!canEdit || saving || requiresReconciliation) return false;
    if (!draft.general.displayName.trim()) { setSaveError("Product name is required before saving."); sectionJumpRef.current?.("basics"); return false; }
    setSaving(true); setSaveError(null);
    const saved: DirtySection[] = [];
    try {
      let id = productId; let version = authoritativeDraft.current?.draftVersionId ?? generalRead.data?.draftVersionId; let revision = authoritativeDraft.current?.expectedDraftUpdatedAt ?? generalRead.data?.draftUpdatedAt;
      if (!id) {
        const created = await productApi.createProduct(organizationId, newBusinessRequestId(), draft.general.displayName.trim());
        id = created.productId; version = created.draftVersionId; revision = created.draftUpdatedAt;
        authoritativeDraft.current = { draftVersionId: version, expectedDraftUpdatedAt: revision };
      }
      if (!id || !version || !revision) throw new Error("The Product Draft could not be prepared for saving.");
      // Capture the submitted snapshot.  Each successful write advances the
      // canonical revision, while Option persistence may also replace local
      // `new:` identities needed by later dependent writes.
      let state = draft;
      const request = () => newBusinessRequestId();
      const savedSection = (section: DirtySection, value: PublishDraftRevision) => { version = value.draftVersionId; revision = value.expectedDraftUpdatedAt; authoritativeDraft.current = value; saved.push(section); setDirty((current) => { const next = new Set(current); next.delete(section); return next; }); };
      if (dirty.has("options")) {
        const submitted = state.options;
        const value = await productApi.saveDraftOptions(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, options: submitted });
        const mapping = optionIdMappingFromSaved(submitted, value.options);
        state = remapProductBuilderDraftOptionReferences({ ...state, options: clone(value.options) }, mapping);
        setDraft(state);
        savedSection("options", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt });
      }
      if (!productId || dirty.has("general")) { const value = await productApi.saveDraftGeneral(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, general: state.general }); savedSection("general", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt }); }
      if (dirty.has("formula")) {
        if (!state.formula.formulaRevisionId) throw new Error("Select an active Formula revision before saving this Product Draft.");
        const value = await productApi.saveDraftFormula(organizationId, id, request(), {
          draftVersionId: version,
          expectedDraftUpdatedAt: revision,
          source: "formula_revision",
          ...(state.formula.formulaId ? { formulaId: state.formula.formulaId } : {}),
          formulaRevisionId: state.formula.formulaRevisionId,
          inputValues: state.formula.inputValues,
          allowRotation: state.formula.allowRotation,
          ...(state.formula.rotationControl ? { rotationControl: state.formula.rotationControl } : {}),
        });
        savedSection("formula", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt });
      }
      if (dirty.has("pricing")) { const value = await productApi.saveDraftPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, base: { perPieceCents: state.pricing.perPieceCents, perSqftCents: state.pricing.perSqftCents, minimumChargeCents: state.pricing.minimumChargeCents }, flatFeeCents: state.pricing.flatFeeCents, tierBasis: state.pricing.tierBasis, tiers: state.pricing.tiers, tierSets: state.pricing.tierSets }); savedSection("pricing", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt }); }
      if (dirty.has("matrix") && state.matrix) { const value = await productApi.saveDraftPricingMatrix(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, active: state.matrix.active, matrixId: state.matrix.matrixId, pricingUnit: state.matrix.pricingUnit, dimensions: state.matrix.dimensions.map((dimension) => dimension.selectionKey), rows: state.matrix.rows }); savedSection("matrix", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt }); }
      if (dirty.has("impacts")) {
        for (const option of state.impacts) { const node = await productApi.saveDraftOptionPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, optionId: option.optionId, impacts: option.nodeImpacts }); revision = node.draftUpdatedAt; for (const choice of option.choices) { const response = await productApi.saveDraftOptionPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, optionId: option.optionId, choiceValue: choice.choiceValue, impacts: choice.impacts, override: choice.override }); revision = response.draftUpdatedAt; } }
        savedSection("impacts", { draftVersionId: version, expectedDraftUpdatedAt: revision });
      }
      if (dirty.has("recipe")) { const value = await productApi.saveDraftRecipe(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, components: state.recipe }); savedSection("recipe", { draftVersionId: value.productVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt }); }
      if (dirty.has("routing")) { const value = await productApi.saveDraftRouting(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, routing: state.routing }); savedSection("routing", { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt }); }
      setDirty(new Set());
      if (!productId) {
        if (!openCreatedProduct) throw new Error("New Product navigation is unavailable.");
        openCreatedProduct(id);
      }
      else {
        await Promise.all([generalRead.refetch(), optionsRead.refetch(), pricingRead.refetch(), formulaRead.refetch(), matrixRead.refetch(), impactsRead.refetch(), recipeRead.refetch(), routingRead.refetch()]);
        void client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "products"] });
      }
      return true;
    } catch (error) {
      const detail = error as { code?: string; message?: string };
      if (detail.code === "STALE_STATE") setRequiresReconciliation(true);
      const prefix = detail.code === "STALE_STATE" ? "This Draft changed elsewhere. Your local edits were kept; refresh and reconcile before saving or publishing." : "Save stopped after " + (saved.length ? `${saved.join(", ")} saved. ` : "") ;
      setSaveError(prefix + (detail.message ?? "Unable to save this Draft."));
      return false;
    } finally { setSaving(false); }
  };

  const localPricingFindings = useMemo(() => {
    const findings: string[] = [];
    const authorsFormula = pricingRead.data?.mode === "formula" || dirty.has("formula");
    if (draft.general.workflowIntent === "service_fee" && draft.pricing.flatFeeCents === null) findings.push("Service fee Products require a Flat Fee Amount before publication.");
    if (draft.matrix?.active && (!draft.matrix.dimensions.length || draft.matrix.rows.some((row) => row.baseRateCents === null))) findings.push("Matrix pricing must contain a rate for every selected Option combination.");
    if (authorsFormula && !draft.formula.formulaRevisionId) findings.push("Choose an active Formula revision before publication.");
    for (const option of draft.impacts) for (const impact of [...option.nodeImpacts, ...option.choices.flatMap((choice) => choice.impacts)]) if (impact.type === "formula" && !impact.formula.trim()) findings.push("Formula option impacts require an expression.");
    return findings;
  }, [draft, dirty, pricingRead.data?.mode]);
  const issueCount = (!draft.general.displayName.trim() ? 1 : 0) + localPricingFindings.length;
  const publishGate = publishGateForDraft({ canEdit, persisted: Boolean(productId), dirty, saving, publishing: Boolean(publishing), localErrors: issueCount, saveError, requiresReconciliation });
  const requestPublish = useCallback(() => {
    if (!publishGate.allowed || !publish || !authoritativeDraft.current) return;
    publish(authoritativeDraft.current);
  }, [publish, publishGate]);
  const routeTemplates = templates.data?.templates ?? [];
  const optionSelectionKeys = useMemo<Record<string, string>>(() => Object.fromEntries(draft.impacts.map((option) => [option.optionId, option.selectionKey])), [draft.impacts]);
  /** Preserve the server-owned pricing mode/editability metadata while making
   * every editable value come from the staged Draft.  This is not a pricing
   * calculation: the server remains the only preview/save authority. */
  const stagedPricing = useMemo<ProductDraftPricing | undefined>(() => {
    const persisted = pricingRead.data;
    if (!persisted && productId) return undefined;
    const source = persisted ?? {
      productId: "new", draftVersionId: "new", draftUpdatedAt: "", lifecycle: "draft" as const,
      measurementMode: draft.general.measurementMode, mode: "unconfigured" as const, editable: true,
      base: { perPieceCents: null, perSqftCents: null, minimumChargeCents: null }, flatFeeCents: null,
      tierBasis: null, tiers: [], tierSets: { quantity: [], squareFoot: [], computedSheetUsage: [] },
    };
    return {
    ...source,
    base: {
      perPieceCents: draft.pricing.perPieceCents,
      perSqftCents: draft.pricing.perSqftCents,
      minimumChargeCents: draft.pricing.minimumChargeCents,
    },
    flatFeeCents: draft.pricing.flatFeeCents,
    tierBasis: draft.pricing.tierBasis,
    tiers: draft.pricing.tiers,
    tierSets: draft.pricing.tierSets,
  };
  }, [draft.general.measurementMode, draft.pricing, pricingRead.data, productId]);
  const stagedFormula = useMemo<ProductDraftFormulaPricing | undefined>(() => {
    const persisted = formulaRead.data;
    if (!persisted && productId) return undefined;
    const source = persisted ?? {
      productId: "new", draftVersionId: "new", draftUpdatedAt: "", lifecycle: "draft" as const,
      source: "none" as const, editable: true, expressionEditable: true, variablesEditable: true, rotationEditable: false,
      inputs: [], expression: "", variables: {}, allowRotation: false, supportedRuntimeVariables: [], warnings: [],
    };
    return {
    ...source,
    source: draft.formula.formulaRevisionId ? "formula_revision" : source.source,
    ...(draft.formula.formulaId ? { formulaId: draft.formula.formulaId } : {}),
    ...(draft.formula.formulaRevisionId ? { formulaRevisionId: draft.formula.formulaRevisionId } : {}),
    expression: draft.formula.expression,
    inputValues: draft.formula.inputValues,
    allowRotation: draft.formula.allowRotation,
    ...(draft.formula.rotationControl ? { rotationControl: draft.formula.rotationControl } : {}),
  };
  }, [draft.formula, formulaRead.data, productId]);
  const stagedMatrix = useMemo<ProductDraftPricingMatrix | null>(() => draft.matrix ?? (!productId ? {
    productId: "new", draftVersionId: "new", draftUpdatedAt: "", lifecycle: "draft" as const, editable: true, active: false,
    matrixId: "new:matrix", pricingUnit: "per_square_foot" as const,
    availableDimensions: draft.options.filter((option) => (option.inputType === "select" || option.inputType === "multiselect") && option.choices.length).map((option) => ({ selectionKey: option.optionId, label: option.label, values: option.choices.map((choice) => ({ value: choice.choiceValue, label: choice.label })) })),
    dimensions: [], rows: [], warnings: [],
  } : null), [draft.matrix, draft.options, productId]);
  const reviewLifecycle = useMemo(() => ({
    activeVersion: product?.versions.active ? {
      label: `Active ${product.versions.active.productVersionId.slice(0, 8)}`,
      publishedLabel: product.versions.active.publishedAt ? `Published ${new Date(product.versions.active.publishedAt).toLocaleDateString()}` : undefined,
    } : undefined,
    draftVersion: generalRead.data ? {
      label: `Draft ${generalRead.data.draftVersionId.slice(0, 8)}`,
      statusLabel: generalRead.data.lifecycle,
    } : undefined,
    history: product?.versions.history.map((version) => ({
      label: version.productVersionId.slice(0, 8),
      statusLabel: version.status[0].toUpperCase() + version.status.slice(1),
      publishedLabel: version.publishedAt ? `Published ${new Date(version.publishedAt).toLocaleDateString()}` : undefined,
      createdLabel: `Created ${new Date(version.createdAt).toLocaleDateString()}`,
    })),
    historyHasMore: product?.versions.historyHasMore,
  }), [generalRead.data, product?.versions.active, product?.versions.history, product?.versions.historyHasMore]);
  /** The active Product read model and persisted Draft read model are the
   * only change sources displayed here. Local, unsaved controls deliberately
   * remain marked Unsaved rather than being represented as canonical history. */
  const reviewChanges = useMemo(() => {
    if (!product || !generalRead.data || product.displayName === generalRead.data.general.displayName) return [];
    return [{ section: "Basics", label: "Product name", from: product.displayName, to: generalRead.data.general.displayName }];
  }, [generalRead.data, product]);
  const reviewFindings = useMemo(() => [
    ...(!draft.general.displayName.trim() ? [{ severity: "error" as const, message: "Product name is required before the Draft can be saved or published." }] : []),
    ...localPricingFindings.map((message) => ({ severity: "error" as const, message })),
  ], [draft.general.displayName, localPricingFindings]);
  const lifecycleSubtitle = useMemo(() => {
    const draftVersion = generalRead.data?.draftVersionId ? generalRead.data.draftVersionId.slice(0, 8) : "Unsaved";
    const activeVersion = product?.versions.active?.productVersionId.slice(0, 8) ?? "None";
    const published = product?.versions.active?.publishedAt ? new Date(product.versions.active.publishedAt).toLocaleDateString() : "Not published";
    return `${draftVersion} · live version ${activeVersion} · published ${published}`;
  }, [generalRead.data?.draftVersionId, product?.versions.active]);
  const canonicalConditions = useMemo(() => projectCanonicalConditions({
    options: draft.options,
    recipe: draft.recipe,
    production: draft.general.productionUnitSpecification,
    selectionKeys: optionSelectionKeys,
  }), [draft.general.productionUnitSpecification, draft.options, draft.recipe, optionSelectionKeys]);
  const runPreview = useCallback(async () => {
    if (!productId || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const value = await productApi.previewDraftPricing(organizationId, productId, {
        quantity: Number(previewInputs.quantity),
        ...(draft.general.measurementMode === "dimensions_required" ? { width: Number(previewInputs.width), height: Number(previewInputs.height) } : {}),
        selections: previewInputs.selections,
      });
      setPreview(value);
    } catch (error) {
      setPreview(null);
      const detail = error as { message?: string };
      setPreviewError(detail.message ?? "The canonical pricing preview could not be resolved.");
    } finally {
      setPreviewLoading(false);
    }
  }, [draft.general.measurementMode, organizationId, previewInputs, previewLoading, productId]);
  if (productId && !sourceReady) return <section className="v2-products"><p className="v2-proof-empty">Loading Product Builder…</p></section>;
  return <LovableProductBuilderRoot
    title={draft.general.displayName || "Untitled product"}
    lifecycle={<><Chip tone={product?.versions.active ? "ok" : "neutral"}>{product?.versions.active ? "Active · Draft" : newProduct ? "Unsaved" : "Draft"}</Chip>{newProduct && <span className="text-[0.6875rem] text-muted-foreground">New Product Draft</span>}{dirty.size > 0 && <Chip tone="warn">Unsaved</Chip>}</>}
    subtitle={lifecycleSubtitle}
    onSave={() => void runSave()} saving={saving} onPublish={requestPublish} publishing={publishing} canEdit={canEdit} persisted={Boolean(productId)} saveError={saveError} publishDisabled={!publishGate.allowed} publishBlockedReason={publishGate.reason} findings={{ errors: issueCount, warnings: 0 }}
    sectionJumpRef={sectionJumpRef}
  rail={<PricingPreviewRail productId={productId} measurementMode={draft.general.measurementMode} options={draft.options} selectionKeys={optionSelectionKeys} recipe={draft.recipe} production={draft.general.productionUnitSpecification} inputs={previewInputs} onInputsChange={setPreviewInputs} result={preview} loading={previewLoading} error={previewError} onPreview={() => void runPreview()} onJump={(id) => sectionJumpRef.current?.(id as ProductBuilderSection)} findings={reviewFindings.map((finding, index) => ({ severity: finding.severity, code: `PRODUCT_DRAFT_${index}`, message: finding.message, section: finding.message.startsWith("Product name") ? "basics" : "pricing" }))} />}
  >{{
    basics: <BasicsSection general={draft.general} productTypeLabel={product?.productType?.displayName} disabled={!canEdit || saving} onChange={(general) => patch("general", (value) => ({ ...value, general }))} />,
    options: <><OptionGroupsSection options={draft.options} disabled={!canEdit || saving} onChange={(options) => patch("options", (value) => ({ ...value, options }))} /><Disclosure label={`Option visibility conditions (${canonicalConditions.length})`}><RuleCards conditions={canonicalConditions} onJumpToOwner={(owner) => sectionJumpRef.current?.(owner)} /></Disclosure></>,
    pricing: <div className="space-y-4">{stagedPricing && <PricingEngine pricing={stagedPricing} formula={stagedFormula} formulaLibrary={formulaLibrary.data ?? []} formulaRevisions={formulaRevisions.data ?? []} options={draft.options} serviceFee={draft.general.workflowIntent === "service_fee"} disabled={!canEdit || saving} onManageFormulaLibrary={() => { pushWorkspaceLocation("formulas"); window.dispatchEvent(new PopStateEvent("popstate")); }} onPricingChange={(pricing) => patch("pricing", (value) => ({ ...value, pricing: { ...pricing.base, flatFeeCents: pricing.flatFeeCents, tierBasis: pricing.tierBasis, tiers: pricing.tiers, tierSets: pricing.tierSets } }))} onFormulaChange={(formula) => patch("formula", (value) => ({ ...value, formula }))} />}<Sub title="Matrix pricing">{stagedMatrix && <MatrixPricing matrix={stagedMatrix} disabled={!canEdit || saving} onChange={(matrix) => patch("matrix", (value) => ({ ...value, matrix }))} />}</Sub><Sub title="Option pricing impacts" hint="Options that change price without being matrix dimensions. Edit amounts on the choice in Options."><OptionImpactsEditor options={draft.impacts} disabled={!canEdit || saving} onChange={(impacts) => patch("impacts", (value) => ({ ...value, impacts }))} /></Sub></div>,
    materials: <div className="space-y-4"><Sub title="Recipe"><RecipeEditor components={draft.recipe} materials={materials.data?.items ?? []} options={draft.options} primaryMaterialName={product?.primaryMaterialName} disabled={!canEdit || saving} onChange={(recipe) => patch("recipe", (value) => ({ ...value, recipe }))} /></Sub></div>,
    production: <ProductionUnits specification={draft.general.productionUnitSpecification} options={draft.options} selectionKeys={optionSelectionKeys} disabled={!canEdit || saving} onChange={(productionUnitSpecification) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification } }))} />,
    routing: <RoutingSection routing={draft.routing} templates={routeTemplates} disabled={!canEdit || saving} onChange={(routing) => patch("routing", (value) => ({ ...value, routing }))} />,
    review: <ReviewSummary rows={[
      { label: "Product", value: draft.general.displayName || "Untitled product" },
      { label: "Measurement", value: draft.general.measurementMode },
      { label: "Workflow", value: draft.general.workflowIntent },
      { label: "Routing", value: draft.routing.kind },
    ]} lifecycle={reviewLifecycle} changes={reviewChanges} findings={reviewFindings} validation={{ status: issueCount || !publishGate.allowed ? "invalid" : "unknown", summary: issueCount ? reviewFindings.map((finding) => finding.message).join(" ") : publishGate.reason ?? "Publishing runs canonical server validation and readiness checks." }} />,
  }}</LovableProductBuilderRoot>;
};
