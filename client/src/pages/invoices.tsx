import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-muted-foreground">Manage invoices and payments</p>
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

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(
                  filteredInvoices
                    .filter(inv => inv.status !== 'paid')
                    .reduce((sum, inv) => sum + Number(inv.balanceDue || inv.total), 0)
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overdue</CardTitle>
              <FileText className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {filteredInvoices.filter(inv => inv.status === 'overdue').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paid This Month</CardTitle>
              <DollarSign className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(
                  filteredInvoices
                    .filter(inv => inv.status === 'paid')
                    .reduce((sum, inv) => sum + Number(inv.total), 0)
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredInvoices.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          </CardContent>
        </Card>

        {/* Invoices Table */}
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading invoices...</div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No invoices found</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">
                        <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                          #{invoice.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[invoice.status]}>
                          {statusLabels[invoice.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(invoice.total)}</TableCell>
                      <TableCell>{formatCurrency(invoice.amountPaid)}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(invoice.balanceDue || Number(invoice.total) - Number(invoice.amountPaid))}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/invoices/${invoice.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
