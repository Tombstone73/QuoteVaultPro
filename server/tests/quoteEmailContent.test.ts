import { describe, expect, test } from "@jest/globals";

import { quoteEmailPlainTextToHtml, resolveQuoteEmailContent } from "../emailService";

describe("quote email content", () => {
  const variables = {
    quoteNumber: "QT-20000",
    companyName: "Titan Graphics",
    customerName: "Eye 4 Group",
  };

  test("uses staff-provided subject and body without replacing them with templates", () => {
    expect(resolveQuoteEmailContent({
      customSubject: "Your revised quote",
      customBody: "Hello Mike,\n\nPlease review this revision.",
      subjectTemplate: "Quote #{quoteNumber} from {companyName}",
      bodyTemplate: "Hello, {customerName}",
      variables,
    })).toEqual({
      subject: "Your revised quote",
      bodyText: "Hello Mike,\n\nPlease review this revision.",
    });
  });

  test("keeps template-based fallback behavior when custom content is omitted", () => {
    expect(resolveQuoteEmailContent({
      variables,
      subjectTemplate: "Quote #{quoteNumber} from {companyName}",
      bodyTemplate: "Hello {customerName}, quote {quoteNumber} is ready.",
    })).toEqual({
      subject: "Quote #QT-20000 from Titan Graphics",
      bodyText: "Hello Eye 4 Group, quote QT-20000 is ready.",
    });
  });

  test("keeps built-in fallback content when neither custom content nor templates are supplied", () => {
    expect(resolveQuoteEmailContent({ variables })).toEqual({
      subject: "Quote #QT-20000 from Titan Graphics",
      bodyText: "Hello,\n\nPlease find your quote #QT-20000 below.\n\nThank you for your business!",
    });
  });

  test("renders custom message text safely as email HTML", () => {
    expect(quoteEmailPlainTextToHtml("Hello\n<script>alert(1)</script>"))
      .toBe("Hello<br>&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
