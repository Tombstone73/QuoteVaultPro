import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVendors, useDeleteVendor, Vendor } from "@/hooks/useVendors";
import { VendorForm } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { Plus, Building2 } from "lucide-react";
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
} from "@/components/titan";

export default function VendorsPage() {
  const navigate = useNavigate();
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
        <DataCard title="Search Vendors" description="Find vendors by name">
          <TitanSearchInput
            placeholder="Search vendors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-w-xs"
          />
        </DataCard>

        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead>Name</TitanTableHead>
                <TitanTableHead>Email</TitanTableHead>
                <TitanTableHead>Phone</TitanTableHead>
                <TitanTableHead>Terms</TitanTableHead>
                <TitanTableHead>Lead Time</TitanTableHead>
                <TitanTableHead>Status</TitanTableHead>
                <TitanTableHead className="w-32"></TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={7} message="Loading vendors..." />}
              
              {!isLoading && vendors.length === 0 && (
                <TitanTableEmpty
                  colSpan={7}
                  icon={<Building2 className="w-12 h-12" />}
                  message="No vendors found"
                  action={
                    <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add first vendor
                    </Button>
                  }
                />
              )}
              
              {!isLoading && vendors.map((v) => (
                <TitanTableRow key={v.id} clickable onClick={() => navigate(ROUTES.vendors.detail(v.id))}>
                  <TitanTableCell className="font-medium">
                    <span className="text-titan-accent hover:underline">{v.name}</span>
                  </TitanTableCell>
                  <TitanTableCell>{v.email || '-'}</TitanTableCell>
                  <TitanTableCell>{v.phone || '-'}</TitanTableCell>
                  <TitanTableCell>{v.paymentTerms}</TitanTableCell>
                  <TitanTableCell>{v.defaultLeadTimeDays || '-'}</TitanTableCell>
                  <TitanTableCell>
                    <StatusPill variant={v.isActive ? "success" : "error"}>
                      {v.isActive ? "Active" : "Inactive"}
                    </StatusPill>
                  </TitanTableCell>
                  <TitanTableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={ROUTES.vendors.detail(v.id)}>View</Link>
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
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>
      </ContentLayout>

      <VendorForm open={showCreate} onOpenChange={setShowCreate} />
    </Page>
  );
}
