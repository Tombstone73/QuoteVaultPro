import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, ClipboardList } from "lucide-react";
import {
  Page,
  PageHeader,
  ContentLayout,
  DataCard,
  TitanSearchInput,
  TitanTableContainer,
  TitanTable,
  TitanTableHeader,
  TitanTableHead,
  TitanTableBody,
  TitanTableRow,
  TitanTableCell,
  TitanTableEmpty,
  TitanTableLoading,
  StatusPill,
  getStatusVariant,
} from "@/components/titan";

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const { data: vendors = [] } = useVendors({ isActive: true });
  const { data: pos = [], isLoading } = usePurchaseOrders({
    search: search || undefined,
    vendorId: vendorId || undefined,
    status: status !== 'all' ? status : undefined,
  });

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  return (
    <Page>
      <PageHeader
        title="Purchase Orders"
        subtitle="Manage vendor orders and track deliveries"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New PO
          </Button>
        }
      />

      <ContentLayout>
        <DataCard title="Filter Purchase Orders" description="Search and filter by vendor or status">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <TitanSearchInput
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="space-y-2">
              <Label className="text-titan-xs font-medium text-titan-text-muted">Vendor</Label>
              <Select value={vendorId} onValueChange={(v) => setVendorId(v === "all" ? undefined : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-titan-xs font-medium text-titan-text-muted">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="partially_received">Partial</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DataCard>

        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead>PO #</TitanTableHead>
                <TitanTableHead>Vendor</TitanTableHead>
                <TitanTableHead>Status</TitanTableHead>
                <TitanTableHead>Issue Date</TitanTableHead>
                <TitanTableHead>Expected</TitanTableHead>
                <TitanTableHead className="text-right">Total</TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={6} message="Loading purchase orders..." />}
              
              {!isLoading && pos.length === 0 && (
                <TitanTableEmpty
                  colSpan={6}
                  icon={<ClipboardList className="w-12 h-12" />}
                  message="No purchase orders found"
                  action={
                    <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create first PO
                    </Button>
                  }
                />
              )}
              
              {!isLoading && pos.map((po) => (
                <TitanTableRow
                  key={po.id}
                  clickable
                  onClick={() => navigate(`/purchase-orders/${po.id}`)}
                >
                  <TitanTableCell className="font-medium">
                    <span className="text-titan-accent hover:underline">{po.poNumber}</span>
                  </TitanTableCell>
                  <TitanTableCell>{po.vendor?.name || '-'}</TitanTableCell>
                  <TitanTableCell>
                    <StatusPill variant={getStatusVariant(po.status)}>
                      {po.status}
                    </StatusPill>
                  </TitanTableCell>
                  <TitanTableCell>{po.issueDate?.substring(0, 10)}</TitanTableCell>
                  <TitanTableCell>{po.expectedDate?.substring(0, 10) || '-'}</TitanTableCell>
                  <TitanTableCell className="text-right font-medium">
                    {formatCurrency(po.grandTotal)}
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>
      </ContentLayout>

      <PurchaseOrderForm open={showCreate} onOpenChange={setShowCreate} />
    </Page>
  );
}
