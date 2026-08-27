export type ProductLocation = Readonly<Record<string, never>>;
export type FormulaAuthoringIntent = "new" | "revise";
/**
 * This is navigation context only.  It is deliberately limited to stable IDs
 * and an internal intent: the server still authorizes Formula ownership and
 * the canonical Draft binding mutation still authorizes adoption.
 */
export type FormulaAuthoringContext = Readonly<{
  productId: string;
  draftVersionId: string;
  intent: FormulaAuthoringIntent;
  formulaId?: string;
}>;
export type ProductBuilderLocation = Readonly<{
  productId?: string;
  newProduct?: true;
  /** A Formula screen may request that the Builder present this revision for
   * explicit adoption. It is not a binding instruction. */
  formulaReturn?: Readonly<{ formulaId: string; formulaRevisionId: string }>;
}>;
export type CustomerLocation = Readonly<{ customerId?: string }>;
export type ContactLocation = Readonly<{ contactId?: string }>;
export type QuoteLocation = Readonly<{ quoteId?: string; newQuote?: true }>;
export type SalesLocation = QuoteLocation | Readonly<{ orderId?: string }>;
export type WorkspaceLocation = Readonly<{ page: "home" }> | Readonly<{ page: "products"; productId?: string }> | Readonly<{ page: "productBuilder"; productId?: string; newProduct?: true }> | Readonly<{ page: "customers"; customerId?: string }> | Readonly<{ page: "contacts"; contactId?: string }> | Readonly<{ page: "quotes"; quoteId?: string; newQuote?: true }> | Readonly<{ page: "orders"; orderId?: string }> | Readonly<{ page: "invoices"; invoiceId?: string }> | Readonly<{ page: "fulfillment"; orderId?: string }> | Readonly<{ page: "production"; station?: "flatbed" | "roll"; productionWorkId?: string }> | Readonly<{ page: "artwork"; artworkFileId?: string; orderId?: string; lineId?: string }> | Readonly<{ page: "proofing"; proofWorkId?: string; orderId?: string; lineId?: string }> | Readonly<{ page: "prepress"; lineId?: string; prepressUnitId?: string }> | Readonly<{ page: "appearance" | "routing" | "payments" | "formulas" }>;

const productId = (value: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(value);
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(decoded) ? decoded : undefined;
  } catch { return undefined; }
};

/** The first deliberately small history adapter: only real Product destinations own URLs. */
export const readProductLocation = (pathname = window.location.pathname): ProductLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "products") return {};
  return null;
};
export const productPath = (id?: string) => id ? `/products/${encodeURIComponent(id)}` : "/products";
export const pushProductLocation = (id?: string) => window.history.pushState({}, "", productPath(id));
/**
 * Every former existing-Product URL now enters the single canonical Builder.
 * The URL retains only the Product identity; the Builder reads or creates the
 * current server-authoritative Draft through the normal lifecycle.
 */
export const legacyProductEditorRedirect = (
  pathname?: string,
  _search?: string,
): string | null => {
  const currentPathname = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const parts = currentPathname.split("/").filter(Boolean);
  const id = parts[0] === "products" ? productId(parts[1] ?? "") : undefined;
  if (!id || parts[1] === "new") return null;
  if (parts.length === 2) return productBuilderPath(id);
  if (parts.length === 3 && parts[2] === "edit") return productBuilderPath(id);
  return null;
};
const searchParams = (search: string) => new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
const queryId = (params: URLSearchParams, name: string): string | undefined => {
  const value = params.get(name);
  return value ? productId(value) : undefined;
};

export const readFormulaAuthoringContext = (
  pathname = typeof window === "undefined" ? "" : window.location.pathname,
  search = typeof window === "undefined" ? "" : window.location.search,
): FormulaAuthoringContext | null => {
  if (pathname !== "/formulas") return null;
  const params = searchParams(search);
  const product = queryId(params, "product");
  const draft = queryId(params, "draft");
  const intent = params.get("formulaIntent");
  const formula = queryId(params, "formula");
  if (!product || !draft || (intent !== "new" && intent !== "revise")) return null;
  if (intent === "revise" && !formula) return null;
  return { productId: product, draftVersionId: draft, intent, ...(formula ? { formulaId: formula } : {}) };
};

export const formulaAuthoringPath = (context: FormulaAuthoringContext): string => {
  const params = new URLSearchParams({
    product: context.productId,
    draft: context.draftVersionId,
    formulaIntent: context.intent,
  });
  if (context.formulaId) params.set("formula", context.formulaId);
  return `/formulas?${params.toString()}`;
};
export const pushFormulaAuthoringLocation = (context: FormulaAuthoringContext) =>
  window.history.pushState({}, "", formulaAuthoringPath(context));

export const readProductBuilderLocation = (
  pathname = typeof window === "undefined" ? "" : window.location.pathname,
  search = typeof window === "undefined" ? "" : window.location.search,
): ProductBuilderLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "products" && parts[1] === "new") return { newProduct: true };
  if (parts.length === 2 && parts[0] === "product-builder") {
    const id = productId(parts[1]);
    if (!id) return null;
    const params = searchParams(search);
    const formulaId = queryId(params, "formula");
    const formulaRevisionId = queryId(params, "formulaRevision");
    const formulaReturn = params.get("formulaReturn") === "1" && formulaId && formulaRevisionId
      ? { formulaId, formulaRevisionId }
      : undefined;
    return { productId: id, ...(formulaReturn ? { formulaReturn } : {}) };
  }
  return null;
};
export const productBuilderPath = (id: string, formulaReturn?: Readonly<{ formulaId: string; formulaRevisionId: string }>) => {
  const params = new URLSearchParams({ draft: "1" });
  if (formulaReturn) {
    params.set("formulaReturn", "1");
    params.set("formula", formulaReturn.formulaId);
    params.set("formulaRevision", formulaReturn.formulaRevisionId);
  }
  return `/product-builder/${encodeURIComponent(id)}?${params.toString()}`;
};
export const pushProductBuilderLocation = (id: string) => window.history.pushState({}, "", productBuilderPath(id));
/** Adopt a newly-created Product without leaving an obsolete /products/new
 * history entry behind. The Builder keeps its local Draft state until the
 * section-by-section first Save has either completed or reported a failure. */
export const replaceProductBuilderLocation = (id: string) => window.history.replaceState({}, "", productBuilderPath(id));
export const newProductBuilderPath = () => "/products/new";
export const pushNewProductBuilderLocation = () => window.history.pushState({}, "", newProductBuilderPath());
export const readCustomerLocation = (pathname = window.location.pathname): CustomerLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "customers") return {};
  if (parts.length === 2 && parts[0] === "customers") return productId(parts[1]) ? { customerId: productId(parts[1]) } : null;
  return null;
};
export const readContactLocation = (pathname = window.location.pathname): ContactLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "contacts") return {};
  if (parts.length === 2 && parts[0] === "contacts") return productId(parts[1]) ? { contactId: productId(parts[1]) } : null;
  return null;
};
export const readQuoteLocation = (pathname = window.location.pathname): QuoteLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "quotes") return {};
  if (parts.length === 2 && parts[0] === "quotes" && parts[1] === "new") return { newQuote: true };
  if (parts.length === 2 && parts[0] === "quotes") return productId(parts[1]) ? { quoteId: productId(parts[1]) } : null;
  return null;
};
export const readOrderLocation = (pathname = window.location.pathname): SalesLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "orders") return {};
  if (parts.length === 2 && parts[0] === "orders") return productId(parts[1]) ? { orderId: productId(parts[1]) } : null;
  return null;
};
export const readInvoiceLocation = (pathname = window.location.pathname): Readonly<{ invoiceId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "invoices") return {};
  if (parts.length === 2 && parts[0] === "invoices") return productId(parts[1]) ? { invoiceId: productId(parts[1]) } : null;
  return null;
};
export const readFulfillmentLocation = (pathname = window.location.pathname): Readonly<{ orderId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "fulfillment") return {};
  if (parts.length === 3 && parts[0] === "fulfillment" && parts[1] === "orders") return productId(parts[2]) ? { orderId: productId(parts[2]) } : null;
  return null;
};
/** A work URL is selection context only. The tenant-scoped Production read
 * remains the authority for whether the work is available. */
export const readProductionLocation = (pathname = window.location.pathname): Readonly<{ station?: "flatbed" | "roll"; productionWorkId?: string }> | null => {
  const page = pathname.replace(/^\/+|\/+$/gu, "");
  if (page === "production") return {};
  if (page === "production/flatbed") return { station: "flatbed" };
  if (page === "production/roll") return { station: "roll" };
  const parts = page.split("/");
  if (parts.length === 3 && parts[0] === "production" && parts[1] === "works") {
    const productionWorkId = productId(parts[2]!);
    return productionWorkId ? { productionWorkId } : null;
  }
  return null;
};
export const readArtworkLocation = (pathname = window.location.pathname): Readonly<{ artworkFileId?: string; orderId?: string; lineId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "artwork") return {};
  if (parts.length === 3 && parts[0] === "artwork" && parts[1] === "files") return productId(parts[2]) ? { artworkFileId: productId(parts[2]) } : null;
  if (parts.length === 3 && parts[0] === "artwork" && parts[1] === "orders") return productId(parts[2]) ? { orderId: productId(parts[2]) } : null;
  if (parts.length === 5 && parts[0] === "artwork" && parts[1] === "orders" && parts[3] === "lines") {
    const orderId = productId(parts[2]), lineId = productId(parts[4]);
    return orderId && lineId ? { orderId, lineId } : null;
  }
  return null;
};
export const readProofingLocation = (pathname = window.location.pathname): Readonly<{ proofWorkId?: string; orderId?: string; lineId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "proofing") return {};
  if (parts.length === 3 && parts[0] === "proofing" && parts[1] === "works") return productId(parts[2]) ? { proofWorkId: productId(parts[2]) } : null;
  if (parts.length === 5 && parts[0] === "proofing" && parts[1] === "orders" && parts[3] === "lines") {
    const orderId = productId(parts[2]), lineId = productId(parts[4]);
    return orderId && lineId ? { orderId, lineId } : null;
  }
  return null;
};
/** A Prepress line URL is selection context only. The tenant-scoped queue
 * remains authoritative for whether it can be read or worked. */
export const readPrepressLocation = (pathname = window.location.pathname): Readonly<{ lineId?: string; prepressUnitId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "prepress") return {};
  if (parts.length === 3 && parts[0] === "prepress" && parts[1] === "lines") {
    const lineId = productId(parts[2]);
    return lineId ? { lineId } : null;
  }
  if (parts.length === 3 && parts[0] === "prepress" && parts[1] === "units") {
    const prepressUnitId = productId(parts[2]);
    return prepressUnitId ? { prepressUnitId } : null;
  }
  return null;
};
/** Extend the Product slice's one small history adapter; unrelated shell destinations stay state-driven. */
export const readWorkspaceLocation = (pathname = window.location.pathname): WorkspaceLocation | null => {
  if (pathname === "/" || pathname === "") return { page: "home" };
  const productBuilder = readProductBuilderLocation(pathname);
  if (productBuilder) return { page: "productBuilder", ...productBuilder };
  const product = readProductLocation(pathname);
  if (product) return { page: "products", ...product };
  const customer = readCustomerLocation(pathname);
  if (customer) return { page: "customers", ...customer };
  const contact = readContactLocation(pathname);
  if (contact) return { page: "contacts", ...contact };
  const quote = readQuoteLocation(pathname);
  if (quote) return { page: "quotes", ...quote };
  const order = readOrderLocation(pathname);
  if (order) return { page: "orders", ...order };
  const invoice = readInvoiceLocation(pathname);
  if (invoice) return { page: "invoices", ...invoice };
  const fulfillment = readFulfillmentLocation(pathname);
  if (fulfillment) return { page: "fulfillment", ...fulfillment };
  const production = readProductionLocation(pathname);
  if (production) return { page: "production", ...production };
  const artwork = readArtworkLocation(pathname);
  if (artwork) return { page: "artwork", ...artwork };
  const proofing = readProofingLocation(pathname);
  if (proofing) return { page: "proofing", ...proofing };
  const prepress = readPrepressLocation(pathname);
  if (prepress) return { page: "prepress", ...prepress };
  const page = pathname.replace(/^\/+|\/+$/gu, "");
  return page === "appearance" || page === "routing" || page === "payments" || page === "formulas" ? { page } : null;
};
export const customerPath = (id?: string) => id ? `/customers/${encodeURIComponent(id)}` : "/customers";
export const pushCustomerLocation = (id?: string) => window.history.pushState({}, "", customerPath(id));
export const contactPath = (id?: string) => id ? `/contacts/${encodeURIComponent(id)}` : "/contacts";
export const pushContactLocation = (id?: string) => window.history.pushState({}, "", contactPath(id));
export const quotePath = (id?: string) => id ? `/quotes/${encodeURIComponent(id)}` : "/quotes";
export const pushQuoteLocation = (id?: string) => window.history.pushState({}, "", quotePath(id));
export const newQuotePath = () => "/quotes/new";
export const pushNewQuoteLocation = () => window.history.pushState({}, "", newQuotePath());
export const orderPath = (id?: string) => id ? `/orders/${encodeURIComponent(id)}` : "/orders";
export const pushOrderLocation = (id?: string) => window.history.pushState({}, "", orderPath(id));
export const invoicePath = (id?: string) => id ? `/invoices/${encodeURIComponent(id)}` : "/invoices";
export const pushInvoiceLocation = (id?: string) => window.history.pushState({}, "", invoicePath(id));
export const fulfillmentPath = (orderId?: string) => orderId ? `/fulfillment/orders/${encodeURIComponent(orderId)}` : "/fulfillment";
export const pushFulfillmentLocation = (orderId?: string) => window.history.pushState({}, "", fulfillmentPath(orderId));
export const productionPath = (station?: "flatbed" | "roll") => station ? `/production/${station}` : "/production";
export const pushProductionLocation = (station?: "flatbed" | "roll") => window.history.pushState({}, "", productionPath(station));
export const productionWorkPath = (productionWorkId: string) => `/production/works/${encodeURIComponent(productionWorkId)}`;
export const pushProductionWorkLocation = (productionWorkId: string) => window.history.pushState({}, "", productionWorkPath(productionWorkId));
export const artworkPath = (orderId?: string, lineId?: string) => orderId ? lineId ? `/artwork/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}` : `/artwork/orders/${encodeURIComponent(orderId)}` : "/artwork";
export const artworkFilePath = (artworkFileId: string) => `/artwork/files/${encodeURIComponent(artworkFileId)}`;
export const pushArtworkLocation = (orderId?: string, lineId?: string) => window.history.pushState({}, "", artworkPath(orderId, lineId));
export const pushArtworkFileLocation = (artworkFileId: string) => window.history.pushState({}, "", artworkFilePath(artworkFileId));
export const proofingPath = (proofWorkId?: string, orderId?: string, lineId?: string) => proofWorkId ? `/proofing/works/${encodeURIComponent(proofWorkId)}` : orderId && lineId ? `/proofing/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}` : "/proofing";
export const pushProofingLocation = (proofWorkId?: string, orderId?: string, lineId?: string) => window.history.pushState({}, "", proofingPath(proofWorkId, orderId, lineId));
export const prepressPath = (lineId?: string) => lineId ? `/prepress/lines/${encodeURIComponent(lineId)}` : "/prepress";
export const pushPrepressLocation = (lineId?: string) => window.history.pushState({}, "", prepressPath(lineId));
export const prepressUnitPath = (prepressUnitId: string) => `/prepress/units/${encodeURIComponent(prepressUnitId)}`;
export const workspacePath = (page: "appearance" | "routing" | "payments" | "artwork" | "proofing" | "prepress" | "formulas") => `/${page}`;
export const pushWorkspaceLocation = (page: "appearance" | "routing" | "payments" | "artwork" | "proofing" | "prepress" | "formulas") => window.history.pushState({}, "", workspacePath(page));
