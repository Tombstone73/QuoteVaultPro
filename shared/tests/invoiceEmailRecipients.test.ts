import {
  buildInvoiceEmailRecipients,
  isValidInvoiceRecipientEmail,
} from "../invoiceEmailRecipients";

describe("invoice email recipients", () => {
  test("keeps the order contact as the default and deduplicates addresses case-insensitively", () => {
    const recipients = buildInvoiceEmailRecipients([
      { source: "order_contact", name: "Aidan Martin", email: "Aidan@controlgroup.biz" },
      { source: "customer_primary_contact", name: "Aidan", email: "aidan@controlgroup.biz" },
      { source: "customer_account", name: "Control Group", email: "billing@controlgroup.biz" },
      { source: "customer_contact", name: "Accounting", email: "accounting@controlgroup.biz" },
    ]);

    expect(recipients).toEqual([
      { source: "order_contact", name: "Aidan Martin", email: "Aidan@controlgroup.biz" },
      { source: "customer_account", name: "Control Group", email: "billing@controlgroup.biz" },
      { source: "customer_contact", name: "Accounting", email: "accounting@controlgroup.biz" },
    ]);
  });

  test("excludes blank and invalid saved addresses", () => {
    expect(buildInvoiceEmailRecipients([
      { source: "customer_primary_contact", name: "Blank", email: " " },
      { source: "customer_account", name: "Invalid", email: "not-an-email" },
      { source: "customer_contact", name: "Valid", email: " valid@example.com " },
    ])).toEqual([
      { source: "customer_contact", name: "Valid", email: "valid@example.com" },
    ]);
  });

  test("uses the established inline email validation format", () => {
    expect(isValidInvoiceRecipientEmail(" customer@example.com ")).toBe(true);
    expect(isValidInvoiceRecipientEmail("not-an-email")).toBe(false);
    expect(isValidInvoiceRecipientEmail("")).toBe(false);
  });
});
