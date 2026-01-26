/**
 * Email Templates V1 - Variable substitution and defaults
 * Supports {{token}} format with allowlisted variables only
 */

export type EmailTemplateType = 'quote' | 'invoice';

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailTemplates {
  quote: EmailTemplate;
  invoice: EmailTemplate;
}

/**
 * Allowlisted template variables
 */
export const TEMPLATE_VARIABLES = {
  // Organization
  'org.name': 'Organization name',
  // Customer
  'customer.name': 'Customer name',
  'customer.company': 'Customer company name',
  // Contact
  'contact.name': 'Contact person name',
  'contact.email': 'Contact email address',
  // Quote-specific
  'quote.number': 'Quote number',
  'quote.total': 'Quote total amount',
  'quote.validUntil': 'Quote valid until date',
  // Invoice-specific
  'invoice.number': 'Invoice number',
  'invoice.total': 'Invoice total amount',
  'invoice.dueDate': 'Invoice due date',
  // Optional
  'order.poNumber': 'Purchase order number (if available)',
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;

/**
 * Default email templates
 */
export const DEFAULT_QUOTE_TEMPLATE: EmailTemplate = {
  subject: 'Quote ' + '{{quote.number}}' + ' from ' + '{{org.name}}',
  body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #333;">Quote #` + '{{quote.number}}' + `</h2>
  <p>Dear ` + '{{customer.name}}' + `,</p>
  <p>Thank you for your interest. Please find attached our quote for your review.</p>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
    <p style="margin: 5px 0;"><strong>Quote Total:</strong> $` + '{{quote.total}}' + `</p>
    <p style="margin: 5px 0;"><strong>Valid Until:</strong> ` + '{{quote.validUntil}}' + `</p>
  </div>
  <p>If you have any questions, please don't hesitate to contact us.</p>
  <p>Best regards,<br>` + '{{org.name}}' + `</p>
</div>`,
};

export const DEFAULT_INVOICE_TEMPLATE: EmailTemplate = {
  subject: 'Invoice ' + '{{invoice.number}}' + ' from ' + '{{org.name}}',
  body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #333;">Invoice #` + '{{invoice.number}}' + `</h2>
  <p>Dear ` + '{{customer.name}}' + `,</p>
  <p>Thank you for your business. Please find attached your invoice.</p>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
    <p style="margin: 5px 0;"><strong>Invoice Total:</strong> $` + '{{invoice.total}}' + `</p>
    <p style="margin: 5px 0;"><strong>Due Date:</strong> ` + '{{invoice.dueDate}}' + `</p>
  </div>
  <p>Please remit payment by the due date. If you have any questions about this invoice, please contact us.</p>
  <p>Best regards,<br>` + '{{org.name}}' + `</p>
</div>`,
};

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplates = {
  quote: DEFAULT_QUOTE_TEMPLATE,
  invoice: DEFAULT_INVOICE_TEMPLATE,
};

/**
 * HTML escape for safe variable substitution
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Render template with variable substitution
 * Only replaces allowlisted {{token}} patterns
 * Unknown tokens are left unchanged
 */
export function renderTemplate(template: string, context: Record<string, string | number | null | undefined>): string {
  let result = template;
  
  // Replace each allowlisted variable
  Object.keys(TEMPLATE_VARIABLES).forEach((key) => {
    const token = `{{${key}}}`;
    if (result.includes(token)) {
      const value = context[key];
      // Convert to string and escape for HTML safety
      const safeValue = value != null ? escapeHtml(String(value)) : '';
      result = result.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), safeValue);
    }
  });
  
  return result;
}

/**
 * Validate template string
 * Returns array of error messages (empty if valid)
 */
export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  
  // Find all {{...}} tokens
  const tokenRegex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(template.matchAll(tokenRegex));
  
  matches.forEach((match) => {
    const token = match[1].trim();
    if (!Object.keys(TEMPLATE_VARIABLES).includes(token)) {
      errors.push(`Unknown variable: {{${token}}}. Only allowlisted variables are permitted.`);
    }
  });
  
  return errors;
}

/**
 * Validate email templates object
 */
export function validateEmailTemplates(templates: Partial<EmailTemplates>): { valid: boolean; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  
  if (templates.quote) {
    const subjectErrors = validateTemplate(templates.quote.subject);
    const bodyErrors = validateTemplate(templates.quote.body);
    
    if (templates.quote.subject.length > 200) {
      subjectErrors.push('Quote subject must be 200 characters or less');
    }
    if (templates.quote.body.length > 10000) {
      bodyErrors.push('Quote body must be 10,000 characters or less');
    }
    
    if (subjectErrors.length > 0) errors['quote.subject'] = subjectErrors;
    if (bodyErrors.length > 0) errors['quote.body'] = bodyErrors;
  }
  
  if (templates.invoice) {
    const subjectErrors = validateTemplate(templates.invoice.subject);
    const bodyErrors = validateTemplate(templates.invoice.body);
    
    if (templates.invoice.subject.length > 200) {
      subjectErrors.push('Invoice subject must be 200 characters or less');
    }
    if (templates.invoice.body.length > 10000) {
      bodyErrors.push('Invoice body must be 10,000 characters or less');
    }
    
    if (subjectErrors.length > 0) errors['invoice.subject'] = subjectErrors;
    if (bodyErrors.length > 0) errors['invoice.body'] = bodyErrors;
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
