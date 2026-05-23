/**
 * QBInvoiceInspectorPage.tsx
 *
 * Developer-only read-only tool for inspecting a single QuickBooks invoice payload.
 * Used to audit QB field shapes and verify transformed mappings before bulk imports.
 *
 * Route: /admin/developer/qb-invoice-inspector
 * Access: isPlatformDeveloper = true required (enforced at middleware + UI level)
 *
 * STRICTLY READ-ONLY — does not write to DB, import data, or trigger sync jobs.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/queryClient";

// ─── Local types (mirrors quickbooksService exported types) ──────────────────

interface QBAddress {
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface QBInvoiceLineItemDetail {
  lineNum: number | null;
  description: string | null;
  amount: number | null;
  qty: number | null;
  unitPrice: number | null;
  itemRef: { value: string; name: string } | null;
  serviceDate: string | null;
}

interface QBInvoiceDetail {
  qbId: string;
  invoiceNumber: string;
  poNumber: string | null;
  poSource: string | null;
  status: string;
  customer: {
    id: string;
    name: string;
    email: string | null;
    companyName: string | null;
  } | null;
  billingEmail: string | null;
  billAddress: QBAddress | null;
  shipAddress: QBAddress | null;
  customerMemo: string | null;
  privateNote: string | null;
  emailStatus: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  balanceDue: number | null;
  lineItems: QBInvoiceLineItemDetail[];
  customFields: Array<{ name: string; value: string; stringValue?: string }>;
}

interface InspectorResponse {
  success: boolean;
  invoiceNumber: string;
  data: QBInvoiceDetail;
  raw: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatAddress(addr: QBAddress | null | undefined): string {
  if (!addr) return "—";
  const parts = [addr.line1, addr.city, addr.state, addr.zip, addr.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function nullDisplay(value: string | null | undefined): string {
  return value ?? "—";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ label, getValue }: { label: string; getValue: () => string }) {
  const { toast } = useToast();

  function handleCopy() {
    const value = getValue();
    navigator.clipboard.writeText(value).then(() => {
      toast({ title: `${label} copied to clipboard` });
    }).catch(() => {
      toast({ title: "Copy failed", description: "Could not access clipboard.", variant: "destructive" });
    });
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-titan-text-muted hover:text-titan-text-primary" onClick={handleCopy}>
      <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
      {label}
    </Button>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-titan-border bg-titan-bg-card-elevated">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-titan-sm text-titan-text-primary">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {children}
      </CardContent>
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-1">
      <span className="text-titan-xs text-titan-text-muted font-medium truncate">{label}</span>
      <span className="text-titan-xs text-titan-text-primary break-all">
        {value || "—"}
      </span>
    </div>
  );
}

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const json = JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10">
        <CopyButton label={`Copy ${label}`} getValue={() => json} />
      </div>
      <pre className="text-[11px] leading-relaxed font-mono bg-black/40 text-green-300 rounded-md p-4 overflow-auto max-h-[500px] border border-titan-border-subtle whitespace-pre-wrap">
        {json}
      </pre>
    </div>
  );
}

function CollapsibleSection({ title, badge, children, defaultOpen = false }: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full py-2 text-left hover:opacity-80 transition-opacity">
          {open ? (
            <ChevronDown className="h-4 w-4 text-titan-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-titan-text-muted shrink-0" />
          )}
          <span className="text-titan-sm font-semibold text-titan-text-primary">{title}</span>
          {badge && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{badge}</Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1 pb-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Main results display ─────────────────────────────────────────────────────

function InvoiceResults({ data: invoice, raw }: { data: QBInvoiceDetail; raw: unknown }) {
  return (
    <div className="space-y-4">
      {/* Invoice Header */}
      <SectionCard title="Invoice Header">
        <div className="divide-y divide-titan-border-subtle">
          <FieldRow label="QB ID" value={nullDisplay(invoice.qbId)} />
          <FieldRow label="Invoice #" value={nullDisplay(invoice.invoiceNumber)} />
          <FieldRow label="Status" value={
            <Badge variant="outline" className="text-[10px]">{nullDisplay(invoice.status)}</Badge>
          } />
          <FieldRow label="Email Status" value={nullDisplay(invoice.emailStatus)} />
        </div>
      </SectionCard>

      {/* Customer Info */}
      <SectionCard title="Customer">
        {invoice.customer ? (
          <div className="divide-y divide-titan-border-subtle">
            <FieldRow label="QB Customer ID" value={nullDisplay(invoice.customer.id)} />
            <FieldRow label="Display Name" value={nullDisplay(invoice.customer.name)} />
            <FieldRow label="Company Name" value={nullDisplay(invoice.customer.companyName)} />
            <FieldRow label="Email" value={nullDisplay(invoice.customer.email)} />
            <FieldRow label="Billing Email" value={nullDisplay(invoice.billingEmail)} />
            <FieldRow label="Bill Address" value={formatAddress(invoice.billAddress)} />
            <FieldRow label="Ship Address" value={formatAddress(invoice.shipAddress)} />
          </div>
        ) : (
          <p className="text-titan-xs text-titan-text-muted italic">No customer data on invoice</p>
        )}
      </SectionCard>

      {/* PO Number */}
      <SectionCard title="PO Number">
        <div className="divide-y divide-titan-border-subtle">
          <FieldRow label="PO Number" value={nullDisplay(invoice.poNumber)} />
          <FieldRow label="PO Source field" value={
            <span>
              {nullDisplay(invoice.poSource)}
              {invoice.poSource && (
                <span className="ml-2 text-[10px] text-titan-text-muted">
                  (QB field where PO was found)
                </span>
              )}
            </span>
          } />
        </div>
      </SectionCard>

      {/* Memo / Notes */}
      <SectionCard title="Memo / Notes">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] text-titan-text-muted uppercase tracking-wide mb-1 font-medium">
              Customer Memo (visible on invoice)
            </p>
            <pre className="text-titan-xs text-titan-text-primary whitespace-pre-wrap bg-titan-bg-surface rounded-sm p-2 border border-titan-border-subtle min-h-[2rem]">
              {invoice.customerMemo ?? "—"}
            </pre>
          </div>
          <div>
            <p className="text-[10px] text-titan-text-muted uppercase tracking-wide mb-1 font-medium">
              Private Note (internal only)
            </p>
            <pre className="text-titan-xs text-titan-text-primary whitespace-pre-wrap bg-titan-bg-surface rounded-sm p-2 border border-titan-border-subtle min-h-[2rem]">
              {invoice.privateNote ?? "—"}
            </pre>
          </div>
        </div>
      </SectionCard>

      {/* Totals */}
      <SectionCard title="Totals">
        <div className="divide-y divide-titan-border-subtle">
          <FieldRow label="Subtotal" value={formatCurrency(invoice.subtotal)} />
          <FieldRow label="Tax" value={formatCurrency(invoice.tax)} />
          <FieldRow label="Total" value={
            <span className="font-semibold">{formatCurrency(invoice.total)}</span>
          } />
          <FieldRow label="Balance Due" value={
            <span className={invoice.balanceDue && invoice.balanceDue > 0 ? "text-amber-500 font-medium" : ""}>
              {formatCurrency(invoice.balanceDue)}
            </span>
          } />
        </div>
      </SectionCard>

      {/* Line Items */}
      <SectionCard title={`Line Items (${invoice.lineItems.length})`}>
        {invoice.lineItems.length === 0 ? (
          <p className="text-titan-xs text-titan-text-muted italic">No line items</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px] text-[10px]">#</TableHead>
                  <TableHead className="text-[10px]">Description</TableHead>
                  <TableHead className="text-[10px]">Item Ref</TableHead>
                  <TableHead className="text-right text-[10px]">Qty</TableHead>
                  <TableHead className="text-right text-[10px]">Unit Price</TableHead>
                  <TableHead className="text-right text-[10px]">Amount</TableHead>
                  <TableHead className="text-[10px]">Service Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lineItems.map((li, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-[11px] text-titan-text-muted">{li.lineNum ?? idx + 1}</TableCell>
                    <TableCell className="text-[11px] max-w-[220px] truncate" title={li.description ?? undefined}>
                      {li.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {li.itemRef ? (
                        <span>
                          <span className="text-titan-text-muted">[{li.itemRef.value}]</span>{" "}
                          {li.itemRef.name}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-[11px]">{li.qty ?? "—"}</TableCell>
                    <TableCell className="text-right text-[11px]">{formatCurrency(li.unitPrice)}</TableCell>
                    <TableCell className="text-right text-[11px] font-medium">{formatCurrency(li.amount)}</TableCell>
                    <TableCell className="text-[11px] text-titan-text-muted">{li.serviceDate ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Custom Fields */}
      <SectionCard title={`Custom Fields (${invoice.customFields?.length ?? 0})`}>
        {!invoice.customFields || invoice.customFields.length === 0 ? (
          <p className="text-titan-xs text-titan-text-muted italic">No custom fields on this invoice</p>
        ) : (
          <div className="divide-y divide-titan-border-subtle">
            {invoice.customFields.map((cf, idx) => (
              <FieldRow key={idx} label={cf.name} value={cf.stringValue ?? cf.value ?? "—"} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Transformed JSON payload */}
      <Card className="border-titan-border bg-titan-bg-card-elevated">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-titan-sm text-titan-text-primary">Transformed Payload (Printers Hero mapping)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <JsonBlock value={invoice} label="Transformed JSON" />
        </CardContent>
      </Card>

      {/* Raw QB payload — collapsible */}
      <Card className="border-titan-border bg-titan-bg-card-elevated">
        <CardHeader className="py-3 px-4">
          <CollapsibleSection title="Raw QuickBooks Payload" badge="verbose">
            <JsonBlock value={raw} label="Raw QB JSON" />
          </CollapsibleSection>
        </CardHeader>
      </Card>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function InspectorSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="border-titan-border bg-titan-bg-card-elevated">
          <CardHeader className="py-3 px-4">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QBInvoiceInspectorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [pendingNumber, setPendingNumber] = useState<string | null>(null);

  const { data, isLoading, error, isError } = useQuery<InspectorResponse>({
    queryKey: ["/api/integrations/quickbooks/debug/invoice", pendingNumber],
    queryFn: async () => {
      const res = await apiFetch(`/api/integrations/quickbooks/debug/invoice/${encodeURIComponent(pendingNumber!)}`);
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          message = body.error ?? body.message ?? message;
        } catch { /* raw text already enough */ }
        throw new Error(message);
      }
      return res.json();
    },
    enabled: !!pendingNumber,
    staleTime: 0,
    retry: false,
  });

  const handleFetch = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      toast({ title: "Enter an invoice number first", variant: "destructive" });
      return;
    }
    setPendingNumber(trimmed);
  }, [inputValue, toast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleFetch();
  }, [handleFetch]);

  // Developer-only gate (middleware also enforces this at API level)
  if (user && !user.isPlatformDeveloper) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <ShieldAlert className="h-12 w-12 text-destructive/60" />
        <h2 className="text-titan-lg font-semibold text-titan-text-primary">Access Denied</h2>
        <p className="text-titan-sm text-titan-text-secondary">
          This tool requires platform developer access (
          <code className="text-xs bg-titan-bg-surface rounded px-1 py-0.5">is_platform_developer = true</code>
          ).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-titan-lg font-semibold text-titan-text-primary">
              QB Invoice Inspector
            </h2>
            <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500/50 text-amber-500 bg-amber-500/5">
              DEV ONLY
            </Badge>
          </div>
          <p className="text-titan-sm text-titan-text-secondary">
            Fetch and inspect a single QuickBooks invoice payload to verify transformed field mappings.
            Read-only — no data is imported or modified.
          </p>
        </div>
      </div>

      {/* Fetch control */}
      <Card className="border-titan-border bg-titan-bg-card-elevated">
        <CardContent className="p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1 max-w-xs space-y-1.5">
              <Label htmlFor="invoice-number-input" className="text-titan-xs font-medium text-titan-text-secondary">
                QuickBooks Invoice Number (DocNumber)
              </Label>
              <Input
                id="invoice-number-input"
                placeholder="e.g. 1023"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                className="font-mono"
              />
            </div>
            <Button
              onClick={handleFetch}
              disabled={isLoading || !inputValue.trim()}
              className="shrink-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Fetching…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Fetch Invoice
                </>
              )}
            </Button>
          </div>
          {pendingNumber && !isLoading && !isError && (
            <p className="mt-2 text-[11px] text-titan-text-muted">
              Showing result for invoice <span className="font-mono font-medium">{pendingNumber}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Error state */}
      {isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-titan-sm font-medium text-destructive">Failed to fetch invoice</p>
              <p className="text-titan-xs text-titan-text-secondary mt-0.5">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <p className="text-[11px] text-titan-text-muted mt-1">
                Ensure the invoice number exactly matches the QB DocNumber and that QuickBooks OAuth is connected.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {isLoading && <InspectorSkeleton />}

      {/* Results */}
      {!isLoading && data?.success && data.data && (
        <InvoiceResults data={data.data} raw={data.raw} />
      )}
    </div>
  );
}
