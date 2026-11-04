import type { customerPortalAccess, customers } from '@shared/schema';
import type { Request } from 'express';
import { portalRoleAllows, type PortalAction } from '../../shared/portalPermissions';
import { canExecuteStaffPortalPreviewPayment } from './staffPortalPreviewService';

export function portalAccessRole(req: Request): string | undefined {
  return (req.portalAccess as typeof customerPortalAccess.$inferSelect | null)?.accessRole;
}

export class PortalPermissionError extends Error {
  readonly statusCode = 403;
  readonly code = 'PORTAL_ACTION_FORBIDDEN';
  constructor() { super('Your portal role does not permit this action. Contact your company administrator or the shop.'); }
}

/** Called at the service boundary, before any external or database mutation. */
export async function requirePortalAction(req: Request, action: PortalAction): Promise<void> {
  if (action === 'payment' && (req as Request & { guestPaymentScope?: unknown }).guestPaymentScope) return; // Existing verified invoice-token scope.
  if (req.staffPortalPreview) {
    if (action === 'payment' && await canExecuteStaffPortalPreviewPayment(req)) return;
  } else {
    const access = req.portalAccess as typeof customerPortalAccess.$inferSelect | null;
    const customer = req.portalCustomer as typeof customers.$inferSelect | undefined;
    const userId = (req.user as { id?: string } | undefined)?.id;
    if (access?.status === 'ACTIVE' && access.userId === userId
      && access.organizationId === req.organizationId
      && access.customerId === req.portalCustomerId
      && customer?.id === access.customerId
      && customer.organizationId === access.organizationId
      && portalRoleAllows(access.accessRole, action)) return;
  }
  throw new PortalPermissionError();
}
