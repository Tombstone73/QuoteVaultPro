import { assistantCurrentOrderStatusInputSchema, assistantCurrentOrderStatusResultSchema } from "@shared/assistantContracts";
import type { Order } from "@shared/schema";
import type { AssistantToolAdapter } from "./toolRegistry";

type StatusRow = Pick<Order, "id" | "orderNumber" | "displayNumber" | "state" | "statusPillValue">;
type ReadOrder = (organizationId: string, id: string) => Promise<StatusRow | undefined>;

export function createCurrentOrderStatusTool(readOrder: ReadOrder = async (org, id) =>
  (await import("../../storage")).storage.getOrderById(org, id)): AssistantToolAdapter {
  return { async execute(input, { scope, context }) {
    assistantCurrentOrderStatusInputSchema.parse(input);
    if (context.entityType !== "order" || !context.entityId) {
      return { status: "not_found", data: null, warning: "No current order. Ask which order the user means." };
    }
    const order = await readOrder(scope.organizationId, context.entityId);
    if (!order) return { status: "not_found", data: null };
    const data = assistantCurrentOrderStatusResultSchema.parse({
      orderNumber: order.displayNumber ?? order.orderNumber, state: order.state, statusPillValue: order.statusPillValue,
    });
    const capturedAt = new Date().toISOString();
    return { status: "succeeded", data, provenance: {
      sourceLinks: [{ label: `Order ${data.orderNumber}`, href: `/orders/${order.id}`, entityType: "order", entityId: order.id, capturedAt }],
      freshness: { capturedAt },
    } };
  } };
}
