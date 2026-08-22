import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  type ProductCatalogItem,
  type ProductWorkspaceDetail,
} from "./api";
import { productBuilderPath, productPath } from "./productRouting";
import { ProductBuilderReference, type PublishDraftRevision } from "./ProductBuilderReference";

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
  backToCatalog,
  openEditor,
  openNewProduct = backToCatalog,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  productId: string;
  newProduct?: boolean;
  canView: boolean;
  canEdit: boolean;
  builderMode?: boolean;
  backToCatalog: () => void;
  openEditor: (id: string) => void;
  openNewProduct?: () => void;
}>) => {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (builderMode && !newProduct && !productId) backToCatalog();
  }, [backToCatalog, builderMode, newProduct, productId]);
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
    mutationFn: async (input: Readonly<{ productId: string; revision: PublishDraftRevision }>) => {
      // Read immediately before publish so the browser cannot race a just-saved
      // Draft revision or publish a parent query-cache snapshot from before Save.
      const product = await productApi.get(organizationId, input.productId);
      const draft = product.versions.draft;
      if (!draft || draft.productVersionId !== input.revision.draftVersionId || draft.updatedAt !== input.revision.expectedDraftUpdatedAt) {
        const error = new Error("This Draft changed elsewhere. Refresh and reconcile before publishing.");
        Object.assign(error, { code: "STALE_STATE" });
        throw error;
      }
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
      // Publishing closes the Draft. Return to the catalog rather than
      // immediately creating another Draft for the newly ACTIVE version.
      window.history.pushState({}, "", productPath());
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
  });
  if (!organizationId || !canView)
    return (
      <section className="v2-products">
        <p className="v2-proof-empty">Products are unavailable.</p>
      </section>
    );
  if (newProduct)
    return <NewProductBuilder organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} openEditor={openEditor} />;
  if (productId)
    return <ProductDraftEntry state={detail} canEdit={canEdit} organizationId={organizationId} sessionScope={sessionScope} creatingDraft={createDraft.isPending} draftCreationError={(createDraft.error as { message?: string } | null)?.message} createDraft={(product) => createDraft.mutate(product)} publish={(revision) => publishDraft.mutate({ productId, revision })} publishing={publishDraft.isPending} publishError={publishDraft.error as { code?: string; message?: string } | null} back={backToCatalog} />;
  if (builderMode) return <section className="v2-products"><p className="v2-proof-empty">Opening Products…</p></section>;
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
                  <button className="v2-products-link" type="button" onClick={() => openEditor(product.productId)}>
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

const NewProductBuilder = ({ organizationId, sessionScope, canEdit, openEditor }: Readonly<{ organizationId: string; sessionScope: string; canEdit: boolean; openEditor: (id: string) => void }>) => {
  return <ProductBuilderReference organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} openCreatedProduct={openEditor} newProduct />;
};
const ProductDraftEntry = ({
  state,
  canEdit,
  organizationId,
  sessionScope,
  creatingDraft,
  draftCreationError,
  createDraft,
  publish,
  publishing,
  publishError,
  back,
}: Readonly<{
  state: ReturnType<typeof useQuery<ProductWorkspaceDetail>>;
  canEdit: boolean;
  organizationId: string;
  sessionScope: string;
  creatingDraft: boolean;
  draftCreationError?: string;
  createDraft: (product: ProductWorkspaceDetail) => void;
  publish: (revision: PublishDraftRevision) => void;
  publishing: boolean;
  publishError?: { code?: string; message?: string } | null;
  back: () => void;
}>) => {
  const automaticDraftRequest = useRef("");
  const product = state.data;
  useEffect(() => {
    if (!product || !canEdit || product.versions.draft || !product.versions.active || automaticDraftRequest.current === product.productId) return;
    automaticDraftRequest.current = product.productId;
    createDraft(product);
  }, [canEdit, createDraft, product]);
  if (state.isLoading)
    return <section className="v2-products"><p className="v2-proof-empty">Loading Product Builder…</p></section>;
  if (state.isError || !product)
    return <section className="v2-products"><button className="v2-products-back" onClick={back}>← Products</button><p className="v2-proof-empty">Product not found.</p></section>;
  if (!canEdit)
    return <section className="v2-products"><button className="v2-products-back" onClick={back}>← Products</button><p className="v2-proof-empty">You do not have permission to edit this Product.</p></section>;
  if (!product.versions.draft)
    return <section className="v2-products"><button className="v2-products-back" onClick={back}>← Products</button><p className="v2-proof-empty">{draftCreationError ?? (creatingDraft ? "Preparing an editable Draft…" : "This Product has no editable Draft.")}</p></section>;
  return <ProductBuilderReference organizationId={organizationId} sessionScope={sessionScope} product={product} canEdit={canEdit} publish={publish} publishing={publishing} publishError={publishError} />;
};
