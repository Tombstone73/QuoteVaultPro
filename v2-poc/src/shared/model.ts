export type OrganizationRole = "owner" | "admin" | "manager" | "employee" | "member";

export type ActorOrganizationContext = {
  actorId: string;
  organizationId: string;
  role: OrganizationRole;
  grants: ReadonlySet<"orders:create">;
};

export type Customer = { id: string; organizationId: string; name: string; taxExempt: boolean; taxRateBasisPoints?: number };
export type ProductPricingConfiguration = {
  id: string;
  organizationId: string;
  name: string;
  activeTreeVersionId: string;
  treeJson: unknown;
  baseUnitPriceCents: number;
  taxable: boolean;
};

export type PricedLine = {
  productId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxable: boolean;
  pricingSnapshot: Record<string, unknown>;
};

export type Order = {
  id: string;
  organizationId: string;
  customerId: string;
  createdByActorId: string;
  status: "new";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lines: PricedLine[];
};

export type Invoice = {
  id: string;
  organizationId: string;
  orderId: string;
  status: "draft";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lines: PricedLine[];
};

export type CreateOrderCommand = {
  organizationId: string;
  customerId: string;
  requestId: string;
  lines: Array<{ productId: string; quantity: number; selections?: Record<string, { value: string | number | boolean }>; widthIn?: number; heightIn?: number }>;
};

export type CreateOrderResult = { order: Order; invoice: Invoice; idempotentReplay: boolean };
