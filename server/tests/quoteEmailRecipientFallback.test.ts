import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildRawMessage } from "../lib/emailMime";
import { markInvoiceEmailDeliveryFailure } from "../services/invoiceEmailDeliveryFailure";

import {
  QuoteEmailRecipientError,
  sendQuoteEmailWithRecipientFallback,
  type QuoteEmailRecipientDeps,
} from "../lib/quoteEmailRecipientFallback";

const getQuoteById = jest.fn<QuoteEmailRecipientDeps["getQuoteById"]>();
const getCustomerContacts = jest.fn<QuoteEmailRecipientDeps["getCustomerContacts"]>();
const updateCustomerContactForOrganization = jest.fn<QuoteEmailRecipientDeps["updateCustomerContactForOrganization"]>();
const createCustomerContactForOrganization = jest.fn<QuoteEmailRecipientDeps["createCustomerContactForOrganization"]>();
const getOrganizationById = jest.fn<QuoteEmailRecipientDeps["getOrganizationById"]>();
const sendQuoteEmail = jest.fn<QuoteEmailRecipientDeps["sendQuoteEmail"]>();
const createAuditLog = jest.fn<QuoteEmailRecipientDeps["createAuditLog"]>();

const deps: QuoteEmailRecipientDeps = {
  getQuoteById,
  getCustomerContacts,
  updateCustomerContactForOrganization,
  createCustomerContactForOrganization,
  getOrganizationById,
  sendQuoteEmail,
  createAuditLog,
};

function input(payload: unknown) {
  return {
    organizationId: "org_1",
    quoteId: "quote_1",
    userId: "user_1",
    userName: "Staff User",
    isInternalUser: true,
    payload,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getQuoteById.mockResolvedValue({
    id: "quote_1",
    customerId: "customer_1",
    quoteNumber: 1001,
    displayNumber: "QT-1001",
    revision: 4,
    lineItems: [{
      id: "line_1",
      productId: "product_1",
      productName: "Banner",
      width: 24,
      height: 36,
      quantity: 1,
      linePrice: 25,
      status: "active",
    }],
  });
  getOrganizationById.mockResolvedValue({ id: "org_1", name: "Test Org", settings: { currency: "USD" } });
  getCustomerContacts.mockResolvedValue([
    { id: "contact_1", firstName: "Old", lastName: "Name", email: null },
  ]);
  updateCustomerContactForOrganization.mockResolvedValue({
    id: "contact_1",
    firstName: "Buyer",
    lastName: "Person",
    email: "buyer@example.com",
  });
  createCustomerContactForOrganization.mockResolvedValue({
    id: "contact_new",
    firstName: "New",
    lastName: "Buyer",
    email: "new@example.com",
  });
  sendQuoteEmail.mockResolvedValue("gmail-message-1");
  createAuditLog.mockResolvedValue(undefined);
});

describe("sendQuoteEmailWithRecipientFallback", () => {
  test("sends to a use-once recipient with quote PDF attached by default", async () => {
    const result = await sendQuoteEmailWithRecipientFallback(
      deps,
      input({ recipientEmail: "once@example.com", saveToCustomerContact: false }),
    );

    expect(result.success).toBe(true);
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "once@example.com", undefined, {
      quoteSnapshot: expect.objectContaining({ revision: 4 }),
      attachments: [expect.objectContaining({
        filename: "Quote_QT-1001.pdf",
        content: expect.any(Buffer),
        contentType: "application/pdf",
      })],
    });
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "QUOTE_EMAIL_RECIPIENT",
      description: expect.stringContaining("one-time"),
    }));
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "quote_email_sent",
      newValues: expect.objectContaining({ attachPdf: true, recipientMode: "use_once" }),
    }));
  });

  test("sends without quote PDF when attachPdf is false", async () => {
    await sendQuoteEmailWithRecipientFallback(
      deps,
      input({ recipientEmail: "once@example.com", saveToCustomerContact: false, attachPdf: false }),
    );

    expect(getOrganizationById).not.toHaveBeenCalled();
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "once@example.com", undefined, {
      quoteSnapshot: expect.objectContaining({ revision: 4 }),
      attachments: undefined,
    });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "quote_email_sent",
      newValues: expect.objectContaining({ attachPdf: false, recipientMode: "use_once" }),
    }));
  });

  test("passes staff-edited subject and body to the quote email service", async () => {
    await sendQuoteEmailWithRecipientFallback(
      deps,
      input({
        recipientEmail: "once@example.com",
        saveToCustomerContact: false,
        attachPdf: false,
        subject: "Your updated quote",
        body: "Hello Mike,\n\nPlease review the revised quote.",
      }),
    );

    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "once@example.com", undefined, {
      quoteSnapshot: expect.objectContaining({ revision: 4 }),
      subject: "Your updated quote",
      body: "Hello Mike,\n\nPlease review the revised quote.",
      attachments: undefined,
    });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "quote_email_sent",
      newValues: expect.objectContaining({
        subject: "Your updated quote",
        body: "Hello Mike,\n\nPlease review the revised quote.",
      }),
    }));
  });

  test("updates an existing linked customer contact before sending", async () => {
    await sendQuoteEmailWithRecipientFallback(
      deps,
      input({
        recipientEmail: "buyer@example.com",
        recipientName: "Buyer Person",
        saveToCustomerContact: true,
        contactId: "contact_1",
      }),
    );

    expect(getCustomerContacts).toHaveBeenCalledWith("customer_1");
    expect(updateCustomerContactForOrganization).toHaveBeenCalledWith("org_1", "contact_1", {
      email: "buyer@example.com",
      firstName: "Buyer",
      lastName: "Person",
    });
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "buyer@example.com", undefined, expect.objectContaining({
      attachments: expect.any(Array),
    }));
  });

  test("creates a new linked customer contact before sending", async () => {
    await sendQuoteEmailWithRecipientFallback(
      deps,
      input({
        recipientEmail: "new@example.com",
        recipientName: "New Buyer",
        saveToCustomerContact: true,
        contactId: null,
      }),
    );

    expect(createCustomerContactForOrganization).toHaveBeenCalledWith("org_1", "customer_1", {
      firstName: "New",
      lastName: "Buyer",
      email: "new@example.com",
      isPrimary: false,
    });
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "new@example.com", undefined, expect.objectContaining({
      attachments: expect.any(Array),
    }));
  });

  test("rejects invalid recipient email server-side", async () => {
    await expect(
      sendQuoteEmailWithRecipientFallback(
        deps,
        input({ recipientEmail: "not-an-email", saveToCustomerContact: false }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid address in TO: not-an-email",
    } satisfies Partial<QuoteEmailRecipientError>);

    expect(sendQuoteEmail).not.toHaveBeenCalled();
  });

  test("fails clearly when requested PDF generation fails", async () => {
    getQuoteById.mockResolvedValue({
      id: "quote_1",
      customerId: "customer_1",
      quoteNumber: 1001,
      lineItems: [],
    });

    await expect(
      sendQuoteEmailWithRecipientFallback(
        deps,
        input({ recipientEmail: "once@example.com", saveToCustomerContact: false, attachPdf: true }),
      ),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("Quote PDF attachment failed"),
    });

    expect(sendQuoteEmail).not.toHaveBeenCalled();
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
  });

  test("reports email sent when contact save fails", async () => {
    updateCustomerContactForOrganization.mockRejectedValue(new Error("Contact save failed"));

    const result = await sendQuoteEmailWithRecipientFallback(
      deps,
      input({
        recipientEmail: "buyer@example.com",
        saveToCustomerContact: true,
        contactId: "contact_1",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.contactSave?.success).toBe(false);
    expect(result.message).toContain("contact was not saved");
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "buyer@example.com", undefined, expect.objectContaining({
      attachments: expect.any(Array),
    }));
  });

  test("reports contact saved when sending fails", async () => {
    sendQuoteEmail.mockRejectedValue(new Error("SMTP unavailable"));

    await expect(
      sendQuoteEmailWithRecipientFallback(
        deps,
        input({
          recipientEmail: "buyer@example.com",
          saveToCustomerContact: true,
          contactId: "contact_1",
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("Contact was saved"),
    });
  });

  test.each([["first@example.com", "second@example.com"], ["first@example.com", "second@example.com", "third@example.com"]])(
    "submits all To addresses in one Gmail message with a versioned audit and PDF", async (...addresses) => {
      const result = await sendQuoteEmailWithRecipientFallback(deps, input({ recipients: {
        to: addresses.join(" "), cc: "copy@example.com; FIRST@example.com", bcc: "private@example.com",
      } }));
      expect(result.providerMessageId).toBe("gmail-message-1");
      expect(sendQuoteEmail).toHaveBeenCalledTimes(1);
      expect(getQuoteById).toHaveBeenCalledTimes(1);
      const [, , to, , options] = sendQuoteEmail.mock.calls[0];
      const raw = buildRawMessage({ from: "staff@example.com", to, cc: options?.cc, bcc: options?.bcc,
        subject: "Quote QT-1001", html: "Saved quote", attachments: options?.attachments });
      const mime = Buffer.from(raw, "base64url").toString();
      expect(mime).toContain(`To: ${addresses.join(",\r\n ")}\r\nCc: copy@example.com\r\nBcc: private@example.com\r\n`);
      expect(mime).toContain('filename="Quote_QT-1001.pdf"');
      expect(options?.quoteSnapshot).toMatchObject({ revision: 4 });
      expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actionType: "quote_email_sent", newValues: expect.objectContaining({
        quoteRevision: 4, providerMessageId: "gmail-message-1", recipients: { to: addresses, cc: ["copy@example.com"], bcc: ["private@example.com"] },
      }) }));
      expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
      expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    },
  );

  test("rejects invalid pasted addresses and a multi-address contact write before sending", async () => {
    await expect(sendQuoteEmailWithRecipientFallback(deps, input({ recipients: { to: "first@example.com invalid" } })))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("invalid") });
    await expect(sendQuoteEmailWithRecipientFallback(deps, input({ recipients: { to: "first@example.com second@example.com" }, saveToCustomerContact: true })))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("one To address") });
    expect(sendQuoteEmail).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
  });

  test("keeps contact identity scoped and avoids duplicate creation", async () => {
    getCustomerContacts.mockResolvedValue([{ id: "linked", email: "buyer@example.com" }]);
    for (const contactId of [null, "other-customer-contact"]) {
      const result = await sendQuoteEmailWithRecipientFallback(deps, input({
        recipientEmail: "BUYER@example.com", contactId, saveToCustomerContact: true, attachPdf: false,
      }));
      expect(result.contactSave?.success).toBe(false);
    }
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(sendQuoteEmail).toHaveBeenCalledTimes(2);
  });

  test("scopes quote lookup and rejects unauthorized contact mutation", async () => {
    const request = { ...input({ recipientEmail: "buyer@example.com" }), organizationId: "another-tenant", isInternalUser: false };
    getQuoteById.mockResolvedValue(null);
    await expect(sendQuoteEmailWithRecipientFallback(deps, request)).rejects.toMatchObject({ statusCode: 404 });
    expect(getQuoteById).toHaveBeenCalledWith("another-tenant", "quote_1", "user_1");
    await expect(sendQuoteEmailWithRecipientFallback(deps, { ...request, payload: { recipientEmail: "buyer@example.com", saveToCustomerContact: true } }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(sendQuoteEmail).not.toHaveBeenCalled();
  });

  test("keeps an ambiguous Gmail result out of successful history", async () => {
    sendQuoteEmail.mockRejectedValue(markInvoiceEmailDeliveryFailure(new Error("timeout"), "needs_review"));
    await expect(sendQuoteEmailWithRecipientFallback(deps, input({ recipientEmail: "buyer@example.com", attachPdf: false })))
      .rejects.toMatchObject({ result: { success: false, code: "EMAIL_DELIVERY_UNCONFIRMED", message: expect.stringContaining("Check Gmail Sent") } });
    expect(createAuditLog.mock.calls.map(([event]) => event.actionType)).toEqual(["QUOTE_EMAIL_RECIPIENT"]);
  });
});
