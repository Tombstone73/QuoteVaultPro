import crypto from "node:crypto";
import type { Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { customers, invoiceGuestPaymentTokens, invoices } from "../../shared/schema";
import { sha256Hex } from "../lib/tokenHash";
import {
  confirmPortalStripePayment,
  createPortalStripePaymentIntent,
  getPortalInvoice,
  getPortalStripeRuntimeConfig,
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
  const [row] = await db.select({ token: invoiceGuestPaymentTokens, invoice: invoices, customer: customers })
    .from(invoiceGuestPaymentTokens)
    .innerJoin(invoices, and(eq(invoiceGuestPaymentTokens.invoiceId, invoices.id), eq(invoiceGuestPaymentTokens.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(invoices.customerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
    .where(and(eq(invoiceGuestPaymentTokens.tokenHash, sha256Hex(rawToken)), isNull(invoiceGuestPaymentTokens.revokedAt), gt(invoiceGuestPaymentTokens.expiresAt, new Date())))
    .limit(1);
  return row ? { organizationId: row.token.organizationId, customerId: row.invoice.customerId, customer: row.customer, userId: null, contactId: null, invoiceId: row.invoice.id } : null;
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
  };
}

export async function getGuestStripeRuntimeConfig(rawToken: string) {
  const req = await guestRequest(rawToken);
  return req ? getPortalStripeRuntimeConfig(req, (req as any).guestPaymentScope.invoiceId) : null;
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
