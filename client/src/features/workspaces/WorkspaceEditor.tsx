import OrderNewRoute from "@/pages/order-new";
import OrderDetail from "@/pages/order-detail";
import CustomerDetail from "@/pages/customer-detail-enhanced";
import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";
import { useWorkspaceLocation } from "@/contexts/WorkspaceContext";
import { matchWorkspaceRoute } from "./workspaceRoutes";

export function WorkspaceEditor() {
  const location = useWorkspaceLocation();
  const match = matchWorkspaceRoute(location.pathname);
  if (!match) return null;
  if (match.family === "customer") return <CustomerDetail />;
  if (match.family === "order") return match.isNew ? <OrderNewRoute /> : <OrderDetail />;
  return <QuoteEditorPage mode={match.isNew || location.pathname.endsWith("/edit") ? "edit" : "view"} />;
}
