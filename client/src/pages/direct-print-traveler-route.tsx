import { Navigate, useSearchParams } from "react-router-dom";
import OrderTravelerPage, { hasValidDirectPrintJobId } from "./order-traveler";

/**
 * This is deliberately a route gate, not authorization. It lets the
 * off-screen print host mount an otherwise empty Traveler shell, while the
 * claimed-job source request made by that shell remains bridge-authenticated.
 */
export default function DirectPrintTravelerRoute() {
  const [searchParams] = useSearchParams();
  const directPrintJobId = searchParams.get("directPrintJobId");

  if (!hasValidDirectPrintJobId(directPrintJobId)) {
    return <Navigate to="/login" replace />;
  }

  return <OrderTravelerPage />;
}
