/**
 * QBCustomerInspectorPage.tsx
 *
 * Developer-only read-only tool for inspecting a single QuickBooks customer payload.
 * Shows raw QB data, mapped TitanOS fields (with field source), unmapped QB fields,
 * and contact creation warnings.
 *
 * Route: /admin/developer/qb-customer-inspector
 * Access: isPlatformDeveloper = true required (enforced at middleware + UI level)
 *
 * STRICTLY READ-ONLY — does not write to DB, import data, or trigger sync jobs.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Search,
  ShieldAlert,
  TriangleAlert,
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

interface QBCustomerMappedField {
  titanField: string;
  value: string | null;
  source: string | null;
}

interface QBCustomerUnmappedField {
  qbField: string;
  value: unknown;
  reason: string;
}

interface QBCustomerInspectionResult {
  qbCustomerId: string;
  qbDisplayName: string;
  mapped: QBCustomerMappedField[];
  unmapped: QBCustomerUnmappedField[];
  warnings: string[];
  contactMapped: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    willBeCreated: boolean;
    skipReason: string | null;
  };
}

interface CustomerInspectorResponse {
  success: boolean;
  customerId: string;
  data: QBCustomerInspectionResult;
  raw: unknown;
}

interface QBCustomerSearchMatch {
  qbCustomerId: string;
  qbDisplayName: string;
  qbCompanyName: string | null;
  qbFullyQualifiedName: string | null;
  email: string | null;
  active: boolean | null;
}

interface QBCustomerSearchResponse {
  success: boolean;
  query: string;
  count: number;
  data: QBCustomerSearchMatch[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nullDisplay(value: string | null | undefined): string {
  return value ?? "—";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ label, getValue }: { label: string; getValue: () => string }) {
  const { toast } = useToast();
  function handleCopy() {
    navigator.clipboard.writeText(getValue()).then(() => {
      toast({ title: `${label} copied to clipboard` });
    }).catch(() => {
      toast({ title: "Copy failed", variant: "destructive" });
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

function FieldRow({ label, value, dim }: { label: string; value: string | React.ReactNode; dim?: boolean }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-2 py-1">
      <span className="text-titan-xs text-titan-text-muted font-medium truncate">{label}</span>
      <span className={`text-titan-xs break-all ${dim ? "text-titan-text-muted italic" : "text-titan-text-primary"}`}>
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
          {open ? <ChevronDown className="h-4 w-4 text-titan-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-titan-text-muted shrink-0" />}
          <span className="text-titan-sm font-semibold text-titan-text-primary">{title}</span>
          {badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{badge}</Badge>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Results display ──────────────────────────────────────────────────────────

function CustomerResults({ data: inspection, raw }: { data: QBCustomerInspectionResult; raw: unknown }) {
  const missingPersonName = inspection.warnings.some((warning) => warning.includes("missing_person_name"));

  return (
    <div className="space-y-4">
      {/* Header */}
      <SectionCard title="QB Customer">
        <div className="divide-y divide-titan-border-subtle">
          <FieldRow label="QB Customer ID" value={inspection.qbCustomerId} />
          <FieldRow label="QB Display Name" value={inspection.qbDisplayName || "—"} />
        </div>
      </SectionCard>

      {/* Warnings */}
      {inspection.warnings.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-titan-sm font-medium text-amber-500">Warnings ({inspection.warnings.length})</p>
                {inspection.warnings.map((w, i) => (
                  <p key={i} className="text-titan-xs text-titan-text-secondary font-mono">{w}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation results */}
      <SectionCard title="Validation Results">
        {inspection.warnings.length === 0 ? (
          <p className="text-titan-xs text-titan-text-muted">No validation warnings detected.</p>
        ) : (
          <div className="space-y-2">
            {inspection.warnings.map((warning, index) => (
              <div key={index} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <p className="text-titan-xs font-mono text-amber-500">{warning}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Mapped fields */}
      <SectionCard title={`Mapped Printers Hero Fields (${inspection.mapped.length})`}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">Printers Hero Field</TableHead>
                <TableHead className="text-[10px]">Value</TableHead>
                <TableHead className="text-[10px]">QB Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspection.mapped.map((field, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-[11px] font-mono text-titan-text-muted">{field.titanField}</TableCell>
                  <TableCell className="text-[11px] max-w-[280px] break-all">
                    {field.value ?? <span className="text-titan-text-muted italic">null</span>}
                  </TableCell>
                  <TableCell className="text-[11px] text-titan-text-muted">
                    {field.source ? (
                      <Badge variant="outline" className="text-[10px] font-mono">{field.source}</Badge>
                    ) : (
                      <span className="italic">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      {/* Contact mapping */}
      <SectionCard title="Contact Creation Analysis">
        <div className="divide-y divide-titan-border-subtle mb-3">
          <FieldRow label="First Name" value={nullDisplay(inspection.contactMapped.firstName)} />
          <FieldRow label="Last Name" value={nullDisplay(inspection.contactMapped.lastName)} />
          <FieldRow label="Email" value={nullDisplay(inspection.contactMapped.email)} />
          <FieldRow label="Phone" value={nullDisplay(inspection.contactMapped.phone)} />
          <FieldRow label="Mobile" value={nullDisplay(inspection.contactMapped.mobile)} />
          <FieldRow
            label="Will be created"
            value={
              <Badge variant={inspection.contactMapped.willBeCreated ? "default" : "secondary"} className="text-[10px]">
                {inspection.contactMapped.willBeCreated ? "Yes" : "No"}
              </Badge>
            }
          />
          {inspection.contactMapped.skipReason && (
            <FieldRow label="Skip reason" value={inspection.contactMapped.skipReason} dim />
          )}
          {missingPersonName && (
            <FieldRow label="missing_person_name fields" value="GivenName, FamilyName" dim />
          )}
        </div>
      </SectionCard>

      {/* Unmapped QB fields */}
      <SectionCard title={`Unmapped QB Fields (${inspection.unmapped.length})`}>
        {inspection.unmapped.length === 0 ? (
          <p className="text-titan-xs text-titan-text-muted italic">No unmapped fields found</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">QB Field</TableHead>
                  <TableHead className="text-[10px]">Value</TableHead>
                  <TableHead className="text-[10px]">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspection.unmapped.map((field, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-[11px] font-mono">{field.qbField}</TableCell>
                    <TableCell className="text-[11px] max-w-[220px] truncate text-titan-text-muted" title={JSON.stringify(field.value)}>
                      {JSON.stringify(field.value)}
                    </TableCell>
                    <TableCell className="text-[11px] text-titan-text-muted italic">{field.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Mapped JSON */}
      <Card className="border-titan-border bg-titan-bg-card-elevated">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-titan-sm text-titan-text-primary">Inspection Payload (Printers Hero mapping)</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <JsonBlock value={inspection} label="Inspection JSON" />
        </CardContent>
      </Card>

      {/* Raw QB payload */}
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
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="border-titan-border bg-titan-bg-card-elevated">
          <CardHeader className="py-3 px-4"><Skeleton className="h-4 w-32" /></CardHeader>
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

export default function QBCustomerInspectorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const initialSearchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialCustomerId = initialSearchParams.get("customerId") ?? initialSearchParams.get("id") ?? "";
  const initialQuery = initialSearchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(initialCustomerId || initialQuery);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  useEffect(() => {
    if (initialCustomerId) {
      setPendingId(initialCustomerId.trim());
    } else if (initialQuery) {
      setPendingSearch(initialQuery.trim());
    }
  }, [initialCustomerId, initialQuery]);

  const { data, isLoading, error, isError } = useQuery<CustomerInspectorResponse>({
    queryKey: ["/api/integrations/quickbooks/debug/customer", pendingId],
    queryFn: async () => {
      const res = await apiFetch(`/api/integrations/quickbooks/debug/customer/${encodeURIComponent(pendingId!)}`);
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          message = body.error ?? body.message ?? message;
        } catch { /* raw status is enough */ }
        throw new Error(message);
      }
      return res.json();
    },
    enabled: !!pendingId,
    staleTime: 0,
    retry: false,
  });

  const {
    data: searchData,
    isLoading: isSearching,
    error: searchError,
    isError: isSearchError,
  } = useQuery<QBCustomerSearchResponse>({
    queryKey: ["/api/integrations/quickbooks/debug/customer-search", pendingSearch],
    queryFn: async () => {
      const res = await apiFetch(`/api/integrations/quickbooks/debug/customer-search?q=${encodeURIComponent(pendingSearch!)}`);
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          message = body.error ?? body.message ?? message;
        } catch { /* raw status is enough */ }
        throw new Error(message);
      }
      return res.json();
    },
    enabled: !!pendingSearch,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    const matches = searchData?.data ?? [];
    if (!pendingSearch || isSearching || matches.length !== 1) return;
    setPendingId(matches[0].qbCustomerId);
    setPendingSearch(null);
  }, [isSearching, pendingSearch, searchData]);

  const handleFetch = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      toast({ title: "Enter a QB Customer ID, company name, or display name first", variant: "destructive" });
      return;
    }
    if (/^\d+$/.test(trimmed)) {
      setPendingId(trimmed);
      setPendingSearch(null);
      return;
    }
    setPendingId(null);
    setPendingSearch(trimmed);
  }, [inputValue, toast]);

  const handlePickMatch = useCallback((match: QBCustomerSearchMatch) => {
    setInputValue(match.qbCustomerId);
    setPendingId(match.qbCustomerId);
    setPendingSearch(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleFetch();
  }, [handleFetch]);

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
            <h2 className="text-titan-lg font-semibold text-titan-text-primary">QB Customer Inspector</h2>
            <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500/50 text-amber-500 bg-amber-500/5">
              DEV ONLY
            </Badge>
          </div>
          <p className="text-titan-sm text-titan-text-secondary">
            Fetch and inspect a single QuickBooks customer payload - mapped Printers Hero fields, unmapped QB fields,
            and contact creation analysis. Read-only — no data is imported or modified.
          </p>
        </div>
      </div>

      {/* Fetch control */}
      <Card className="border-titan-border bg-titan-bg-card-elevated">
        <CardContent className="p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1 max-w-xs space-y-1.5">
              <Label htmlFor="customer-id-input" className="text-titan-xs font-medium text-titan-text-secondary">
                QuickBooks Customer ID, Company Name, or Display Name
              </Label>
              <Input
                id="customer-id-input"
                placeholder="e.g. 59, Acme Signs, or Acme Display Name"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || isSearching}
                className="font-mono"
              />
            </div>
            <Button onClick={handleFetch} disabled={isLoading || isSearching || !inputValue.trim()} className="shrink-0">
              {isLoading || isSearching ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Searching...</>
              ) : (
                <><Search className="h-4 w-4 mr-2" />Inspect Customer</>
              )}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-titan-text-muted">
            Numeric input preserves direct lookup by QB Id. Name searches check QuickBooks DisplayName, CompanyName,
            and FullyQualifiedName before opening the inspector.
          </p>
          {pendingId && !isLoading && !isError && (
            <p className="mt-1 text-[11px] text-titan-text-muted">
              Showing result for customer <span className="font-mono font-medium">{pendingId}</span>
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
              <p className="text-titan-sm font-medium text-destructive">Failed to fetch customer</p>
              <p className="text-titan-xs text-titan-text-secondary mt-0.5">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <p className="text-[11px] text-titan-text-muted mt-1">
                Ensure the ID is a valid QB Customer Id and that QuickBooks OAuth is connected.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search error state */}
      {isSearchError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-titan-sm font-medium text-destructive">Failed to search customers</p>
              <p className="text-titan-xs text-titan-text-secondary mt-0.5">
                {searchError instanceof Error ? searchError.message : "Unknown error"}
              </p>
              <p className="text-[11px] text-titan-text-muted mt-1">
                Ensure QuickBooks OAuth is connected and try a QB Id, Company Name, or Display Name.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search picker */}
      {!isSearching && pendingSearch && searchData?.success && (searchData.data?.length ?? 0) !== 1 && (
        <SectionCard title={`Search Results (${searchData.data?.length ?? 0})`}>
          {(searchData.data?.length ?? 0) === 0 ? (
            <p className="text-titan-xs text-titan-text-muted">
              No QuickBooks customers matched <span className="font-mono">{pendingSearch}</span>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">QB ID</TableHead>
                    <TableHead className="text-[10px]">Display Name</TableHead>
                    <TableHead className="text-[10px]">Company Name</TableHead>
                    <TableHead className="text-[10px]">Email</TableHead>
                    <TableHead className="text-[10px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchData.data.map((match) => (
                    <TableRow
                      key={match.qbCustomerId}
                      className="cursor-pointer hover:bg-titan-bg-surface"
                      onClick={() => handlePickMatch(match)}
                    >
                      <TableCell className="text-[11px] font-mono">{match.qbCustomerId}</TableCell>
                      <TableCell className="text-[11px] font-medium">{match.qbDisplayName || "-"}</TableCell>
                      <TableCell className="text-[11px]">{match.qbCompanyName || match.qbFullyQualifiedName || "-"}</TableCell>
                      <TableCell className="text-[11px]">{match.email || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePickMatch(match);
                          }}
                        >
                          Inspect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Loading */}
      {(isLoading || isSearching) && <InspectorSkeleton />}

      {/* Results */}
      {!isLoading && data?.success && data.data && (
        <CustomerResults data={data.data} raw={data.raw} />
      )}
    </div>
  );
}
