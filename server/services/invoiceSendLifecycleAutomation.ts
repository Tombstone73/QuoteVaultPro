import { and, eq, sql } from "drizzle-orm";
import { auditLogs, customers, invoices, organizations } from "@shared/schema";
import {
  calculateDueDateFromSuccessfulCustomerSend,
  resolveInvoiceCustomerDeliveryTerms,
  resolveInvoiceSendAutomationPreferences,
  shouldRecalculateInvoiceDueDateAfterSuccessfulSend,
} from "@shared/invoiceSendAutomation";
import { db } from "../db";
import { approveInvoicesForAccounting } from "./invoiceAccountingApproval.service";
import { accountingApprovalRevocationPatch } from "../lib/invoiceAccountingApproval";

export type InvoiceSendLifecycleResult = {
  status: string;
  isFirstSuccessfulCustomerDelivery: boolean;
  dueDateUpdated: boolean;
  accountingApproved: boolean;
};

/**
 * The only post-provider-success lifecycle boundary for customer invoice
 * delivery. Direct sending and the durable queue both enter through the same
 * canonical sender and therefore share this handler.
 */
export async function applyInvoiceSendSuccessLifecycle(input: {
  organizationId: string;
  invoiceId: string;
  successfulSentAt: Date;
}): Promise<InvoiceSendLifecycleResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-send-lifecycle:${input.organizationId}:${input.invoiceId}`}))`);

    const [invoice] = await tx.select().from(invoices).where(and(
      eq(invoices.id, input.invoiceId),
      eq(invoices.organizationId, input.organizationId),
    )).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found after customer delivery"), { statusCode: 404 });

    const [organization] = await tx.select({ settings: organizations.settings }).from(organizations)
      .where(eq(organizations.id, input.organizationId)).limit(1);
    if (!organization) throw Object.assign(new Error("Organization not found after customer delivery"), { statusCode: 404 });

    const [customer] = invoice.customerId
      ? await tx.select({ paymentTerms: customers.paymentTerms }).from(customers).where(and(
        eq(customers.id, invoice.customerId),
        eq(customers.organizationId, input.organizationId),
      )).limit(1)
      : [null];

    const preferences = (organization.settings as any)?.preferences;
    const automation = resolveInvoiceSendAutomationPreferences(preferences);
    const isFirstSuccessfulCustomerDelivery = !invoice.lastSentAt;
    const nextStatus = ["paid", "partially_paid", "credit", "void"].includes(String(invoice.status || "").toLowerCase())
      ? String(invoice.status)
      : "sent";
    const updates: Record<string, unknown> = {
      status: nextStatus,
      lastSentAt: input.successfulSentAt,
      lastSentVia: "email",
      updatedAt: input.successfulSentAt,
    };

    let dueDateUpdated = false;
    if (shouldRecalculateInvoiceDueDateAfterSuccessfulSend({ isFirstSuccessfulCustomerDelivery, automation })) {
      const dueDate = calculateDueDateFromSuccessfulCustomerSend({
        successfulSentAt: input.successfulSentAt,
        terms: resolveInvoiceCustomerDeliveryTerms({
          invoiceTerms: invoice.terms,
          customerPaymentTerms: customer?.paymentTerms,
        }),
      });
      if (dueDate && (!invoice.dueDate || dueDate.getTime() !== new Date(invoice.dueDate).getTime())) {
        dueDateUpdated = true;
        updates.dueDate = dueDate;
        updates.invoiceVersion = Number(invoice.invoiceVersion || 1) + 1;
        updates.accountingUpdatedAt = input.successfulSentAt;
        Object.assign(updates, accountingApprovalRevocationPatch(invoice as any));
      }
    }
    updates.lastSentVersion = Number(updates.invoiceVersion || invoice.invoiceVersion || 1);

    await tx.update(invoices).set(updates as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));

    if (dueDateUpdated) {
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: null,
        userName: "Invoice delivery automation",
        actionType: "invoice_due_date_recalculated_after_send",
        entityType: "invoice",
        entityId: invoice.id,
        entityName: String(invoice.displayNumber || invoice.invoiceNumber),
        description: "Due date recalculated from the first provider-confirmed customer delivery and the invoice payment terms.",
        oldValues: { dueDate: invoice.dueDate, terms: invoice.terms } as any,
        newValues: { dueDate: updates.dueDate, source: "invoice_delivery_automation" } as any,
      } as any);
    }

    let accountingApproved = false;
    if (automation.approveForAccountingAfterSuccessfulSend) {
      const approval = await approveInvoicesForAccounting({
        organizationId: input.organizationId,
        invoiceIds: [invoice.id],
        actorUserId: null,
        actorUserName: "Invoice delivery automation",
        source: "invoice_delivery_automation",
      }, { tx });
      accountingApproved = approval.approved > 0;
    }

    return { status: nextStatus, isFirstSuccessfulCustomerDelivery, dueDateUpdated, accountingApproved };
  });
}
