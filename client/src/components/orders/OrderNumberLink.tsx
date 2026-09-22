import { Link, useLocation } from "react-router-dom";
import { buildReferrer } from "@/lib/nav/smartBack";

type OrderNumberLinkProps = {
  orderId?: string | null;
  orderNumber?: string | null;
  className?: string;
};

/**
 * Canonical, safe Order Detail navigation for invoice-backed Order numbers.
 * The display number is never used as an identifier: only the durable orderId
 * is allowed to construct the route.
 */
export function OrderNumberLink({ orderId, orderNumber, className = "" }: OrderNumberLinkProps) {
  const location = useLocation();
  const displayNumber = String(orderNumber || "").trim();
  if (!orderId || !displayNumber) return <>{displayNumber || "—"}</>;

  return (
    <Link
      to={`/orders/${orderId}`}
      state={{ referrer: buildReferrer(location) }}
      className={`text-titan-accent hover:underline ${className}`.trim()}
      onClick={(event) => event.stopPropagation()}
    >
      {displayNumber}
    </Link>
  );
}
