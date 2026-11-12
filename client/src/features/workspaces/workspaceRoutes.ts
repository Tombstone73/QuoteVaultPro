import { matchPath } from "react-router-dom";
import { ROUTES } from "@/config/routes";

// Shared by the application router and retained editor host. No second router.
export const workspaceRoutes = [
  { path: ROUTES.orders.new, family: "order", isNew: true },
  { path: ROUTES.orders.edit(":id"), family: "order", isNew: false },
  { path: ROUTES.orders.detail(":id"), family: "order", isNew: false },
  { path: ROUTES.quotes.new, family: "quote", isNew: true },
  { path: ROUTES.quotes.edit(":id"), family: "quote", isNew: false },
  { path: ROUTES.quotes.detail(":id"), family: "quote", isNew: false },
  { path: "/purchase-orders/new", family: "purchase-order", isNew: true },
  { path: "/purchase-orders/:id", family: "purchase-order", isNew: false },
  { path: "/customers/:id", family: "customer", isNew: false },
] as const;

export function matchWorkspaceRoute(pathname: string) {
  // These fixed routes are not customer records.
  if (pathname === ROUTES.customers.portalAccess || pathname === "/customers/new") return null;
  for (const route of workspaceRoutes) {
    const match = matchPath({ path: route.path, end: true }, pathname);
    if (match) return { ...route, params: match.params, recordKey: route.isNew ? null : `${route.family}:${match.params.id}` };
  }
  return null;
}

export type WorkspaceMatch = NonNullable<ReturnType<typeof matchWorkspaceRoute>>;
