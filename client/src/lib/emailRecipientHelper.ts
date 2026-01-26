/**
 * Email recipient resolution helper
 * Handles various email field patterns across customer and contact objects
 */

import type { CustomerContact } from "@shared/schema";
import type { CustomerWithContacts } from "@/components/CustomerSelect";

export type RecipientSource = 'entered' | 'contact' | 'customer' | 'missing';

export interface ResolvedRecipient {
  email: string | null;
  source: RecipientSource;
}

/**
 * Extract email from contact object (handles multiple possible field names)
 */
function getContactEmail(contact: CustomerContact | undefined | null): string | null {
  if (!contact) return null;
  
  // Try various possible email field names
  const email = 
    contact.email ||
    (contact as any).primaryEmail ||
    (contact as any).emailAddress ||
    (contact as any).emails?.[0];
  
  return email && typeof email === 'string' ? email.trim() : null;
}

/**
 * Extract email from customer object (handles multiple possible field names)
 */
function getCustomerEmail(customer: CustomerWithContacts | undefined | null): string | null {
  if (!customer) return null;
  
  // Try various possible email field names
  const email = 
    customer.email ||
    (customer as any).primaryEmail ||
    (customer as any).emailAddress ||
    (customer as any).emails?.[0];
  
  return email && typeof email === 'string' ? email.trim() : null;
}

/**
 * Resolve recipient email with fallback chain: entered > contact > customer
 */
export function resolveRecipientEmail(params: {
  toInput: string;
  contact?: CustomerContact | null;
  customer?: CustomerWithContacts | null;
}): ResolvedRecipient {
  const { toInput, contact, customer } = params;
  
  // Priority 1: User-entered email
  const enteredEmail = toInput.trim();
  if (enteredEmail) {
    return { email: enteredEmail, source: 'entered' };
  }
  
  // Priority 2: Contact email
  const contactEmail = getContactEmail(contact);
  if (contactEmail) {
    return { email: contactEmail, source: 'contact' };
  }
  
  // Priority 3: Customer email
  const customerEmail = getCustomerEmail(customer);
  if (customerEmail) {
    return { email: customerEmail, source: 'customer' };
  }
  
  // No email found
  return { email: null, source: 'missing' };
}
