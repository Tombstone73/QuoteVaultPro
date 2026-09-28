export type EmailTemplateType = "quote" | "invoice";

export const EMAIL_TEMPLATE_VARIABLES = [
  { key: "companyName", label: "Company Name", description: "Company sending the email", appliesTo: ["quote", "invoice"], optional: false, sample: "Titan Graphics" },
  { key: "customerName", label: "Customer Name", description: "Customer receiving the document", appliesTo: ["quote", "invoice"], optional: false, sample: "Acme Signs" },
  { key: "quoteNumber", label: "Quote Number", description: "Customer-facing quote number", appliesTo: ["quote"], optional: false, sample: "QT-20552" },
  { key: "recipientName", label: "Recipient Name", description: "Selected quote recipient, or customer name when unavailable", appliesTo: ["quote"], optional: true, sample: "Jane Smith" },
  { key: "invoiceNumber", label: "Invoice Number", description: "Customer-facing invoice number", appliesTo: ["invoice"], optional: false, sample: "20552" },
  { key: "orderNumber", label: "Order Number", description: "Linked Order number, if available", appliesTo: ["invoice"], optional: true, sample: "20507" },
  { key: "poNumber", label: "PO Number", description: "Linked Order customer PO number, if available", appliesTo: ["invoice"], optional: true, sample: "152594" },
  { key: "jobLabel", label: "Job Label", description: "Customer-facing Quote or linked Order job label", appliesTo: ["quote", "invoice"], optional: true, sample: "Yard Signs" },
  { key: "dueDate", label: "Due Date", description: "Invoice due date, if established", appliesTo: ["invoice"], optional: true, sample: "October 15, 2026" },
] as const satisfies readonly { key: string; label: string; description: string; appliesTo: readonly EmailTemplateType[]; optional: boolean; sample: string }[];

export type EmailTemplateVariableKey = (typeof EMAIL_TEMPLATE_VARIABLES)[number]["key"];
export type EmailTemplateValues = Partial<Record<EmailTemplateVariableKey, string | number | null | undefined>>;
const tokenPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function emailTemplateVariables(type: EmailTemplateType) {
  return EMAIL_TEMPLATE_VARIABLES.filter(variable => (variable.appliesTo as readonly EmailTemplateType[]).includes(type));
}

export function unknownEmailTemplateVariables(template: string, type: EmailTemplateType): string[] {
  const allowed = new Set(emailTemplateVariables(type).map(variable => variable.key));
  return Array.from(new Set(Array.from(template.matchAll(tokenPattern))
    .filter(match => !allowed.has(match[1] as EmailTemplateVariableKey)).map(match => match[0])));
}

/** Ordinary unmatched braces stay literal; known optional values become empty. */
export function renderEmailTemplate(template: string, type: EmailTemplateType, values: EmailTemplateValues): string {
  const allowed = new Set(emailTemplateVariables(type).map(variable => variable.key));
  return template.replace(tokenPattern, (token, key: EmailTemplateVariableKey) =>
    allowed.has(key) ? String(values[key] ?? "") : token);
}

/** Pipe-delimited subject segments depend on every optional token they contain. */
export function renderEmailSubject(template: string, type: EmailTemplateType, values: EmailTemplateValues): string {
  if (!template.includes("|")) return renderEmailTemplate(template, type, values);
  const optional = new Set<string>(emailTemplateVariables(type).filter(variable => variable.optional).map(variable => variable.key));
  return template.split("|")
    .filter(segment => !Array.from(segment.matchAll(tokenPattern)).some(match =>
      optional.has(match[1] as EmailTemplateVariableKey) && !String(values[match[1] as EmailTemplateVariableKey] ?? "").trim()))
    .map(segment => renderEmailTemplate(segment, type, values).trim())
    .filter(Boolean)
    .join(" | ");
}

export function sampleEmailTemplateValues(type: EmailTemplateType): EmailTemplateValues {
  return Object.fromEntries(emailTemplateVariables(type).map(variable => [variable.key, variable.sample])) as EmailTemplateValues;
}
