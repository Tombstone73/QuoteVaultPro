import { resolveActorOrganizationContext } from "../authorization/organizationContext";
import { InvoiceRepository } from "../billing/invoiceRepository";
import { InMemoryV2Database } from "../infrastructure/inMemoryV2Database";
import { OrderRepository } from "./orderRepository";

/** Organization-scoped read seam; foreign IDs deliberately resolve as not-found. */
export class ReadOrderApplicationQuery {
  private readonly orders = new OrderRepository();
  constructor(private readonly database: InMemoryV2Database, private readonly invoices: InvoiceRepository) {}

  async execute(actorId: string, organizationId: string, orderId: string) {
    return this.database.transaction(async (unitOfWork) => {
      await resolveActorOrganizationContext(unitOfWork, actorId, organizationId);
      const order = await this.orders.get(unitOfWork, organizationId, orderId);
      return { order, invoice: await this.invoices.getForOrder(unitOfWork, organizationId, order.id) };
    });
  }
}
