import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { companySettings, customerContactLinks, customerContacts, customers, payments } from "../../shared/schema";
import { getAccountsReceivableReport } from "./accountsReceivableReport";
import { getCustomerAccountCreditSummary } from "./billing/customerAccountCreditOperations";
import { buildCustomerStatementRecipients, type CustomerStatementRecipient } from "./customerStatementRecipients";

export type CustomerStatement = {
  statementDate: string;
  organization: { companyName: string; email: string | null; phone: string | null; address: string | null };
  customer: { id: string; companyName: string; email: string | null; phone: string | null; billingAddress: string | null };
  summary: { outstandingCents: number; unappliedCreditCents: number; amountDueCents: number; agingCents: { current: number; oneToThirty: number; thirtyOneToSixty: number; sixtyOneToNinety: number; ninetyPlus: number; noDueDate: number } };
  openItems: Array<{ invoiceId: string; invoiceNumber: string; issueDate: string | null; dueDate: string | null; poNumber: string | null; orderNumber: string | null; originalCents: number; paidCents: number; remainingCents: number; agingBucket: string }>;
  recentPayments: Array<{ id: string; invoiceId: string; amountCents: number; paidAt: string | null; method: string | null }>;
  unappliedCredits: Array<{ id: string; amountCents: number; sourceType: string; createdAt: string; reference: string | null; reason: string | null }>;
};

function address(parts: Array<string | null | undefined>): string | null {
  const value = parts.filter((part): part is string => Boolean(part && part.trim())).join(", ");
  return value || null;
}

/**
 * One read-only accounting projection for statement screen, print, PDF, and
 * delivery snapshots. Invoice balances and aging come from the canonical A/R
 * report; the statement never recomputes payment application client-side.
 */
export async function getCustomerStatement(input: { organizationId: string; customerId: string; now?: Date }): Promise<CustomerStatement> {
  const [[customer], [branding], ar, creditSummary] = await Promise.all([
    db.select().from(customers).where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, input.customerId))).limit(1),
    db.select().from(companySettings).where(eq(companySettings.organizationId, input.organizationId)).limit(1),
    getAccountsReceivableReport({ organizationId: input.organizationId, filters: { customerId: input.customerId }, sortBy: "dueDate", sortDir: "asc", pageSize: 200, now: input.now }),
    getCustomerAccountCreditSummary({ organizationId: input.organizationId, customerId: input.customerId }),
  ]);
  if (!customer) throw Object.assign(new Error("Customer not found"), { statusCode: 404, code: "CUSTOMER_NOT_FOUND" });

  const invoiceIds = ar.rows.map((row) => row.id);
  const paymentRows = invoiceIds.length
    ? await db.select({ id: payments.id, invoiceId: payments.invoiceId, amountCents: payments.amountCents, paidAt: payments.paidAt, appliedAt: payments.appliedAt, method: payments.method, status: payments.status })
      .from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.status, "succeeded"), inArray(payments.invoiceId, invoiceIds)))
    : [];
  const relevantPayments = paymentRows.filter((payment) => invoiceIds.includes(payment.invoiceId)).sort((a, b) => Number(new Date(b.paidAt || b.appliedAt || 0)) - Number(new Date(a.paidAt || a.appliedAt || 0))).slice(0, 25);
  const activeCredits = creditSummary.credits.filter((credit: any) => Number(credit.remainingCents || 0) > 0);
  const aging = ar.summary.agingCents;
  const outstandingCents = ar.summary.totalOutstandingCents;
  const unappliedCreditCents = creditSummary.availableCents;
  return {
    statementDate: ar.asOf,
    organization: {
      companyName: branding?.companyName || "PrintersHero",
      email: branding?.email || null,
      phone: branding?.phone || null,
      address: branding?.address || address([branding?.physicalAddress?.line1, branding?.physicalAddress?.line2, branding?.physicalAddress?.city, branding?.physicalAddress?.state, branding?.physicalAddress?.postalCode, branding?.physicalAddress?.country]),
    },
    customer: {
      id: customer.id,
      companyName: customer.companyName,
      email: customer.email || null,
      phone: customer.phone || null,
      billingAddress: address([customer.billingStreet1 || customer.billingAddress, customer.billingStreet2, customer.billingCity, customer.billingState, customer.billingPostalCode, customer.billingCountry]),
    },
    summary: {
      outstandingCents,
      unappliedCreditCents,
      // Unapplied account credit is explicit customer-held value. It is shown
      // separately and reduces the customer-facing amount due, while the raw
      // A/R total remains visible and reconciles directly to the A/R report.
      amountDueCents: Math.max(0, outstandingCents - unappliedCreditCents),
      agingCents: { current: aging.current, oneToThirty: aging["1-30"], thirtyOneToSixty: aging["31-60"], sixtyOneToNinety: aging["61-90"], ninetyPlus: aging["90+"], noDueDate: aging.no_due_date },
    },
    openItems: ar.rows.map((row) => ({ invoiceId: row.id, invoiceNumber: row.invoiceNumber, issueDate: row.issueDate, dueDate: row.dueDate, poNumber: row.purchaseOrderNumber, orderNumber: row.orderNumber, originalCents: row.totalCents, paidCents: row.paidCents, remainingCents: row.remainingCents, agingBucket: row.agingBucket })),
    recentPayments: relevantPayments.map((payment) => ({ id: payment.id, invoiceId: payment.invoiceId, amountCents: Number(payment.amountCents || 0), paidAt: (payment.paidAt || payment.appliedAt)?.toISOString?.() || null, method: payment.method || null })),
    unappliedCredits: activeCredits.map((credit: any) => ({ id: credit.id, amountCents: Number(credit.remainingCents || 0), sourceType: credit.sourceType, createdAt: credit.createdAt.toISOString(), reference: credit.reference || null, reason: credit.reason || null })),
  };
}

export async function getCustomerStatementRecipients(input: { organizationId: string; customerId: string }): Promise<CustomerStatementRecipient[]> {
  const [customer, contacts] = await Promise.all([
    db.select({ email: customers.email, companyName: customers.companyName }).from(customers).where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, input.customerId))).limit(1),
    db.select({
      id: customerContacts.id,
      email: customerContacts.email,
      firstName: customerContacts.firstName,
      lastName: customerContacts.lastName,
      isBilling: customerContactLinks.isBilling,
      isPrimary: customerContactLinks.isPrimary,
    })
      .from(customerContactLinks)
      .innerJoin(customerContacts, and(
        eq(customerContactLinks.contactId, customerContacts.id),
        eq(customerContacts.organizationId, input.organizationId),
      ))
      .where(and(
        eq(customerContactLinks.organizationId, input.organizationId),
        eq(customerContactLinks.customerId, input.customerId),
        eq(customerContactLinks.status, "active"),
        eq(customerContacts.status, "active"),
      ))
      .orderBy(desc(customerContactLinks.isBilling), desc(customerContactLinks.isPrimary), customerContacts.firstName, customerContacts.lastName),
  ]);
  return buildCustomerStatementRecipients({
    customerEmail: customer[0]?.email || null,
    customerName: customer[0]?.companyName || null,
    contacts,
  });
}
