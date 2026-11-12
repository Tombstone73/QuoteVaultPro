import { parseDocumentEmailRecipients } from "../documentEmailRecipients";

describe("document email recipient parsing", () => {
  const emails = ["alpha@example.com", "beta@example.com", "gamma@example.com"];

  test.each([",", ";", "\n", "\r\n", " ", "\t"])("recognizes addresses separated by %j", separator => {
    expect(parseDocumentEmailRecipients({ to: emails.join(separator) })).toEqual({
      recipients: { to: emails, cc: [], bcc: [] }, errors: {}, limitError: null,
    });
  });

  test("validates addresses independently and keeps the first occurrence across headers", () => {
    expect(parseDocumentEmailRecipients({ to: [emails[0]], cc: `${emails[0].toUpperCase()}; ${emails[1]}`,
      bcc: `${emails[2]}\ninvalid-address` })).toEqual({
      recipients: { to: [emails[0]], cc: [emails[1]], bcc: [emails[2]] },
      errors: { bcc: "Invalid address in BCC: invalid-address" }, limitError: null,
    });
  });

  test("rejects injection in structured input and caps unique recipients", () => {
    expect(parseDocumentEmailRecipients({ to: ["safe@example.com\r\nBcc: injected@example.com"] }).errors.to).toBeDefined();
    expect(parseDocumentEmailRecipients({ to: Array.from({ length: 51 }, (_, i) => `test${i}@example.com`) }).limitError).toMatch(/50 unique/);
    expect(parseDocumentEmailRecipients({ to: "one@example.com" + " ".repeat(13_000) + "two@example.com" }).errors.to).toMatch(/length limit/);
  });
});
