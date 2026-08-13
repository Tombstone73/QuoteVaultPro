import { requireOrderCreate, resolveActorOrganizationContext } from "../authorization/organizationContext";
import { InvoiceRepository } from "../billing/invoiceRepository";
import { getProductPricingConfiguration } from "../catalog/catalogRepository";
import { getCustomer } from "../customers/customerRepository";
import { InMemoryV2Database, type IdempotencyRecord, type V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { priceOrderLine, type PricingEngine } from "../pricing/canonicalPricingAdapter";
import { V2PocError } from "../shared/errors";
import type { CreateOrderCommand, CreateOrderResult, Order } from "../shared/model";
import { OrderRepository } from "./orderRepository";

const fingerprint = (command: CreateOrderCommand): string => JSON.stringify({ customerId: command.customerId, lines: command.lines, organizationId: command.organizationId });

class RequestRepository {
  find(unitOfWork: V2UnitOfWork, organizationId: string, actorId: string, requestId: string): IdempotencyRecord | undefined {
    return unitOfWork.state.requests.find((entry) => entry.organizationId === organizationId && entry.actorId === actorId && entry.requestId === requestId);
  }
  insert(unitOfWork: V2UnitOfWork, record: IdempotencyRecord): void { unitOfWork.state.requests.push(record); }
}

/** The sole V2 cross-domain consistency boundary: Orders + Billing + durable request record. */
export class CreateOrderApplicationOperation {
  private readonly requests = new RequestRepository();
  private readonly orders = new OrderRepository();

  constructor(private readonly database: InMemoryV2Database, private readonly pricing: PricingEngine, private readonly invoices: InvoiceRepository) {}

  async execute(actorId: string, command: CreateOrderCommand): Promise<CreateOrderResult> {
    return this.database.transaction(async (unitOfWork) => {
      const context = await resolveActorOrganizationContext(unitOfWork, actorId, command.organizationId);
      requireOrderCreate(context);
      if (!command.requestId.trim() || command.lines.length === 0) throw new V2PocError("VALIDATION", "A request ID and at least one line are required.");
      const requestHash = fingerprint(command);
      const previous = this.requests.find(unitOfWork, command.organizationId, actorId, command.requestId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new V2PocError("IDEMPOTENCY_CONFLICT", "Request ID was already used with different content.");
        return { order: await this.orders.get(unitOfWork, command.organizationId, previous.orderId), invoice: await this.invoices.getForOrder(unitOfWork, command.organizationId, previous.orderId), idempotentReplay: true };
      }
      const customer = await getCustomer(unitOfWork, command.organizationId, command.customerId);
      const rate = customer.taxRateBasisPoints ?? unitOfWork.state.taxRateBasisPointsByOrganization[command.organizationId] ?? 0;
      const lines = await Promise.all(command.lines.map(async (line) => {
        const configuration = await getProductPricingConfiguration(unitOfWork, command.organizationId, line.productId);
        const priced = priceOrderLine(this.pricing, { configuration, quantity: line.quantity, selections: line.selections ?? {}, widthIn: line.widthIn, heightIn: line.heightIn });
        const taxCents = !customer.taxExempt && priced.taxable ? Math.round((priced.lineSubtotalCents * rate) / 10_000) : 0;
        return { ...priced, taxCents, totalCents: priced.lineSubtotalCents + taxCents };
      }));
      const orderDraft: Omit<Order, "id"> = { organizationId: command.organizationId, customerId: customer.id, createdByActorId: actorId, status: "new", subtotalCents: lines.reduce((sum, line) => sum + line.lineSubtotalCents, 0), taxCents: lines.reduce((sum, line) => sum + line.taxCents, 0), totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0), lines };
      const order = await this.orders.insert(unitOfWork, orderDraft);
      const invoice = await this.invoices.createDraftFromOrder(unitOfWork, order);
      this.requests.insert(unitOfWork, { organizationId: command.organizationId, actorId, requestId: command.requestId, requestHash, orderId: order.id, invoiceId: invoice.id });
      unitOfWork.state.auditEvents.push({ organizationId: command.organizationId, actorId, action: "order.created", orderId: order.id });
      return { order, invoice, idempotentReplay: false };
    });
  }
}
