import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuotes } from "@/hooks/useQuotes";
import { useConvertQuote } from "@/hooks/useConvertQuote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, FileText, Search, RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import type { QuoteState, PortalQuoteListItem } from "@/types/portal";

const STATE_BADGE_VARIANT: Record<QuoteState, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  sent: "default",
  approved: "secondary",
  expired: "outline",
  rejected: "destructive",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function QuotesList() {
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError, error, refetch } = useQuotes();
  const convertQuote = useConvertQuote();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [approveTarget, setApproveTarget] = useState<PortalQuoteListItem | null>(null);

  const filtered = useMemo(() => {
    if (!quotes) return [];
    let result = quotes;

    if (stateFilter !== "all") {
      result = result.filter((q) => q.state === stateFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((q) => q.quoteNumber.toLowerCase().includes(s));
    }

    return result;
  }, [quotes, search, stateFilter]);

  const handleApprove = () => {
    if (!approveTarget) return;
    convertQuote.mutate(approveTarget.id, {
      onSettled: () => setApproveTarget(null),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Your Quotes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review quotes and approve them to create orders.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by quote #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="sent">Pending Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <p className="text-lg font-medium text-foreground">Unable to load quotes</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error instanceof Error ? error.message : "An unexpected error occurred."}
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <FileText className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-medium text-foreground">No quotes found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {quotes && quotes.length > 0
                ? "Try adjusting your search or filter."
                : "You don't have any quotes yet."}
            </p>
          </div>
        </div>
      )}

      {/* Quotes Table */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((quote) => (
                <QuoteRow
                  key={quote.id}
                  quote={quote}
                  onApprove={() => setApproveTarget(quote)}
                  onClick={() => navigate(`/quotes/${quote.id}`)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Approval Confirmation Dialog */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Quote</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve{" "}
              <span className="font-medium text-foreground">
                {approveTarget?.quoteNumber}
              </span>{" "}
              for{" "}
              <span className="font-medium text-foreground">
                {approveTarget ? formatCurrency(approveTarget.total) : ""}
              </span>
              ? This will create a new order from this quote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertQuote.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={convertQuote.isPending}>
              {convertQuote.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve Quote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function QuoteRow({
  quote,
  onApprove,
  onClick,
}: {
  quote: PortalQuoteListItem;
  onApprove: () => void;
  onClick: () => void;
}) {
  const canApprove = quote.state === "sent" && !isExpired(quote.expiresAt);

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onClick}>
      <TableCell className="font-medium">{quote.quoteNumber}</TableCell>
      <TableCell>
        <Badge variant={STATE_BADGE_VARIANT[quote.state]}>{quote.stateLabel}</Badge>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">
        {quote.expiresAt ? (
          <span className={isExpired(quote.expiresAt) ? "text-destructive" : ""}>
            {formatDate(quote.expiresAt)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(quote.total)}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">
        {formatDate(quote.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        {canApprove ? (
          <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); onApprove(); }}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
