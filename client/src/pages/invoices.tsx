import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { TitanCard } from "@/components/ui/TitanCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, FileText, DollarSign, Calendar } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useInvoices } from "@/hooks/useInvoices";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500",
  sent: "bg-blue-500",
  partially_paid: "bg-yellow-500",
  paid: "bg-green-500",
  overdue: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
};

export default function InvoicesListPage() {
  const { user } = useAuth();
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

  const badgeStyleForStatus = (status: string): React.CSSProperties => {
    switch (status) {
      case 'paid':
        return { backgroundColor: 'var(--badge-success-bg)', color: 'var(--badge-success-text)', border: '1px solid var(--badge-success-border)' };
      case 'overdue':
        return { backgroundColor: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', border: '1px solid var(--badge-danger-border)' };
      case 'partially_paid':
        return { backgroundColor: 'var(--badge-warning-bg)', color: 'var(--badge-warning-text)', border: '1px solid var(--badge-warning-border)' };
      case 'sent':
        return { backgroundColor: 'var(--badge-muted-bg)', color: 'var(--badge-muted-text)', border: '1px solid var(--badge-muted-border)' };
      case 'draft':
      default:
        return { backgroundColor: 'var(--badge-muted-bg)', color: 'var(--badge-muted-text)', border: '1px solid var(--badge-muted-border)' };
    }
  };

  return (
    <PageShell>
      <div className="space-y-6">
        {/* Header */}
        <TitanCard className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Invoices</h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Manage invoices and payments</p>
            </div>
            {isAdminOrOwner && (
              <Button asChild>
                <Link href="/orders">
                  <Plus className="mr-2 h-4 w-4" />
                  Create from Order
                </Link>
              </Button>
            )}
          </div>
        </TitanCard>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <TitanCard className="p-4">
            <div className="flex items-center justify-between pb-2">
              <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Total Outstanding</div>
              <DollarSign className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(
                filteredInvoices
                  .filter(inv => inv.status !== 'paid')
                  .reduce((sum, inv) => sum + Number(inv.balanceDue || inv.total), 0)
              )}
            </div>
          </TitanCard>
          <TitanCard className="p-4">
            <div className="flex items-center justify-between pb-2">
              <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Overdue</div>
              <FileText className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {filteredInvoices.filter(inv => inv.status === 'overdue').length}
            </div>
          </TitanCard>
          <TitanCard className="p-4">
            <div className="flex items-center justify-between pb-2">
              <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Paid This Month</div>
              <DollarSign className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(
                filteredInvoices
                  .filter(inv => inv.status === 'paid')
                  .reduce((sum, inv) => sum + Number(inv.total), 0)
              )}
            </div>
          </TitanCard>
          <TitanCard className="p-4">
            <div className="flex items-center justify-between pb-2">
              <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Total Invoices</div>
              <FileText className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{filteredInvoices.length}</div>
          </TitanCard>
        </div>

        {/* Filters */}
        <TitanCard className="p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <Input
                  placeholder="Search invoices..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
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
              </SelectContent>
            </Select>
          </div>
        </TitanCard>

        {/* Invoices Table */}
        <TitanCard className="p-0">
          {isLoading ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Loading invoices...</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No invoices found</div>
          ) : (
            <Table>
              <TableHeader style={{ backgroundColor: 'var(--table-header-bg)' }}>
                <TableRow style={{ color: 'var(--table-header-text)' }}>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow key={invoice.id}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--table-row-hover-bg'))}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    style={{ borderTop: '1px solid var(--table-border-color)' }}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/invoices/${invoice.id}`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>
                        #{invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell>
                      <Badge style={badgeStyleForStatus(invoice.status)}>
                        {statusLabels[invoice.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(invoice.total)}</TableCell>
                    <TableCell>{formatCurrency(invoice.amountPaid)}</TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(invoice.balanceDue || Number(invoice.total) - Number(invoice.amountPaid))}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/invoices/${invoice.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TitanCard>
      </div>
    </PageShell>
  );
}
