import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("invoice recipients and guest payment contract", () => {
  const route = source("server/routes/mvpInvoicing.routes.ts");
  const recipients = source("shared/invoiceEmailRecipients.ts");
  const contactForm = source("client/src/components/contact-form.tsx");
  const guestService = source("server/services/guestInvoicePayment.service.ts");
  const portalPayments = source("server/services/portal.service.ts");
  const migration = source("server/db/migrations_v2/0192_customer_portal_default_on_guest_invoice_payment.sql");

  test("uses every explicitly marked invoice recipient and falls back only when none are marked", () => {
    expect(route).toContain("customerContactLinks.isBilling");
    expect(route).toContain('source: "billing_contact" as const');
    expect(route).toContain("billingContacts.length > 0");
    expect(route).toContain("recipientResolution.recipients.length > 1");
    expect(recipients).toContain('"billing_contact"');
    expect(contactForm).toContain("Invoice Recipient - Receives invoices and payment communications");
  });

  test("creates one durable send/audit path per resolved recipient", () => {
    expect(route).toContain("for (const recipient of recipientResolution.recipients)");
    expect(route).toContain("recipientEmails: recipientResolution.recipients.map");
    expect(route).toContain("createInvoiceEmailLog");
    expect(route).toContain("buildInvoiceEmailSentAudit");
  });

  test("keeps guest tokens hashed, expiring, and on the canonical Stripe reconciliation path", () => {
    expect(guestService).toContain("crypto.randomBytes(32)");
    expect(guestService).toContain("sha256Hex(rawToken)");
    expect(guestService).toContain("isNull(invoiceGuestPaymentTokens.revokedAt)");
    expect(guestService).toContain("gt(invoiceGuestPaymentTokens.expiresAt");
    expect(guestService).toContain("createPortalStripePaymentIntent");
    expect(guestService).toContain("confirmPortalStripePayment");
    expect(portalPayments).toContain('channel: isGuestPayment ? "guest" : "portal"');
    expect(portalPayments).toContain("guestPayment: isGuestPayment");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS invoice_guest_payment_tokens");
    expect(migration).toContain("token_hash text NOT NULL");
  });
});
