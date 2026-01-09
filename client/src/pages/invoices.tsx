import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, FileText, DollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useInvoices } from "@/hooks/useInvoices";
import { format } from "date-fns";
import { ROUTES } from "@/config/routes";
import {
  Page,
  PageHeader,
  ContentLayout,
  DataCard,
  TitanStatCard,
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

const statusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  billed: "Billed",
  void: "Void",
};

export default function InvoicesListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: invoices, isLoading } = useInvoices({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return "-";
    }
  };

  const filteredInvoices = invoices?.filter((inv) => {
    const matchesSearch = search === "" || 
      inv.invoiceNumber.toString().includes(search) ||
      inv.id.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  }) || [];

  // Calculate stats
  const totalOutstanding = filteredInvoices
    .filter(inv => inv.status !== 'paid')
    .reduce((sum, inv) => sum + Number(inv.balanceDue || inv.total), 0);
  
  const overdueCount = filteredInvoices.filter(inv => inv.status === 'overdue').length;
  
  const paidThisMonth = filteredInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.total), 0);

  return (
    <Page maxWidth="full">
      <PageHeader
        title="Invoices"
        subtitle="Manage invoices and payments"
        actions={
          isAdminOrOwner && (
            <Button asChild>
              <Link to={ROUTES.orders.list}>
                <Plus className="mr-2 h-4 w-4" />
                Create from Order
              </Link>
            </Button>
          )
        }
      />

      <ContentLayout>
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <TitanStatCard
            label="Total Outstanding"
            value={formatCurrency(totalOutstanding)}
            icon={DollarSign}
          />
          <TitanStatCard
            label="Overdue"
            value={overdueCount}
            icon={FileText}
          />
          <TitanStatCard
            label="Paid This Month"
            value={formatCurrency(paidThisMonth)}
            icon={DollarSign}
          />
          <TitanStatCard
            label="Total Invoices"
            value={filteredInvoices.length}
            icon={FileText}
          />
        </div>

        {/* Filters */}
        <DataCard>
          <div className="flex gap-4">
            <TitanSearchInput
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              containerClassName="flex-1"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="billed">Billed</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DataCard>

        {/* Invoices Table */}
        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead>Invoice #</TitanTableHead>
                <TitanTableHead>Issue Date</TitanTableHead>
                <TitanTableHead>Due Date</TitanTableHead>
                <TitanTableHead>Status</TitanTableHead>
                <TitanTableHead className="text-right">Total</TitanTableHead>
                <TitanTableHead className="text-right">Paid</TitanTableHead>
                <TitanTableHead className="text-right">Balance</TitanTableHead>
                <TitanTableHead>Actions</TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={8} message="Loading invoices..." />}
              
              {!isLoading && filteredInvoices.length === 0 && (
                <TitanTableEmpty
                  colSpan={8}
                  icon={<FileText className="w-12 h-12" />}
                  message="No invoices found"
                  action={
                    isAdminOrOwner && (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={ROUTES.orders.list}>
                          <Plus className="w-4 h-4 mr-2" />
                          Create from Order
                        </Link>
                      </Button>
                    )
                  }
                />
              )}
              
              {!isLoading && filteredInvoices.map((invoice) => (
                <TitanTableRow
                  key={invoice.id}
                  clickable
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                >
                  <TitanTableCell className="font-medium">
                    <span className="text-titan-accent hover:underline">
                      #{invoice.invoiceNumber}
                    </span>
                  </TitanTableCell>
                  <TitanTableCell>{formatDate(invoice.issueDate)}</TitanTableCell>
                  <TitanTableCell>{formatDate(invoice.dueDate)}</TitanTableCell>
                  <TitanTableCell>
                    <StatusPill variant={getStatusVariant(invoice.status)}>
                      {statusLabels[invoice.status]}
                    </StatusPill>
                  </TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.total)}</TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.amountPaid)}</TitanTableCell>
                  <TitanTableCell className="text-right font-semibold">
                    {formatCurrency(invoice.balanceDue || Number(invoice.total) - Number(invoice.amountPaid))}
                  </TitanTableCell>
                  <TitanTableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/invoices/${invoice.id}`}>View</Link>
                    </Button>
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>
      </ContentLayout>
    </Page>
  );
}
