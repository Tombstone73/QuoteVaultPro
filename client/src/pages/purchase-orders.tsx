import { useState } from "react";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Link, useLocation } from "wouter";
import { Search, Plus, ClipboardList } from "lucide-react";
import { Page, PageHeader, ContentLayout, FilterPanel, DataCard } from "@/components/titan";

export default function PurchaseOrdersPage() {
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
  const [, navigate] = useLocation();

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
        <FilterPanel title="Filter Purchase Orders" description="Search and filter by vendor or status">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Vendor</Label>
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
              <Label className="text-xs font-medium">Status</Label>
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
        </FilterPanel>

        <DataCard
          title="Purchase Orders"
          description={`${pos.length} purchase order${pos.length !== 1 ? 's' : ''} found`}
          noPadding
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && pos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="w-12 h-12 text-muted-foreground" />
                      <p>No purchase orders found</p>
                      <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Create first PO
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {pos.map((po) => (
                <TableRow
                  key={po.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/purchase-orders/${po.id}`)}
                >
                  <TableCell className="underline text-primary">{po.poNumber}</TableCell>
                  <TableCell>{po.vendor?.name || '-'}</TableCell>
                  <TableCell>{po.status}</TableCell>
                  <TableCell>{po.issueDate?.substring(0, 10)}</TableCell>
                  <TableCell>{po.expectedDate?.substring(0, 10) || '-'}</TableCell>
                  <TableCell>${parseFloat(po.grandTotal).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataCard>
      </ContentLayout>

      <PurchaseOrderForm open={showCreate} onOpenChange={setShowCreate} />
    </Page>
  );
}
