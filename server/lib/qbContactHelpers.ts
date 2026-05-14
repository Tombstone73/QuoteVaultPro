/**
 * Pure helpers for QuickBooks customer-to-contact mapping.
 * No DB or network dependencies — safe to import in unit tests.
 */

const SUSPICIOUS_CONTACT_NAMES = new Set([
  'primary contact',
  'main contact',
  'contact',
  'customer contact',
  'unknown',
  'n/a',
  'na',
  'none',
  'no name',
  'no contact',
]);

/**
 * Returns true when firstName (+ optional lastName) form a known generic
 * placeholder rather than a real person name.
 */
export function isSuspiciousContactName(firstName: string, lastName = ''): boolean {
  const first = firstName.trim().toLowerCase();
  const full  = `${first} ${lastName.trim().toLowerCase()}`.trim();
  if (!full) return true;
  return SUSPICIOUS_CONTACT_NAMES.has(full) || SUSPICIOUS_CONTACT_NAMES.has(first);
}

/**
 * Derive a contact person name from QuickBooks Customer fields.
 * Returns null when no person-level name can be identified.
 */
export function deriveQBContactName(
  qbCustomer: any,
): { firstName: string; lastName: string } | null {
  const givenName  = String(qbCustomer.GivenName  || '').trim();
  const familyName = String(qbCustomer.FamilyName || '').trim();

  if (givenName && familyName) {
    return { firstName: givenName, lastName: familyName };
  }
  if (givenName) {
    return { firstName: givenName, lastName: '' };
  }
  if (familyName) {
    // Only a last name is known — store it as the display name in firstName so
    // the contact renders meaningfully (e.g. "Smith" not "Contact Smith").
    return { firstName: familyName, lastName: '' };
  }

  // Fall back to DisplayName only when it is not identical to the company name.
  const displayName = String(qbCustomer.DisplayName || '').trim();
  const companyName = String(qbCustomer.CompanyName || '').trim();

  if (displayName && displayName.toLowerCase() !== companyName.toLowerCase()) {
    return { firstName: displayName, lastName: '' };
  }

  return null;
}
