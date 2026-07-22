import { ROUTES } from "@/config/routes";

/** The order-number link in Fulfillment always targets the full order detail view. */
export function getFulfillmentOrderDetailPath(orderId: string): string {
  return ROUTES.orders.detail(orderId);
}
