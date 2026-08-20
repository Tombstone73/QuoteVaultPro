export type ProductLocation = Readonly<{ productId?: string }>;
export type CustomerLocation = Readonly<{ customerId?: string }>;
export type ContactLocation = Readonly<{ contactId?: string }>;
export type SalesLocation = Readonly<{ quoteId?: string }> | Readonly<{ orderId?: string }>;
export type WorkspaceLocation = Readonly<{ page: "home" }> | Readonly<{ page: "products"; productId?: string }> | Readonly<{ page: "customers"; customerId?: string }> | Readonly<{ page: "contacts"; contactId?: string }> | Readonly<{ page: "quotes"; quoteId?: string }> | Readonly<{ page: "orders"; orderId?: string }> | Readonly<{ page: "invoices"; invoiceId?: string }> | Readonly<{ page: "fulfillment"; orderId?: string }> | Readonly<{ page: "production"; station?: "flatbed" | "roll" }> | Readonly<{ page: "artwork"; orderId?: string; lineId?: string }> | Readonly<{ page: "proofing"; proofWorkId?: string; orderId?: string; lineId?: string }> | Readonly<{ page: "appearance" | "routing" | "payments" | "prepress" }>;

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
  if (parts.length === 2 && parts[0] === "products") return productId(parts[1]) ? { productId: productId(parts[1]) } : null;
  return null;
};
export const productPath = (id?: string) => id ? `/products/${encodeURIComponent(id)}` : "/products";
export const pushProductLocation = (id?: string) => window.history.pushState({}, "", productPath(id));
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
export const readQuoteLocation = (pathname = window.location.pathname): SalesLocation | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "quotes") return {};
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
export const readProductionLocation = (pathname = window.location.pathname): Readonly<{ station?: "flatbed" | "roll" }> | null => {
  const page = pathname.replace(/^\/+|\/+$/gu, "");
  if (page === "production") return {};
  if (page === "production/flatbed") return { station: "flatbed" };
  if (page === "production/roll") return { station: "roll" };
  return null;
};
export const readArtworkLocation = (pathname = window.location.pathname): Readonly<{ orderId?: string; lineId?: string }> | null => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "artwork") return {};
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
/** Extend the Product slice's one small history adapter; unrelated shell destinations stay state-driven. */
export const readWorkspaceLocation = (pathname = window.location.pathname): WorkspaceLocation | null => {
  if (pathname === "/" || pathname === "") return { page: "home" };
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
  const page = pathname.replace(/^\/+|\/+$/gu, "");
  return page === "appearance" || page === "routing" || page === "payments" || page === "prepress" ? { page } : null;
};
export const customerPath = (id?: string) => id ? `/customers/${encodeURIComponent(id)}` : "/customers";
export const pushCustomerLocation = (id?: string) => window.history.pushState({}, "", customerPath(id));
export const contactPath = (id?: string) => id ? `/contacts/${encodeURIComponent(id)}` : "/contacts";
export const pushContactLocation = (id?: string) => window.history.pushState({}, "", contactPath(id));
export const quotePath = (id?: string) => id ? `/quotes/${encodeURIComponent(id)}` : "/quotes";
export const pushQuoteLocation = (id?: string) => window.history.pushState({}, "", quotePath(id));
export const orderPath = (id?: string) => id ? `/orders/${encodeURIComponent(id)}` : "/orders";
export const pushOrderLocation = (id?: string) => window.history.pushState({}, "", orderPath(id));
export const invoicePath = (id?: string) => id ? `/invoices/${encodeURIComponent(id)}` : "/invoices";
export const pushInvoiceLocation = (id?: string) => window.history.pushState({}, "", invoicePath(id));
export const fulfillmentPath = (orderId?: string) => orderId ? `/fulfillment/orders/${encodeURIComponent(orderId)}` : "/fulfillment";
export const pushFulfillmentLocation = (orderId?: string) => window.history.pushState({}, "", fulfillmentPath(orderId));
export const productionPath = (station?: "flatbed" | "roll") => station ? `/production/${station}` : "/production";
export const pushProductionLocation = (station?: "flatbed" | "roll") => window.history.pushState({}, "", productionPath(station));
export const artworkPath = (orderId?: string, lineId?: string) => orderId ? lineId ? `/artwork/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}` : `/artwork/orders/${encodeURIComponent(orderId)}` : "/artwork";
export const pushArtworkLocation = (orderId?: string, lineId?: string) => window.history.pushState({}, "", artworkPath(orderId, lineId));
export const proofingPath = (proofWorkId?: string, orderId?: string, lineId?: string) => proofWorkId ? `/proofing/works/${encodeURIComponent(proofWorkId)}` : orderId && lineId ? `/proofing/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}` : "/proofing";
export const pushProofingLocation = (proofWorkId?: string, orderId?: string, lineId?: string) => window.history.pushState({}, "", proofingPath(proofWorkId, orderId, lineId));
export const workspacePath = (page: "appearance" | "routing" | "payments" | "artwork" | "proofing" | "prepress") => `/${page}`;
export const pushWorkspaceLocation = (page: "appearance" | "routing" | "payments" | "artwork" | "proofing" | "prepress") => window.history.pushState({}, "", workspacePath(page));
