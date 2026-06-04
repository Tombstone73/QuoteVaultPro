import { describe, expect, test } from "@jest/globals";

import {
  buildQuoteRecipientFallbackPayload,
  CREATE_NEW_CONTACT_CHOICE,
  getInitialRecipientContactChoice,
  isValidRecipientEmail,
  resolveAttachQuotePdfDefault,
  resolveSelectedContactEmail,
} from "./quoteRecipientFallback";

describe("quote recipient fallback helpers", () => {
  test("validates recipient email format before send", () => {
    expect(isValidRecipientEmail("customer@example.com")).toBe(true);
    expect(isValidRecipientEmail(" customer@example.com ")).toBe(true);
    expect(isValidRecipientEmail("missing-at.example.com")).toBe(false);
  });

  test("builds use-once payload without contact mutation", () => {
    expect(
      buildQuoteRecipientFallbackPayload({
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
      buildQuoteRecipientFallbackPayload({
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
      buildQuoteRecipientFallbackPayload({
        recipientEmail: "new@example.com",
        saveToCustomerContact: true,
        contactChoice: CREATE_NEW_CONTACT_CHOICE,
        attachPdf: true,
      }).contactId,
    ).toBeNull();
  });

  test("prefers selected contact and rejects invalid selected contact email", () => {
    const contacts = [
      { id: "contact_1", email: "" },
      { id: "contact_2", email: "good@example.com" },
    ];

    expect(getInitialRecipientContactChoice(contacts, "contact_2")).toBe("contact_2");
    expect(getInitialRecipientContactChoice([], null)).toBe(CREATE_NEW_CONTACT_CHOICE);
    expect(resolveSelectedContactEmail(contacts, "contact_1")).toBeNull();
    expect(resolveSelectedContactEmail(contacts, "contact_2")).toBe("good@example.com");
  });

  test("defaults attach PDF checkbox from org basic settings", () => {
    expect(resolveAttachQuotePdfDefault(undefined)).toBe(true);
    expect(resolveAttachQuotePdfDefault({ basic: {} })).toBe(true);
    expect(resolveAttachQuotePdfDefault({ basic: { attachQuotePdfByDefault: false } })).toBe(false);
  });
});
