import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";

type QuoteEditorRouteParams = {
  id?: string;
  quoteId?: string;
};

/**
 * Legacy route wrapper for the quote editor.
 *
 * This page intentionally delegates all business logic/state to the new
 * quotes editor feature (`useQuoteEditorState` + `QuoteEditorPage`).
 */
export default function QuoteEditorRoute() {
  const params = useParams<QuoteEditorRouteParams>();
  const navigate = useNavigate();
  const location = useLocation();

  const isNewQuoteRoute = location.pathname === ROUTES.quotes.new;
  // Fallback to location.state.quoteId during transitions when params may lag
  const stateQuoteId = (location.state as any)?.quoteId ?? null;
  const routeQuoteId = params.quoteId ?? params.id ?? stateQuoteId;
  const quoteId: string | null = isNewQuoteRoute ? null : routeQuoteId ?? null;

  // If someone hits a non-new editor route without an id, send them back to the list.
  useEffect(() => {
    if (!isNewQuoteRoute && !quoteId) {
      navigate(ROUTES.quotes.list, { replace: true });
    }
  }, [isNewQuoteRoute, quoteId, navigate]);

  // Render placeholder instead of null to prevent unmounting during transitions
  if (!isNewQuoteRoute && !quoteId) {
    return <div className="p-6 text-sm text-muted-foreground">Loading quote…</div>;
  }

  const mode: "view" | "edit" = isNewQuoteRoute
    ? "edit"
    : location.pathname.endsWith("/edit")
      ? "edit"
      : "view";

  return <QuoteEditorPage mode={mode} />;
}


