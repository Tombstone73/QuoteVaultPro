import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  type ProductCatalogItem,
  type ProductActiveDefinition,
  type ProductVersionSummary,
  type ProductWorkspaceDetail,
} from "./api";
import { productBuilderPath, productPath } from "./productRouting";
import { ProductBuilderReference } from "./ProductBuilderReference";

const keys = {
  list: (s: string, o: string, q: string, p: number) =>
    ["v2", s, o, "products", q, p] as const,
  detail: (s: string, o: string, id: string) =>
    ["v2", s, o, "products", id] as const,
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
    [editing, setEditing] = useState(builderMode);
  useEffect(() => {
    if (builderMode) setEditing(true);
  }, [builderMode, productId]);
  useEffect(() => {
    if (builderMode || !productId || new URLSearchParams(window.location.search).get("draft") !== "1") return;
    window.history.replaceState({}, "", productBuilderPath(productId));
    window.dispatchEvent(new PopStateEvent("popstate"));
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
      window.history.pushState({}, "", productBuilderPath(productId));
      window.dispatchEvent(new PopStateEvent("popstate"));
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
          window.history.pushState({}, "", productBuilderPath(productId));
          window.dispatchEvent(new PopStateEvent("popstate"));
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
}: Readonly<{
  product: ProductWorkspaceDetail;
  organizationId: string;
  sessionScope: string;
  canEdit: boolean;
  publish: () => void;
  publishing: boolean;
  back: () => void;
}>) => (
  <ProductBuilderReference
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
  />
);
