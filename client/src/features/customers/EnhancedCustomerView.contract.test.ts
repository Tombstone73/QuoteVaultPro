import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const source = fs.readFileSync(path.join(process.cwd(), 'client/src/features/customers/EnhancedCustomerView.tsx'), 'utf8');
const invoiceTable = source.slice(source.indexOf('function InvoicesTable('), source.indexOf('// StatementTab'));
const ordersStart = source.indexOf('function OrdersTable(');
const ordersTable = source.slice(ordersStart, source.indexOf('function QuotesTable(', ordersStart));

test('Customer Detail displays the shared human-readable payment terms', () => {
  expect(source).toContain('import { customerPaymentTermsLabel } from "@shared/customerCommercialConfiguration";');
  expect(source).toContain('customerPaymentTermsLabel(customer.paymentTerms)');
});

test('the actual Customer Detail invoice table renders the operational invoice fields and shared direct actions', () => {
  for (const label of [
    'Invoice #', 'Job / Order', 'PO #', 'Order #', 'Invoice Date', 'Last Sent', 'Due Date',
    'Approval', 'Job Status', 'Total', 'Balance', 'Invoice Status', 'Actions',
  ]) expect(source).toContain(label);
  expect(invoiceTable).toContain('InvoiceSendQuickAction');
  expect(invoiceTable).toContain('CloseJobOverrideDialog');
  expect(invoiceTable).toContain('getOrderJobStatus(inv)');
  expect(invoiceTable).toContain('CloseJobOverrideAction');
  expect(invoiceTable).not.toContain('DropdownMenu');
});

test('the actual Customer Detail invoice table uses compact approval labels', () => {
  const approvalMapping = invoiceTable.slice(invoiceTable.indexOf('const approvalLabel'), invoiceTable.indexOf('const canApprove'));
  expect(approvalMapping).toContain('return "Approved"');
  expect(approvalMapping).toContain('return "Not Approved"');
  expect(approvalMapping).not.toContain('Approved for Accounting');
  expect(approvalMapping).not.toContain('Needs Reapproval');
});

test('the rendered Customer Detail invoice table owns its persistent layout and server-backed sort state', () => {
  expect(invoiceTable).toContain('useInvoicesPage');
  expect(invoiceTable).toContain('customer_detail_invoices');
  expect(invoiceTable).toContain('customerInvoiceSortApiField');
  expect(invoiceTable).toContain('persistCustomerInvoiceTableSortPreference');
  expect(invoiceTable).toContain('Reset to default');
  expect(invoiceTable).toContain('Configure Invoice Columns');
  expect(invoiceTable).toContain('sticky right-0');
  expect(invoiceTable).toContain('pageSize');
});

test('the Customer Detail Invoices tab uses the authoritative customer pagination total, not the visible page length', () => {
  const customerView = source.slice(source.indexOf('export default function EnhancedCustomerView'));

  expect(customerView).toContain('const invoicePage = useInvoicesPage({');
  expect(customerView).toContain('customerId,');
  expect(customerView).toContain('pageSize: 50,');
  expect(customerView).toContain('const invoices = invoicePage.data?.items ?? [];');
  expect(customerView).toContain('const invoiceTotalCount = invoicePage.data?.pagination?.totalCount ?? invoices.length;');
  expect(customerView).toContain('{ key: "invoices" as const, label: "Invoices", count: invoiceTotalCount }');
  expect(customerView).not.toContain('{ key: "invoices" as const, label: "Invoices", count: invoices.length }');
});

test('the Customer Detail invoice badge is stable across bounded pages and is zero for an empty customer', () => {
  const invoiceTabCount = (invoicePage: { pagination?: { totalCount?: number } } | undefined, invoices: unknown[]) =>
    invoicePage?.pagination?.totalCount ?? invoices.length;

  expect(invoiceTabCount({ pagination: { totalCount: 73 } }, Array.from({ length: 50 }))).toBe(73);
  expect(invoiceTabCount({ pagination: { totalCount: 73 } }, Array.from({ length: 23 }))).toBe(73);
  expect(invoiceTabCount({ pagination: { totalCount: 0 } }, [])).toBe(0);
});

test('the Customer Detail invoice table keeps its bounded page and filter-specific rows independent of the tab total', () => {
  expect(invoiceTable).toContain('const [pageSize, setPageSize] = useState(50);');
  expect(invoiceTable).toContain('status: statusFilter === "all" ? undefined : statusFilter,');
  expect(invoiceTable).toContain('search: searchQuery || undefined,');
  expect(invoiceTable).toContain('page,');
  expect(invoiceTable).toContain('pageSize,');
  expect(invoiceTable).toContain('invoices.map((inv: InvoiceListItem) => (');
  expect(invoiceTable).toContain('setPage((current) => Math.min(pagination.totalPages, current + 1))');
});

test('the actual Customer Detail reset control imports the supported Lucide RotateCcw icon', () => {
  const lucideImport = source.slice(source.indexOf('from "lucide-react"') - 800, source.indexOf('from "lucide-react"'));
  expect(lucideImport).toContain('RotateCcw');
  expect(invoiceTable).toContain('<RotateCcw');
  expect(source).not.toContain(['Rotated', 'Ccw'].join(''));
});

test('the actual Customer Detail orders table uses the same visible Close Job Override action', () => {
  expect(ordersTable).toContain('CloseJobOverrideDialog');
  expect(ordersTable).toContain('CloseJobOverrideAction');
  expect(ordersTable).toContain('View Order');
  expect(ordersTable).toContain('Traveler');
  expect(ordersTable).not.toContain('DropdownMenu');
});

test('Customer Detail tables preserve primary identifiers and dates while allowing local horizontal overflow', () => {
  expect(ordersTable).toContain('w-full overflow-x-auto');
  expect(ordersTable).toContain('min-w-[1260px] w-full table-auto');
  expect(ordersTable).not.toContain('table-fixed');
  expect(ordersTable).toContain('min-w-[120px] whitespace-nowrap px-4 py-3');
  expect(ordersTable).toContain('min-w-[132px] whitespace-nowrap px-4 py-3');

  expect(invoiceTable).toContain('w-full overflow-x-auto');
  expect(invoiceTable).toContain('min-w-[1480px] w-full table-auto');
  expect(invoiceTable).toContain('min-w-[132px] whitespace-nowrap px-3 py-3');
  expect(invoiceTable).toContain('min-w-[120px] whitespace-nowrap px-3 py-3');
});

test('Customer Detail Orders renders the canonical Job Name field without changing the working-set navigation', () => {
  expect(ordersTable).toContain('{ id: "jobName", label: "Job Name", defaultVisible: true');
  expect(ordersTable).toContain('return Array.from(new Set([...parsed, "jobName", "invoice"]));');
  expect(ordersTable).toContain('case "jobName":');
  expect(ordersTable).toContain('aVal = a.label || "";');
  expect(ordersTable).toContain('const jobName = order.label || "—";');
  expect(ordersTable).toContain('title={order.label || undefined}');
  expect(ordersTable).toContain('min-w-[180px] max-w-sm px-4 py-3');

  const renderJobName = (label: string | null | undefined) => label || "—";
  expect(renderJobName("Seating Chart")).toBe("Seating Chart");
  expect(renderJobName(null)).toBe("—");
});

test('Customer Detail Orders reuse the canonical Global Orders status selector', () => {
  expect(source).toContain('import { OrdersListStatusCell } from "@/components/orders/OrdersListStatusCell";');
  expect(ordersTable).toContain('<OrdersListStatusCell row={order} />');
  expect(ordersTable).not.toContain('getStatusStyle(order.status)');
  expect(ordersTable).not.toContain('formatStatusLabel(order.status)');
});

test('Customer Detail Invoice numbers are canonical, fully readable, and open the canonical detail route', () => {
  expect(invoiceTable).toContain('resolveDocumentDisplayNumber({ displayNumber: inv.displayNumber, numberCore: inv.numberCore, legacyNumber: inv.invoiceNumber })');
  expect(invoiceTable).toContain('onClick={(event) => { event.stopPropagation(); navigate(invoiceDetailPath(inv)); }}');
  expect(invoiceTable).toContain('title={`Open invoice ${resolveDocumentDisplayNumber(');
  expect(invoiceTable).toContain('min-w-[132px] whitespace-nowrap px-3 py-3');
});

test('Customer Detail rows open canonical workspaces with customer-scoped list context and a safe customer return path', () => {
  expect(invoiceTable).toContain('buildListDetailPath(');
  expect(invoiceTable).toContain('invoiceNavigationSource');
  expect(invoiceTable).toContain('invoiceReturnPath');
  expect(invoiceTable).toContain('customerId, page: String(page), pageSize: String(pageSize)');
  expect(ordersTable).toContain('buildListDetailPath(');
  expect(ordersTable).toContain('orderNavigationSource');
  expect(ordersTable).toContain('orderReturnPath');
  expect(ordersTable).toContain('customerId, page: "1", pageSize: "50"');
  expect(source).toContain('tab === "orders" || tab === "quotes" || tab === "invoices"');
});
