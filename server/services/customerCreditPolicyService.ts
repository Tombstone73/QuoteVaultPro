import { customers } from "@shared/schema";
import { parseMoneyToCents } from "@shared/customerCreditExposure";
import { getCustomerCreditExposure } from "./customerCreditExposureService";
import { db } from "../db";
import { and, eq } from "drizzle-orm";

export class CustomerCreditPolicyError extends Error {
  constructor(
    readonly code: "CREDIT_LIMIT_EXCEEDED" | "CREDIT_OVERRIDE_FORBIDDEN" | "CREDIT_OVERRIDE_REASON_REQUIRED" | "CUSTOMER_NOT_FOUND",
    readonly details: { creditLimitCents?: number; projectedExposureCents?: number; overLimitCents?: number },
    message: string,
  ) { super(message); }
}

export function canOverrideCustomerCredit(role: unknown): boolean {
  return ["owner", "admin"].includes(String(role ?? "").trim().toLowerCase());
}

export async function assertCustomerCreditForOrder(input: {
  organizationId: string;
  customerId: string | null | undefined;
  actorUserId: string;
  actorOrgRole?: string | null;
  proposedOrderTotalCents: number;
  existingOrderTotalCents?: number;
  orderId?: string | null;
  override?: boolean;
  overrideReason?: string | null;
}) {
  if (!input.customerId) return null;
  const [customer] = await db.select({ id: customers.id, creditLimit: customers.creditLimit, creditLimitConfiguredAt: customers.creditLimitConfiguredAt })
    .from(customers).where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, input.customerId))).limit(1);
  if (!customer) throw new CustomerCreditPolicyError("CUSTOMER_NOT_FOUND", {}, "Customer not found for credit evaluation.");
  const position = await getCustomerCreditExposure(input.organizationId, customer);
  if (!position.creditLimitConfigured || position.creditLimitCents === null) return position;

  const deltaCents = Math.max(0, Math.round(input.proposedOrderTotalCents)) - Math.max(0, Math.round(input.existingOrderTotalCents ?? 0));
  const projectedExposureCents = position.creditExposureCents + deltaCents;
  const overLimitCents = Math.max(0, projectedExposureCents - position.creditLimitCents);
  if (overLimitCents <= 0) return { ...position, projectedExposureCents, overLimitCents };

  if (!input.override) {
    throw new CustomerCreditPolicyError("CREDIT_LIMIT_EXCEEDED", { creditLimitCents: position.creditLimitCents, projectedExposureCents, overLimitCents }, "This financially committed order would exceed the customer's credit limit.");
  }
  if (!canOverrideCustomerCredit(input.actorOrgRole)) {
    throw new CustomerCreditPolicyError("CREDIT_OVERRIDE_FORBIDDEN", { creditLimitCents: position.creditLimitCents, projectedExposureCents, overLimitCents }, "Only an Organization Owner or Admin can override a customer credit limit.");
  }
  const reason = String(input.overrideReason ?? "").trim();
  if (!reason) {
    throw new CustomerCreditPolicyError("CREDIT_OVERRIDE_REASON_REQUIRED", { creditLimitCents: position.creditLimitCents, projectedExposureCents, overLimitCents }, "A reason is required for a credit-limit override.");
  }
  return { ...position, projectedExposureCents, overLimitCents, overrideApplied: true, overrideReason: reason };
}

export function orderPayloadTotalCents(payload: { lineItems?: Array<any>; taxAmount?: unknown; discount?: unknown; shippingCents?: unknown }) {
  const lineCents = (payload.lineItems ?? []).reduce((sum, line) => sum + parseMoneyToCents(line.totalPrice ?? line.linePrice ?? 0), 0);
  return Math.max(0, lineCents - parseMoneyToCents(payload.discount ?? 0) + parseMoneyToCents(payload.taxAmount ?? 0) + Math.max(0, Number(payload.shippingCents ?? 0) || 0));
}
