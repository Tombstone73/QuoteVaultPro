import { useState } from "react";
import { useRoute } from "wouter";
import { useVendor } from "@/hooks/useVendors";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { VendorForm } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function VendorDetailPage() {
  const [match, params] = useRoute("/vendors/:id");
  const vendorId = params?.id;
  const { data: vendor } = useVendor(vendorId);
  const { data: pos = [] } = usePurchaseOrders({ vendorId });
  const [showEdit, setShowEdit] = useState(false);

  if (!vendor) return <div>Loading vendor...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendor: {vendor.name}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=> setShowEdit(true)}>Edit</Button>
          <Button asChild><Link href={`/purchase-orders/new?vendorId=${vendor.id}`}>New PO</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Supplier info and terms.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="font-medium">Email:</span> {vendor.email || '-'} </div>
          <div><span className="font-medium">Phone:</span> {vendor.phone || '-'} </div>
          <div><span className="font-medium">Website:</span> {vendor.website ? <a href={vendor.website} target="_blank" className="underline text-primary">{vendor.website}</a> : '-'} </div>
          <div><span className="font-medium">Payment Terms:</span> {vendor.paymentTerms} </div>
          <div><span className="font-medium">Lead Time:</span> {vendor.defaultLeadTimeDays || '-'} days</div>
          <div><span className="font-medium">Status:</span> {vendor.isActive ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Active</Badge> : <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Inactive</Badge>}</div>
          <div className="col-span-2"><span className="font-medium">Notes:</span> {vendor.notes || '-'} </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
          <CardDescription>Recent orders placed with this vendor.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pos.length === 0 && <TableRow><TableCell colSpan={5}>No purchase orders</TableCell></TableRow>}
              {pos.map(po => (
                <TableRow key={po.id}>
                  <TableCell><Link href={`/purchase-orders/${po.id}`} className="underline text-primary">{po.poNumber}</Link></TableCell>
                  <TableCell>{po.status}</TableCell>
                  <TableCell>{po.issueDate?.substring(0,10)}</TableCell>
                  <TableCell>{po.expectedDate?.substring(0,10) || '-'}</TableCell>
                  <TableCell>${parseFloat(po.grandTotal).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <VendorForm open={showEdit} onOpenChange={setShowEdit} vendor={vendor} />
    </div>
  );
}
