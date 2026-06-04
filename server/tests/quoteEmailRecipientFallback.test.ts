import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  QuoteEmailRecipientError,
  sendQuoteEmailWithRecipientFallback,
  type QuoteEmailRecipientDeps,
} from "../lib/quoteEmailRecipientFallback";

const getQuoteById = jest.fn<QuoteEmailRecipientDeps["getQuoteById"]>();
const getCustomerContacts = jest.fn<QuoteEmailRecipientDeps["getCustomerContacts"]>();
const updateCustomerContactForOrganization = jest.fn<QuoteEmailRecipientDeps["updateCustomerContactForOrganization"]>();
const createCustomerContactForOrganization = jest.fn<QuoteEmailRecipientDeps["createCustomerContactForOrganization"]>();
const sendQuoteEmail = jest.fn<QuoteEmailRecipientDeps["sendQuoteEmail"]>();
const createAuditLog = jest.fn<QuoteEmailRecipientDeps["createAuditLog"]>();

const deps: QuoteEmailRecipientDeps = {
  getQuoteById,
  getCustomerContacts,
  updateCustomerContactForOrganization,
  createCustomerContactForOrganization,
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
  });
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
  sendQuoteEmail.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue(undefined);
});

describe("sendQuoteEmailWithRecipientFallback", () => {
  test("sends to a use-once recipient without mutating contacts", async () => {
    const result = await sendQuoteEmailWithRecipientFallback(
      deps,
      input({ recipientEmail: "once@example.com", saveToCustomerContact: false }),
    );

    expect(result.success).toBe(true);
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "once@example.com", undefined);
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "QUOTE_EMAIL_RECIPIENT",
      description: expect.stringContaining("one-time"),
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
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "buyer@example.com", undefined);
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
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "new@example.com", undefined);
  });

  test("rejects invalid recipient email server-side", async () => {
    await expect(
      sendQuoteEmailWithRecipientFallback(
        deps,
        input({ recipientEmail: "not-an-email", saveToCustomerContact: false }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A valid recipient email is required.",
    } satisfies Partial<QuoteEmailRecipientError>);

    expect(sendQuoteEmail).not.toHaveBeenCalled();
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
    expect(sendQuoteEmail).toHaveBeenCalledWith("org_1", "quote_1", "buyer@example.com", undefined);
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
});
