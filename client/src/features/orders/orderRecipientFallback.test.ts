import { describe, expect, test } from "@jest/globals";

import {
  buildOrderRecipientFallbackPayload,
  CREATE_NEW_ORDER_CONTACT_CHOICE,
  getInitialOrderRecipientContactChoice,
  isValidOrderRecipientEmail,
  resolveAttachOrderPdfDefault,
  resolveSelectedOrderContactEmail,
} from "./orderRecipientFallback";

describe("order recipient fallback helpers", () => {
  test("validates recipient email format before send", () => {
    expect(isValidOrderRecipientEmail("customer@example.com")).toBe(true);
    expect(isValidOrderRecipientEmail(" customer@example.com ")).toBe(true);
    expect(isValidOrderRecipientEmail("missing-at.example.com")).toBe(false);
  });

  test("builds use-once payload without contact mutation", () => {
    expect(
      buildOrderRecipientFallbackPayload({
        recipientEmail: " customer@example.com ",
        recipientName: " Buyer ",
        saveToCustomerContact: false,
        contactChoice: "contact_1",
        attachPdf: true,
      }),
    ).toEqual({
      recipientEmail: "customer@example.com",
      recipientName: "Buyer",
      saveToCustomerContact: false,
      contactId: null,
      attachPdf: true,
    });
  });

  test("builds existing contact update and new contact payloads", () => {
    expect(
      buildOrderRecipientFallbackPayload({
        recipientEmail: "buyer@example.com",
        saveToCustomerContact: true,
        contactChoice: "contact_1",
        attachPdf: false,
      }),
    ).toEqual({
      recipientEmail: "buyer@example.com",
      recipientName: undefined,
      saveToCustomerContact: true,
      contactId: "contact_1",
      attachPdf: false,
    });

    expect(
      buildOrderRecipientFallbackPayload({
        recipientEmail: "new@example.com",
        saveToCustomerContact: true,
        contactChoice: CREATE_NEW_ORDER_CONTACT_CHOICE,
        attachPdf: true,
      }).contactId,
    ).toBeNull();
  });

  test("prefers selected contact and rejects invalid selected contact email", () => {
    const contacts = [
      { id: "contact_1", email: "" },
      { id: "contact_2", email: "good@example.com" },
    ];

    expect(getInitialOrderRecipientContactChoice(contacts, "contact_2")).toBe("contact_2");
    expect(getInitialOrderRecipientContactChoice([], null)).toBe(CREATE_NEW_ORDER_CONTACT_CHOICE);
    expect(resolveSelectedOrderContactEmail(contacts, "contact_1")).toBeNull();
    expect(resolveSelectedOrderContactEmail(contacts, "contact_2")).toBe("good@example.com");
  });

  test("defaults attach PDF checkbox from org basic settings", () => {
    expect(resolveAttachOrderPdfDefault(undefined)).toBe(true);
    expect(resolveAttachOrderPdfDefault({ basic: {} })).toBe(true);
    expect(resolveAttachOrderPdfDefault({ basic: { attachOrderPdfByDefault: false } })).toBe(false);
  });
});
