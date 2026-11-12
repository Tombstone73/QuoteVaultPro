import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePurchaseOrder, usePurchaseOrders, type PurchaseOrderListRow } from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useAuth } from "@/hooks/useAuth";
import { useTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";
import { InvoiceColumnResizeHandle } from "@/components/invoices/InvoiceColumnResizeHandle";
import { PurchaseOrderLink, PurchaseOrderSummary, purchaseMoney, purchaseVarianceLabel } from "@/components/PurchaseOrderSummary";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, ClipboardList, Settings2 } from "lucide-react";
import {
  Page, PageHeader, ContentLayout, DataCard, TitanSearchInput, TitanTableContainer, TitanTable,
  TitanTableHeader, TitanTableHead, TitanTableBody, TitanTableRow, TitanTableCell,
  TitanTableEmpty, TitanTableLoading, StatusPill, getStatusVariant,
} from "@/components/titan";
import { purchasePaymentMethodLabel, purchasePaymentTermsLabel, purchaseVariance } from "@shared/purchaseOrderWorkflow";

const columns: ColumnConfig[] = [
  { id: "number", label: "PO Number", required: true, visible: true, order: 0, width: 150 },
  { id: "vendor", label: "Vendor", visible: true, order: 1, width: 150 },
  { id: "order", label: "Related Order", visible: true, order: 2, width: 140 },
  { id: "items", label: "Item Summary", visible: true, order: 3, width: 230 },
  { id: "status", label: "Status", visible: true, order: 4, width: 120 },
  { id: "issue", label: "Issue Date", visible: true, order: 5, width: 122 },
  { id: "delivery", label: "Expected Delivery", visible: true, order: 6, width: 146 },
  { id: "terms", label: "Payment Terms", visible: false, order: 7, width: 145 },
  { id: "method", label: "Payment Method", visible: false, order: 8, width: 155 },
  { id: "original", label: "Original Total", visible: false, order: 9, width: 138 },
  { id: "expected", label: "Current Expected", visible: true, order: 10, width: 160 },
  { id: "actual", label: "Actual Total", visible: false, order: 11, width: 148 },
  { id: "variance", label: "Cost Variance", visible: false, order: 12, width: 160 },
  { id: "actions", label: "Actions", required: true, visible: true, order: 13, width: 90 },
];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const statuses = [
  ["draft", "Draft"], ["issued", "Issued"], ["sent", "Sent (legacy)"], ["partially_received", "Partially received"],
  ["received", "Received"], ["cancelled", "Cancelled"], ["closed", "Closed"],
];

function sortValue(po: PurchaseOrderListRow, id: string): number | string | null {
  switch (id) {
    case "number": return po.poNumber;
    case "vendor": return po.vendor?.name ?? null;
    case "order": return po.relatedOrder?.displayNumber || po.relatedOrder?.orderNumber || null;
    case "items": return po.itemSummary ?? null;
    case "status": return po.status;
    case "issue": return po.issueDate;
    case "delivery": return po.expectedDate ?? null;
    case "terms": return purchasePaymentTermsLabel(po.paymentTerms);
    case "method": return purchasePaymentMethodLabel(po.paymentMethod);
    case "original": return po.originalTotal === null ? null : Number(po.originalTotal);
    case "expected": return Number(po.grandTotal);
    case "actual": return po.actualTotal === null ? null : Number(po.actualTotal);
    case "variance": return !po.actualProvisional && po.actualTotal !== null && po.originalTotal !== null
      ? Number(purchaseVariance(po.actualTotal, po.originalTotal)) : null;
    default: return null;
  }
}

function ExpandedPurchaseOrder({ id, colSpan }: { id: string; colSpan: number }) {
  const detail = usePurchaseOrder(id);
  return <TitanTableRow><TitanTableCell colSpan={colSpan} className="bg-muted/30">
    {detail.data ? <PurchaseOrderSummary po={detail.data} /> :
      detail.isError ? <Button type="button" variant="outline" onClick={() => void detail.refetch()}>Retry loading purchase order</Button> :
        <p role="status">Loading purchase order lines…</p>}
  </TitanTableCell></TitanTableRow>;
}

function cellContent(po: PurchaseOrderListRow, id: string, expanded: boolean, toggle: () => void): ReactNode {
  const detailPath = "/purchase-orders/" + po.id;
  switch (id) {
    case "number": {
      const Chevron = expanded ? ChevronDown : ChevronRight;
      return <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          aria-label={(expanded ? "Collapse " : "Expand ") + po.poNumber} aria-expanded={expanded} onClick={toggle}>
          <Chevron className="h-4 w-4" />
        </Button>
        <Link to={detailPath} className="font-medium text-titan-accent hover:underline">{po.poNumber}</Link>
      </div>;
    }
    case "vendor": return po.vendor?.name ?? "Vendor unavailable";
    case "order": return <PurchaseOrderLink order={po.relatedOrder} />;
    case "items": return po.itemSummary ?? "—";
    case "status": return <StatusPill variant={getStatusVariant(po.status)}>{statuses.find(([status]) => status === po.status)?.[1] ?? po.status}</StatusPill>;
    case "issue": return po.issueDate.slice(0, 10);
    case "delivery": return po.expectedDate?.slice(0, 10) ?? "—";
    case "terms": return purchasePaymentTermsLabel(po.paymentTerms);
    case "method": return purchasePaymentMethodLabel(po.paymentMethod);
    case "original": return purchaseMoney(po.originalTotal);
    case "expected": return purchaseMoney(po.grandTotal);
    case "actual": return purchaseMoney(po.actualTotal) + (po.actualTotal !== null && po.actualProvisional ? " (provisional)" : "");
    case "variance": return purchaseVarianceLabel(po);
    case "actions": return <Button asChild size="sm" variant="outline"><Link to={detailPath}>Open</Link></Button>;
    default: return null;
  }
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrgId, isAdminOrOwner } = useActiveOrganizationRole();
  const config = useTableColumnConfig("purchase_orders:" + activeOrgId + ":" + user?.id, columns);
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("all");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; descending: boolean } | null>(null);
  const { data: vendors = [] } = useVendors();
  const { data: pos = [], isLoading, isError, refetch } = usePurchaseOrders({
    search: search || undefined, vendorId: vendorId !== "all" ? vendorId : undefined, status: status !== "all" ? status : undefined,
  });
  const visible = config.columns.filter(column => column.visible);
  const rows = sort ? [...pos].sort((left, right) => {
    const a = sortValue(left, sort.id);
    const b = sortValue(right, sort.id);
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const comparison = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
    return sort.descending ? -comparison : comparison;
  }) : pos;

  return <Page>
    <PageHeader title="Purchase Orders" subtitle="Manage vendor orders and track deliveries" actions={
      <div className="flex flex-wrap gap-2">
        <Popover>
          <PopoverTrigger asChild><Button variant="outline"><Settings2 className="mr-2 h-4 w-4" />Columns</Button></PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
            {config.columns.map(column => <div key={column.id} className="flex items-center gap-2">
              <Checkbox id={"po-column-" + column.id} checked={column.visible} disabled={column.required}
                onCheckedChange={checked => config.setColumnVisibility(column.id, checked === true)} />
              <Label htmlFor={"po-column-" + column.id} className="flex-1">{column.label}</Label>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!config.canMoveColumn(column.id, "up")}
                onClick={() => config.moveColumn(column.id, "up")} aria-label={"Move " + column.label + " up"}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!config.canMoveColumn(column.id, "down")}
                onClick={() => config.moveColumn(column.id, "down")} aria-label={"Move " + column.label + " down"}><ArrowDown className="h-4 w-4" /></Button>
            </div>)}
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={config.reset}>Reset columns</Button>
          </PopoverContent>
        </Popover>
        {isAdminOrOwner && <Button onClick={() => navigate("/purchase-orders/new")}><Plus className="mr-2 h-4 w-4" />New PO</Button>}
      </div>
    } />
    <ContentLayout>
      <DataCard title="Filter Purchase Orders">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TitanSearchInput aria-label="Search purchase orders" placeholder="Search…" value={search} onChange={event => setSearch(event.target.value)} />
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger aria-label="Filter by vendor"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All vendors</SelectItem>{vendors.map(vendor => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{statuses.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </DataCard>
      <TitanTableContainer>
        <TitanTable className="table-fixed" style={{ minWidth: visible.reduce((sum, column) => sum + (column.width ?? 120), 0) }}>
          <colgroup>{visible.map(column => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
          <TitanTableHeader><TitanTableRow>
            {visible.map(column => <TitanTableHead key={column.id} className="relative pr-4" aria-sort={sort?.id === column.id ? sort.descending ? "descending" : "ascending" : undefined}>
              {column.id === "actions" ? column.label : <button type="button" className="flex items-center gap-1 text-left"
                onClick={() => setSort({ id: column.id, descending: sort?.id === column.id && !sort.descending })}>
                {column.label}
                {sort?.id === column.id && (sort.descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
              </button>}
              <InvoiceColumnResizeHandle label={column.label} width={column.width ?? 120}
                onPreview={width => config.setColumnWidth(column.id, width, false)} onCommit={width => config.setColumnWidth(column.id, width)} />
            </TitanTableHead>)}
          </TitanTableRow></TitanTableHeader>
          <TitanTableBody>
            {isLoading && <TitanTableLoading colSpan={visible.length} message="Loading purchase orders…" />}
            {isError && <TitanTableEmpty colSpan={visible.length} message="Could not load purchase orders" action={<Button onClick={() => void refetch()}>Retry</Button>} />}
            {!isLoading && !isError && !rows.length && <TitanTableEmpty colSpan={visible.length} icon={<ClipboardList className="h-10 w-10" />} message="No purchase orders found" />}
            {rows.map(po => <Fragment key={po.id}>
              <TitanTableRow>
                {visible.map(column => <TitanTableCell key={column.id} className="break-words">
                  {cellContent(po, column.id, expanded === po.id, () => setExpanded(expanded === po.id ? null : po.id))}
                </TitanTableCell>)}
              </TitanTableRow>
              {expanded === po.id && <ExpandedPurchaseOrder id={po.id} colSpan={visible.length} />}
            </Fragment>)}
          </TitanTableBody>
        </TitanTable>
      </TitanTableContainer>
    </ContentLayout>
  </Page>;
}
