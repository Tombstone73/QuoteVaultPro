import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  routingApi,
  type ProductCatalogItem,
  type ProductActiveDefinition,
  type ProductDraftFormulaPricing,
  type ProductDraftGeneral,
  type ProductDraftGeneralRead,
  type ProductDraftOption,
  type ProductDraftOptionPricing,
  type ProductDraftOptionsRead,
  type ProductDraftPricing,
  type ProductDraftPricingMatrix,
  type ProductDraftPricingPreview,
  type ProductDraftPricingTier,
  type ProductDraftRouting,
  type ProductMaterial,
  type ProductRecipe,
  type ProductRecipeComponent,
  type ProductVersionSummary,
  type ProductWorkspaceDetail,
} from "./api";
import {
  conditionalProductionUnitSpecification,
  conditionLabel,
  conditionOptions,
  conditionToken,
  presetProductionUnitSpecification,
  productionUnitAuthoringMode,
  type ProductionUnitAuthoringMode,
} from "./productProductionUnits";
import { productBuilderPath, productPath } from "./productRouting";
import { ProductBuilderReference } from "./ProductBuilderReference";

const keys = {
  list: (s: string, o: string, q: string, p: number) =>
    ["v2", s, o, "products", q, p] as const,
  detail: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id] as const,
  general: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-general"] as const,
  options: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-options"] as const,
  pricing: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-pricing"] as const,
  formula: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-formula"] as const,
  optionPricing: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-option-pricing"] as const,
  recipe: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-recipe"] as const,
  routing: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id, "draft-routing"] as const,
};
const dash = "—";
const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "P";
const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : dash;
const dollars = (value?: number) =>
  value === undefined ? dash : (value / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
const status = (product: ProductCatalogItem) =>
  product.lifecycle === "active_with_draft"
    ? "Active · Draft"
    : product.lifecycle === "draft"
      ? "Draft"
      : product.lifecycle === "inactive"
        ? "Inactive"
        : "Active";
const basis = (product: ProductCatalogItem) =>
  product.measurementMode === "quantity_only"
    ? "Quantity only"
    : "Dimensions + quantity";
const route = (product: ProductCatalogItem) =>
  !product.productType
    ? dash
    : product.productType.routePolicy === "route_required"
      ? `${product.productType.displayName} · Route required`
      : product.productType.routePolicy === "no_route"
        ? `${product.productType.displayName} · No route`
        : `${product.productType.displayName} · Unconfigured`;

export const ProductWorkspace = ({
  organizationId,
  sessionScope,
  productId,
  newProduct = false,
  canView,
  canEdit,
  builderMode = false,
  openProduct,
  backToCatalog,
  openEditor = openProduct,
  openNewProduct = backToCatalog,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  productId: string;
  newProduct?: boolean;
  canView: boolean;
  canEdit: boolean;
  builderMode?: boolean;
  openProduct: (id: string) => void;
  backToCatalog: () => void;
  openEditor?: (id: string) => void;
  openNewProduct?: () => void;
}>) => {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState(
      () =>
        typeof window !== "undefined" &&
        builderMode || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("draft") === "1"),
    );
  useEffect(() => {
    if (builderMode || new URLSearchParams(window.location.search).get("draft") === "1") setEditing(true);
  }, [builderMode, productId]);
  const list = useQuery({
    queryKey: keys.list(sessionScope, organizationId, query, page),
    queryFn: () => productApi.list(organizationId, query, page),
    enabled: Boolean(organizationId && sessionScope && canView && !productId),
  });
  const detail = useQuery({
    queryKey: keys.detail(sessionScope, organizationId, productId),
    queryFn: () => productApi.get(organizationId, productId),
    enabled: Boolean(organizationId && sessionScope && canView && productId),
  });
  const client = useQueryClient();
  const createDraft = useMutation({
    mutationFn: (product: ProductWorkspaceDetail) =>
      productApi.createDraft(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        product.versions.active?.updatedAt ?? "",
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: keys.detail(sessionScope, organizationId, productId),
      });
      window.history.pushState({}, "", builderMode ? productBuilderPath(productId) : `${productPath(productId)}?draft=1`);
      setEditing(true);
    },
  });
  const publishDraft = useMutation({
    mutationFn: (product: ProductWorkspaceDetail) => {
      const draft = product.versions.draft;
      if (!draft) throw new Error("A Product Draft is required before publication.");
      return productApi.publishDraft(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: draft.productVersionId,
          expectedProductUpdatedAt: product.productUpdatedAt,
          expectedDraftUpdatedAt: draft.updatedAt,
          confirmWarnings: true,
          activateProduct: true,
        },
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: keys.detail(sessionScope, organizationId, productId),
      });
      void client.invalidateQueries({
        queryKey: keys.list(sessionScope, organizationId, query, page),
      });
      window.history.pushState({}, "", builderMode ? productBuilderPath(productId) : productPath(productId));
      setEditing(false);
    },
  });
  if (!organizationId || !canView)
    return (
      <section className="v2-products">
        <p className="v2-proof-empty">Products are unavailable.</p>
      </section>
    );
  if (newProduct)
    return <NewProductBuilder organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} openEditor={openEditor} back={backToCatalog} />;
  if (productId)
    return (
      <Detail
        state={detail}
        canEdit={canEdit}
        organizationId={organizationId}
        sessionScope={sessionScope}
        editing={editing}
        creatingDraft={createDraft.isPending}
        draftCreationError={(createDraft.error as { message?: string } | null)?.message}
        publishingDraft={publishDraft.isPending}
        publishError={(publishDraft.error as { message?: string } | null)?.message}
        createDraft={(product) => createDraft.mutate(product)}
        publishDraft={(product) => publishDraft.mutate(product)}
        openDraft={() => {
          window.history.pushState({}, "", builderMode ? productBuilderPath(productId) : `${productPath(productId)}?draft=1`);
          setEditing(true);
        }}
        closeDraft={() => {
          if (builderMode) backToCatalog();
          else window.history.pushState({}, "", productPath(productId));
          setEditing(false);
        }}
        back={backToCatalog}
      />
    );
  if (builderMode) return <section className="v2-products"><p className="v2-proof-empty">Choose a Product from the Product Catalog.</p></section>;
  return (
    <section className="v2-products" aria-label="Products">
      <header className="v2-products-heading">
        <div>
          <h1>Products</h1>
          <p>
            {list.data
              ? `${list.data.total} configurable product${list.data.total === 1 ? "" : "s"}`
              : "Products"}
          </p>
        </div>
        {canEdit && <button type="button" className="button" onClick={openNewProduct}>New Product</button>}
      </header>
      <div className="v2-products-tools">
        <label>
          <span>⌕</span>
          <input
            aria-label="Search Products"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Product or category…"
          />
        </label>
      </div>
      <div className="v2-products-table-wrap">
        <table className="v2-products-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Pricing</th>
              <th>Route</th>
              <th>Basis</th>
              <th>Primary Material</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={8}>Loading Products…</td>
              </tr>
            )}
            {list.isSuccess && !list.data.items.length && (
              <tr>
                <td colSpan={8}>No Products match this search.</td>
              </tr>
            )}
            {list.data?.items.map((product) => (
              <tr key={product.productId}>
                <td>
                  <button className="v2-products-link" type="button" onClick={() => openProduct(product.productId)}>
                    <i>{initials(product.displayName)}</i>
                    <b>{product.displayName}</b>
                  </button>
                </td>
                <td>{product.category ?? dash}</td>
                <td>{product.pricingSummary}</td>
                <td>{route(product)}</td>
                <td>{basis(product)}</td>
                <td>{product.primaryMaterialName ?? dash}</td>
                <td>
                  <em className={`v2-product-status ${product.lifecycle}`}>
                    {status(product)}
                  </em>
                </td>
                <td><button type="button" className="button secondary" disabled={!canEdit} onClick={() => openEditor(product.productId)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && list.data.total > list.data.pageSize && (
        <nav className="v2-products-pagination">
          <span>Page {list.data.page}</span>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            disabled={!list.data.hasMore}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
};

const NewProductBuilder = ({ organizationId, sessionScope, canEdit, openEditor, back }: Readonly<{ organizationId: string; sessionScope: string; canEdit: boolean; openEditor: (id: string) => void; back: () => void }>) => {
  return <ProductBuilderReference organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} back={back} openProduct={openEditor} newProduct />;
  /* Legacy per-section New Product shell retained below only as an unrendered
     implementation record while the reference port is exercised in DEV. */
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [collapsed, setCollapsed] = useState<Readonly<Partial<Record<ProductBuilderSectionId, boolean>>>>({});
  const create = useMutation({ mutationFn: () => productApi.createProduct(organizationId, newBusinessRequestId(), displayName.trim()), onSuccess: (created) => openEditor(created.productId) });
  return <section className="v2-products v2-product-builder" aria-label="New Product Builder">
    <ProductBuilderHeader title={displayName || "Untitled product"} subtitle="New Product Draft" state="UNSAVED" back={back} saveLabel={create.isPending ? "Creating…" : "Save Changes"} saveDisabled={!canEdit || !displayName.trim() || create.isPending} onSave={() => create.mutate()} publishDisabled />
    <ProductBuilderJumpNav />
    <div className="v2-product-builder-layout"><main className="v2-product-builder-main"><ProductBuilderSection id="basics" title="Basics" hint="Identity, measurement mode and workflow intent." collapsed={collapsed} setCollapsed={setCollapsed}><div className="v2-product-builder-basics"><label>Product name<input aria-label="Product name" autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Enter Product name" /></label><label className="wide">Description<textarea aria-label="Description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional customer-facing description" /></label></div></ProductBuilderSection>{PRODUCT_BUILDER_SECTIONS.filter(({ id }) => id !== "basics" && id !== "review").map(({ id, label, hint }) => <ProductBuilderSection key={id} id={id} title={label} hint={hint} collapsed={collapsed} setCollapsed={setCollapsed}><p className="v2-product-section-empty">Save the Product name to create the Draft, then configure this section.</p></ProductBuilderSection>)}<ProductBuilderSection id="review" title="Review" hint="Check this Product before publishing." collapsed={collapsed} setCollapsed={setCollapsed}><p className="v2-product-section-empty">Save the Product name to create the first Draft.</p>{create.isError && <p className="v2-product-version-message">{(create.error as Error).message}</p>}</ProductBuilderSection></main><aside className="v2-product-builder-rail"><section className="v2-product-builder-readiness"><h2>Draft readiness</h2><ul><li>{displayName.trim() ? "✓ Product name" : "○ Product name"}</li><li>○ Pricing</li><li>○ Materials</li><li>○ Production</li><li>○ Routing</li></ul></section></aside></div>
  </section>;
};

const PRODUCT_BUILDER_SECTIONS = [
  { id: "basics", label: "Basics", hint: "Identity, measurement mode and workflow intent." },
  { id: "options", label: "Options", hint: "Option groups, choices, defaults and ordering." },
  { id: "pricing", label: "Pricing", hint: "What this Product charges, and why." },
  { id: "materials", label: "Materials", hint: "Material requirements and option conditions." },
  { id: "production", label: "Production", hint: "Required production units for this Product." },
  { id: "routing", label: "Routing", hint: "Choose the workflow this Product follows." },
  { id: "review", label: "Review", hint: "Check this Product before publishing." },
] as const;
type ProductBuilderSectionId = (typeof PRODUCT_BUILDER_SECTIONS)[number]["id"];
type ProductBuilderCollapsedSections = Readonly<Partial<Record<ProductBuilderSectionId, boolean>>>;

const ProductBuilderHeader = ({ title, subtitle, state, back, saveLabel, saveDisabled, onSave, publishDisabled = false, onPublish }: Readonly<{ title: string; subtitle: string; state: string; back: () => void; saveLabel: string; saveDisabled?: boolean; onSave: () => void; publishDisabled?: boolean; onPublish?: () => void }>) => <header className="v2-product-builder-header"><button className="v2-products-back" onClick={back}>← Products</button><div><h1>{title}</h1><p>{subtitle}</p></div><span className="v2-product-builder-state">{state}</span><button type="button" className="v2-product-builder-save-link" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button><a className="v2-product-builder-review-link" href="#review">Review</a>{onPublish ? <button type="button" className="v2-product-builder-publish-link" disabled={publishDisabled} onClick={onPublish}>Publish</button> : <button type="button" className="v2-product-builder-publish-link" disabled>Publish</button>}</header>;

const ProductBuilderJumpNav = () => <nav className="v2-product-builder-jump-nav" aria-label="Product Builder sections">{PRODUCT_BUILDER_SECTIONS.map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>;

const ProductBuilderSection = ({ id, title, hint, collapsed, setCollapsed, children }: Readonly<{ id: ProductBuilderSectionId; title: string; hint: string; collapsed: ProductBuilderCollapsedSections; setCollapsed: React.Dispatch<React.SetStateAction<ProductBuilderCollapsedSections>>; children: React.ReactNode }>) => {
  const open = !collapsed[id];
  return <section id={id} data-section={id} className="v2-product-builder-section"><header><div><h2>{title}</h2><p>{hint}</p></div><button type="button" aria-expanded={open} onClick={() => setCollapsed((current) => ({ ...current, [id]: !open }))}>{open ? "Collapse" : "Expand"}<span aria-hidden="true">⌄</span></button></header>{open && <div className="v2-product-builder-section-body">{children}</div>}</section>;
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
const VersionRow = ({ version }: { version: ProductVersionSummary }) => (
  <li>
    <span>
      <em className={`v2-product-status ${version.status}`}>
        {version.status[0].toUpperCase() + version.status.slice(1)}
      </em>
      {version.publishedAt
        ? `Published ${date(version.publishedAt)}`
        : `Updated ${date(version.updatedAt)}`}
    </span>
    <small>Created {date(version.createdAt)}</small>
  </li>
);
const ActiveDefinition = ({ value }: { value: ProductActiveDefinition }) => (
  <section className="v2-product-definition" aria-label="Active Product definition">
    <header><div><h2>Active Product definition</h2><p>This is the immutable configuration currently used by Sales.</p></div><small>Active version</small></header>
    <div className="v2-product-definition-grid">
      <article><h3>Options</h3>{value.options.length ? <ul>{value.options.map(option => <li key={option.label}><strong>{option.label}</strong>{option.required ? " · Required" : " · Optional"}{option.defaultLabel ? ` · Default: ${option.defaultLabel}` : ""}{option.choices.length ? <span>{option.choices.map(choice => choice.label).join(" · ")}</span> : null}</li>)}</ul> : <p className="muted">No configurable options.</p>}</article>
      <article><h3>Pricing</h3><p><strong>{value.pricing.mode === "matrix_formula" ? "Matrix + Formula" : value.pricing.mode[0].toUpperCase() + value.pricing.mode.slice(1)}</strong></p>{value.pricing.perSquareFootCents !== undefined && <p>Rate per sq ft: {dollars(value.pricing.perSquareFootCents)}</p>}{value.pricing.perPieceCents !== undefined && <p>Rate per piece: {dollars(value.pricing.perPieceCents)}</p>}{value.pricing.minimumChargeCents !== undefined && <p>Minimum charge: {dollars(value.pricing.minimumChargeCents)}</p>}{value.pricing.tierBasis && <p>Tier basis: {value.pricing.tierBasis.replaceAll("_", " ")}</p>}{value.pricing.formula && <details><summary>{value.pricing.formula.name ?? "Formula"}</summary><code>{value.pricing.formula.expression}</code>{Object.keys(value.pricing.formula.variables).length ? <p>Variables: {Object.entries(value.pricing.formula.variables).map(([key, amount]) => `${key} = ${amount}`).join(", ")}</p> : null}</details>}{value.pricing.matrix && <details><summary>Matrix: {value.pricing.matrix.dimensions.join(" × ")}</summary><p>{value.pricing.matrix.pricingUnit === "per_piece" ? "Per piece" : "Per sq ft"}</p><ul>{value.pricing.matrix.rows.map((row,index)=><li key={index}>{row.selections.join(" · ")} — {dollars(row.baseRateCents)}{row.tierCount ? ` · ${row.tierCount} tier${row.tierCount === 1 ? "" : "s"}` : ""}{row.computedSheetTiers ? " · computed-sheet tiers" : ""}</li>)}</ul></details>}</article>
      <article><h3>Materials / Recipe</h3>{value.recipe.length ? <ul>{value.recipe.map(component => <li key={component.componentId}><strong>{component.materialName}</strong> — {component.quantity} {component.unit} per {component.basis.replace(/^per_/u, "")}{component.condition ? ` · ${component.condition}` : ""}{component.replacesCompatibility ? " · replaces compatibility rule" : ""}</li>)}</ul> : <p className="muted">No recipe is defined.</p>}</article>
      <article><h3>Production</h3>{value.productionUnits.length ? <ul>{value.productionUnits.map(unit => <li key={unit.key}><strong>{unit.side ?? unit.key}</strong>{unit.condition ? ` · ${unit.condition}` : " · Always"}</li>)}</ul> : <p className="muted">Production units are unconfigured.</p>}</article>
      <article><h3>Routing</h3>{value.routing ? <><p><strong>{value.routing.mode === "route_required" ? "Route required" : value.routing.mode === "no_route" ? "No route" : "Unconfigured"}</strong></p>{value.routing.templateName && <p>{value.routing.templateName}{value.routing.revision ? ` · revision ${value.routing.revision}` : ""}</p>}{value.routing.steps.length ? <p>{value.routing.steps.join(" → ")}</p> : null}</> : <p className="muted">No version-owned routing specification.</p>}</article>
    </div>
  </section>
);

/** Product selects a Routing-owned definition; it never edits route steps here. */
const RoutingPolicyForm = ({ value, templates, disabled, onSave }: Readonly<{ value: ProductDraftRouting; templates: readonly Readonly<{ routeTemplateId: string; name: string; active: boolean; steps: readonly Readonly<{ position: number; kind: string }>[] }>[]; disabled: boolean; onSave: (value: ProductDraftRouting) => void }>) => {
  const [kind, setKind] = useState(value.routing.kind), [templateId, setTemplateId] = useState(value.routing.kind === "route_required" ? value.routing.routeTemplateId : "");
  const selected = templates.find((template) => template.routeTemplateId === templateId);
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (kind === "route_required" && !selected) return; onSave({ ...value, routing: kind === "route_required" ? { kind, routeTemplateId: selected!.routeTemplateId, routeTemplateName: selected!.name, steps: selected!.steps.map((step) => ({ position: step.position, kind: step.kind as "proofing" | "prepress" | "production" | "fulfillment" })) } : { kind } }); };
  return <form id="product-draft-routing" className="v2-product-form" onSubmit={submit}><h2>Routing</h2><p>Choose the workflow this Product follows.</p><label>Routing policy<select value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="unconfigured">Unconfigured</option><option value="no_route">No route</option><option value="route_required">Route required</option></select></label>{kind === "route_required" && <><label>Route template<select value={templateId} disabled={disabled} onChange={(event) => setTemplateId(event.target.value)}><option value="">Select a Route Template</option>{templates.filter((template) => template.active).map((template) => <option key={template.routeTemplateId} value={template.routeTemplateId}>{template.name}</option>)}</select></label>{selected && <p className="v2-product-note">{selected.steps.map((step) => step.kind).join(" → ")}</p>}</>}<button type="submit" disabled={disabled || (kind === "route_required" && !selected)}>Save Routing</button></form>;
};
const Detail = ({
  state,
  canEdit,
  organizationId,
  sessionScope,
  editing,
  creatingDraft,
  draftCreationError,
  publishingDraft,
  publishError,
  createDraft,
  publishDraft,
  openDraft,
  closeDraft,
  back,
}: {
  state: ReturnType<typeof useQuery<ProductWorkspaceDetail>>;
  canEdit: boolean;
  organizationId: string;
  sessionScope: string;
  editing: boolean;
  creatingDraft: boolean;
  draftCreationError?: string;
  publishingDraft: boolean;
  publishError?: string;
  createDraft: (product: ProductWorkspaceDetail) => void;
  publishDraft: (product: ProductWorkspaceDetail) => void;
  openDraft: () => void;
  closeDraft: () => void;
  back: () => void;
}) => {
  const automaticDraftRequest = useRef("");
  const sourceProduct = state.data;
  useEffect(() => {
    if (!sourceProduct || !editing || !canEdit || sourceProduct.versions.draft || !sourceProduct.versions.active || automaticDraftRequest.current === sourceProduct.productId) return;
    automaticDraftRequest.current = sourceProduct.productId;
    createDraft(sourceProduct);
  }, [canEdit, createDraft, editing, sourceProduct]);
  if (state.isLoading)
    return (
      <section className="v2-products">
        <p className="v2-proof-empty">Loading Product…</p>
      </section>
    );
  if (state.isError || !state.data)
    return (
      <section className="v2-products">
        <button className="v2-products-back" onClick={back}>
          ← Products
        </button>
        <p className="v2-proof-empty">Product not found.</p>
      </section>
    );
  const product = state.data;
  if (editing && !product.versions.draft && product.versions.active)
    return <section className="v2-products v2-product-builder"><button className="v2-products-back" onClick={back}>← Products</button><p className="v2-proof-empty">{draftCreationError ?? (creatingDraft ? "Preparing an editable Draft…" : "Preparing an editable Draft…")}</p></section>;
  if (editing && product.versions.draft)
    return (
      <Builder
        product={product}
        organizationId={organizationId}
        sessionScope={sessionScope}
        canEdit={canEdit}
        publish={() => publishDraft(product)}
        publishing={publishingDraft}
        back={closeDraft}
      />
    );
  const versions = product.versions;
  return (
    <section className="v2-products v2-product-detail">
      <button className="v2-products-back" onClick={back}>
        ← Products
      </button>
      <header className="v2-products-heading">
        <div>
          <h1>{product.displayName}</h1>
          <p>
            {[product.category, product.productType?.displayName]
              .filter(Boolean)
              .join(" · ") || "Product"}
          </p>
        </div>
        <em className={`v2-product-status ${product.lifecycle}`}>
          {status(product)}
        </em>
      </header>
      <div className="v2-product-detail-grid">
        <article>
          <h2>Product details</h2>
          <dl>
            <Field label="Measurement" value={basis(product)} />
            <Field
              label="Workflow"
              value={
                product.workflowIntent === "service_fee"
                  ? "Service / fee"
                  : product.workflowIntent === "fulfillment_only"
                    ? "Fulfillment only"
                    : "Standard production"
              }
            />
            <Field
              label="Configurable options"
              value={
                product.configurableOptionCount
                  ? `${product.configurableOptionCount} option${product.configurableOptionCount === 1 ? "" : "s"}`
                  : dash
              }
            />
          </dl>
        </article>
        <article>
          <h2>Pricing</h2>
          <dl>
            <Field label="Method" value={product.pricingSummary} />
            <Field
              label="Current version"
              value={product.activeVersion?.label ?? dash}
            />
            <Field
              label="Draft"
              value={product.hasDraft ? "Available" : dash}
            />
          </dl>
        </article>
        <article>
          <h2>Production policy</h2>
          <dl>
            <Field
              label="Product Type"
              value={product.productType?.displayName ?? dash}
            />
            <Field
              label="Route policy"
              value={
                product.productType?.routePolicy === "route_required"
                  ? "Route required"
                  : product.productType?.routePolicy === "no_route"
                    ? "No route"
                    : product.productType
                      ? "Unconfigured"
                      : dash
              }
            />
            <Field
              label="Proof required"
              value={product.requiresProofApproval ? "Yes" : "No"}
            />
            <Field
              label="Production required"
              value={product.requiresProductionJob ? "Yes" : "No"}
            />
          </dl>
        </article>
        <article>
          <h2>Primary Material</h2>
          <dl>
            <Field
              label="Material"
              value={product.primaryMaterialName ?? dash}
            />
          </dl>
        </article>
        <article className="v2-product-versions">
          <header>
            <h2>Versions</h2>
            {canEdit && versions.draft ? (
              <>
                <button type="button" onClick={openDraft}>
                  Edit Draft
                </button>
                <button
                  type="button"
                  disabled={publishingDraft}
                  onClick={() => publishDraft(product)}
                >
                  {publishingDraft ? "Publishing…" : "Publish Draft"}
                </button>
              </>
            ) : canEdit && versions.active ? (
              <button
                type="button"
                disabled={creatingDraft}
                onClick={() => createDraft(product)}
              >
                {creatingDraft ? "Creating Draft…" : "Create Draft"}
              </button>
            ) : null}
          </header>
          <dl>
            <Field
              label="Active"
              value={
                versions.active
                  ? `Published ${date(versions.active.publishedAt ?? versions.active.updatedAt)}`
                  : dash
              }
            />
            <Field
              label="Draft"
              value={
                versions.draft
                  ? `Updated ${date(versions.draft.updatedAt)}`
                  : dash
              }
            />
          </dl>
          {versions.history.length > 0 && (
            <>
              <h3>History</h3>
              <ul>
                {versions.history.map((version, index) => (
                  <VersionRow
                    key={`${version.status}-${version.createdAt}-${index}`}
                    version={version}
                  />
                ))}
              </ul>
            </>
          )}
          {publishError && (
            <p className="v2-product-version-message">{publishError}</p>
          )}
        </article>
      </div>
      {product.activeDefinition && <ActiveDefinition value={product.activeDefinition} />}
    </section>
  );
};

const Builder = ({
  product,
  organizationId,
  sessionScope,
  canEdit,
  publish,
  publishing,
  back,
}: {
  product: ProductWorkspaceDetail;
  organizationId: string;
  sessionScope: string;
  canEdit: boolean;
  publish: () => void;
  publishing: boolean;
  back: () => void;
}) => {
  const client = useQueryClient();
  const refreshDetail = () =>
    void client.invalidateQueries({
      queryKey: keys.detail(sessionScope, organizationId, product.productId),
    });
  const general = useQuery({
    queryKey: keys.general(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftGeneral(organizationId, product.productId),
  });
  const options = useQuery({
    queryKey: keys.options(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftOptions(organizationId, product.productId),
    enabled: true,
  });
  const pricing = useQuery({
    queryKey: keys.pricing(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftPricing(organizationId, product.productId),
    enabled: true,
  });
  const matrix = useQuery({
    queryKey: [
      ...keys.pricing(sessionScope, organizationId, product.productId),
      "matrix",
    ],
    queryFn: () =>
      productApi.draftPricingMatrix(organizationId, product.productId),
    enabled: true,
  });
  const optionPricing = useQuery({
    queryKey: keys.optionPricing(
      sessionScope,
      organizationId,
      product.productId,
    ),
    queryFn: () =>
      productApi.draftOptionPricing(organizationId, product.productId),
    enabled: true,
    retry: false,
  });
  const formula = useQuery({
    queryKey: keys.formula(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftFormula(organizationId, product.productId),
    enabled: true,
    retry: false,
  });
  const recipe = useQuery({
    queryKey: keys.recipe(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftRecipe(organizationId, product.productId),
    enabled: true,
    retry: false,
  });
  const routing = useQuery({
    queryKey: keys.routing(sessionScope, organizationId, product.productId),
    queryFn: () => productApi.draftRouting(organizationId, product.productId),
    enabled: true,
    retry: false,
  });
  const routeTemplates = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "routing", "workspace"],
    queryFn: () => routingApi.workspace(organizationId),
    enabled: true,
    retry: false,
  });
  const materials = useQuery({
    queryKey: [
      ...keys.recipe(sessionScope, organizationId, product.productId),
      "materials",
    ],
    queryFn: () => productApi.materials(organizationId, product.productId),
    enabled: true,
  });
  const saveGeneral = useMutation({
    mutationFn: (value: ProductDraftGeneralRead) =>
      productApi.saveDraftGeneral(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.draftVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          general: value.general,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.general(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const saveOptions = useMutation({
    mutationFn: (value: ProductDraftOptionsRead) =>
      productApi.saveDraftOptions(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.draftVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          options: value.options,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.options(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const savePricing = useMutation({
    mutationFn: (value: ProductDraftPricing) =>
      productApi.saveDraftPricing(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.draftVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          base: value.base,
          tierBasis: value.tierBasis,
          tiers: value.tiers,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.pricing(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const saveMatrix = useMutation({
    mutationFn: (value: ProductDraftPricingMatrix) =>
      productApi.saveDraftPricingMatrix(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.draftVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          matrixId: value.matrixId,
          pricingUnit: value.pricingUnit,
          dimensions: value.dimensions.map(
            (dimension) => dimension.selectionKey,
          ),
          rows: value.rows,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        [
          ...keys.pricing(sessionScope, organizationId, product.productId),
          "matrix",
        ],
        value,
      );
      refreshDetail();
    },
  });
  const saveFormula = useMutation({
    mutationFn: (value: ProductDraftFormulaPricing) =>
      productApi.saveDraftFormula(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.draftVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          expression: value.expression,
          variables: value.variables,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.formula(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const saveOptionPricing = useMutation({
    mutationFn: (
      value: Readonly<{
        draftVersionId: string;
        expectedDraftUpdatedAt: string;
        optionId: string;
        choiceValue?: string;
        impact: ProductDraftOptionPricing["options"][number]["choices"][number]["impact"];
      }>,
    ) =>
      productApi.saveDraftOptionPricing(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        value,
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.optionPricing(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const saveRecipe = useMutation({
    mutationFn: (value: ProductRecipe) =>
      productApi.saveDraftRecipe(
        organizationId,
        product.productId,
        newBusinessRequestId(),
        {
          draftVersionId: value.productVersionId,
          expectedDraftUpdatedAt: value.draftUpdatedAt,
          components: value.components,
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(
        keys.recipe(sessionScope, organizationId, product.productId),
        value,
      );
      refreshDetail();
    },
  });
  const saveRouting = useMutation({
    mutationFn: (value: ProductDraftRouting) => productApi.saveDraftRouting(organizationId, product.productId, newBusinessRequestId(), { draftVersionId: value.draftVersionId, expectedDraftUpdatedAt: value.draftUpdatedAt, routing: value.routing }),
    onSuccess: (value) => {
      client.setQueryData(keys.routing(sessionScope, organizationId, product.productId), value);
      refreshDetail();
    },
  });
  if (!general.data)
    return (
      <section className="v2-products">
        <p className="v2-proof-empty">Loading Draft…</p>
      </section>
    );
  /* The reference port owns presentation and global-save orchestration. The
     canonical queries above remain intentionally available for the legacy
     editor until its focused tests are migrated. */
  return <ProductBuilderReference
    organizationId={organizationId}
    sessionScope={sessionScope}
    product={product}
    canEdit={canEdit}
    back={back}
    publish={publish}
    publishing={publishing}
    openProduct={(id) => {
      window.history.pushState({}, "", productBuilderPath(id));
      window.dispatchEvent(new PopStateEvent("popstate"));
    }}
  />;
  /* Legacy rendered Builder intentionally superseded by ProductBuilderReference.
  const [collapsed, setCollapsed] = useState<Readonly<Partial<Record<ProductBuilderSectionId, boolean>>>>({});
  if (!general.data)
    return (
      <section className="v2-products">
        <p className="v2-proof-empty">Loading Draft…</p>
      </section>
    );
  const busy =
    saveGeneral.isPending ||
    saveOptions.isPending ||
    savePricing.isPending ||
    saveMatrix.isPending ||
    saveFormula.isPending ||
    saveRecipe.isPending ||
    saveRouting.isPending;
  const error = (saveGeneral.error ??
    saveOptions.error ??
    savePricing.error ??
    saveMatrix.error ??
    saveFormula.error ??
    saveRecipe.error ?? saveRouting.error) as { message?: string } | null;
  return (
    <section className="v2-products v2-product-builder">
      <ProductBuilderHeader title={product.displayName} subtitle={`Draft ProductVersion · ${product.versions.active ? "Active version preserved" : "No Active version yet"}`} state="DRAFT" back={back} saveLabel="Save Changes" saveDisabled={!canEdit || busy} onSave={() => (document.getElementById("product-draft-general") as HTMLFormElement | null)?.requestSubmit()} publishDisabled={!canEdit || publishing} onPublish={publish} />
      <ProductBuilderJumpNav />
      {error && (
        <p className="v2-product-version-message">
          {error.message ?? "Unable to save Draft."}
        </p>
      )}
      <div className="v2-product-builder-layout">
        <main className="v2-product-builder-main">
          <ProductBuilderSection id="basics" title="Basics" hint="Identity, measurement mode and workflow intent." collapsed={collapsed} setCollapsed={setCollapsed}><GeneralForm
          value={general.data}
          conditionOptions={optionPricing.data?.options ?? []}
          disabled={!canEdit || busy}
          onSave={(value) => saveGeneral.mutate(value)}
          /></ProductBuilderSection>
          <ProductBuilderSection id="options" title="Options" hint="Option groups, choices, defaults and ordering." collapsed={collapsed} setCollapsed={setCollapsed}>{options.data ? <><OptionsForm
              value={options.data}
              disabled={!canEdit || busy}
              onSave={(value) => saveOptions.mutate(value)}
            />{optionPricing.data && <OptionPricingForm
                value={optionPricing.data}
                disabled={!canEdit || busy}
                onSave={saveOptionPricing.mutate}
              />}</> : <p className="v2-proof-empty">Loading options…</p>}</ProductBuilderSection>
          <ProductBuilderSection id="pricing" title="Pricing" hint="What this Product charges, and why." collapsed={collapsed} setCollapsed={setCollapsed}>{formula.data ? <FormulaForm
              value={formula.data} disabled={!canEdit || busy} onSave={(value) => saveFormula.mutate(value)} organizationId={organizationId} productId={product.productId}
            /> : matrix.data ? <MatrixForm value={matrix.data} measurementMode={pricing.data?.measurementMode ?? "quantity_only"} disabled={!canEdit || busy} onSave={(value) => saveMatrix.mutate(value)} organizationId={organizationId} productId={product.productId} /> : pricing.data ? <PricingForm value={pricing.data} options={options.data?.options ?? []} disabled={!canEdit || busy} onSave={(value) => savePricing.mutate(value)} organizationId={organizationId} productId={product.productId} /> : <p className="v2-proof-empty">Loading pricing…</p>}</ProductBuilderSection>
          <ProductBuilderSection id="materials" title="Materials" hint="Material requirements and option conditions." collapsed={collapsed} setCollapsed={setCollapsed}>{recipe.data ? <RecipeForm
            value={recipe.data}
            materials={materials.data?.items ?? []}
            options={options.data?.options ?? []}
            disabled={!canEdit || busy}
            onSave={(value) => saveRecipe.mutate(value)}
          /> : recipe.isError ? <p className="v2-proof-empty">A recipe is not available for this Draft.</p> : <p className="v2-proof-empty">Loading materials…</p>}</ProductBuilderSection>
          <ProductBuilderSection id="production" title="Production" hint="Required production units for this Product." collapsed={collapsed} setCollapsed={setCollapsed}><ProductionSummary specification={general.data.general.productionUnitSpecification} /></ProductBuilderSection>
          <ProductBuilderSection id="routing" title="Routing" hint="Choose the workflow this Product follows." collapsed={collapsed} setCollapsed={setCollapsed}>{routing.data ? <RoutingPolicyForm value={routing.data} templates={routeTemplates.data?.templates ?? []} disabled={!canEdit || busy} onSave={(value) => saveRouting.mutate(value)} /> : <p className="v2-proof-empty">Loading Routing settings…</p>}</ProductBuilderSection>
          <ProductBuilderSection id="review" title="Review" hint="Check this Product before publishing." collapsed={collapsed} setCollapsed={setCollapsed}><DraftReview general={general.data} options={options.data} pricing={pricing.data} matrix={matrix.data} formula={formula.data} optionPricing={optionPricing.data} recipe={recipe.data} routing={routing.data} canPublish={canEdit} publishing={publishing} publish={publish} /></ProductBuilderSection>
        </main>
        <aside className="v2-product-builder-rail"><PricingDiagnostic organizationId={organizationId} productId={product.productId} options={options.data?.options ?? []} requiresDimensions={general.data.general.measurementMode === "dimensions_required"} /><DraftReadiness general={general.data} recipe={recipe.data} routing={routing.data} /></aside>
      </div>
    </section>
  ); */
};

const DraftReview = ({ general, options, pricing, matrix, formula, optionPricing, recipe, routing, canPublish, publishing, publish }: Readonly<{
  general: ProductDraftGeneralRead;
  options?: ProductDraftOptionsRead;
  pricing?: ProductDraftPricing;
  matrix?: ProductDraftPricingMatrix | null;
  formula?: ProductDraftFormulaPricing | null;
  optionPricing?: ProductDraftOptionPricing | null;
  recipe?: ProductRecipe | null;
  routing?: ProductDraftRouting | null;
  canPublish: boolean;
  publishing: boolean;
  publish: () => void;
}>) => (
  <section className="v2-product-review" aria-label="Draft review and publish">
    <header><div><h2>Review Product definition</h2><p>Review this Draft before it replaces the Active ProductVersion.</p></div><button type="button" disabled={!canPublish || publishing} onClick={publish}>{publishing ? "Publishing…" : "Publish Draft"}</button></header>
    <div className="v2-product-definition-grid">
      <article><h3>General</h3><p><strong>{general.general.displayName}</strong></p><p>{general.general.measurementMode === "dimensions_required" ? "Dimensions + quantity" : "Quantity only"} · {general.general.workflowIntent.replaceAll("_", " ")}</p><p>{general.general.description || "No description"}</p></article>
      <article><h3>Options</h3>{options ? <ul>{options.options.map(option => <li key={option.optionId}><strong>{option.label}</strong>{option.required ? " · Required" : " · Optional"}{option.choices.length ? <span>{option.choices.map(choice => choice.label).join(" · ")}</span> : null}</li>)}</ul> : <p>Loading options…</p>}</article>
      <article><h3>Pricing</h3>{matrix ? <><p><strong>Matrix</strong> · {matrix.dimensions.map(dimension => dimension.label).join(" × ")}</p><p>{matrix.rows.length} matrix row{matrix.rows.length === 1 ? "" : "s"} · {matrix.pricingUnit === "per_piece" ? "per piece" : "per sq ft"}</p></> : formula ? <><p><strong>Formula</strong>{formula.formulaName ? ` · ${formula.formulaName}` : ""}</p><code>{formula.expression}</code></> : pricing ? <><p><strong>{pricing.mode.replaceAll("_", " ")}</strong></p><p>{pricing.base.perSqftCents !== null ? `Rate per sq ft: ${dollars(pricing.base.perSqftCents)}` : pricing.base.perPieceCents !== null ? `Rate per piece: ${dollars(pricing.base.perPieceCents)}` : "No base rate"}</p><p>Minimum: {dollars(pricing.base.minimumChargeCents ?? undefined)}</p></> : <p>Loading pricing…</p>}{optionPricing?.options.some(option => option.nodeImpact || option.choices.some(choice => choice.impact)) ? <p>Option pricing impacts are configured.</p> : null}</article>
      <article><h3>Materials / Recipe</h3>{recipe ? recipe.components.length ? <ul>{recipe.components.map(component => <li key={component.componentId}><strong>{component.materialName}</strong> — {component.quantity} {component.unit} per {component.quantityKind.replace(/^per_/u, "")}{component.condition ? " · conditional selection" : ""}</li>)}</ul> : <p>No recipe components.</p> : <p>Loading recipe…</p>}</article>
      <article><h3>Production</h3>{general.general.productionUnitSpecification?.rules.length ? <ul>{general.general.productionUnitSpecification.rules.map(rule => <li key={rule.key}><strong>{rule.side ?? rule.key}</strong>{rule.when ? " · Conditional selection" : " · Always"}</li>)}</ul> : <p>Production units are unconfigured.</p>}</article>
      <article><h3>Routing</h3>{routing ? <><p><strong>{routing.routing.kind === "route_required" ? "Route required" : routing.routing.kind === "no_route" ? "No route" : "Unconfigured"}</strong></p>{routing.routing.kind === "route_required" ? <p>{routing.routing.routeTemplateName} · {routing.routing.steps.map(step => step.kind).join(" → ")}</p> : null}</> : <p>Loading routing…</p>}</article>
    </div>
  </section>
);
const ProductionSummary = ({ specification }: Readonly<{ specification: ProductDraftGeneral["productionUnitSpecification"] }>) => specification?.rules.length ? <ul className="v2-product-summary-list">{specification.rules.map((rule) => <li key={rule.key}><strong>{rule.side ?? rule.key}</strong>{rule.sourcePageIndex !== undefined ? ` · page ${rule.sourcePageIndex + 1}` : ""}{rule.layerKey ? ` · ${rule.layerKey}` : ""}{rule.when ? ` · when ${rule.when.selectionKey} = ${String(rule.when.equals)}` : " · always"}</li>)}</ul> : <p className="v2-product-note">No production-unit specification has been configured.</p>;

/** This is a read-only view over the canonical Draft pricing resolver; it never calculates price in React. */
const PricingDiagnostic = ({ organizationId, productId, options, requiresDimensions }: Readonly<{ organizationId: string; productId: string; options: readonly ProductDraftOption[]; requiresDimensions: boolean }>) => {
  const [quantity, setQuantity] = useState("1"), [width, setWidth] = useState(""), [height, setHeight] = useState(""), [selections, setSelections] = useState<Record<string, unknown>>({});
  const preview = useMutation({ mutationFn: () => productApi.previewDraftPricing(organizationId, productId, { quantity: Number(quantity), ...(requiresDimensions ? { width: Number(width), height: Number(height) } : {}), selections }) });
  const result = preview.data;
  return <section className="v2-product-pricing-preview" aria-label="Pricing preview"><h2>Pricing preview</h2><p>Test a configuration without changing this Draft.</p><label>Quantity<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>{requiresDimensions && <><label>Width (in)<input inputMode="decimal" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label>Height (in)<input inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} /></label></>}{options.filter((option) => option.inputType === "select").map((option) => <label key={option.optionId}>{option.label}<select value={String(selections[option.optionId] ?? option.defaultValue ?? "")} onChange={(event) => setSelections((current) => ({ ...current, [option.optionId]: event.target.value }))}><option value="">Select…</option>{option.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select></label>)}<button type="button" onClick={() => preview.mutate()} disabled={preview.isPending || !quantity || (requiresDimensions && (!width || !height))}>{preview.isPending ? "Resolving…" : "Preview price"}</button>{result && <><PreviewResult result={result} /><details open><summary>Price details</summary>{result.breakdown.length ? <ul>{result.breakdown.map((item, index) => <li key={`${item.label}-${index}`}>{item.label}: {dollars(item.cents)}</li>)}</ul> : <p>No component breakdown is available.</p>}{result.explanation.matrix && <p>Matrix row: {result.explanation.matrix.rowId} · selections {result.explanation.matrix.selectedValues.join(", ")}</p>}{result.explanation.formula && <p>Formula: {result.explanation.formula.expression}</p>}{result.explanation.optionImpacts.length ? <p>Option impacts: {result.explanation.optionImpacts.map((impact) => `${impact.selectionKey} (${impact.kind})`).join(", ")}</p> : null}{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details></>}{preview.error && <p className="v2-product-version-message">{(preview.error as { message?: string }).message ?? "Pricing preview is unavailable."}</p>}</section>;
};

const DraftReadiness = ({ general, recipe, routing }: Readonly<{ general: ProductDraftGeneralRead; recipe?: ProductRecipe | null; routing?: ProductDraftRouting | null }>) => <section className="v2-product-builder-readiness" aria-label="Draft readiness"><h2>Draft readiness</h2><ul><li>{general.general.displayName ? "✓" : "○"} Product basics</li><li>{recipe?.components.length ? "✓" : "○"} Recipe components</li><li>{general.general.productionUnitSpecification?.rules.length ? "✓" : "○"} Production units</li><li>{routing?.routing.kind === "route_required" || routing?.routing.kind === "no_route" ? "✓" : "○"} Routing policy</li></ul><p>Review the complete Product definition before publishing.</p></section>;
const GeneralForm = ({
  value,
  conditionOptions: productionOptions,
  disabled,
  onSave,
}: {
  value: ProductDraftGeneralRead;
  conditionOptions: ProductDraftOptionPricing["options"];
  disabled: boolean;
  onSave: (value: ProductDraftGeneralRead) => void;
}) => {
  const [general, setGeneral] = useState(value.general);
  const [pendingPreset, setPendingPreset] = useState<Exclude<ProductionUnitAuthoringMode, "conditional"> | null>(null);
  const [conditionalEditor, setConditionalEditor] = useState(
    () => productionUnitAuthoringMode(value.general.productionUnitSpecification) === "conditional",
  );
  const productionUnitMode = conditionalEditor
    ? "conditional"
    : productionUnitAuthoringMode(general.productionUnitSpecification);
  const change = <K extends keyof ProductDraftGeneral>(
    key: K,
    next: ProductDraftGeneral[K],
  ) => setGeneral((current) => ({ ...current, [key]: next }));
  return (
    <form
      id="product-draft-general"
      className="v2-product-general"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...value, general });
      }}
    >
      <h2>General</h2>
      <label>
        Product name
        <input
          disabled={disabled}
          value={general.displayName}
          onChange={(event) => change("displayName", event.target.value)}
        />
      </label>
      <label>
        Category
        <input
          disabled={disabled}
          value={general.category ?? ""}
          onChange={(event) => change("category", event.target.value || null)}
        />
      </label>
      <label className="wide">
        Customer-facing description
        <textarea
          disabled={disabled}
          value={general.description ?? ""}
          onChange={(event) =>
            change("description", event.target.value || null)
          }
        />
      </label>
      <label>
        Measurement
        <select
          disabled={disabled}
          value={general.measurementMode}
          onChange={(event) =>
            change(
              "measurementMode",
              event.target.value as ProductDraftGeneral["measurementMode"],
            )
          }
        >
          <option value="dimensions_required">Dimensions + quantity</option>
          <option value="quantity_only">Quantity only</option>
        </select>
      </label>
      <label>
        Workflow
        <select
          disabled={disabled}
          value={general.workflowIntent}
          onChange={(event) =>
            change(
              "workflowIntent",
              event.target.value as ProductDraftGeneral["workflowIntent"],
            )
          }
        >
          <option value="standard_production">Standard production</option>
          <option value="fulfillment_only">Fulfillment only</option>
          <option value="service_fee">Service / fee</option>
        </select>
      </label>
      <label className="toggle">
        Show in customer storefront
        <input
          type="checkbox"
          disabled={disabled}
          checked={general.storefrontVisible}
          onChange={(event) =>
            change("storefrontVisible", event.target.checked)
          }
        />
      </label>
      <label className="toggle">
        Requires proof approval
        <input
          type="checkbox"
          disabled={
            disabled || general.workflowIntent !== "standard_production"
          }
          checked={general.requiresProofApproval}
          onChange={(event) =>
            change("requiresProofApproval", event.target.checked)
          }
        />
      </label>
      <label className="toggle">
        Requires production job
        <input
          type="checkbox"
          disabled={
            disabled || general.workflowIntent !== "standard_production"
          }
          checked={general.requiresProductionJob}
          onChange={(event) =>
            change("requiresProductionJob", event.target.checked)
          }
        />
      </label>
      <label>
        Production units
        <select
          disabled={disabled || general.workflowIntent !== "standard_production"}
          value={productionUnitMode}
          onChange={(event) => {
            const mode = event.target.value as ProductionUnitAuthoringMode;
            if (mode === "conditional") {
              change("productionUnitSpecification", conditionalProductionUnitSpecification("always", "always", productionOptions));
              setConditionalEditor(true);
              return;
            }
            if (productionUnitMode === "conditional") {
              setPendingPreset(mode);
              return;
            }
            change("productionUnitSpecification", presetProductionUnitSpecification(mode));
          }}
        >
          <option value="unconfigured">Unconfigured (legacy)</option>
          <option value="front">One front unit</option>
          <option value="front-back">Front and back units</option>
          <option value="conditional">Conditional production units</option>
        </select>
      </label>
      {pendingPreset && (
        <div className="wide v2-product-note" role="status">
          <p>Changing this mode replaces the authored conditional production rules.</p>
          <button type="button" disabled={disabled} onClick={() => { change("productionUnitSpecification", presetProductionUnitSpecification(pendingPreset)); setConditionalEditor(false); setPendingPreset(null); }}>Replace conditional rules</button>
          <button type="button" disabled={disabled} onClick={() => setPendingPreset(null)}>Keep conditional rules</button>
        </div>
      )}
      {productionUnitMode === "conditional" && (
        <fieldset className="wide v2-product-production-units">
          <legend>Conditional production units</legend>
          <p>Use Product Options and their stable choices. Production requirements remain version-owned and frozen when an Order is created.</p>
          {general.productionUnitSpecification?.rules.map((rule) => {
            const current = rule.when ? conditionToken(rule.when.selectionKey, String(rule.when.equals)) : "always";
            return <label key={rule.key}>
              {rule.side === "back" ? "Back" : "Front"}
              <select
                disabled={disabled}
                value={current}
                onChange={(event) => {
                  const next = general.productionUnitSpecification?.rules.map((candidate) => candidate.key === rule.key ? { ...candidate, ...(event.target.value === "always" ? {} : (() => { const [selectionKey, equals] = event.target.value.split("\u0000"); return { when: { selectionKey, equals } }; })()), ...(event.target.value === "always" ? { when: undefined } : {}) } : candidate) ?? [];
                  change("productionUnitSpecification", { schemaVersion: 1, rules: next });
                }}
              >
                <option value="always">Always</option>
                {conditionOptions(productionOptions).flatMap((option) => option.choices.map((choice) => <option key={`${option.selectionKey}:${choice.choiceValue}`} value={conditionToken(option.selectionKey, choice.choiceValue)}>When {option.label} = {choice.label}</option>))}
              </select>
              <small>{conditionLabel(rule.when, productionOptions)}</small>
            </label>;
          })}
        </fieldset>
      )}
    </form>
  );
};

const OptionsForm = ({
  value,
  disabled,
  onSave,
}: {
  value: ProductDraftOptionsRead;
  disabled: boolean;
  onSave: (value: ProductDraftOptionsRead) => void;
}) => {
  const [options, setOptions] = useState<readonly ProductDraftOption[]>(
      value.options,
    ),
    [selected, setSelected] = useState(value.options[0]?.optionId ?? "");
  const option = options.find((entry) => entry.optionId === selected);
  const update = (next: ProductDraftOption) =>
    setOptions((current) =>
      current.map((entry) => (entry.optionId === next.optionId ? next : entry)),
    );
  const move = (id: string, delta: number) =>
    setOptions((current) => {
      const from = current.findIndex((entry) => entry.optionId === id),
        to = from + delta;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  const add = () => {
    const next: ProductDraftOption = {
      optionId: `new:${crypto.randomUUID()}`,
      label: "New option",
      inputType: "text",
      required: false,
      defaultValue: "",
      choices: [],
      canRemove: true,
    };
    setOptions((current) => [...current, next]);
    setSelected(next.optionId);
  };
  return (
    <form
      id="product-draft-options"
      className="v2-product-options"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...value, options });
      }}
    >
      <header>
        <h2>Options</h2>
        <button type="button" disabled={disabled} onClick={add}>
          Add option
        </button>
      </header>
      <div className="v2-product-options-grid">
        <section>
          <table>
            <thead>
              <tr>
                <th>Option</th>
                <th>Type</th>
                <th>Choices</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {options.map((entry) => (
                <tr
                  key={entry.optionId}
                  className={entry.optionId === selected ? "selected" : ""}
                >
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelected(entry.optionId)}
                    >
                      {entry.label}
                    </button>
                  </td>
                  <td>{entry.inputType}</td>
                  <td>{entry.choices.length || dash}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Move ${entry.label} up`}
                      disabled={disabled}
                      onClick={() => move(entry.optionId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${entry.label} down`}
                      disabled={disabled}
                      onClick={() => move(entry.optionId, 1)}
                    >
                      ↓
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {option && (
          <OptionEditor
            option={option}
            disabled={disabled}
            onChange={update}
            onRemove={() => {
              setOptions((current) =>
                current.filter((entry) => entry.optionId !== option.optionId),
              );
              setSelected(
                options.find((entry) => entry.optionId !== option.optionId)
                  ?.optionId ?? "",
              );
            }}
          />
        )}
      </div>
    </form>
  );
};

const OptionEditor = ({
  option,
  disabled,
  onChange,
  onRemove,
}: {
  option: ProductDraftOption;
  disabled: boolean;
  onChange: (value: ProductDraftOption) => void;
  onRemove: () => void;
}) => {
  const choiceBased =
    option.inputType === "select" || option.inputType === "multiselect";
  const choices = option.choices;
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= choices.length) return;
    const next = [...choices];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...option, choices: next });
  };
  return (
    <aside className="v2-product-option-editor">
      <label>
        Label
        <input
          disabled={disabled}
          value={option.label}
          onChange={(event) =>
            onChange({ ...option, label: event.target.value })
          }
        />
      </label>
      <p>Type: {option.inputType}</p>
      <label className="toggle">
        Required
        <input
          type="checkbox"
          disabled={disabled}
          checked={option.required}
          onChange={(event) =>
            onChange({ ...option, required: event.target.checked })
          }
        />
      </label>
      {choiceBased && (
        <>
          <label>
            Default
            <select
              disabled={disabled}
              value={
                typeof option.defaultValue === "string"
                  ? option.defaultValue
                  : ""
              }
              onChange={(event) =>
                onChange({
                  ...option,
                  defaultValue: event.target.value || null,
                })
              }
            >
              <option value="">No default</option>
              {choices.map((choice, index) => (
                <option
                  key={choice.choiceValue || index}
                  value={choice.choiceValue}
                >
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <h3>Choices</h3>
          {choices.map((choice, index) => (
            <div key={choice.choiceValue || index}>
              <input
                aria-label={`Choice ${index + 1}`}
                disabled={disabled}
                value={choice.label}
                onChange={(event) =>
                  onChange({
                    ...option,
                    choices: choices.map((entry, choiceIndex) =>
                      choiceIndex === index
                        ? { ...entry, label: event.target.value }
                        : entry,
                    ),
                  })
                }
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => move(index, -1)}
              >
                Up
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => move(index, 1)}
              >
                Down
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...option,
                    choices: choices.filter(
                      (_, choiceIndex) => choiceIndex !== index,
                    ),
                    defaultValue:
                      option.defaultValue === choice.choiceValue
                        ? null
                        : option.defaultValue,
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...option,
                choices: [...choices, { choiceValue: "", label: "New choice" }],
              })
            }
          >
            Add choice
          </button>
        </>
      )}
      <button
        type="button"
        disabled={disabled || !option.canRemove}
        onClick={onRemove}
      >
        {option.canRemove
          ? "Remove option"
          : (option.removalReason ?? "Remove unavailable")}
      </button>
    </aside>
  );
};

const RecipeForm = ({
  value,
  materials,
  options,
  disabled,
  onSave,
}: {
  value: ProductRecipe;
  materials: readonly ProductMaterial[];
  options: readonly ProductDraftOption[];
  disabled: boolean;
  onSave: (value: ProductRecipe) => void;
}) => {
  const [components, setComponents] = useState(value.components);
  const conditionChoices = options.flatMap((option) =>
    option.choices.map((choice) => ({
      key: `${option.optionId}:${choice.choiceValue}`,
      optionId: option.optionId,
      choiceValue: choice.choiceValue,
      label: `${option.label}: ${choice.label}`,
    })),
  );
  const update = (index: number, next: Partial<ProductRecipeComponent>) =>
    setComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...next } : component,
      ),
    );
  const add = () => {
    const material = materials[0];
    if (!material) return;
    setComponents((current) => [
      ...current,
      {
        materialId: material.materialId,
        materialName: material.name,
        materialSku: material.sku,
        quantity: "1",
        unit: material.unit,
        quantityKind: "per_line",
      },
    ]);
  };
  return (
    <form
      id="product-draft-recipe"
      className="v2-product-options"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...value, components });
      }}
    >
      <header>
        <div>
          <h2>Materials</h2>
          <p>
            Expected components for one configured line. Stock is not consumed
            here.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || !materials.length}
          onClick={add}
        >
          Add material
        </button>
      </header>
      {!materials.length && (
        <p className="v2-proof-empty">
          No active Materials are available for this organization.
        </p>
      )}
      {components.map((component, index) => {
        const conditionKey = component.condition
          ? `${component.condition.optionId}:${component.condition.choiceValue}`
          : "";
        return (
          <fieldset
            key={component.componentId ?? `${component.materialId}:${index}`}
            disabled={disabled}
          >
            <legend>{component.materialName ?? "Material component"}</legend>
            <label>
              Material
              <select
                value={component.materialId}
                onChange={(event) => {
                  const material = materials.find(
                    (candidate) => candidate.materialId === event.target.value,
                  );
                  if (material)
                    update(index, {
                      materialId: material.materialId,
                      materialName: material.name,
                      materialSku: material.sku,
                      unit:
                        component.quantityKind === "per_area"
                          ? "square_foot"
                          : material.unit,
                    });
                }}
              >
                {materials.map((material) => (
                  <option key={material.materialId} value={material.materialId}>
                    {material.name}
                    {material.sku ? ` · ${material.sku}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Basis
              <select
                value={component.quantityKind}
                onChange={(event) => {
                  const quantityKind = event.target
                    .value as ProductRecipeComponent["quantityKind"];
                  update(index, {
                    quantityKind,
                    unit:
                      quantityKind === "per_area"
                        ? "square_foot"
                        : component.unit,
                  });
                }}
              >
                <option value="per_line">Per line</option>
                <option value="per_piece">Per finished piece</option>
                <option value="per_area">Per square foot</option>
              </select>
            </label>
            <label>
              Quantity / factor
              <input
                inputMode="decimal"
                value={component.quantity}
                onChange={(event) =>
                  update(index, { quantity: event.target.value })
                }
              />
            </label>
            <label>
              Unit
              <select
                value={component.unit}
                disabled={component.quantityKind === "per_area"}
                onChange={(event) =>
                  update(index, {
                    unit: event.target.value as ProductRecipeComponent["unit"],
                  })
                }
              >
                {["each", "square_foot", "linear_foot", "sheet", "roll"].map(
                  (unit) => (
                    <option key={unit} value={unit}>
                      {unit.replaceAll("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Applies when
              <select
                value={conditionKey}
                onChange={(event) => {
                  const selected = conditionChoices.find(
                    (choice) => choice.key === event.target.value,
                  );
                  update(index, {
                    condition: selected
                      ? {
                          type: "selected",
                          optionId: selected.optionId,
                          choiceValue: selected.choiceValue,
                        }
                      : undefined,
                    replacesPbv2Compatibility: selected
                      ? component.replacesPbv2Compatibility
                      : undefined,
                  });
                }}
              >
                <option value="">Always</option>
                {conditionChoices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            {component.condition && (
              <label className="toggle">
                Replaces existing PBV2 material rule
                <input
                  type="checkbox"
                  checked={Boolean(component.replacesPbv2Compatibility)}
                  onChange={(event) =>
                    update(index, {
                      replacesPbv2Compatibility: event.target.checked,
                    })
                  }
                />
              </label>
            )}
            <button
              type="button"
              onClick={() =>
                setComponents((current) =>
                  current.filter(
                    (_, componentIndex) => componentIndex !== index,
                  ),
                )
              }
            >
              Remove
            </button>
          </fieldset>
        );
      })}
      {!components.length && (
        <p className="v2-proof-empty">
          No material requirements are defined for this Product Draft.
        </p>
      )}
    </form>
  );
};

const OptionPricingForm = ({
  value,
  disabled,
  onSave,
}: {
  value: ProductDraftOptionPricing;
  disabled: boolean;
  onSave: (input: any) => void;
}) => {
  const labels: any = {
    fixed: "Fixed amount",
    per_item: "Per item",
    per_square_foot: "Per square foot",
    percent_of_base: "Percent of base",
    multiplier: "Multiplier",
  };
  return (
    <section className="v2-product-options">
      <h2>Option pricing</h2>
      {value.options.map((option) => (
        <div key={option.optionId}>
          <h3>{option.label}</h3>
          {option.choices.map((choice) => (
            <div key={choice.choiceValue}>
              <span>{choice.label}</span>
              {choice.editable ? (
                <>
                  <select
                    disabled={disabled}
                    value={choice.impact?.type ?? "none"}
                    onChange={(event) =>
                      onSave({
                        draftVersionId: value.draftVersionId,
                        expectedDraftUpdatedAt: value.draftUpdatedAt,
                        optionId: option.optionId,
                        choiceValue: choice.choiceValue,
                        impact:
                          event.target.value === "none"
                            ? null
                            : {
                                type: event.target.value,
                                value: choice.impact?.value ?? 0,
                              },
                      })
                    }
                  >
                    <option value="none">No price change</option>
                    {Object.entries(labels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label as string}
                      </option>
                    ))}
                  </select>
                  {choice.impact && (
                    <input
                      disabled={disabled}
                      inputMode="decimal"
                      value={
                        ["fixed", "per_item", "per_square_foot"].includes(
                          choice.impact.type,
                        )
                          ? (choice.impact.value / 100).toFixed(2)
                          : choice.impact.value
                      }
                      onChange={(event) => {
                        const raw = Number(event.target.value),
                          money = [
                            "fixed",
                            "per_item",
                            "per_square_foot",
                          ].includes(choice.impact!.type);
                        onSave({
                          draftVersionId: value.draftVersionId,
                          expectedDraftUpdatedAt: value.draftUpdatedAt,
                          optionId: option.optionId,
                          choiceValue: choice.choiceValue,
                          impact: {
                            ...choice.impact!,
                            value: money ? Math.round(raw * 100) : raw,
                          },
                        });
                      }}
                    />
                  )}
                </>
              ) : (
                <small>{choice.readOnlyReason ?? "Read only"}</small>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
};
const cents = (value: number | null) =>
  value === null ? "" : (value / 100).toFixed(2);
const fromDollars = (value: string) =>
  value.trim() === "" ? null : Math.round(Number(value) * 100);
const PreviewResult = ({
  result,
}: {
  result: ProductDraftPricingPreview | undefined;
}) =>
  result ? (
    <div className="v2-product-pricing-result">
      <b>
        {(result.calculatedLineAmount.cents / 100).toLocaleString(undefined, {
          style: "currency",
          currency: result.calculatedLineAmount.currency,
        })}
      </b>
      <span>
        {(result.calculatedUnitAmount.cents / 100).toLocaleString(undefined, {
          style: "currency",
          currency: result.calculatedUnitAmount.currency,
        })}{" "}
        each
      </span>
      {result.minimumChargeApplied && <span>Minimum charge applied</span>}
      {result.tier && (
        <span>
          {result.tier.basis === "quantity" ? "Quantity" : result.tier.basis === "computed_sheet" ? "Computed-sheet" : "Area"} tier:{" "}
          {result.tier.value}
        </span>
      )}
      {result.explanation.dimensions && <span>{result.explanation.dimensions.widthIn} × {result.explanation.dimensions.heightIn} in · {result.explanation.dimensions.totalAreaSqft} sq ft total</span>}
      {result.explanation.computedSheetUsage && <span>Computed sheet usage: {result.explanation.computedSheetUsage.sheetCount} sheet{result.explanation.computedSheetUsage.sheetCount === 1 ? "" : "s"}{result.explanation.computedSheetUsage.billedSquareFeet == null ? "" : ` · ${result.explanation.computedSheetUsage.billedSquareFeet} billable sq ft`}</span>}
      {result.explanation.matrix && <span>Pricing matrix row: {result.explanation.matrix.rowId}</span>}
      {result.explanation.formula && <span>Formula: {result.explanation.formula.expression}</span>}
    </div>
  ) : null;
const FormulaForm = ({
  value,
  disabled,
  onSave,
  organizationId,
  productId,
}: {
  value: ProductDraftFormulaPricing;
  disabled: boolean;
  onSave: (value: ProductDraftFormulaPricing) => void;
  organizationId: string;
  productId: string;
}) => {
  const [expression, setExpression] = useState(value.expression),
    [variables, setVariables] = useState(value.variables),
    [quantity, setQuantity] = useState("1"),
    [width, setWidth] = useState(""),
    [height, setHeight] = useState(""),
    preview = useMutation({
      mutationFn: () =>
        productApi.previewDraftPricing(organizationId, productId, {
          quantity: Number(quantity),
          ...(width && height
            ? { width: Number(width), height: Number(height) }
            : {}),
        }),
    });
  const draft = { ...value, expression, variables };
  return (
    <section className="v2-product-pricing">
      <form
        id="product-draft-formula"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <h2>{value.formulaName ? "Shared Formula" : "Formula"}</h2>
        {value.formulaName && <p>{value.formulaName}</p>}
        <label>
          Expression
          <textarea
            disabled={disabled || !value.expressionEditable}
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
          />
        </label>
        {value.variablesEditable && !value.expressionEditable && (
          <p className="v2-product-note">The Formula Library identity and expression are shared and read only. These inputs apply only to this ProductVersion.</p>
        )}
        {value.inputs.length > 0 && <h3>Product Formula Inputs</h3>}
        {value.inputs.map((input) => (
          <label key={input.key}>
            {input.label}{input.unit === "in" ? " (in)" : input.unit === "sq_ft" ? " (sq ft)" : ""}
            <input
              disabled={disabled || !value.variablesEditable}
              inputMode="decimal"
              min={input.minimum}
              value={String(variables[input.key] ?? "")}
              onChange={(event) =>
                setVariables((current) => ({
                  ...current,
                  [input.key]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
        {value.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        {!value.editable && (
          <p>{value.unavailableReason ?? "Formula editing is unavailable."}</p>
        )}
      </form>
      <section className="v2-product-pricing-preview">
        <h2>Preview</h2>
        <label>
          Quantity
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label>
          Width
          <input
            inputMode="decimal"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          />
        </label>
        <label>
          Height
          <input
            inputMode="decimal"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
        >
          Preview price
        </button>
        <PreviewResult result={preview.data} />
        {preview.error && (
          <p>
            {(preview.error as { message?: string }).message ??
              "Preview is unavailable."}
          </p>
        )}
      </section>
    </section>
  );
};
const PricingForm = ({
  value,
  options,
  disabled,
  onSave,
  organizationId,
  productId,
}: {
  value: ProductDraftPricing;
  options: readonly ProductDraftOption[];
  disabled: boolean;
  onSave: (value: ProductDraftPricing) => void;
  organizationId: string;
  productId: string;
}) => {
  const [pricing, setPricing] = useState(value),
    [quantity, setQuantity] = useState("1"),
    [width, setWidth] = useState(""),
    [height, setHeight] = useState(""),
    [selections, setSelections] = useState<Record<string, unknown>>({}),
    preview = useMutation({
      mutationFn: () =>
        productApi.previewDraftPricing(organizationId, productId, {
          quantity: Number(quantity),
          ...(pricing.measurementMode === "dimensions_required"
            ? { width: Number(width), height: Number(height) }
            : {}),
          selections,
        }),
    });
  const changeBase = (key: keyof ProductDraftPricing["base"], next: string) =>
    setPricing((current) => ({
      ...current,
      base: { ...current.base, [key]: fromDollars(next) },
    }));
  const changeTier = (
    index: number,
    key: keyof ProductDraftPricingTier,
    next: string,
  ) =>
    setPricing((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index
          ? ({
              ...tier,
              [key]:
                key === "minimum" || key === "maximum"
                  ? next === ""
                    ? null
                    : Number(next)
                  : fromDollars(next),
            } as ProductDraftPricingTier)
          : tier,
      ),
    }));
  if (!value.editable)
    return (
      <section className="v2-product-pricing">
        <h2>Pricing</h2>
        <p>{value.unavailableReason ?? "This pricing method is read only."}</p>
        <PreviewResult result={preview.data} />
      </section>
    );
  const rate =
      value.base.perSqftCents !== null ? "perSqftCents" : "perPieceCents",
    rateLabel = rate === "perSqftCents" ? "Rate per sq ft" : "Rate per piece";
  return (
    <section className="v2-product-pricing">
      <form
        id="product-draft-pricing"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(pricing);
        }}
      >
        <h2>Pricing</h2>
        <label>
          {rateLabel}
          <input
            disabled={disabled}
            inputMode="decimal"
            value={cents(pricing.base[rate])}
            onChange={(event) => changeBase(rate, event.target.value)}
          />
        </label>
        <label>
          Minimum charge
          <input
            disabled={disabled}
            inputMode="decimal"
            value={cents(pricing.base.minimumChargeCents)}
            onChange={(event) =>
              changeBase("minimumChargeCents", event.target.value)
            }
          />
        </label>
        {pricing.tierBasis && (
          <>
            <h3>
              {pricing.tierBasis === "quantity"
                ? "Quantity tiers"
                : "Square-foot tiers"}
            </h3>
            {pricing.tiers.map((tier, index) => (
              <div className="v2-product-pricing-tier" key={tier.tierId}>
                <label>
                  From
                  <input
                    disabled={disabled}
                    type="number"
                    min="1"
                    value={tier.minimum}
                    onChange={(event) =>
                      changeTier(index, "minimum", event.target.value)
                    }
                  />
                </label>
                <label>
                  To
                  <input
                    disabled={disabled}
                    type="number"
                    min="1"
                    value={tier.maximum ?? ""}
                    onChange={(event) =>
                      changeTier(index, "maximum", event.target.value)
                    }
                  />
                </label>
                <label>
                  {rateLabel}
                  <input
                    disabled={disabled}
                    inputMode="decimal"
                    value={cents(
                      rate === "perSqftCents"
                        ? tier.perSqftCents
                        : tier.perPieceCents,
                    )}
                    onChange={(event) =>
                      changeTier(index, rate, event.target.value)
                    }
                  />
                </label>
              </div>
            ))}
          </>
        )}
      </form>
      <section className="v2-product-pricing-preview">
        <h2>Preview</h2>
        <label>
          Quantity
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        {pricing.measurementMode === "dimensions_required" && (
          <>
            <label>
              Width
              <input
                inputMode="decimal"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <label>
              Height
              <input
                inputMode="decimal"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
          </>
        )}
        {options.map((option) =>
          option.inputType === "select" ? (
            <label key={option.optionId}>
              {option.label}
              <select
                value={String(
                  selections[option.optionId] ?? option.defaultValue ?? "",
                )}
                onChange={(event) =>
                  setSelections((current) => ({
                    ...current,
                    [option.optionId]: event.target.value,
                  }))
                }
              >
                <option value="">Select</option>
                {option.choices.map((choice) => (
                  <option key={choice.choiceValue} value={choice.choiceValue}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null,
        )}
        <button
          type="button"
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
        >
          Preview price
        </button>
        <PreviewResult result={preview.data} />
        {preview.error && (
          <p>
            {(preview.error as { message?: string }).message ??
              "Preview is unavailable."}
          </p>
        )}
      </section>
    </section>
  );
};

const MatrixForm = ({
  value,
  measurementMode,
  disabled,
  onSave,
  organizationId,
  productId,
}: {
  value: ProductDraftPricingMatrix;
  measurementMode: "dimensions_required" | "quantity_only";
  disabled: boolean;
  onSave: (value: ProductDraftPricingMatrix) => void;
  organizationId: string;
  productId: string;
}) => {
  const [matrix, setMatrix] = useState(value),
    [quantity, setQuantity] = useState("1"),
    [width, setWidth] = useState(""),
    [height, setHeight] = useState(""),
    [selections, setSelections] = useState<Record<string, unknown>>({}),
    preview = useMutation({
      mutationFn: () =>
        productApi.previewDraftPricing(organizationId, productId, {
          quantity: Number(quantity),
          ...(measurementMode === "dimensions_required"
            ? { width: Number(width), height: Number(height) }
            : {}),
          selections,
        }),
    });
  const key = (row: ProductDraftPricingMatrix["rows"][number]) =>
    JSON.stringify(
      matrix.dimensions.map(
        (dimension) => row.combination[dimension.selectionKey],
      ),
    );
  const update = (
    rowId: string,
    next: Partial<ProductDraftPricingMatrix["rows"][number]>,
  ) =>
    setMatrix((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.rowId === rowId ? { ...row, ...next } : row,
      ),
    }));
  const remove = (rowId: string) =>
    setMatrix((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.rowId !== rowId),
    }));
  const add = () =>
    setMatrix((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          rowId: `new:${crypto.randomUUID()}`,
          combination: Object.fromEntries(
            current.dimensions.map((dimension) => [
              dimension.selectionKey,
              dimension.values[0]?.value ?? "",
            ]),
          ),
          baseRateCents: 0,
          tierBasis: null,
          tiers: [],
        },
      ],
    }));
  const generate = () =>
    setMatrix((current) => {
      const combinations = current.dimensions.reduce<
        readonly Record<string, string | number | boolean>[]
      >(
        (all, dimension) =>
          all.flatMap((combination) =>
            dimension.values.map((choice) => ({
              ...combination,
              [dimension.selectionKey]: choice.value,
            })),
          ),
        [{}],
      );
      const known = new Set(current.rows.map(key));
      return {
        ...current,
        rows: [
          ...current.rows,
          ...combinations
            .filter(
              (combination) =>
                !known.has(
                  JSON.stringify(
                    current.dimensions.map(
                      (dimension) => combination[dimension.selectionKey],
                    ),
                  ),
                ),
            )
            .map((combination) => ({
              rowId: `new:${crypto.randomUUID()}`,
              combination,
              baseRateCents: 0,
              tierBasis: null,
              tiers: [],
            })),
        ],
      };
    });
  const changeTier = (
    rowId: string,
    index: number,
    key: keyof ProductDraftPricingTier,
    next: string,
  ) => {
    const row = matrix.rows.find((item) => item.rowId === rowId);
    if (!row) return;
    update(rowId, {
      tierBasis: "quantity",
      tiers: row.tiers.map((tier, tierIndex) =>
        tierIndex === index
          ? ({
              ...tier,
              [key]:
                key === "minimum" || key === "maximum"
                  ? next === ""
                    ? null
                    : Number(next)
                  : fromDollars(next),
            } as ProductDraftPricingTier)
          : tier,
      ),
    });
  };
  if (!value.editable)
    return (
      <section className="v2-product-pricing">
        <form
          id="product-draft-pricing"
          onSubmit={(event) => event.preventDefault()}
        >
          <h2>Matrix pricing</h2>
          <p>
            {value.unavailableReason ?? "This pricing method is read only."}
          </p>
        </form>
      </section>
    );
  return (
    <section className="v2-product-pricing">
      <form
        id="product-draft-pricing"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(matrix);
        }}
      >
        <header>
          <h2>Matrix pricing</h2>
          <button type="button" disabled={disabled} onClick={generate}>
            Generate missing combinations
          </button>
          <button type="button" disabled={disabled} onClick={add}>
            Add row
          </button>
        </header>
        <p>{matrix.pricingUnit === "per_piece" ? "Per piece" : "Per sq ft"}</p>
        <div className="v2-products-table-wrap">
          <table className="v2-products-table">
            <thead>
              <tr>
                {matrix.dimensions.map((dimension) => (
                  <th key={dimension.selectionKey}>{dimension.label}</th>
                ))}
                <th>Rate</th>
                <th>Tiers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.rowId}>
                  {matrix.dimensions.map((dimension) => (
                    <td key={dimension.selectionKey}>
                      <select
                        disabled={disabled}
                        value={String(
                          row.combination[dimension.selectionKey] ?? "",
                        )}
                        onChange={(event) => {
                          const choice = dimension.values.find(
                            (item) => String(item.value) === event.target.value,
                          );
                          if (choice)
                            update(row.rowId, {
                              combination: {
                                ...row.combination,
                                [dimension.selectionKey]: choice.value,
                              },
                            });
                        }}
                      >
                        {dimension.values.map((choice) => (
                          <option
                            key={String(choice.value)}
                            value={String(choice.value)}
                          >
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td>
                    <input
                      disabled={disabled}
                      inputMode="decimal"
                      value={cents(row.baseRateCents)}
                      onChange={(event) =>
                        update(row.rowId, {
                          baseRateCents: fromDollars(event.target.value) ?? 0,
                        })
                      }
                    />
                  </td>
                  <td>
                    {row.tierBasis === "computed_sheet_usage"
                      ? "Read only"
                      : row.tiers.length
                        ? `${row.tiers.length} tier${row.tiers.length === 1 ? "" : "s"}`
                        : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={
                        disabled || row.tierBasis === "computed_sheet_usage"
                      }
                      onClick={() => remove(row.rowId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {matrix.rows
          .filter(
            (row) =>
              row.tierBasis !== "computed_sheet_usage" && row.tiers.length,
          )
          .map((row) => (
            <details key={`${row.rowId}:tiers`}>
              <summary>Row tiers</summary>
              {row.tiers.map((tier, index) => (
                <div className="v2-product-pricing-tier" key={tier.tierId}>
                  <label>
                    From
                    <input
                      disabled={disabled}
                      type="number"
                      min="1"
                      value={tier.minimum}
                      onChange={(event) =>
                        changeTier(
                          row.rowId,
                          index,
                          "minimum",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    To
                    <input
                      disabled={disabled}
                      type="number"
                      min="1"
                      value={tier.maximum ?? ""}
                      onChange={(event) =>
                        changeTier(
                          row.rowId,
                          index,
                          "maximum",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    Rate
                    <input
                      disabled={disabled}
                      inputMode="decimal"
                      value={cents(
                        matrix.pricingUnit === "per_piece"
                          ? tier.perPieceCents
                          : tier.perSqftCents,
                      )}
                      onChange={(event) =>
                        changeTier(
                          row.rowId,
                          index,
                          matrix.pricingUnit === "per_piece"
                            ? "perPieceCents"
                            : "perSqftCents",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </details>
          ))}
      </form>
      <section className="v2-product-pricing-preview">
        <h2>Preview</h2>
        <label>
          Quantity
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        {measurementMode === "dimensions_required" && (
          <>
            <label>
              Width
              <input
                inputMode="decimal"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <label>
              Height
              <input
                inputMode="decimal"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
          </>
        )}
        {matrix.dimensions.map((dimension) => (
          <label key={dimension.selectionKey}>
            {dimension.label}
            <select
              value={String(selections[dimension.selectionKey] ?? "")}
              onChange={(event) => {
                const choice = dimension.values.find(
                  (item) => String(item.value) === event.target.value,
                );
                if (choice)
                  setSelections((current) => ({
                    ...current,
                    [dimension.selectionKey]: choice.value,
                  }));
              }}
            >
              <option value="">Select</option>
              {dimension.values.map((choice) => (
                <option key={String(choice.value)} value={String(choice.value)}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
        >
          Preview price
        </button>
        <PreviewResult result={preview.data} />
        {preview.error && (
          <p>
            {(preview.error as { message?: string }).message ??
              "Preview is unavailable."}
          </p>
        )}
      </section>
    </section>
  );
};
