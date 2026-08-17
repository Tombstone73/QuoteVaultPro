export type ProductLocation = Readonly<{ productId?: string }>;
export type CustomerLocation = Readonly<{ customerId?: string }>;
export type SalesLocation = Readonly<{ quoteId?: string }> | Readonly<{ orderId?: string }>;
export type WorkspaceLocation = Readonly<{ page: "products"; productId?: string }> | Readonly<{ page: "customers"; customerId?: string }> | Readonly<{ page: "quotes"; quoteId?: string }> | Readonly<{ page: "orders"; orderId?: string }> | Readonly<{ page: "artwork" | "proofing" | "prepress" }>;

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
/** Extend the Product slice's one small history adapter; unrelated shell destinations stay state-driven. */
export const readWorkspaceLocation = (pathname = window.location.pathname): WorkspaceLocation | null => {
  const product = readProductLocation(pathname);
  if (product) return { page: "products", ...product };
  const customer = readCustomerLocation(pathname);
  if (customer) return { page: "customers", ...customer };
  const quote = readQuoteLocation(pathname);
  if (quote) return { page: "quotes", ...quote };
  const order = readOrderLocation(pathname);
  if (order) return { page: "orders", ...order };
  const page = pathname.replace(/^\/+|\/+$/gu, "");
  return page === "artwork" || page === "proofing" || page === "prepress" ? { page } : null;
};
export const customerPath = (id?: string) => id ? `/customers/${encodeURIComponent(id)}` : "/customers";
export const pushCustomerLocation = (id?: string) => window.history.pushState({}, "", customerPath(id));
export const quotePath = (id?: string) => id ? `/quotes/${encodeURIComponent(id)}` : "/quotes";
export const pushQuoteLocation = (id?: string) => window.history.pushState({}, "", quotePath(id));
export const orderPath = (id?: string) => id ? `/orders/${encodeURIComponent(id)}` : "/orders";
export const pushOrderLocation = (id?: string) => window.history.pushState({}, "", orderPath(id));
export const workspacePath = (page: "artwork" | "proofing" | "prepress") => `/${page}`;
export const pushWorkspaceLocation = (page: "artwork" | "proofing" | "prepress") => window.history.pushState({}, "", workspacePath(page));
