import { describe, expect, test } from "@jest/globals";
import { buildCustomerStatementRecipients } from "../services/customerStatementRecipients";

describe("customer statement recipients", () => {
  test("uses the same active billing-contact priority as invoice delivery", () => {
    const recipients = buildCustomerStatementRecipients({
      customerEmail: "accounts@customer.test",
      customerName: "Customer Co.",
      contacts: [
        { email: "operations@customer.test", firstName: "Operations", lastName: "Contact", isBilling: false, isPrimary: true },
        { email: "billing@customer.test", firstName: "Billing", lastName: "Contact", isBilling: true, isPrimary: false },
      ],
    });

    expect(recipients.map(({ email, isDefault }) => ({ email, isDefault }))).toEqual([
      { email: "billing@customer.test", isDefault: true },
      { email: "operations@customer.test", isDefault: false },
      { email: "accounts@customer.test", isDefault: false },
    ]);
  });

  test("falls back to the invoice recipient order and excludes invalid addresses", () => {
    const recipients = buildCustomerStatementRecipients({
      customerEmail: "accounts@customer.test",
      customerName: "Customer Co.",
      contacts: [
        { email: "primary@customer.test", firstName: "Primary", lastName: "Contact", isBilling: false, isPrimary: true },
        { email: "not-an-email", firstName: "Broken", lastName: "Contact", isBilling: false, isPrimary: false },
      ],
    });

    expect(recipients.map((recipient) => recipient.email)).toEqual([
      "primary@customer.test",
      "accounts@customer.test",
    ]);
  });
});
