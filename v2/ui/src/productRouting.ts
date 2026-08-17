export type ProductLocation = Readonly<{ productId?: string }>;

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
