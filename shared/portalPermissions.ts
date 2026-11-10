/** Customer portal roles are separate from internal staff roles. */
export type PortalAction = 'order' | 'quote' | 'proof' | 'file' | 'payment' | 'profile';
export const PORTAL_ROLES = ['COMPANY_ADMIN', 'BUYER', 'BILLING', 'VIEWER'] as const;
export type PortalRole = typeof PORTAL_ROLES[number];
export const PORTAL_ROLE_LABELS: Record<PortalRole, string> = { COMPANY_ADMIN: 'Company Admin', BUYER: 'Buyer', BILLING: 'Billing', VIEWER: 'Viewer' };
export const PORTAL_ACTION_LABELS: Record<PortalAction, string> = { order: 'place orders', quote: 'respond to quotes', proof: 'respond to proofs', file: 'upload files', payment: 'pay invoices', profile: 'edit company profile' };
export function isPortalRole(value: unknown): value is PortalRole { return typeof value === 'string' && (PORTAL_ROLES as readonly string[]).includes(value); }
export function defaultPortalRole(contact: { isPrimary?: boolean | null; isBilling?: boolean | null }): PortalRole {
  return contact.isPrimary && contact.isBilling ? 'BILLING' : 'VIEWER';
}
export function portalRoleDescription(role: PortalRole): string {
  const actions = (Object.keys(PORTAL_ACTION_LABELS) as PortalAction[]).filter(action => portalRoleAllows(role, action)).map(action => PORTAL_ACTION_LABELS[action]);
  return actions.length ? `View customer records; ${actions.join(', ')}.` : 'View customer records only. Cannot pay invoices or make changes.';
}

export function portalRoleAllows(role: string | null | undefined, action: PortalAction): boolean {
  if (role === 'COMPANY_ADMIN') return true;
  if (action === 'payment') return role === 'BILLING' || role === 'BUYER';
  if (action === 'profile') return false;
  return role === 'BUYER';
}

export function unsupportedPortalPricingFields(customer: {
  pricingTier?: string | null;
  defaultDiscountPercent?: string | number | null;
  defaultMarkupPercent?: string | number | null;
  defaultMarginPercent?: string | number | null;
}): string[] {
  const fields: string[] = [];
  if (customer.pricingTier && customer.pricingTier !== 'default') fields.push('pricingTier');
  for (const field of ['defaultDiscountPercent', 'defaultMarkupPercent', 'defaultMarginPercent'] as const) {
    if (Number(customer[field] || 0) !== 0) fields.push(field);
  }
  return fields;
}
