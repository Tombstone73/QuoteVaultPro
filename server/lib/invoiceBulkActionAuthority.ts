import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { invoiceBulkActionPermissions, type InvoiceBulkAction, type InvoiceBulkActionPermissions } from "../../shared/invoiceBulkActionPermissions";

async function assignedCapabilities(organizationId: string, userId: string): Promise<string[]> {
  // The V2 permission-set schema is not present on every V1 installation.
  const availability = await db.execute(sql`SELECT to_regclass('v2_staff_permission_set_assignments') AS assignments`);
  if (!(availability as any).rows?.[0]?.assignments && !(availability as any)[0]?.assignments) return [];
  const result = await db.execute(sql`
    SELECT DISTINCT capability.capability_id AS id
    FROM v2_staff_permission_set_assignments assignment
    JOIN v2_permission_sets permission_set
      ON permission_set.id = assignment.permission_set_id
      AND permission_set.organization_id = assignment.organization_id
    JOIN v2_permission_set_capabilities capability
      ON capability.permission_set_id = permission_set.id
      AND capability.organization_id = permission_set.organization_id
    JOIN v2_permission_capabilities definition ON definition.id = capability.capability_id
    JOIN user_organizations membership
      ON membership.user_id = assignment.user_id
      AND membership.organization_id = assignment.organization_id
    WHERE assignment.organization_id = ${organizationId}
      AND assignment.user_id = ${userId}
      AND assignment.active = true
      AND permission_set.active = true
      AND definition.active = true
      AND membership.is_active = true
      AND permission_set.principal_kind = 'staff'
  `);
  const rows = (result as any).rows ?? result;
  return Array.from(rows as Array<{ id: string }>, (row) => String(row.id));
}

export async function resolveInvoiceBulkActionPermissions(req: any): Promise<InvoiceBulkActionPermissions> {
  const organizationId = getRequestOrganizationId(req);
  const userId = String(req.user?.claims?.sub ?? req.user?.id ?? "");
  if (!userId) return invoiceBulkActionPermissions(null, []);
  return invoiceBulkActionPermissions(req.actorOrgRole ?? req.orgRole, await assignedCapabilities(organizationId, userId));
}

export function requireInvoiceBulkAction(action: InvoiceBulkAction): RequestHandler {
  return (req, res, next) => {
    void resolveInvoiceBulkActionPermissions(req).then((permissions) => {
      if (permissions[action]) next();
      else res.status(403).json({ success: false, code: "INVOICE_ACTION_PERMISSION_REQUIRED", error: "You do not have permission for this Invoice action." });
    }).catch(next);
  };
}
