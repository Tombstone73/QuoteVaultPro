import { useState } from "react";
import { useVendors, useDeleteVendor, Vendor } from "@/hooks/useVendors";
import { VendorForm } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Search, Plus, Building2 } from "lucide-react";
import { Page, PageHeader, ContentLayout, FilterPanel, DataCard } from "@/components/titan";

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { data: vendors = [], isLoading } = useVendors({ search, isActive: undefined });
  const deleteMutation = useDeleteVendor();

  return (
    <Page>
      <PageHeader
        title="Vendors"
        subtitle="Manage your supplier relationships and contacts"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Vendor
          </Button>
        }
      />

      <ContentLayout>
        <FilterPanel title="Search Vendors" description="Find vendors by name">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 max-w-xs"
            />
          </div>
        </FilterPanel>

        <DataCard
          title="Vendors"
          description={`${vendors.length} vendor${vendors.length !== 1 ? 's' : ''} found`}
          noPadding
        >
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
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && vendors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Building2 className="w-12 h-12 text-muted-foreground" />
                      <p>No vendors found</p>
                      <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add first vendor
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {vendors.map((v) => (
                <TableRow key={v.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/vendors/${v.id}`} className="underline text-primary">
                      {v.name}
                    </Link>
                  </TableCell>
                  <TableCell>{v.email || '-'}</TableCell>
                  <TableCell>{v.phone || '-'}</TableCell>
                  <TableCell>{v.paymentTerms}</TableCell>
                  <TableCell>{v.defaultLeadTimeDays || '-'}</TableCell>
                  <TableCell>
                    {v.isActive ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/vendors/${v.id}`}>View</Link>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(v.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataCard>
      </ContentLayout>

      <VendorForm open={showCreate} onOpenChange={setShowCreate} />
    </Page>
  );
}
