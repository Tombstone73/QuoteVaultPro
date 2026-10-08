import { organizationBusinessToday, validOrganizationTimezone } from './orderDueDate';

/** Store the organization-local Invoice Date in the existing timestamp columns.
 * The precise approval instant remains in accountingApprovedAt and audit history. */
export function firstApprovalInvoiceDate(approvedAt: Date, organizationTimezone: unknown): Date {
  const businessDay = organizationBusinessToday(approvedAt, validOrganizationTimezone(organizationTimezone));
  return new Date(`${businessDay}T12:00:00.000Z`);
}

export function invoiceDocumentDatePart(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
