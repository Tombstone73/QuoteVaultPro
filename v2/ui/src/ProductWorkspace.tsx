import { useQuery } from "@tanstack/react-query";
import { productApi, type ProductCatalogItem, type ProductWorkspaceDetail } from "./api";

const keys = {
  list: (scope: string, organizationId: string, search: string) => ["v2", scope, organizationId, "products", search] as const,
  detail: (scope: string, organizationId: string, productId: string) => ["v2", scope, organizationId, "products", productId] as const,
};
const routeLabel = (value: ProductWorkspaceDetail["routePolicy"]) => value === "route_required" ? "Route required" : value === "no_route" ? "No route" : "Route policy unavailable";
const measure = (value: ProductCatalogItem) => value.requiresDimensions ? "Dimensions + quantity" : "Quantity only";

export const ProductWorkspace = ({ organizationId, sessionScope, productId, canView, openProduct, backToCatalog }: Readonly<{
  organizationId: string; sessionScope: string; productId: string; canView: boolean;
  openProduct: (productId: string) => void; backToCatalog: () => void;
}>) => {
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, ""), queryFn: () => productApi.list(organizationId), enabled: Boolean(organizationId && sessionScope && canView) });
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, productId), queryFn: () => productApi.get(organizationId, productId), enabled: Boolean(organizationId && sessionScope && productId && canView) });
  if (!organizationId) return <section className="v2-products"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Products.</div></section>;
  if (!canView) return <section className="v2-products"><div className="v2-proof-empty">You do not have permission to view Products.</div></section>;
  if (productId) return <ProductDetail state={detail} backToCatalog={backToCatalog} />;
  return <section className="v2-products">
    <header className="v2-products-heading"><div><h1>Products</h1><p>{list.data?.items.length ?? 0} configurable product{list.data?.items.length === 1 ? "" : "s"} in this organization</p></div><span>Read-only catalog</span></header>
    <div className="v2-products-table-wrap"><table className="v2-products-table"><thead><tr><th>Product</th><th>Measurement</th><th>Pricing configuration</th><th>Status</th></tr></thead><tbody>
      {list.isLoading && <tr><td colSpan={4}>Loading Products…</td></tr>}
      {list.isError && <tr><td colSpan={4}>Products are unavailable in this organization.</td></tr>}
      {list.isSuccess && !list.data.items.length && <tr><td colSpan={4}>No active Products are available in this organization.</td></tr>}
      {list.data?.items.map((product) => <tr key={product.productId}><td><button className="v2-products-link" onClick={() => openProduct(product.productId)}><i>{product.displayName.slice(0, 2).toUpperCase()}</i><span><b>{product.displayName}</b><small>{product.productId}</small></span></button></td><td>{measure(product)}</td><td><span className="v2-products-mono">{product.pricingConfiguration.version}</span></td><td><em>Active</em></td></tr>)}
    </tbody></table></div>
  </section>;
};

const ProductDetail = ({ state, backToCatalog }: Readonly<{ state: ReturnType<typeof useQuery<ProductWorkspaceDetail>>; backToCatalog: () => void }>) => {
  if (state.isLoading) return <section className="v2-products"><p className="v2-proof-empty">Loading Product…</p></section>;
  if (state.isError || !state.data) return <section className="v2-products"><button className="v2-products-back" onClick={backToCatalog}>← Products</button><p className="v2-proof-empty">Product not found or unavailable in this organization.</p></section>;
  const product = state.data;
  return <section className="v2-products"><button className="v2-products-back" onClick={backToCatalog}>← Products</button>
    <header className="v2-products-heading"><div><h1>{product.displayName}</h1><p>{measure(product)} · PBV2 active configuration</p></div><span>Active · Read-only</span></header>
    <div className="v2-product-detail-grid"><article><h2>Pricing</h2><dl><div><dt>Configuration</dt><dd>{product.pricingConfiguration.version}</dd></div><div><dt>Configuration ID</dt><dd>{product.pricingConfiguration.id}</dd></div><div><dt>Dimensions</dt><dd>{product.requiresDimensions ? "Required" : "Not required"}</dd></div><div><dt>Route policy</dt><dd>{routeLabel(product.routePolicy)}</dd></div></dl></article><article><h2>PBV2 configuration</h2><dl><div><dt>Schema</dt><dd>{product.activeConfiguration.schemaVersion}</dd></div><div><dt>Published</dt><dd>{product.activeConfiguration.publishedAt ? new Date(product.activeConfiguration.publishedAt).toLocaleString() : "Not recorded"}</dd></div><div><dt>Content hash</dt><dd>{product.pricingConfiguration.contentHash}</dd></div></dl></article></div>
    <article className="v2-product-options"><header><h2>Configuration options</h2><p>Active Product/PBV2 structure. Pricing is evaluated only through canonical Pricing operations.</p></header>{product.activeConfiguration.fields.length ? <table><thead><tr><th>Option</th><th>Input</th><th>Required</th><th>Choices</th></tr></thead><tbody>{product.activeConfiguration.fields.map((field) => <tr key={field.selectionKey}><td><b>{field.label}</b><small>{field.selectionKey}</small></td><td>{field.inputType}</td><td>{field.required ? "Required" : "Optional"}</td><td>{field.choices.length ? field.choices.map((choice) => choice.label).join(", ") : "—"}</td></tr>)}</tbody></table> : <p className="v2-products-empty">This Product has no currently visible configurable options.</p>}</article>
  </section>;
};
