import type { OrderWithRelations } from "@shared/schema";
import { normalizeOrderSaveRoutingMode } from "@shared/orderSaveRouting";
import { db } from "../../db";
import { routeEligibleOrderLineItems, type OrderSaveRoutingLineResult } from "../orderSaveRoutingService";
import { autoSyncCanonicalProofForLineItem } from "../proofingService";

type ArtworkPromotionWarning = { lineItemIndex: number; uploadId: string; message: string };
type RoutingFailure = { lineItemId: null; status: "failed"; reason: string };

type OrderWithFollowUp = OrderWithRelations & {
    attachmentPromotionWarnings?: ArtworkPromotionWarning[];
    routingResult?: OrderSaveRoutingLineResult[] | [RoutingFailure];
};

export async function runDirectOrderCreateFollowUp(args: {
    order: OrderWithRelations;
    organizationId: string;
    userId: string;
    actorName: string;
    configuredRoutingMode: unknown;
    requestedRoutingMode: unknown;
    promoteArtwork: () => Promise<ArtworkPromotionWarning[]>;
}): Promise<OrderWithFollowUp> {
    const order: OrderWithFollowUp = args.order;
    if (Array.isArray(order.lineItems)) {
        for (const lineItem of order.lineItems) {
            try {
                await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                    organizationId: args.organizationId,
                    lineItemId: String(lineItem.id),
                    actorUserId: args.userId,
                    reason: "order_saved",
                }));
            } catch (proofSyncError) {
                console.error("[AutoProofSync:ORDER_CREATE] Failed (non-fatal):", proofSyncError);
            }
        }
    }

    const pendingArtworkWarnings = await args.promoteArtwork();
    if (pendingArtworkWarnings.length > 0) {
        order.attachmentPromotionWarnings = pendingArtworkWarnings;
    }

    const configuredRoutingMode = normalizeOrderSaveRoutingMode(args.configuredRoutingMode);
    const requestedRoutingMode = args.requestedRoutingMode === "route_eligible" || args.requestedRoutingMode === "save_only"
        ? args.requestedRoutingMode
        : configuredRoutingMode;
    if (requestedRoutingMode === "route_eligible") {
        try {
            order.routingResult = await db.transaction((tx) => routeEligibleOrderLineItems(tx, {
                organizationId: args.organizationId,
                orderId: String(order.id),
                actorUserId: args.userId,
                actorName: args.actorName,
                mode: "route_eligible",
            }));
        } catch (routingError) {
            // Commercial persistence has already succeeded. Report the routing failure with the saved Order.
            order.routingResult = [{
                lineItemId: null,
                status: "failed",
                reason: (routingError as { message?: string } | null)?.message || "Order saved, but automatic routing could not start.",
            }];
        }
    }

    return order;
}
