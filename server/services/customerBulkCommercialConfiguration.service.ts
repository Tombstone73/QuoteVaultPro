import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, customers } from "@shared/schema";
import { type BulkCustomerCommercialConfigurationInput } from "@shared/customerCommercialConfiguration";
import { db } from "../db";

export class CustomerBulkCommercialConfigurationError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = "CustomerBulkCommercialConfigurationError";
  }
}

export async function updateCustomersCommercialConfiguration(input: {
  organizationId: string;
  actorUserId: string;
  update: BulkCustomerCommercialConfigurationInput;
}) {
  const customerIds = input.update.customerIds;
  if (!customerIds.length) {
    throw new CustomerBulkCommercialConfigurationError(400, "CUSTOMER_SELECTION_REQUIRED", "Select at least one customer.");
  }

  return db.transaction(async (tx) => {
    const selectedCustomers = await tx
      .select({
        id: customers.id,
        companyName: customers.companyName,
        paymentTerms: customers.paymentTerms,
        creditLimit: customers.creditLimit,
        creditLimitConfiguredAt: customers.creditLimitConfiguredAt,
      })
      .from(customers)
      .where(and(eq(customers.organizationId, input.organizationId), inArray(customers.id, customerIds)));

    if (selectedCustomers.length !== customerIds.length) {
      throw new CustomerBulkCommercialConfigurationError(404, "CUSTOMER_NOT_FOUND", "One or more selected customers are unavailable in this organization.");
    }

    const now = new Date();
    if (input.update.operation === "set_payment_terms") {
      await tx
        .update(customers)
        .set({ paymentTerms: input.update.paymentTerms, updatedAt: now })
        .where(and(eq(customers.organizationId, input.organizationId), inArray(customers.id, customerIds)));
      await tx.insert(auditLogs).values(selectedCustomers.map((customer) => ({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        actionType: "customer_updated",
        entityType: "customer",
        entityId: customer.id,
        entityName: customer.companyName,
        description: "Updated customer payment terms in a bulk customer action.",
        oldValues: { paymentTerms: customer.paymentTerms } as any,
        newValues: { paymentTerms: input.update.paymentTerms, bulk: true } as any,
      } as any)));
      return { updatedCount: selectedCustomers.length, customerIds, operation: input.update.operation, paymentTerms: input.update.paymentTerms };
    }

    const creditLimit = input.update.creditLimit;
    const configuredAt = creditLimit === null ? null : now;
    const persistedCreditLimit = creditLimit === null ? "0.00" : creditLimit.toFixed(2);
    await tx
      .update(customers)
      .set({ creditLimit: persistedCreditLimit, creditLimitConfiguredAt: configuredAt, updatedAt: now })
      .where(and(eq(customers.organizationId, input.organizationId), inArray(customers.id, customerIds)));
    await tx.insert(auditLogs).values(selectedCustomers.map((customer) => ({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "customer_credit_limit_updated",
      entityType: "customer",
      entityId: customer.id,
      entityName: customer.companyName,
      description: creditLimit === null ? "Cleared customer credit limit in a bulk customer action." : "Updated customer credit limit in a bulk customer action.",
      oldValues: { creditLimit: customer.creditLimit, creditLimitConfiguredAt: customer.creditLimitConfiguredAt } as any,
      newValues: { creditLimit: persistedCreditLimit, creditLimitConfiguredAt: configuredAt, bulk: true } as any,
    } as any)));
    return { updatedCount: selectedCustomers.length, customerIds, operation: input.update.operation, creditLimit: creditLimit === null ? null : persistedCreditLimit };
  });
}
