import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  routingApi,
  type ProductDraftFormulaPricing,
  type ProductDraftGeneral,
  type ProductDraftGeneralRead,
  type ProductDraftOption,
  type ProductDraftOptionPricing,
  type ProductDraftOptionsRead,
  type ProductDraftPricing,
  type ProductDraftPricingMatrix,
  type ProductDraftRouting,
  type ProductMaterial,
  type ProductRecipe,
  type ProductRecipeComponent,
  type ProductWorkspaceDetail,
  type RoutingWorkspaceRead,
} from "./api";
import { productBuilderPath } from "./productRouting";

/*
 * This file is a direct production port of reference/lovable-ui's
 * _shell.product-builder.tsx composition.  It deliberately retains the
 * reference header, sticky navigation, section, sub-section and rail DOM
 * hierarchy while replacing its mock ProductDraft and calculator with the
 * canonical V2 draft read/mutate contracts.
 */

const SECTIONS = [
  { id: "basics", label: "Basics", icon: "▣" },
  { id: "options", label: "Options", icon: "◇" },
  { id: "pricing", label: "Pricing", icon: "≋" },
  { id: "materials", label: "Materials", icon: "▤" },
  { id: "production", label: "Production", icon: "▥" },
  { id: "routing", label: "Routing", icon: "↝" },
  { id: "review", label: "Review", icon: "✓" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
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
const dollars = (cents: number | null | undefined) => cents == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const newOption = (): ProductDraftOption => ({ optionId: crypto.randomUUID(), label: "New option", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "choice", label: "Choice" }], canRemove: true });

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
  const [active, setActive] = useState<SectionId>("basics");
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionId, boolean>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const [previewInputs, setPreviewInputs] = useState({ quantity: "1", width: "24", height: "18", selections: {} as Record<string, unknown> });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof productApi.previewDraftPricing>> | null>(null);
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
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
  const jumpTo = useCallback((id: SectionId) => { setCollapsed((c) => ({ ...c, [id]: false })); refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); setActive(id); }, []);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const id = visible?.target.getAttribute("data-section") as SectionId | null; if (id) setActive(id);
    }, { rootMargin: "-96px 0px -60% 0px", threshold: 0 });
    SECTIONS.forEach((section) => { const node = refs.current[section.id]; if (node) observer.observe(node); }); return () => observer.disconnect();
  }, [sourceReady]);

  const runSave = async () => {
    if (!canEdit || saving) return;
    if (!draft.general.displayName.trim()) { setSaveError("Product name is required before saving."); jumpTo("basics"); return; }
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
  const section = (id: SectionId, label: string, hint: string, body: React.ReactNode) => <ReferenceSection id={id} title={label} hint={hint} open={!collapsed[id]} activeRef={(node) => { refs.current[id] = node; }} onToggle={() => setCollapsed((current) => ({ ...current, [id]: !current[id] }))}>{body}</ReferenceSection>;
  if (productId && !sourceReady) return <section className="v2-products"><p className="v2-proof-empty">Loading Product Builder…</p></section>;
  return <section className="v2-products v2-reference-product-builder" aria-label={newProduct ? "New Product Builder" : "Product Builder"}>
    <header className="v2-ref-page-header">
      <button type="button" className="v2-products-back" onClick={back}>← Products</button>
      <div className="v2-ref-title"><h1>{draft.general.displayName || "Untitled product"}</h1><span className={`v2-ref-chip ${product?.versions.active ? "ok" : "neutral"}`}>{product?.versions.active ? "Active · Draft" : newProduct ? "Unsaved" : "Draft"}</span>{dirty.size > 0 && <span className="v2-ref-chip warn">Unsaved</span>}<p>{product?.versions.draft ? `Draft ${product.versions.draft.productVersionId.slice(0, 8)} · active version preserved` : "New Product Draft"}</p></div>
      <div className="v2-ref-header-actions">
        <select aria-label="Choose Product" value={productId ?? ""} onChange={(event) => { if (dirty.size) { setPendingProduct(event.target.value); return; } openProduct(event.target.value); }} disabled={catalog.isLoading}><option value="">{newProduct ? "New Product" : "Choose Product"}</option>{catalog.data?.items.map((item) => <option key={item.productId} value={item.productId}>{item.displayName}</option>)}</select>
        <button type="button" className="button secondary" disabled={!canEdit || saving} onClick={() => void runSave()}>{saving ? "Saving…" : "Save Changes"}</button><button type="button" className="button secondary" onClick={() => jumpTo("review")}>Review</button><button type="button" className="button" disabled={!canEdit || publishing || issueCount > 0 || !productId} onClick={publish}>{publishing ? "Publishing…" : "Publish"}</button>
      </div>
    </header>
    <div className="v2-ref-sticky-nav"><nav aria-label="Product sections">{SECTIONS.map((item) => <button key={item.id} type="button" aria-current={active === item.id ? "true" : undefined} className={active === item.id ? "active" : ""} onClick={() => jumpTo(item.id)}><span aria-hidden>{item.icon}</span>{item.label}</button>)}</nav><div className="v2-ref-findings">{issueCount ? <span className="v2-ref-chip late">{issueCount} error</span> : <span className="v2-ref-chip ok">Valid</span>}</div></div>
    {saveError && <p role="alert" className="v2-product-version-message">{saveError}</p>}
    <div className="v2-ref-builder-grid"><main className="v2-ref-builder-main">
      {section("basics", "Basics", "Identity, measurement mode and workflow intent.", <Basics draft={draft} disabled={!canEdit || saving} patch={patch} />)}
      {section("options", "Options", "Option groups, choices, defaults and ordering.", <Options draft={draft} disabled={!canEdit || saving} patch={patch} />)}
      {section("pricing", "Pricing", "What this Product charges, and why.", <Pricing draft={draft} formulaInfo={formulaRead.data} disabled={!canEdit || saving} patch={patch} />)}
      {section("materials", "Materials & recipe", "What this Product physically consumes — separate from pricing.", <Recipe draft={draft} materials={materials.data?.items ?? []} disabled={!canEdit || saving} patch={patch} />)}
      {section("production", "Production", "Production units and the option conditions that require them.", <Production draft={draft} disabled={!canEdit || saving} patch={patch} />)}
      {section("routing", "Routing", "Which Routing-module template this Product's orders follow.", <Routing draft={draft} templates={routeTemplates} disabled={!canEdit || saving} patch={patch} />)}
      {section("review", "Review & publish", "Full Draft summary and changes against the live version.", <Review draft={draft} issueCount={issueCount} onSave={() => void runSave()} onPublish={publish} canPublish={Boolean(productId && canEdit && !publishing && !issueCount)} />)}
    </main><aside className="v2-ref-pricing-rail"><PricingRail productId={productId} organizationId={organizationId} draft={draft} inputs={previewInputs} setInputs={setPreviewInputs} preview={preview} setPreview={setPreview} jump={jumpTo} /></aside></div>
    {pendingProduct && <div className="v2-ref-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Unsaved changes"><div className="v2-ref-dialog"><h2>Discard unsaved changes?</h2><p>{draft.general.displayName || "This Product"} has unsaved Draft changes. Switching Products now discards them.</p><div><button type="button" onClick={() => setPendingProduct(null)}>Keep editing</button><button type="button" onClick={() => { const selected = pendingProduct; setPendingProduct(null); void runSave().then(() => openProduct(selected)); }}>Save and switch</button><button type="button" className="button" onClick={() => { const selected = pendingProduct; setPendingProduct(null); openProduct(selected); }}>Discard and switch</button></div></div></div>}
  </section>;
};

const ReferenceSection = ({ id, title: heading, hint, open, onToggle, activeRef, children }: Readonly<{ id: SectionId; title: string; hint: string; open: boolean; onToggle: () => void; activeRef: (node: HTMLElement | null) => void; children: React.ReactNode }>) => <section ref={activeRef} data-section={id} id={`section-${id}`} className="v2-ref-panel"><header><div><h2>{heading}</h2><p>{hint}</p></div><button type="button" aria-expanded={open} onClick={onToggle}>{open ? "Collapse" : "Expand"}<span aria-hidden>{open ? "⌄" : "›"}</span></button></header>{open && <div className="v2-ref-panel-body">{children}</div>}</section>;
const Cell = ({ label, hint, wide, children }: Readonly<{ label: string; hint?: string; wide?: boolean; children: React.ReactNode }>) => <label className={`v2-ref-cell${wide ? " wide" : ""}`}><span>{label}</span>{hint && <small>{hint}</small>}{children}</label>;
const Sub = ({ title: heading, hint, children }: Readonly<{ title: string; hint?: string; children: React.ReactNode }>) => <div className="v2-ref-sub"><header><h3>{heading}</h3>{hint && <p>{hint}</p>}</header>{children}</div>;

const Basics = ({ draft, disabled, patch }: Readonly<{ draft: DraftState; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => <div className="v2-ref-basics"><div className="v2-ref-field-grid"><Cell label="Product name"><input disabled={disabled} value={draft.general.displayName} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, displayName: event.target.value } }))} /></Cell><Cell label="Shop name" hint="Short internal name shown in queues and station screens."><input disabled={disabled} value={draft.general.category ?? ""} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, category: event.target.value || null } }))} /></Cell><Cell label="Description" wide><textarea disabled={disabled} value={draft.general.description ?? ""} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, description: event.target.value || null } }))} /></Cell><Cell label="Measurement mode"><select disabled={disabled} value={draft.general.measurementMode} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, measurementMode: event.target.value as ProductDraftGeneral["measurementMode"] } }))}><option value="dimensions_required">Dimensions + quantity</option><option value="quantity_only">Quantity only</option></select></Cell><Cell label="Workflow intent"><select disabled={disabled} value={draft.general.workflowIntent} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, workflowIntent: event.target.value as ProductDraftGeneral["workflowIntent"] } }))}><option value="standard_production">Standard production</option><option value="fulfillment_only">Fulfillment only</option><option value="service_fee">Service fee</option></select></Cell></div><div className="v2-ref-toggle-grid"><Toggle label="Active in catalog" checked={draft.general.storefrontVisible} disabled={disabled} onChange={(storefrontVisible) => patch("general", (value) => ({ ...value, general: { ...value.general, storefrontVisible } }))} /><Toggle label="Service fee product" hint="No material or production usage." checked={draft.general.workflowIntent === "service_fee"} disabled={disabled} onChange={(selected) => patch("general", (value) => ({ ...value, general: { ...value.general, workflowIntent: selected ? "service_fee" : "standard_production" } }))} /><Toggle label="Requires proof" checked={draft.general.requiresProofApproval} disabled={disabled} onChange={(requiresProofApproval) => patch("general", (value) => ({ ...value, general: { ...value.general, requiresProofApproval } }))} /><Toggle label="Creates production job" checked={draft.general.requiresProductionJob} disabled={disabled} onChange={(requiresProductionJob) => patch("general", (value) => ({ ...value, general: { ...value.general, requiresProductionJob } }))} /></div></div>;
const Toggle = ({ label, hint, checked, disabled, onChange }: Readonly<{ label: string; hint?: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }>) => <label className="v2-ref-toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b>{hint && <small>{hint}</small>}</span></label>;

const Options = ({ draft, disabled, patch }: Readonly<{ draft: DraftState; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => <div className="v2-ref-options"><p className="v2-ref-lead">Option groups and choices drive Product configuration, matrix dimensions, recipe conditions and production rules.</p>{draft.options.map((option, index) => <article key={option.optionId} className="v2-ref-card"><header><strong>{option.label || "Untitled option"}</strong><button type="button" disabled={disabled || !option.canRemove} onClick={() => patch("options", (value) => ({ ...value, options: value.options.filter((_, position) => position !== index) }))}>Remove</button></header><div className="v2-ref-field-grid"><Cell label="Option name"><input disabled={disabled} value={option.label} onChange={(event) => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, label: event.target.value } : item) }))} /></Cell><Cell label="Input type"><select disabled={disabled} value={option.inputType} onChange={(event) => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, inputType: event.target.value as ProductDraftOption["inputType"] } : item) }))}><option value="select">Select</option><option value="boolean">Boolean</option><option value="number">Number</option><option value="text">Text</option></select></Cell><Toggle label="Required" checked={option.required} disabled={disabled} onChange={(required) => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, required } : item) }))} /></div><Sub title="Choices">{option.choices.map((choice, choiceIndex) => <div key={choice.choiceValue} className="v2-ref-choice"><input disabled={disabled} value={choice.label} aria-label={`${option.label} choice`} onChange={(event) => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, choices: item.choices.map((current, currentIndex) => currentIndex === choiceIndex ? { ...current, label: event.target.value } : current) } : item) }))} /><code>{choice.choiceValue}</code><button type="button" disabled={disabled} onClick={() => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, choices: item.choices.filter((_, currentIndex) => currentIndex !== choiceIndex) } : item) }))}>Remove</button></div>)}<button type="button" disabled={disabled} onClick={() => patch("options", (value) => ({ ...value, options: value.options.map((item, position) => position === index ? { ...item, choices: [...item.choices, { choiceValue: `choice_${item.choices.length + 1}`, label: "New choice" }] } : item) }))}>Add choice</button></Sub></article>)}<button type="button" className="button secondary" disabled={disabled} onClick={() => patch("options", (value) => ({ ...value, options: [...value.options, newOption()] }))}>Add option group</button></div>;

const Pricing = ({ draft, formulaInfo, disabled, patch }: Readonly<{ draft: DraftState; formulaInfo?: ProductDraftFormulaPricing; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => <div className="v2-ref-pricing"><Sub title="Pricing engine"><div className="v2-ref-field-grid"><Cell label="Per piece"><MoneyInput disabled={disabled} value={draft.pricing.perPieceCents} onChange={(perPieceCents) => patch("pricing", (value) => ({ ...value, pricing: { ...value.pricing, perPieceCents } }))} /></Cell><Cell label="Per square foot"><MoneyInput disabled={disabled} value={draft.pricing.perSqftCents} onChange={(perSqftCents) => patch("pricing", (value) => ({ ...value, pricing: { ...value.pricing, perSqftCents } }))} /></Cell><Cell label="Minimum charge"><MoneyInput disabled={disabled} value={draft.pricing.minimumChargeCents} onChange={(minimumChargeCents) => patch("pricing", (value) => ({ ...value, pricing: { ...value.pricing, minimumChargeCents } }))} /></Cell></div></Sub><Sub title="Formula" hint="Formula Library expression is read-only; Product inputs are version-owned."><div className="v2-ref-field-grid"><Cell label="Formula source"><input readOnly value={formulaInfo?.formulaName ?? formulaInfo?.source ?? "No Formula selected"} /></Cell><Cell label="Expression" wide><input readOnly value={draft.formula.expression || "No Formula expression"} /></Cell>{formulaInfo?.inputs.map((input) => <Cell key={input.key} label={input.label}><input disabled={disabled || !formulaInfo.variablesEditable} inputMode="decimal" value={String(draft.formula.variables[input.key] ?? "")} onChange={(event) => patch("formula", (value) => ({ ...value, formula: { ...value.formula, variables: { ...value.formula.variables, [input.key]: Number(event.target.value) } } }))} /></Cell>)}</div></Sub><Sub title="Matrix pricing"><Matrix draft={draft} disabled={disabled} patch={patch} /></Sub><Sub title="Option pricing impacts" hint="Option-specific pricing stays attached to stable Option/Choice identities."><p className="v2-ref-lead">{draft.impacts.length ? `${draft.impacts.length} configured option impact group${draft.impacts.length === 1 ? "" : "s"}.` : "No option pricing impacts are configured."}</p></Sub></div>;
const MoneyInput = ({ value, disabled, onChange }: Readonly<{ value: number | null; disabled: boolean; onChange: (value: number | null) => void }>) => <input disabled={disabled} inputMode="decimal" value={value == null ? "" : (value / 100).toFixed(2)} onChange={(event) => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))} />;
const Matrix = ({ draft, disabled, patch }: Readonly<{ draft: DraftState; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => !draft.matrix ? <p className="v2-ref-lead">Matrix pricing is not configured for this Draft.</p> : <div className="v2-ref-matrix"><p className="v2-ref-lead">{draft.matrix.dimensions.map((dimension) => dimension.label).join(" × ")} · {draft.matrix.pricingUnit === "per_piece" ? "per piece" : "per square foot"}. N-dimensional matrices persist canonically; this view presents editable rows without flattening them.</p><div className="v2-ref-table-wrap"><table><thead><tr><th>Selections</th><th>Base rate</th><th>Tier basis</th></tr></thead><tbody>{draft.matrix.rows.map((row, index) => <tr key={row.rowId}><td>{draft.matrix!.dimensions.map((dimension) => String(row.combination[dimension.selectionKey] ?? "—")).join(" · ")}</td><td><MoneyInput disabled={disabled || !draft.matrix!.editable || row.tierBasis === "computed_sheet_usage"} value={row.baseRateCents} onChange={(baseRateCents) => patch("matrix", (value) => ({ ...value, matrix: value.matrix ? { ...value.matrix, rows: value.matrix.rows.map((current, position) => position === index ? { ...current, baseRateCents: baseRateCents ?? 0 } : current) } : null }))} /></td><td>{row.tierBasis ? title(row.tierBasis) : "—"}</td></tr>)}</tbody></table></div></div>;

const Recipe = ({ draft, materials, disabled, patch }: Readonly<{ draft: DraftState; materials: readonly ProductMaterial[]; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => <div className="v2-ref-recipe"><Sub title="Recipe"><p className="v2-ref-lead">Material requirements are physical requirements. Inventory normalization is automatic and Material-owned.</p>{draft.recipe.map((component, index) => <article key={component.componentId ?? `${component.materialId}-${index}`} className="v2-ref-card"><header><strong>{component.materialName ?? "Material component"}</strong><button type="button" disabled={disabled} onClick={() => patch("recipe", (value) => ({ ...value, recipe: value.recipe.filter((_, position) => position !== index) }))}>Remove</button></header><div className="v2-ref-field-grid"><Cell label="Material"><select disabled={disabled} value={component.materialId} onChange={(event) => { const found = materials.find((item) => item.materialId === event.target.value); patch("recipe", (value) => ({ ...value, recipe: value.recipe.map((item, position) => position === index ? { ...item, materialId: event.target.value, materialName: found?.name, materialSku: found?.sku } : item) })); }}><option value="">Select material</option>{materials.map((material) => <option key={material.materialId} value={material.materialId}>{material.name}</option>)}</select></Cell><Cell label="Requirement basis"><select disabled={disabled} value={component.quantityKind} onChange={(event) => patch("recipe", (value) => ({ ...value, recipe: value.recipe.map((item, position) => position === index ? { ...item, quantityKind: event.target.value as ProductRecipeComponent["quantityKind"] } : item) }))}><option value="per_line">Per line</option><option value="per_piece">Per piece</option><option value="per_area">Per area</option></select></Cell><Cell label="Factor"><input disabled={disabled} inputMode="decimal" value={component.quantity} onChange={(event) => patch("recipe", (value) => ({ ...value, recipe: value.recipe.map((item, position) => position === index ? { ...item, quantity: event.target.value } : item) }))} /></Cell><Cell label="Unit"><select disabled={disabled} value={component.unit} onChange={(event) => patch("recipe", (value) => ({ ...value, recipe: value.recipe.map((item, position) => position === index ? { ...item, unit: event.target.value as ProductRecipeComponent["unit"] } : item) }))}>{["each", "square_foot", "linear_foot", "sheet", "roll"].map((unit) => <option key={unit} value={unit}>{title(unit)}</option>)}</select></Cell>{component.condition && <Cell label="When selected" wide><span className="v2-ref-readonly">Option {component.condition.optionId} = {component.condition.choiceValue}</span></Cell>}<Toggle label="Replace matching legacy PBV2 compatibility requirement" checked={Boolean(component.replacesPbv2Compatibility)} disabled={disabled} onChange={(replacesPbv2Compatibility) => patch("recipe", (value) => ({ ...value, recipe: value.recipe.map((item, position) => position === index ? { ...item, replacesPbv2Compatibility } : item) }))} /></div></article>)}<button type="button" className="button secondary" disabled={disabled || !materials.length} onClick={() => { const material = materials[0]!; patch("recipe", (value) => ({ ...value, recipe: [...value.recipe, { materialId: material.materialId, materialName: material.name, materialSku: material.sku, quantity: "1", unit: material.unit, quantityKind: "per_piece" }] })); }}>Add recipe component</button></Sub></div>;

const Production = ({ draft, disabled, patch }: Readonly<{ draft: DraftState; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => { const rules = draft.general.productionUnitSpecification?.rules ?? []; const options = draft.options.filter((option) => option.choices.length); return <div className="v2-ref-production"><p className="v2-ref-lead">Production units are the physical things that get made — sides, pages, layers or panels. Conditions use canonical Product Option selection keys.</p>{rules.map((rule, index) => <article key={rule.key} className="v2-ref-card"><header><strong>{rule.key || "Untitled unit"}</strong><button type="button" disabled={disabled} onClick={() => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.filter((_, position) => position !== index) } } }))}>Remove</button></header><div className="v2-ref-field-grid"><Cell label="Unit key"><input disabled={disabled} value={rule.key} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.map((item, position) => position === index ? { ...item, key: event.target.value } : item) } } }))} /></Cell><Cell label="Side"><select disabled={disabled} value={rule.side ?? ""} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.map((item, position) => position === index ? { ...item, side: event.target.value ? event.target.value as "front" | "back" : undefined } : item) } } }))}><option value="">Not specified</option><option value="front">Front</option><option value="back">Back</option></select></Cell><Cell label="Page"><input disabled={disabled} type="number" min="1" value={rule.sourcePageIndex === undefined ? "" : rule.sourcePageIndex + 1} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.map((item, position) => position === index ? { ...item, sourcePageIndex: event.target.value === "" ? undefined : Number(event.target.value) - 1 } : item) } } }))} /></Cell><Cell label="Layer"><input disabled={disabled} value={rule.layerKey ?? ""} onChange={(event) => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.map((item, position) => position === index ? { ...item, layerKey: event.target.value || undefined } : item) } } }))} /></Cell><Cell label="Required when" wide><select disabled={disabled} value={rule.when?.selectionKey ?? ""} onChange={(event) => { const option = options.find((item) => item.optionId === event.target.value); patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: rules.map((item, position) => position === index ? { ...item, when: option ? { selectionKey: option.optionId, equals: String(option.choices[0]?.choiceValue ?? "") } : undefined } : item) } } })); }}><option value="">Always</option>{options.map((option) => <option key={option.optionId} value={option.optionId}>{option.label}</option>)}</select></Cell></div></article>)}<button type="button" className="button secondary" disabled={disabled} onClick={() => patch("general", (value) => ({ ...value, general: { ...value.general, productionUnitSpecification: { schemaVersion: 1, rules: [...rules, { key: `unit_${rules.length + 1}` }] } } }))}>Add production unit</button></div> };
const Routing = ({ draft, templates, disabled, patch }: Readonly<{ draft: DraftState; templates: RoutingWorkspaceRead["templates"]; disabled: boolean; patch: (section: DirtySection, update: (value: DraftState) => DraftState) => void }>) => {
  const selectTemplate = (routeTemplateId: string) => {
    const template = templates.find((item) => item.routeTemplateId === routeTemplateId);
    if (!template) return;
    patch("routing", (value) => ({ ...value, routing: { kind: "route_required", routeTemplateId: template.routeTemplateId, routeTemplateName: template.name, sourceTemplateRevision: template.revision, sourceTemplateFingerprint: template.definitionFingerprint, steps: template.steps.map((step) => ({ position: step.position, kind: step.kind as "proofing" | "prepress" | "production" | "fulfillment" })) } }));
  };
  return <div className="v2-ref-routing"><p className="v2-ref-lead">Route Templates are defined and versioned in the Routing module. This Product only selects which one its orders should follow.</p><div className="v2-ref-field-grid"><Cell label="Route policy"><select disabled={disabled} value={draft.routing.kind} onChange={(event) => { if (event.target.value === "route_required") { const first = templates.find((template) => template.active); if (first) selectTemplate(first.routeTemplateId); return; } patch("routing", (value) => ({ ...value, routing: event.target.value === "no_route" ? { kind: "no_route" } : { kind: "unconfigured" } })); }}><option value="unconfigured">Unconfigured</option><option value="no_route">No route</option><option value="route_required">Route required</option></select></Cell>{draft.routing.kind === "route_required" && <Cell label="Default route"><select disabled={disabled} value={draft.routing.routeTemplateId} onChange={(event) => selectTemplate(event.target.value)}><option value="">Select Route Template</option>{templates.filter((item) => item.active).map((template) => <option key={template.routeTemplateId} value={template.routeTemplateId}>{template.name}</option>)}</select></Cell>}</div>{draft.routing.kind === "route_required" ? <div className="v2-ref-route-preview"><b>Route preview</b><span>Revision {draft.routing.sourceTemplateRevision ?? "—"}</span><ol>{draft.routing.steps.map((step) => <li key={step.position}>{title(step.kind)}</li>)}</ol><p>Read-only route context. Editing steps happens in the Routing module.</p></div> : <p className="v2-ref-lead">{draft.routing.kind === "no_route" ? "Orders skip Routing — typical for service fees and fulfillment-only Products." : "Routing is unconfigured."}</p>}</div>;
};
const Review = ({ draft, issueCount, onSave, onPublish, canPublish }: Readonly<{ draft: DraftState; issueCount: number; onSave: () => void; onPublish?: () => void; canPublish: boolean }>) => <div className="v2-ref-review"><div className="v2-ref-review-grid"><article><h3>Basics</h3><p>{draft.general.displayName || "Product name required"}</p><p>{title(draft.general.workflowIntent)} · {title(draft.general.measurementMode)}</p></article><article><h3>Options</h3><p>{draft.options.length} option group{draft.options.length === 1 ? "" : "s"}</p></article><article><h3>Pricing</h3><p>{dollars(draft.pricing.perPieceCents)} per piece · {dollars(draft.pricing.perSqftCents)} per sq ft</p></article><article><h3>Materials / Recipe</h3><p>{draft.recipe.length} component{draft.recipe.length === 1 ? "" : "s"}</p></article><article><h3>Production</h3><p>{draft.general.productionUnitSpecification?.rules.length ?? 0} required unit{(draft.general.productionUnitSpecification?.rules.length ?? 0) === 1 ? "" : "s"}</p></article><article><h3>Routing</h3><p>{title(draft.routing.kind)}</p></article></div><div className="v2-ref-review-actions"><button type="button" className="button" disabled={!canPublish} onClick={onPublish}>Publish ProductVersion</button><button type="button" className="button secondary" onClick={onSave}>Save Changes</button>{issueCount > 0 && <span>Fix {issueCount} blocking issue{issueCount === 1 ? "" : "s"} first.</span>}</div></div>;
const PricingRail = ({ productId, organizationId, draft, inputs, setInputs, preview, setPreview, jump }: Readonly<{ productId?: string; organizationId: string; draft: DraftState; inputs: { quantity: string; width: string; height: string; selections: Record<string, unknown> }; setInputs: React.Dispatch<React.SetStateAction<{ quantity: string; width: string; height: string; selections: Record<string, unknown> }>>; preview: Awaited<ReturnType<typeof productApi.previewDraftPricing>> | null; setPreview: React.Dispatch<React.SetStateAction<Awaited<ReturnType<typeof productApi.previewDraftPricing>> | null>>; jump: (id: SectionId) => void }>) => <div className="v2-ref-rail-stack"><section className="v2-ref-rail-card"><h2>Configuration preview</h2><div className="v2-ref-field-grid"><Cell label="Quantity"><input type="number" min="1" value={inputs.quantity} onChange={(event) => setInputs((current) => ({ ...current, quantity: event.target.value }))} /></Cell>{draft.general.measurementMode === "dimensions_required" && <><Cell label="Width (in)"><input inputMode="decimal" value={inputs.width} onChange={(event) => setInputs((current) => ({ ...current, width: event.target.value }))} /></Cell><Cell label="Height (in)"><input inputMode="decimal" value={inputs.height} onChange={(event) => setInputs((current) => ({ ...current, height: event.target.value }))} /></Cell></>}{draft.options.filter((option) => option.inputType === "select").map((option) => <Cell key={option.optionId} label={option.label}><select value={String(inputs.selections[option.optionId] ?? option.defaultValue ?? "")} onChange={(event) => setInputs((current) => ({ ...current, selections: { ...current.selections, [option.optionId]: event.target.value } }))}><option value="">Select</option>{option.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select></Cell>)}</div><button type="button" className="button secondary" disabled={!productId} onClick={() => { if (!productId) return; void productApi.previewDraftPricing(organizationId, productId, { quantity: Number(inputs.quantity), ...(draft.general.measurementMode === "dimensions_required" ? { width: Number(inputs.width), height: Number(inputs.height) } : {}), selections: inputs.selections }).then(setPreview); }}>Preview price</button>{preview && <div className="v2-ref-preview-result"><strong>{dollars(preview.calculatedLineAmount.cents)}</strong><span>{preview.minimumChargeApplied ? "Minimum applied" : "Resolved by canonical Pricing"}</span>{preview.breakdown.map((entry, index) => <p key={`${entry.label}-${index}`}>{entry.label}<b>{dollars(entry.cents)}</b></p>)}</div>}</section><section className="v2-ref-rail-card"><h2>Material resolution</h2>{draft.recipe.length ? <ul>{draft.recipe.map((component, index) => <li key={`${component.materialId}-${index}`}>{component.materialName ?? component.materialId} · {component.quantity} {title(component.unit)}</li>)}</ul> : <p>No Recipe components.</p>}<button type="button" onClick={() => jump("materials")}>Edit materials</button></section><section className="v2-ref-rail-card"><h2>Production resolution</h2><p>{draft.general.productionUnitSpecification?.rules.length ?? 0} production requirement(s)</p><button type="button" onClick={() => jump("production")}>Edit production</button></section><section className="v2-ref-rail-card"><h2>Validation findings</h2><p>{draft.general.displayName.trim() ? "No blocking local finding." : "Product name is required."}</p></section></div>;
