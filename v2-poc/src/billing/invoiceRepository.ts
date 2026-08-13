import type { V2UnitOfWork } from "../infrastructure/inMemoryV2Database";
import { V2PocError } from "../shared/errors";
import type { Invoice, Order } from "../shared/model";

export class InvoiceRepository {
  failNextCreate = false;

  async createDraftFromOrder(unitOfWork: V2UnitOfWork, order: Order): Promise<Invoice> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new V2PocError("INJECTED_FAILURE", "Injected draft-invoice persistence failure.");
    }
    const existing = unitOfWork.state.invoices.find((entry) => entry.organizationId === order.organizationId && entry.orderId === order.id);
    if (existing) return structuredClone(existing);
    const invoice: Invoice = {
      id: `v2-invoice-${unitOfWork.state.nextInvoiceNumber++}`,
      organizationId: order.organizationId,
      orderId: order.id,
      status: "draft",
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      lines: structuredClone(order.lines),
    };
    unitOfWork.state.invoices.push(invoice);
    return structuredClone(invoice);
  }

  async getForOrder(unitOfWork: V2UnitOfWork, organizationId: string, orderId: string): Promise<Invoice> {
    const invoice = unitOfWork.state.invoices.find((entry) => entry.organizationId === organizationId && entry.orderId === orderId);
    if (!invoice) throw new V2PocError("NOT_FOUND", "Invoice not found.");
    return structuredClone(invoice);
  }
}
