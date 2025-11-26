import { useState } from "react";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Link, useLocation } from "wouter";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <Button onClick={()=> setShowCreate(true)}>New PO</Button>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <Input placeholder="Search" value={search} onChange={e=> setSearch(e.target.value)} className="max-w-xs" />
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Vendor</label>
          <Select value={vendorId} onValueChange={v=> setVendorId(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Vendors"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Status</label>
          <Select value={status} onValueChange={v=> setStatus(v)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
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
      <div className="border rounded">
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
            {isLoading && <TableRow><TableCell colSpan={6}>Loading...</TableCell></TableRow>}
            {!isLoading && pos.length === 0 && <TableRow><TableCell colSpan={6}>No purchase orders found</TableCell></TableRow>}
            {pos.map(po => (
              <TableRow key={po.id} className="cursor-pointer" onClick={()=> navigate(`/purchase-orders/${po.id}`)}>
                <TableCell className="underline text-primary">{po.poNumber}</TableCell>
                <TableCell>{po.vendor?.name || '-'}</TableCell>
                <TableCell>{po.status}</TableCell>
                <TableCell>{po.issueDate?.substring(0,10)}</TableCell>
                <TableCell>{po.expectedDate?.substring(0,10) || '-'}</TableCell>
                <TableCell>${parseFloat(po.grandTotal).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PurchaseOrderForm open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
