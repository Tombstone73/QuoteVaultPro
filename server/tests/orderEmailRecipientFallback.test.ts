import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  OrderEmailRecipientError,
  sendOrderEmailWithRecipientFallback,
  type OrderEmailRecipientDeps,
} from "../lib/orderEmailRecipientFallback";

const getOrderById = jest.fn<OrderEmailRecipientDeps["getOrderById"]>();
const getCustomerContacts = jest.fn<OrderEmailRecipientDeps["getCustomerContacts"]>();
const updateCustomerContactForOrganization = jest.fn<OrderEmailRecipientDeps["updateCustomerContactForOrganization"]>();
const createCustomerContactForOrganization = jest.fn<OrderEmailRecipientDeps["createCustomerContactForOrganization"]>();
const getOrganizationById = jest.fn<OrderEmailRecipientDeps["getOrganizationById"]>();
const sendOrderEmail = jest.fn<OrderEmailRecipientDeps["sendOrderEmail"]>();
const createAuditLog = jest.fn<OrderEmailRecipientDeps["createAuditLog"]>();

const deps: OrderEmailRecipientDeps = {
  getOrderById,
  getCustomerContacts,
  updateCustomerContactForOrganization,
  createCustomerContactForOrganization,
  getOrganizationById,
  sendOrderEmail,
  createAuditLog,
};

function input(payload: unknown) {
  return {
    organizationId: "org_1",
    orderId: "order_1",
    userId: "user_1",
    userName: "Staff User",
    isInternalUser: true,
    payload,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getOrderById.mockResolvedValue({
    id: "order_1",
    customerId: "customer_1",
    orderNumber: "ORD-10023",
    displayNumber: "ORD-10023",
    subtotal: "25.00",
    taxAmount: "0.00",
    total: "25.00",
    lineItems: [{
      id: "line_1",
      productId: "product_1",
      product: { name: "Banner" },
      width: 24,
      height: 36,
      quantity: 1,
      totalPrice: 25,
      status: "new",
    }],
  } as any);
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
  sendOrderEmail.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue(undefined);
});

describe("sendOrderEmailWithRecipientFallback", () => {
  test("sends to a use-once recipient with order PDF attached by default", async () => {
    const result = await sendOrderEmailWithRecipientFallback(
      deps,
      input({ recipientEmail: "once@example.com", saveToCustomerContact: false }),
    );

    expect(result.success).toBe(true);
    expect(sendOrderEmail).toHaveBeenCalledWith("org_1", "order_1", "once@example.com", {
      attachments: [expect.objectContaining({
        filename: "Order_ORD-10023.pdf",
        content: expect.any(Buffer),
        contentType: "application/pdf",
      })],
    });
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "order_email_sent",
      newValues: expect.objectContaining({ attachPdf: true, recipientMode: "use_once" }),
    }));
  });

  test("sends without order PDF when attachPdf is false", async () => {
    await sendOrderEmailWithRecipientFallback(
      deps,
      input({ recipientEmail: "once@example.com", saveToCustomerContact: false, attachPdf: false }),
    );

    expect(getOrganizationById).not.toHaveBeenCalled();
    expect(sendOrderEmail).toHaveBeenCalledWith("org_1", "order_1", "once@example.com", {
      attachments: undefined,
    });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "order_email_sent",
      newValues: expect.objectContaining({ attachPdf: false, recipientMode: "use_once" }),
    }));
  });

  test("updates an existing linked customer contact before sending", async () => {
    await sendOrderEmailWithRecipientFallback(
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
    expect(sendOrderEmail).toHaveBeenCalledWith("org_1", "order_1", "buyer@example.com", expect.objectContaining({
      attachments: expect.any(Array),
    }));
  });

  test("creates a new linked customer contact before sending", async () => {
    await sendOrderEmailWithRecipientFallback(
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
    expect(sendOrderEmail).toHaveBeenCalledWith("org_1", "order_1", "new@example.com", expect.objectContaining({
      attachments: expect.any(Array),
    }));
  });

  test("rejects invalid recipient email server-side", async () => {
    await expect(
      sendOrderEmailWithRecipientFallback(
        deps,
        input({ recipientEmail: "not-an-email", saveToCustomerContact: false }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A valid recipient email is required.",
    } satisfies Partial<OrderEmailRecipientError>);

    expect(sendOrderEmail).not.toHaveBeenCalled();
  });

  test("fails clearly when requested PDF generation fails before creating contacts", async () => {
    getOrderById.mockResolvedValue({
      id: "order_1",
      customerId: "customer_1",
      orderNumber: "ORD-10023",
      lineItems: [],
    } as any);

    await expect(
      sendOrderEmailWithRecipientFallback(
        deps,
        input({ recipientEmail: "once@example.com", saveToCustomerContact: true, contactId: null, attachPdf: true }),
      ),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("Order PDF attachment failed"),
    });

    expect(sendOrderEmail).not.toHaveBeenCalled();
    expect(updateCustomerContactForOrganization).not.toHaveBeenCalled();
    expect(createCustomerContactForOrganization).not.toHaveBeenCalled();
  });

  test("rejects customer users", async () => {
    await expect(
      sendOrderEmailWithRecipientFallback(
        deps,
        { ...input({ recipientEmail: "once@example.com", saveToCustomerContact: false }), isInternalUser: false },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
