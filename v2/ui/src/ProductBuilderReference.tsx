import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  routingApi,
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

/*
 * This file is a direct production port of reference/lovable-ui's
 * _shell.product-builder.tsx composition.  It deliberately retains the
 * reference header, sticky navigation, section, sub-section and rail DOM
 * hierarchy while replacing its mock ProductDraft and calculator with the
 * canonical V2 draft read/mutate contracts.
 */

type DirtySection = "general" | "options" | "pricing" | "matrix" | "formula" | "impacts" | "recipe" | "routing";
type DraftState = Readonly<{
  general: ProductDraftGeneral;
  options: readonly ProductDraftOption[];
  pricing: ProductDraftPricing["base"] & Readonly<{ tierBasis: ProductDraftPricing["tierBasis"]; tiers: ProductDraftPricing["tiers"] }>;
  formula: Readonly<{ expression: string; variables: Record<string, number> }>;
  matrix: ProductDraftPricingMatrix | null;
  impacts: ProductDraftOptionPricing["options"];
  recipe: readonly ProductRecipeComponent[];
  routing: ProductDraftRouting["routing"];
}>;

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
  pricing: { perPieceCents: null, perSqftCents: null, minimumChargeCents: null, tierBasis: null, tiers: [] },
  formula: { expression: "", variables: {} },
  matrix: null,
  impacts: [],
  recipe: [],
  routing: { kind: "unconfigured" },
});
const clone = <T,>(value: T): T => structuredClone(value);

const key = (scope: string, org: string, id: string, part: string) => ["v2", scope, org, "reference-product-builder", id, part] as const;

export const ProductBuilderReference = ({
  organizationId, sessionScope, product, canEdit, back, publish, publishing, openProduct, newProduct = false,
}: Readonly<{
  organizationId: string; sessionScope: string; product?: ProductWorkspaceDetail; canEdit: boolean; back: () => void;
  publish?: () => void; publishing?: boolean; openProduct: (id: string) => void; newProduct?: boolean;
}>) => {
  const productId = product?.productId;
  const client = useQueryClient();
  const generalRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "general"), queryFn: () => productApi.draftGeneral(organizationId, productId!), enabled: Boolean(productId) });
  const optionsRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "options"), queryFn: () => productApi.draftOptions(organizationId, productId!), enabled: Boolean(productId) });
  const pricingRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "pricing"), queryFn: () => productApi.draftPricing(organizationId, productId!), enabled: Boolean(productId) });
  const formulaRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "formula"), queryFn: () => productApi.draftFormula(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const matrixRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "matrix"), queryFn: () => productApi.draftPricingMatrix(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const impactsRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "impacts"), queryFn: () => productApi.draftOptionPricing(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const recipeRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "recipe"), queryFn: () => productApi.draftRecipe(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const routingRead = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "routing"), queryFn: () => productApi.draftRouting(organizationId, productId!), enabled: Boolean(productId), retry: false });
  const materials = useQuery({ queryKey: key(sessionScope, organizationId, productId ?? "new", "materials"), queryFn: () => productApi.materials(organizationId, productId!), enabled: Boolean(productId) });
  const catalog = useQuery({ queryKey: ["v2", sessionScope, organizationId, "products", "picker"], queryFn: () => productApi.list(organizationId, "", 1) });
  const templates = useQuery({ queryKey: ["v2", sessionScope, organizationId, "routing", "picker"], queryFn: () => routingApi.workspace(organizationId), retry: false });
  const [draft, setDraft] = useState<DraftState>(() => blankState());
  const [dirty, setDirty] = useState<ReadonlySet<DirtySection>>(() => new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const [previewInputs, setPreviewInputs] = useState({ quantity: "1", width: "24", height: "18", selections: {} as Record<string, unknown> });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof productApi.previewDraftPricing>> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sectionJumpRef = useRef<((section: ProductBuilderSection) => void) | null>(null);
  const initialised = useRef<string | null>(null);

  const sourceReady = !productId || Boolean(generalRead.data && optionsRead.data && pricingRead.data && recipeRead.data && routingRead.data);
  useEffect(() => {
    if (!productId) { if (initialised.current !== "new") { setDraft(blankState()); initialised.current = "new"; } return; }
    if (!sourceReady || initialised.current === productId) return;
    setDraft({
      general: clone(generalRead.data!.general), options: clone(optionsRead.data!.options),
      pricing: { ...clone(pricingRead.data!.base), tierBasis: pricingRead.data!.tierBasis, tiers: clone(pricingRead.data!.tiers) },
      formula: formulaRead.data ? { expression: formulaRead.data.expression, variables: clone(formulaRead.data.variables) } : { expression: "", variables: {} },
      matrix: matrixRead.data ? clone(matrixRead.data) : null,
      impacts: impactsRead.data ? clone(impactsRead.data.options) : [], recipe: clone(recipeRead.data!.components), routing: clone(routingRead.data!.routing),
    });
    initialised.current = productId;
    setDirty(new Set()); setSaveError(null);
  }, [productId, sourceReady, generalRead.data, optionsRead.data, pricingRead.data, formulaRead.data, matrixRead.data, impactsRead.data, recipeRead.data, routingRead.data]);

  const patch = useCallback((section: DirtySection, update: (current: DraftState) => DraftState) => {
    setDraft((current) => update(clone(current)));
    setDirty((current) => new Set([...current, section]));
  }, []);
  const runSave = async () => {
    if (!canEdit || saving) return;
    if (!draft.general.displayName.trim()) { setSaveError("Product name is required before saving."); sectionJumpRef.current?.("basics"); return; }
    setSaving(true); setSaveError(null);
    const saved: DirtySection[] = [];
    try {
      let id = productId; let version = generalRead.data?.draftVersionId; let revision = generalRead.data?.draftUpdatedAt;
      if (!id) {
        const created = await productApi.createProduct(organizationId, newBusinessRequestId(), draft.general.displayName.trim());
        id = created.productId; version = created.draftVersionId; revision = created.draftUpdatedAt;
      }
      if (!id || !version || !revision) throw new Error("The Product Draft could not be prepared for saving.");
      const request = () => newBusinessRequestId();
      if (!productId || dirty.has("general")) { const value = await productApi.saveDraftGeneral(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, general: draft.general }); revision = value.draftUpdatedAt; version = value.draftVersionId; saved.push("general"); }
      if (dirty.has("options")) { const value = await productApi.saveDraftOptions(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, options: draft.options }); revision = value.draftUpdatedAt; saved.push("options"); }
      if (dirty.has("formula")) { const value = await productApi.saveDraftFormula(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, expression: draft.formula.expression, variables: draft.formula.variables }); revision = value.draftUpdatedAt; saved.push("formula"); }
      if (dirty.has("pricing")) { const value = await productApi.saveDraftPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, base: { perPieceCents: draft.pricing.perPieceCents, perSqftCents: draft.pricing.perSqftCents, minimumChargeCents: draft.pricing.minimumChargeCents }, tierBasis: draft.pricing.tierBasis, tiers: draft.pricing.tiers }); revision = value.draftUpdatedAt; saved.push("pricing"); }
      if (dirty.has("matrix") && draft.matrix) { const value = await productApi.saveDraftPricingMatrix(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, matrixId: draft.matrix.matrixId, pricingUnit: draft.matrix.pricingUnit, dimensions: draft.matrix.dimensions.map((dimension) => dimension.selectionKey), rows: draft.matrix.rows }); revision = value.draftUpdatedAt; saved.push("matrix"); }
      if (dirty.has("impacts")) {
        for (const option of draft.impacts) { const node = await productApi.saveDraftOptionPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, optionId: option.optionId, impact: option.nodeImpact }); revision = node.draftUpdatedAt; for (const choice of option.choices) { const response = await productApi.saveDraftOptionPricing(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, optionId: option.optionId, choiceValue: choice.choiceValue, impact: choice.impact }); revision = response.draftUpdatedAt; } }
        saved.push("impacts");
      }
      if (dirty.has("recipe")) { const value = await productApi.saveDraftRecipe(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, components: draft.recipe }); revision = value.draftUpdatedAt; saved.push("recipe"); }
      if (dirty.has("routing")) { const value = await productApi.saveDraftRouting(organizationId, id, request(), { draftVersionId: version, expectedDraftUpdatedAt: revision, routing: draft.routing }); revision = value.draftUpdatedAt; saved.push("routing"); }
      setDirty(new Set());
      if (!productId) openProduct(id);
      else {
        await Promise.all([generalRead.refetch(), optionsRead.refetch(), pricingRead.refetch(), formulaRead.refetch(), matrixRead.refetch(), impactsRead.refetch(), recipeRead.refetch(), routingRead.refetch()]);
        void client.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "products"] });
      }
    } catch (error) {
      const detail = error as { code?: string; message?: string };
      const prefix = detail.code === "STALE_STATE" ? "This Draft changed elsewhere. Your local edits were kept; refresh and reconcile before saving again." : "Save stopped after " + (saved.length ? `${saved.join(", ")} saved. ` : "") ;
      setSaveError(prefix + (detail.message ?? "Unable to save this Draft."));
    } finally { setSaving(false); }
  };

  const issueCount = !draft.general.displayName.trim() ? 1 : 0;
  const routeTemplates = templates.data?.templates ?? [];
  const optionSelectionKeys = useMemo<Record<string, string>>(() => Object.fromEntries((impactsRead.data?.options ?? []).map((option) => [option.optionId, option.selectionKey])), [impactsRead.data]);
  /** Preserve the server-owned pricing mode/editability metadata while making
   * every editable value come from the staged Draft.  This is not a pricing
   * calculation: the server remains the only preview/save authority. */
  const stagedPricing = useMemo<ProductDraftPricing | undefined>(() => pricingRead.data && ({
    ...pricingRead.data,
    base: {
      perPieceCents: draft.pricing.perPieceCents,
      perSqftCents: draft.pricing.perSqftCents,
      minimumChargeCents: draft.pricing.minimumChargeCents,
    },
    tierBasis: draft.pricing.tierBasis,
    tiers: draft.pricing.tiers,
  }), [draft.pricing, pricingRead.data]);
  const stagedFormula = useMemo<ProductDraftFormulaPricing | undefined>(() => formulaRead.data && ({
    ...formulaRead.data,
    expression: draft.formula.expression,
    variables: draft.formula.variables,
  }), [draft.formula, formulaRead.data]);
  const reviewLifecycle = useMemo(() => ({
    activeVersion: product?.versions.active ? {
      label: `Active ${product.versions.active.productVersionId.slice(0, 8)}`,
      publishedLabel: product.versions.active.publishedAt ? `Published ${new Date(product.versions.active.publishedAt).toLocaleDateString()}` : undefined,
    } : undefined,
    draftVersion: generalRead.data ? {
      label: `Draft ${generalRead.data.draftVersionId.slice(0, 8)}`,
      statusLabel: generalRead.data.lifecycle,
    } : undefined,
  }), [generalRead.data, product?.versions.active]);
  /** The active Product read model and persisted Draft read model are the
   * only change sources displayed here. Local, unsaved controls deliberately
   * remain marked Unsaved rather than being represented as canonical history. */
  const reviewChanges = useMemo(() => {
    if (!product || !generalRead.data || product.displayName === generalRead.data.general.displayName) return [];
    return [{ section: "Basics", label: "Product name", from: product.displayName, to: generalRead.data.general.displayName }];
  }, [generalRead.data, product]);
  const reviewFindings = useMemo(() => issueCount ? [{ severity: "error" as const, message: "Product name is required before the Draft can be saved or published." }] : [], [issueCount]);
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
    lifecycle={<><span className={`v2-ref-chip ${product?.versions.active ? "ok" : "neutral"}`}>{product?.versions.active ? "Active · Draft" : newProduct ? "Unsaved" : "Draft"}</span>{newProduct && <span className="text-[11px] text-muted-foreground">New Product Draft</span>}{dirty.size > 0 && <span className="v2-ref-chip warn">Unsaved</span>}</>}
    picker={<select aria-label="Choose Product" value={productId ?? ""} onChange={(event) => { if (dirty.size) { setPendingProduct(event.target.value); return; } openProduct(event.target.value); }} disabled={catalog.isLoading}><option value="">{newProduct ? "New Product" : "Choose Product"}</option>{catalog.data?.items.map((item) => <option key={item.productId} value={item.productId}>{item.displayName}</option>)}</select>}
    onBack={back} onSave={() => void runSave()} saving={saving} onPublish={publish} publishing={publishing} canEdit={canEdit} persisted={Boolean(productId)} saveError={saveError} findings={{ errors: issueCount, warnings: 0 }}
    sectionJumpRef={sectionJumpRef}
    rail={<PricingPreviewRail productId={productId} measurementMode={draft.general.measurementMode} options={draft.options} recipe={draft.recipe} production={draft.general.productionUnitSpecification} inputs={previewInputs} onInputsChange={setPreviewInputs} result={preview} loading={previewLoading} error={previewError} onPreview={() => void runPreview()} onJump={(id) => sectionJumpRef.current?.(id as ProductBuilderSection)} findings={issueCount ? [{ severity: "error", code: "PRODUCT_NAME_REQUIRED", message: "Product name is required.", section: "basics" }] : []} />}
    dialog={pendingProduct ? <div className="v2-ref-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Unsaved changes"><div className="v2-ref-dialog"><h2>Discard unsaved changes?</h2><p>{draft.general.displayName || "This Product"} has unsaved Draft changes. Switching Products now discards them.</p><div><button type="button" onClick={() => setPendingProduct(null)}>Keep editing</button><button type="button" onClick={() => { const selected = pendingProduct; setPendingProduct(null); void runSave().then(() => openProduct(selected)); }}>Save and switch</button><button type="button" className="button" onClick={() => { const selected = pendingProduct; setPendingProduct(null); openProduct(selected); }}>Discard and switch</button></div></div></div> : undefined}
  >{{
    basics: <BasicsSection general={draft.general} disabled={!canEdit || saving} onChange={(general) => patch("general", (value) => ({ ...value, general }))} />,
    options: <div className="space-y-3"><OptionGroupsSection options={draft.options} disabled={!canEdit || saving} onChange={(options) => patch("options", (value) => ({ ...value, options }))} /><RuleCards conditions={projectCanonicalConditions({ options: draft.options, recipe: draft.recipe, production: draft.general.productionUnitSpecification, selectionKeys: optionSelectionKeys })} onJumpToOwner={(owner) => sectionJumpRef.current?.(owner)} /></div>,
    pricing: <div className="space-y-4">{stagedPricing && <PricingEngine pricing={stagedPricing} formula={stagedFormula} disabled={!canEdit || saving} onPricingChange={(pricing) => patch("pricing", (value) => ({ ...value, pricing: { ...pricing.base, tierBasis: pricing.tierBasis, tiers: pricing.tiers } }))} onFormulaChange={(formula) => patch("formula", (value) => ({ ...value, formula }))} />}{draft.matrix && <MatrixPricing matrix={draft.matrix} disabled={!canEdit || saving} onChange={(matrix) => patch("matrix", (value) => ({ ...value, matrix }))} />}<OptionImpactsEditor options={draft.impacts} disabled={!canEdit || saving} onChange={(impacts) => patch("impacts", (value) => ({ ...value, impacts }))} /></div>,
    materials: <RecipeEditor components={draft.recipe} materials={materials.data?.items ?? []} options={draft.options} disabled={!canEdit || saving} onChange={(recipe) => patch("recipe", (value) => ({ ...value, recipe }))} />,
    production: <ProductionUnits specification={draft.general.productionUnitSpecification} options={draft.options} selectionKeys={optionSelectionKeys} disabled={!canEdit || saving} onChange={(productionUnitSpecification) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification } }))} />,
    routing: <RoutingSection routing={draft.routing} templates={routeTemplates} disabled={!canEdit || saving} onChange={(routing) => patch("routing", (value) => ({ ...value, routing }))} />,
    review: <ReviewSummary rows={[
      { label: "Product", value: draft.general.displayName || "Untitled product" },
      { label: "Measurement", value: draft.general.measurementMode },
      { label: "Workflow", value: draft.general.workflowIntent },
      { label: "Routing", value: draft.routing.kind },
    ]} lifecycle={reviewLifecycle} changes={reviewChanges} findings={reviewFindings} validation={{ status: issueCount ? "invalid" : "unknown", summary: issueCount ? "Product name is required before saving or publishing." : "Publishing runs canonical server validation and readiness checks." }} />,
  }}</LovableProductBuilderRoot>;
};
