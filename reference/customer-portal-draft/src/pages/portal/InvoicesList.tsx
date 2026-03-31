import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useInvoices } from "@/hooks/useInvoices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Receipt, Search, RefreshCw, CreditCard } from "lucide-react";
import type { InvoiceStatus, PortalInvoiceListItem } from "@/types/portal";

const STATUS_BADGE_VARIANT: Record<InvoiceStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  billed: "destructive",
  paid: "secondary",
  void: "outline",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function InvoicesList() {
  const { data: invoices, isLoading, isError, error, refetch } = useInvoices();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (!invoices) return [];
    let result = invoices;
    if (statusFilter !== "all") result = result.filter((i) => i.status === statusFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((i) => i.invoiceNumber.toLowerCase().includes(s));
    }
    return result;
  }, [invoices, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Invoices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your invoices and make payments.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by invoice #..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="billed">Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <p className="text-lg font-medium text-foreground">Unable to load invoices</p>
            <p className="text-sm text-muted-foreground mt-1">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />Try Again
          </Button>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <Receipt className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-medium text-foreground">No invoices found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {invoices && invoices.length > 0 ? "Try adjusting your search or filter." : "You don't have any invoices yet."}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Due Date</TableHead>
                <TableHead className="text-right">Amount Due</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Total</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} onView={() => navigate(`/invoices/${inv.id}`)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ invoice, onView }: { invoice: PortalInvoiceListItem; onView: () => void }) {
  const isPayable = invoice.status === "billed";

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onView}>
      <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[invoice.status]}>{invoice.statusLabel}</Badge>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">{formatDate(invoice.dueDate)}</TableCell>
      <TableCell className="text-right font-medium">
        {invoice.amountDue > 0 ? formatCurrency(invoice.amountDue) : "—"}
      </TableCell>
      <TableCell className="text-right hidden lg:table-cell text-muted-foreground">{formatCurrency(invoice.total)}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
      <TableCell className="text-right">
        {isPayable ? (
          <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); onView(); }}>
            <CreditCard className="mr-1.5 h-3.5 w-3.5" />Pay Now
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onView(); }}>View</Button>
        )}
      </TableCell>
    </TableRow>
  );
}
