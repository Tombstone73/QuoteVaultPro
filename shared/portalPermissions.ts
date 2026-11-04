/** Customer portal roles are separate from internal staff roles. */
export type PortalAction = 'order' | 'quote' | 'proof' | 'file' | 'payment' | 'profile';

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
