import crypto from "node:crypto";
import type { Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { customers, invoiceGuestPaymentTokens, invoices, orders } from "../../shared/schema";
import { canonicalInvoiceCustomerId } from "./invoiceCustomerProjection";
import { sha256Hex } from "../lib/tokenHash";
import {
  confirmPortalStripePayment,
  validatePortalStripePayment,
  createPortalStripePaymentIntent,
  getPortalInvoice,
  getPortalStripeRuntimeConfig,
  getPortalStripeDiagnosticScope,
} from "./portal.service";

const GUEST_TOKEN_TTL_DAYS = 30;

type GuestScope = { organizationId: string; customerId: string; customer: any; userId: null; contactId: null; invoiceId: string };

export async function issueGuestInvoicePaymentToken(input: { organizationId: string; invoiceId: string; createdByUserId?: string | null }) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  await db.insert(invoiceGuestPaymentTokens).values({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    createdByUserId: input.createdByUserId ?? null,
  });
  return rawToken;
}

async function resolveGuestScope(rawToken: string): Promise<GuestScope | null> {
  // The token itself is the authority for this narrow guest surface: it is
  // stored against a specific organization and invoice.  Do not require a
  // currently joinable customer record here.  Older invoices can retain a
  // valid canonical customer id after a merge/import cleanup has removed or
  // replaced the original customer row; an INNER JOIN made those valid links
  // indistinguishable from an expired token.
  const [row] = await db.select({
    token: invoiceGuestPaymentTokens,
    invoice: invoices,
    customer: customers,
    canonicalCustomerId: canonicalInvoiceCustomerId,
  })
    .from(invoiceGuestPaymentTokens)
    .innerJoin(invoices, and(eq(invoiceGuestPaymentTokens.invoiceId, invoices.id), eq(invoiceGuestPaymentTokens.organizationId, invoices.organizationId)))
    .leftJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, invoices.organizationId)))
    .leftJoin(customers, and(eq(canonicalInvoiceCustomerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
    .where(and(eq(invoiceGuestPaymentTokens.tokenHash, sha256Hex(rawToken)), isNull(invoiceGuestPaymentTokens.revokedAt), gt(invoiceGuestPaymentTokens.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.canonicalCustomerId) return null;
  // getPortalScope only needs a stable, scoped identity for guest payment
  // authorization.  Preserve a harmless display fallback when the historic
  // customer row is no longer present.
  const customer = row.customer ?? {
    id: row.canonicalCustomerId,
    organizationId: row.token.organizationId,
    companyName: null,
    email: null,
  };
  return { organizationId: row.token.organizationId, customerId: row.canonicalCustomerId, customer, userId: null, contactId: null, invoiceId: row.invoice.id };
}

async function guestRequest(rawToken: string): Promise<Request | null> {
  const scope = await resolveGuestScope(rawToken);
  return scope ? ({ guestPaymentScope: scope, user: null } as unknown as Request) : null;
}

export async function getGuestInvoice(rawToken: string) {
  const req = await guestRequest(rawToken);
  if (!req) return null;
  const invoice = await getPortalInvoice(req, (req as any).guestPaymentScope.invoiceId);
  if (!invoice) return null;
  return {
    businessName: (req as any).guestPaymentScope.customer.companyName || "PrintersHero",
    invoiceId: invoice.id,
    invoiceNumber: invoice.displayNumber || invoice.invoiceNumber,
    amountDue: invoice.amountDue,
    amountPaid: invoice.amountPaid,
    total: invoice.total,
    currency: invoice.currency,
    paymentStatusLabel: invoice.paymentStatusLabel,
    status: invoice.status,
    paymentEligibility: invoice.paymentEligibility,
  };
}

export async function getGuestStripeRuntimeConfig(rawToken: string) {
  const req = await guestRequest(rawToken);
  return req ? getPortalStripeRuntimeConfig(req, (req as any).guestPaymentScope.invoiceId) : null;
}
export async function getGuestStripeDiagnosticScope(rawToken: string) {
  const req = await guestRequest(rawToken);
  return req ? getPortalStripeDiagnosticScope(req, (req as any).guestPaymentScope.invoiceId) : null;
}
export async function createGuestStripePaymentIntent(rawToken: string) {
  const req = await guestRequest(rawToken);
  return req ? createPortalStripePaymentIntent(req, (req as any).guestPaymentScope.invoiceId) : null;
}
export async function confirmGuestStripePayment(rawToken: string, paymentIntentId: string) {
  const req = await guestRequest(rawToken);
  if (!req) return null;
  (req as any).body = { paymentIntentId };
  return confirmPortalStripePayment(req, (req as any).guestPaymentScope.invoiceId);
}

export async function validateGuestStripePayment(rawToken: string, paymentIntentId: string) {
  const req = await guestRequest(rawToken);
  if (!req) return null;
  req.body = { paymentIntentId };
  return validatePortalStripePayment(req, (req as any).guestPaymentScope.invoiceId);
}
