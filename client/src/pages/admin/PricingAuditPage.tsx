/**
 * PricingAuditPage.tsx
 *
 * Admin-only, read-only tool that analyses how PBV2 pricing is currently
 * configured across all active products in the organization.
 *
 * Classifies each product into:
 *   Material-driven | Market pricing | Hybrid | No pricing | Unknown
 *
 * Route: /admin/pricing-audit
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  DollarSign,
  Filter,
  HardDrive,
  Info,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// ─── Types (mirrored from server) ────────────────────────────────────────────

type PricingType =
  | "material_driven"
  | "market_pricing"
  | "hybrid"
  | "no_pricing"
  | "unknown";

type FormulaSource =
  | "pbv2_override"
  | "pbv2_structured"
  | "formula_library"
  | "legacy_formula"
  | "none";

interface ProductAuditRow {
  id: string;
  name: string;
  category: string | null;
  materialType: string | null;
  pricingEngine: string | null;
  isActive: boolean;
  primaryMaterialId: string | null;
  primaryMaterialName: string | null;
  formulaSource: FormulaSource;
  formulaString: string | null;
  referencedVariables: string[];
  usesMaterialBasePrice: boolean;
  usesCost: boolean;
  hasStructuredPbv2: boolean;
  perSqftCents: number | null;
  perPieceCents: number | null;
  hasTieredPricing: boolean;
  pricingType: PricingType;
  hasHardcodedMultiplier: boolean;
  hardcodedValues: number[];
  materialNotUsedInPricing: boolean;
  multiMaterialWarning: boolean;
  notes: string[];
}

interface AuditSummary {
  materialDriven: number;
  marketPricing: number;
  hybrid: number;
  noPricing: number;
  unknown: number;
  pctMaterialDriven: number;
  pctMarketPricing: number;
  pctNoPricing: number;
  pctHardcoded: number;
  pctMaterialNotUsed: number;
}

interface PricingAuditResult {
  organizationId: string;
  generatedAt: string;
  totalProducts: number;
  summary: AuditSummary;
  rows: ProductAuditRow[];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const PRICING_TYPE_META: Record<
  PricingType,
  { label: string; className: string; icon: React.ReactNode }
> = {
  material_driven: {
    label: "Material",
    className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    icon: <Layers className="w-3 h-3" />,
  },
  market_pricing: {
    label: "Market",
    className: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
    icon: <TrendingUp className="w-3 h-3" />,
  },
  hybrid: {
    label: "Hybrid",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    icon: <HardDrive className="w-3 h-3" />,
  },
  no_pricing: {
    label: "No Pricing",
    className: "bg-red-500/15 text-red-400 border border-red-500/20",
    icon: <XCircle className="w-3 h-3" />,
  },
  unknown: {
    label: "Unknown",
    className: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
    icon: <Info className="w-3 h-3" />,
  },
};

const FORMULA_SOURCE_LABELS: Record<FormulaSource, string> = {
  pbv2_override: "PBV2 override",
  pbv2_structured: "PBV2 structured",
  formula_library: "Formula library",
  legacy_formula: "Legacy formula",
  none: "—",
};

function PricingTypeBadge({ type }: { type: PricingType }) {
  const meta = PRICING_TYPE_META[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        meta.className
      )}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function YesNo({
  value,
  warnOnTrue,
  warnOnFalse,
}: {
  value: boolean;
  warnOnTrue?: boolean;
  warnOnFalse?: boolean;
}) {
  if (value) {
    return (
      <span
        className={cn(
          "text-xs font-medium",
          warnOnTrue ? "text-amber-400" : "text-emerald-400"
        )}
      >
        Yes
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-xs font-medium",
        warnOnFalse ? "text-red-400" : "text-titan-text-muted"
      )}
    >
      No
    </span>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
  return direction === "asc" ? (
    <ChevronUp className="w-3 h-3" />
  ) : (
    <ChevronDown className="w-3 h-3" />
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryStatCard({
  label,
  value,
  pct,
  icon,
  className,
}: {
  label: string;
  value: number;
  pct: number;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-titan-border bg-titan-surface-2 p-4 flex flex-col gap-1",
        className
      )}
    >
      <div className="flex items-center gap-2 text-titan-text-muted text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-titan-text-primary">{value}</span>
        <span className="text-sm text-titan-text-muted">{pct}%</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type SortKey = "name" | "category" | "pricingType" | "formulaSource" | "material";

export default function PricingAuditPage() {
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<PricingType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<PricingAuditResult>({
      queryKey: ["admin", "pricing-audit"],
      queryFn: async () => {
        const res = await fetch("/api/admin/pricing-audit", {
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? "Failed to load pricing audit");
        }
        return res.json();
      },
      staleTime: 1000 * 60 * 5, // 5 min
    });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.category ?? "").toLowerCase().includes(q) ||
          (r.primaryMaterialName ?? "").toLowerCase().includes(q) ||
          (r.formulaString ?? "").toLowerCase().includes(q)
      );
    }

    if (filterType !== "all") {
      rows = rows.filter((r) => r.pricingType === filterType);
    }

    rows = [...rows].sort((a, b) => {
      let av = "";
      let bv = "";
      switch (sortKey) {
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "category":
          av = a.category ?? "";
          bv = b.category ?? "";
          break;
        case "pricingType":
          av = a.pricingType;
          bv = b.pricingType;
          break;
        case "formulaSource":
          av = a.formulaSource;
          bv = b.formulaSource;
          break;
        case "material":
          av = a.primaryMaterialName ?? "";
          bv = b.primaryMaterialName ?? "";
          break;
      }
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [data, search, filterType, sortKey, sortDir]);

  // Redirect if not admin/owner
  if (user?.role === "customer" || user?.role === "staff") {
    return (
      <div className="p-8 text-titan-text-muted text-sm">
        This tool is restricted to administrators.
      </div>
    );
  }

  const s = data?.summary;
  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleString()
    : null;

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6 max-w-[1400px] mx-auto">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-titan-text-primary">
              Pricing Audit
            </h1>
            <p className="text-sm text-titan-text-muted mt-0.5">
              Read-only analysis of PBV2 pricing configuration across all active
              products.
            </p>
            {generatedAt && (
              <p className="text-xs text-titan-text-muted mt-1">
                Generated {generatedAt}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="shrink-0"
          >
            <RefreshCw
              className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        {/* ── Error state ───────────────────────────────────────────────── */}
        {isError && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4 flex items-center gap-3 text-red-400 text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              Failed to load pricing audit. Check server logs and try refreshing.
            </CardContent>
          </Card>
        )}

        {/* ── Summary cards ─────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : s ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <SummaryStatCard
                label="Material-driven"
                value={s.materialDriven}
                pct={s.pctMaterialDriven}
                icon={<Layers className="w-3.5 h-3.5" />}
                className="border-emerald-500/20"
              />
              <SummaryStatCard
                label="Market pricing"
                value={s.marketPricing}
                pct={s.pctMarketPricing}
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                className="border-blue-500/20"
              />
              <SummaryStatCard
                label="Hybrid"
                value={s.hybrid}
                pct={
                  data.totalProducts > 0
                    ? Math.round((s.hybrid / data.totalProducts) * 100)
                    : 0
                }
                icon={<HardDrive className="w-3.5 h-3.5" />}
                className="border-amber-500/20"
              />
              <SummaryStatCard
                label="Hardcoded price"
                value={
                  data.rows.filter((r) => r.hasHardcodedMultiplier).length
                }
                pct={s.pctHardcoded}
                icon={<DollarSign className="w-3.5 h-3.5" />}
                className="border-orange-500/20"
              />
              <SummaryStatCard
                label="Material not used"
                value={
                  data.rows.filter((r) => r.materialNotUsedInPricing).length
                }
                pct={s.pctMaterialNotUsed}
                icon={<AlertTriangle className="w-3.5 h-3.5" />}
                className="border-red-500/20"
              />
            </div>

            {/* Insight bar */}
            <div className="flex flex-wrap gap-3 text-xs text-titan-text-muted">
              <span>
                <span className="font-semibold text-titan-text-primary">
                  {data.totalProducts}
                </span>{" "}
                active products analysed
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-amber-400">
                  {s.pctHardcoded}%
                </span>{" "}
                use hardcoded pricing
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-emerald-400">
                  {s.pctMaterialDriven}%
                </span>{" "}
                use material pricing
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-red-400">
                  {s.pctMaterialNotUsed}%
                </span>{" "}
                have a linked material that isn't used in pricing
              </span>
            </div>
          </>
        ) : null}

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-titan-text-primary flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Products
              {data && (
                <span className="text-titan-text-muted font-normal">
                  ({filteredRows.length} of {data.totalProducts})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titan-text-muted pointer-events-none" />
                <Input
                  placeholder="Search by name, category, material, formula…"
                  className="pl-9 h-9 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                value={filterType}
                onValueChange={(v) => setFilterType(v as PricingType | "all")}
              >
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue placeholder="Pricing type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="material_driven">Material-driven</SelectItem>
                  <SelectItem value="market_pricing">Market pricing</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="no_pricing">No pricing</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ── Table ──────────────────────────────────────────────────── */}
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-titan-text-muted">
                No products match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-titan-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-titan-border">
                      {(
                        [
                          { key: "name", label: "Product Name" },
                          { key: "category", label: "Category" },
                          { key: "pricingType", label: "Pricing Type" },
                          { key: "formulaSource", label: "Formula Source" },
                          { key: "material", label: "Primary Material" },
                        ] as { key: SortKey; label: string }[]
                      ).map(({ key, label }) => (
                        <TableHead
                          key={key}
                          className="text-xs text-titan-text-muted cursor-pointer select-none whitespace-nowrap"
                          onClick={() => handleSort(key)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <SortIcon
                              active={sortKey === key}
                              direction={sortDir}
                            />
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="text-xs text-titan-text-muted whitespace-nowrap">
                        Formula
                      </TableHead>
                      <TableHead className="text-xs text-titan-text-muted text-center whitespace-nowrap">
                        Uses Base Price
                      </TableHead>
                      <TableHead className="text-xs text-titan-text-muted text-center whitespace-nowrap">
                        Uses Cost
                      </TableHead>
                      <TableHead className="text-xs text-titan-text-muted text-center whitespace-nowrap">
                        Hardcoded
                      </TableHead>
                      <TableHead className="text-xs text-titan-text-muted whitespace-nowrap">
                        Notes / Flags
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => {
                      const isExpanded = expandedId === row.id;
                      const hasWarnings =
                        row.materialNotUsedInPricing ||
                        row.multiMaterialWarning ||
                        row.pricingType === "no_pricing";

                      return (
                        <>
                          <TableRow
                            key={row.id}
                            className={cn(
                              "border-titan-border cursor-pointer",
                              isExpanded && "bg-titan-surface-2"
                            )}
                            onClick={() =>
                              setExpandedId(isExpanded ? null : row.id)
                            }
                          >
                            {/* Name */}
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2">
                                {hasWarnings && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                )}
                                <span className="font-medium text-sm text-titan-text-primary">
                                  {row.name}
                                </span>
                              </div>
                              {row.materialType && (
                                <span className="text-xs text-titan-text-muted ml-5">
                                  {row.materialType}
                                </span>
                              )}
                            </TableCell>

                            {/* Category */}
                            <TableCell className="py-2.5 text-sm text-titan-text-secondary">
                              {row.category ?? (
                                <span className="text-titan-text-muted italic">
                                  —
                                </span>
                              )}
                            </TableCell>

                            {/* Pricing type */}
                            <TableCell className="py-2.5">
                              <PricingTypeBadge type={row.pricingType} />
                            </TableCell>

                            {/* Formula source */}
                            <TableCell className="py-2.5 text-xs text-titan-text-secondary">
                              {FORMULA_SOURCE_LABELS[row.formulaSource]}
                            </TableCell>

                            {/* Material */}
                            <TableCell className="py-2.5 text-sm">
                              {row.primaryMaterialName ? (
                                <span
                                  className={cn(
                                    row.materialNotUsedInPricing
                                      ? "text-amber-400"
                                      : "text-titan-text-secondary"
                                  )}
                                >
                                  {row.primaryMaterialName}
                                </span>
                              ) : (
                                <span className="text-titan-text-muted italic text-xs">
                                  none
                                </span>
                              )}
                            </TableCell>

                            {/* Formula string */}
                            <TableCell className="py-2.5 max-w-[220px]">
                              {row.formulaSource === "pbv2_structured" ? (
                                <span className="text-xs text-blue-400 font-mono">
                                  {row.perSqftCents !== null
                                    ? `$${(row.perSqftCents / 100).toFixed(4)}/sqft`
                                    : "structured"}
                                  {row.hasTieredPricing && " (tiered)"}
                                </span>
                              ) : row.formulaString ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="font-mono text-xs text-titan-text-secondary truncate block max-w-[220px]">
                                      {row.formulaString}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="bottom"
                                    className="font-mono text-xs max-w-sm break-all"
                                  >
                                    {row.formulaString}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-titan-text-muted italic text-xs">
                                  —
                                </span>
                              )}
                            </TableCell>

                            {/* Uses Base Price */}
                            <TableCell className="py-2.5 text-center">
                              <YesNo
                                value={row.usesMaterialBasePrice}
                                warnOnFalse={
                                  row.formulaSource !== "pbv2_structured" &&
                                  row.formulaSource !== "none"
                                }
                              />
                            </TableCell>

                            {/* Uses Cost */}
                            <TableCell className="py-2.5 text-center">
                              <YesNo value={row.usesCost} />
                            </TableCell>

                            {/* Hardcoded */}
                            <TableCell className="py-2.5 text-center">
                              <YesNo
                                value={row.hasHardcodedMultiplier}
                                warnOnTrue
                              />
                            </TableCell>

                            {/* Notes */}
                            <TableCell className="py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {row.notes.length === 0 ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-titan-text-muted" />
                                ) : (
                                  row.notes.map((note, i) => (
                                    <span
                                      key={i}
                                      className="text-xs text-titan-text-muted"
                                    >
                                      {i > 0 && " · "}
                                      {note}
                                    </span>
                                  ))
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expanded detail row */}
                          {isExpanded && (
                            <TableRow
                              key={`${row.id}-detail`}
                              className="border-titan-border bg-titan-surface-2 hover:bg-titan-surface-2"
                            >
                              <TableCell colSpan={10} className="py-3 pl-8">
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-2 text-xs">
                                  <div>
                                    <span className="text-titan-text-muted">
                                      Product ID
                                    </span>
                                    <p className="font-mono text-titan-text-secondary mt-0.5">
                                      {row.id}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-titan-text-muted">
                                      Pricing Engine
                                    </span>
                                    <p className="font-mono text-titan-text-secondary mt-0.5">
                                      {row.pricingEngine ?? "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-titan-text-muted">
                                      Material Type
                                    </span>
                                    <p className="text-titan-text-secondary mt-0.5">
                                      {row.materialType ?? "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-titan-text-muted">
                                      Referenced Variables
                                    </span>
                                    <p className="font-mono text-titan-text-secondary mt-0.5 break-all">
                                      {row.referencedVariables.length > 0
                                        ? row.referencedVariables.join(", ")
                                        : "none detected"}
                                    </p>
                                  </div>
                                  {row.hardcodedValues.length > 0 && (
                                    <div>
                                      <span className="text-titan-text-muted">
                                        Hardcoded Values
                                      </span>
                                      <p className="font-mono text-amber-400 mt-0.5">
                                        {row.hardcodedValues.join(", ")}
                                      </p>
                                    </div>
                                  )}
                                  {row.hasStructuredPbv2 && (
                                    <>
                                      <div>
                                        <span className="text-titan-text-muted">
                                          Base $/sqft
                                        </span>
                                        <p className="font-mono text-titan-text-secondary mt-0.5">
                                          {row.perSqftCents !== null
                                            ? `$${(
                                                row.perSqftCents / 100
                                              ).toFixed(4)}`
                                            : "—"}
                                        </p>
                                      </div>
                                      <div>
                                        <span className="text-titan-text-muted">
                                          Base $/piece
                                        </span>
                                        <p className="font-mono text-titan-text-secondary mt-0.5">
                                          {row.perPieceCents !== null
                                            ? `$${(
                                                row.perPieceCents / 100
                                              ).toFixed(4)}`
                                            : "—"}
                                        </p>
                                      </div>
                                      <div>
                                        <span className="text-titan-text-muted">
                                          Has Tier Overrides
                                        </span>
                                        <p className="text-titan-text-secondary mt-0.5">
                                          {row.hasTieredPricing ? "Yes" : "No"}
                                        </p>
                                      </div>
                                    </>
                                  )}
                                  {row.formulaString && (
                                    <div className="col-span-2 lg:col-span-4">
                                      <span className="text-titan-text-muted">
                                        Full Formula
                                      </span>
                                      <p className="font-mono text-titan-text-secondary mt-0.5 break-all">
                                        {row.formulaString}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Legend ────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-titan-border bg-titan-surface-2 p-4 space-y-2">
          <p className="text-xs font-medium text-titan-text-secondary">
            Pricing Type Legend
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-titan-text-muted">
            <div className="flex items-start gap-2">
              <PricingTypeBadge type="material_driven" />
              <span>Formula references base_price or cost variables.</span>
            </div>
            <div className="flex items-start gap-2">
              <PricingTypeBadge type="market_pricing" />
              <span>
                Hardcoded multipliers (e.g. sqft * 3) or structured PBV2 rate.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <PricingTypeBadge type="hybrid" />
              <span>Both material variables and hardcoded values present.</span>
            </div>
            <div className="flex items-start gap-2">
              <PricingTypeBadge type="no_pricing" />
              <span>No formula or PBV2 tree configured.</span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
