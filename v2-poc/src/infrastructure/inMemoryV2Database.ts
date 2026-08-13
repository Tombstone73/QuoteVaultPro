import type { Customer, Invoice, Order, OrganizationRole, ProductPricingConfiguration } from "../shared/model";

export type Membership = { actorId: string; organizationId: string; role: OrganizationRole };
export type IdempotencyRecord = { organizationId: string; actorId: string; requestId: string; requestHash: string; orderId: string; invoiceId: string };
export type V2State = {
  memberships: Membership[];
  customers: Customer[];
  products: ProductPricingConfiguration[];
  orders: Order[];
  invoices: Invoice[];
  requests: IdempotencyRecord[];
  auditEvents: Array<{ organizationId: string; actorId: string; action: string; orderId: string }>;
  nextOrderNumber: number;
  nextInvoiceNumber: number;
  taxRateBasisPointsByOrganization: Record<string, number>;
};

export class V2UnitOfWork {
  constructor(readonly state: V2State) {}
}

/**
 * Fixture-only persistence that models a single database transaction through
 * copy-on-write state. It intentionally has no DATABASE_URL and cannot write
 * a shared development or production database.
 */
export class InMemoryV2Database {
  private state: V2State;

  constructor(seed: Omit<V2State, "orders" | "invoices" | "requests" | "auditEvents" | "nextOrderNumber" | "nextInvoiceNumber">) {
    this.state = { ...structuredClone(seed), orders: [], invoices: [], requests: [], auditEvents: [], nextOrderNumber: 1, nextInvoiceNumber: 1 };
  }

  async transaction<T>(work: (unitOfWork: V2UnitOfWork) => Promise<T>): Promise<T> {
    const staged = structuredClone(this.state);
    const result = await work(new V2UnitOfWork(staged));
    this.state = staged;
    return result;
  }

  snapshot(): V2State { return structuredClone(this.state); }
}
