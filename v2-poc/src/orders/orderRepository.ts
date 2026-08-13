import type { V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { V2PocError } from "../shared/errors";
import type { Order } from "../shared/model";

export class OrderRepository {
  async insert(unitOfWork: V2UnitOfWork, order: Omit<Order, "id">): Promise<Order> {
    const id = `v2-order-${unitOfWork.state.nextOrderNumber++}`;
    const stored = { ...structuredClone(order), id };
    unitOfWork.state.orders.push(stored);
    return structuredClone(stored);
  }

  async get(unitOfWork: V2UnitOfWork, organizationId: string, orderId: string): Promise<Order> {
    const order = unitOfWork.state.orders.find((entry) => entry.id === orderId && entry.organizationId === organizationId);
    if (!order) throw new V2PocError("NOT_FOUND", "Order not found.");
    return structuredClone(order);
  }
}
