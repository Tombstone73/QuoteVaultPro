import { useState } from "react";
import { useVendors, useDeleteVendor, Vendor } from "@/hooks/useVendors";
import { VendorForm } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function VendorsPage() {
  console.log("DEBUG: VendorsPage rendered");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { data: vendors = [], isLoading } = useVendors({ search, isActive: undefined });
  const deleteMutation = useDeleteVendor();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendors</h1>
        <Button onClick={()=> setShowCreate(true)}>New Vendor</Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Search vendors" value={search} onChange={e=> setSearch(e.target.value)} className="max-w-xs" />
      </div>
      <div className="border rounded">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead>Lead Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7}>Loading...</TableCell></TableRow>}
            {!isLoading && vendors.length === 0 && <TableRow><TableCell colSpan={7}>No vendors found</TableCell></TableRow>}
            {vendors.map(v => (
              <TableRow key={v.id}>
                <TableCell><Link href={`/vendors/${v.id}`} className="underline text-primary">{v.name}</Link></TableCell>
                <TableCell>{v.email || '-'}</TableCell>
                <TableCell>{v.phone || '-'}</TableCell>
                <TableCell>{v.paymentTerms}</TableCell>
                <TableCell>{v.defaultLeadTimeDays || '-'}</TableCell>
                <TableCell>{v.isActive ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Active</Badge> : <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Inactive</Badge>}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild><Link href={`/vendors/${v.id}`}>View</Link></Button>
                    <Button variant="destructive" size="sm" disabled={deleteMutation.isPending} onClick={()=> deleteMutation.mutate(v.id)}>Delete</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <VendorForm open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
