import { ROUTES } from "@/config/routes";

export type ItemTagScope = "order" | "line" | "partial";

export function validTagQuantity(value: unknown, orderedQuantity: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    && typeof orderedQuantity === "number" && Number.isSafeInteger(orderedQuantity)
    && orderedQuantity > 0 && value <= orderedQuantity;
}

export function itemTagPrintUrl(args: {
  orderId: string;
  lineItemId: string;
  scope: ItemTagScope;
  orderedQuantity: number;
  quantity?: number;
  includeThumbnails: boolean;
}): string | null {
  if (args.scope === "order") return ROUTES.orders.traveler(args.orderId);
  if (!args.lineItemId || !validTagQuantity(args.orderedQuantity, args.orderedQuantity)) return null;
  if (args.scope === "partial" && !validTagQuantity(args.quantity, args.orderedQuantity)) return null;
  const params = new URLSearchParams({ lineItemId: args.lineItemId });
  if (args.scope === "partial") params.set("tagQty", String(args.quantity));
  if (args.includeThumbnails) params.set("artworkThumbs", "1");
  return `${ROUTES.orders.traveler(args.orderId)}?${params}`;
}

export function parseItemTagRequest(params: URLSearchParams): {
  lineItemId: string;
  quantity: number | null;
  includeThumbnails: boolean;
} | null {
  const lineItemId = params.get("lineItemId")?.trim();
  if (!lineItemId) return null;
  const rawQuantity = params.get("tagQty");
  return {
    lineItemId,
    quantity: rawQuantity === null ? null : Number(rawQuantity),
    includeThumbnails: params.get("artworkThumbs") === "1",
  };
}
