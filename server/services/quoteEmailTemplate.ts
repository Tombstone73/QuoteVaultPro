import { renderEmailTemplate, type EmailTemplateValues } from "@shared/emailTemplateVariables";

export function resolveQuoteEmailContent(input: {
  customSubject?: string | null;
  customBody?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  variables: EmailTemplateValues;
}): { subject: string; bodyText: string } {
  const subjectTemplate = input.subjectTemplate || "Quote #{quoteNumber} from {companyName}";
  const bodyTemplate = input.bodyTemplate || "Hello,\n\nPlease find your quote #{quoteNumber} below.\n\nThank you for your business!";
  return {
    subject: input.customSubject?.trim() || renderEmailTemplate(subjectTemplate, "quote", input.variables),
    bodyText: input.customBody?.trim() || renderEmailTemplate(bodyTemplate, "quote", input.variables),
  };
}

export function quoteEmailPlainTextToHtml(bodyText: string): string {
  return bodyText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
}
