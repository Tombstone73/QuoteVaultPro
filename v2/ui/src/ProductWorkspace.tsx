import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import {
  newBusinessRequestId,
  productApi,
  type ProductRoutingCompatibility,
  type ProductRoutingReadinessAudit,
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
  openCreatedProduct = openEditor,
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
  /** Sync application routing after a New Product's first Save has completed. */
  openCreatedProduct?: (id: string) => void;
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
  const routingAudit = useQuery({queryKey:["v2",sessionScope,organizationId,"product-routing-readiness"],queryFn:()=>productApi.routingReadiness(organizationId),enabled:Boolean(organizationId&&sessionScope&&canView&&!productId)});
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
    return <NewProductBuilder organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} openEditor={openCreatedProduct} />;
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
      {routingAudit.data?.counts.unroutable ? <RoutingDebtWorklist audit={routingAudit.data} openEditor={openEditor} /> : null}
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
  const routing = useQuery({queryKey:["v2",sessionScope,organizationId,"product-routing-compatibility",product?.productId],queryFn:()=>productApi.routingCompatibility(organizationId,product!.productId),enabled:Boolean(product?.productId && canEdit)});
  const [productTypeId,setProductTypeId]=useState("");
  useEffect(()=>{ if(routing.data)setProductTypeId(routing.data.productTypeId??"");},[routing.data]);
  const saveCompatibility=useMutation({mutationFn:()=>productApi.assignRoutingCompatibility(organizationId,product!.productId,{businessRequestId:newBusinessRequestId(),productTypeId:productTypeId||null,expectedProductUpdatedAt:product!.productUpdatedAt}),onSuccess:()=>{void routing.refetch();void state.refetch();}});
  const saveDefaultRoute=useMutation({mutationFn:(input:Readonly<{productTypeId:string;routeTemplateId:string;expectedProductTypeUpdatedAt:string}>)=>productApi.setProductTypeDefaultRoute(organizationId,input.productTypeId,{businessRequestId:newBusinessRequestId(),routeTemplateId:input.routeTemplateId,expectedProductTypeUpdatedAt:input.expectedProductTypeUpdatedAt}),onSuccess:()=>void routing.refetch()});
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
  return <>
    {/* A current Draft is the canonical editable version, whether or not an
        immutable Active version also exists. Draft recovery is reserved for
        an explicit server-reported recovery condition; the presence of both
        lifecycle pointers is normal and must always open the Builder. */}
    <CompatibilityRoutingPanel routing={routing.data} loading={routing.isLoading} productTypeId={productTypeId} setProductTypeId={setProductTypeId} saveCompatibility={()=>saveCompatibility.mutate()} saveDefaultRoute={(input)=>saveDefaultRoute.mutate(input)} saving={saveCompatibility.isPending||saveDefaultRoute.isPending} error={(saveCompatibility.error??saveDefaultRoute.error) as Error|null}/>
    <ProductBuilderReference organizationId={organizationId} sessionScope={sessionScope} product={product} canEdit={canEdit} publish={publish} publishing={publishing} publishError={publishError} />
  </>;
};

const CompatibilityRoutingPanel = ({routing,loading,productTypeId,setProductTypeId,saveCompatibility,saveDefaultRoute,saving,error}:Readonly<{routing?:ProductRoutingCompatibility;loading:boolean;productTypeId:string;setProductTypeId:(value:string)=>void;saveCompatibility:()=>void;saveDefaultRoute:(input:Readonly<{productTypeId:string;routeTemplateId:string;expectedProductTypeUpdatedAt:string}>)=>void;saving:boolean;error:Error|null}>) => {
  if(loading||!routing) return null;
  const exact=routing.readiness==="ROUTABLE_VERSION_ROUTE";
  return <section className="v2-products" aria-label="Routing compatibility">
    <header className="v2-products-heading"><div><h2>Routing compatibility</h2><p>{exact?`This ProductVersion is routed by ${routing.versionRouteName}.`:routing.readiness==="ROUTABLE_COMPATIBILITY_ROUTE"?`Legacy compatibility route: ${routing.compatibilityRouteName}.`:routing.readiness==="UNROUTABLE_PRODUCTION_UNITS_MISSING"?"This active production Product needs production units before it can be routed.":routing.readiness.startsWith("UNROUTABLE_")?"This active physical Product is not routable.":"Routing is not required for this Product."}</p></div></header>
    {!exact && <div className="v2-products-tools"><label>Product Type<select aria-label="Compatibility Product Type" value={productTypeId} onChange={(event)=>setProductTypeId(event.target.value)}><option value="">Select Product Type…</option>{routing.productTypes.map((item)=><option key={item.productTypeId} value={item.productTypeId}>{item.name}{item.defaultRoute?` — ${item.defaultRoute.name}`:" — no active default route"}</option>)}</select></label><button type="button" className="button secondary" disabled={saving||!productTypeId} onClick={saveCompatibility}>Save Product Type</button></div>}
    <ProductTypeRouteAdmin types={routing.productTypes} routes={routing.routeTemplates} saving={saving} save={saveDefaultRoute}/>
    {error&&<p role="alert" className="v2-proof-empty">{error.message}</p>}
  </section>;
};

const ProductTypeRouteAdmin = ({types,routes,saving,save}:Readonly<{types:ProductRoutingCompatibility["productTypes"];routes:ProductRoutingCompatibility["routeTemplates"];saving:boolean;save:(input:Readonly<{productTypeId:string;routeTemplateId:string;expectedProductTypeUpdatedAt:string}>)=>void}>) => {
  const [selected,setSelected]=useState<Record<string,string>>({});
  return <section className="v2-products-table-wrap" aria-label="Product Type default Routes"><h3>Product Type default Routes</h3><p className="v2-proof-empty">A default Route changes compatibility resolution only; it never rewrites ProductVersions or Orders with frozen routing.</p><table className="v2-products-table"><thead><tr><th>Product Type</th><th>Current default Route</th><th>Active Route Template</th><th /></tr></thead><tbody>{types.map((type)=>{const routeId=selected[type.productTypeId]??type.defaultRoute?.routeTemplateId??"";return <tr key={type.productTypeId}><td>{type.name}</td><td>{type.defaultRoute?.name??"No active default Route"}</td><td><select aria-label={`${type.name} default Route`} value={routeId} onChange={(event)=>setSelected({...selected,[type.productTypeId]:event.target.value})}><option value="">Select active Route Template…</option>{routes.map((route)=><option key={route.routeTemplateId} value={route.routeTemplateId}>{route.name} ({route.steps.join(" → ")})</option>)}</select></td><td><button type="button" className="button secondary" disabled={saving||!routeId} onClick={()=>save({productTypeId:type.productTypeId,routeTemplateId:routeId,expectedProductTypeUpdatedAt:type.updatedAt})}>Save default Route</button></td></tr>})}</tbody></table></section>;
};

const RoutingDebtWorklist = ({audit,openEditor}:Readonly<{audit:ProductRoutingReadinessAudit;openEditor:(id:string)=>void}>) => <section className="v2-products-table-wrap" aria-label="Routing readiness worklist"><h2>Routing readiness</h2><p className="v2-proof-empty">{audit.counts.unroutable} active standard-production Product{audit.counts.unroutable===1?" is":"s are"} unroutable. Resolve each Product explicitly; no routing is inferred.</p><table className="v2-products-table"><thead><tr><th>Product</th><th>Product Type</th><th>Exact route</th><th>Product Type route</th><th>Reason</th><th /></tr></thead><tbody>{audit.worklist.map((item)=><tr key={item.productId}><td>{item.productName}</td><td>{item.productTypeName??"No Product Type"}</td><td>{item.exactVersionRouteStatus}</td><td>{item.productTypeDefaultRouteStatus}</td><td>{item.reason}</td><td><button type="button" className="button secondary" onClick={()=>openEditor(item.productId)}>Configure routing</button></td></tr>)}</tbody></table></section>;
