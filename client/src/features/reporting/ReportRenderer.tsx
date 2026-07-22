import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportDefinition } from "@shared/aiReportingContracts";
import { cn } from "@/lib/utils";

export type ReportRendererProps = {
  definition: ReportDefinition;
  /** Removes fields marked sensitive. Used by the public customer-safe shell. */
  customerSafe?: boolean;
  className?: string;
};

type ReportRow = Record<string, string | number | boolean | null>;

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function displayValue(value: ReportRow[string]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return numberFormatter.format(value);
  return value;
}

function chartRows(rows: ReportRow[], labelKey: string, valueKey: string) {
  return rows.flatMap((row) => {
    const rawValue = row[valueKey];
    const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
    const label = row[labelKey];
    if (!Number.isFinite(numericValue) || label === null || label === undefined) return [];
    return [{ label: displayValue(label), value: numericValue }];
  });
}

function ChartEmptyState() {
  return <div className="flex h-56 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No chartable values are available for this report section.</div>;
}

function ReportBarChart({ title, rows, labelKey, valueKey }: { title: string; rows: ReportRow[]; labelKey: string; valueKey: string }) {
  const data = chartRows(rows, labelKey, valueKey);
  return <section className="report-section break-inside-avoid rounded-lg border bg-card p-4 shadow-sm" aria-label={title}>
    <h2 className="text-base font-semibold">{title}</h2>
    <div className="mt-4 h-64" data-testid="report-bar-chart">
      {data.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 36 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" angle={-28} textAnchor="end" interval={0} height={56} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number) => numberFormatter.format(value)} /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <ChartEmptyState />}
    </div>
  </section>;
}

function ReportLineChart({ title, rows, labelKey, valueKey }: { title: string; rows: ReportRow[]; labelKey: string; valueKey: string }) {
  const data = chartRows(rows, labelKey, valueKey);
  return <section className="report-section break-inside-avoid rounded-lg border bg-card p-4 shadow-sm" aria-label={title}>
    <h2 className="text-base font-semibold">{title}</h2>
    <div className="mt-4 h-64" data-testid="report-line-chart">
      {data.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number) => numberFormatter.format(value)} /><Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer> : <ChartEmptyState />}
    </div>
  </section>;
}

function ReportTable({ title, columns, rows, customerSafe }: Extract<ReportDefinition["sections"][number], { kind: "table" }> & { customerSafe: boolean }) {
  const visibleColumns = customerSafe ? columns.filter((column) => !column.sensitive) : columns;
  if (!visibleColumns.length) return null;
  return <section className="report-section break-inside-avoid rounded-lg border bg-card p-4 shadow-sm" aria-label={title}>
    <h2 className="text-base font-semibold">{title}</h2>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[32rem] border-collapse text-sm"><thead><tr className="border-b text-left text-muted-foreground">{visibleColumns.map((column) => <th className="px-3 py-2 font-medium" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-b last:border-0" key={`${index}-${visibleColumns.map((column) => String(row[column.key])).join("-")}`}>{visibleColumns.map((column) => <td className="px-3 py-2 align-top" key={column.key}>{displayValue(row[column.key])}</td>)}</tr>)}</tbody></table></div>
  </section>;
}

function ReportKpiGrid({ title, items, customerSafe }: Extract<ReportDefinition["sections"][number], { kind: "kpi_grid" }> & { customerSafe: boolean }) {
  const visibleItems = customerSafe ? items.filter((item) => !item.sensitive) : items;
  if (!visibleItems.length) return null;
  return <section className="report-section break-inside-avoid" aria-label={title}><h2 className="mb-3 text-base font-semibold">{title}</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{visibleItems.map((item) => <div className="rounded-lg border bg-card p-4 shadow-sm" key={item.label}><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</p>{item.detail ? <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p> : null}</div>)}</div></section>;
}

/**
 * Renders only the validated, declarative ReportDefinition contract. It does
 * not interpret HTML, arbitrary URLs, scripts, or user-authored components.
 */
export function ReportRenderer({ definition, customerSafe = false, className }: ReportRendererProps) {
  return <article className={cn("report-renderer space-y-5 text-foreground", className)} data-testid="report-renderer">
    {definition.sections.map((section, index) => {
      const key = `${section.kind}-${index}`;
      switch (section.kind) {
        case "executive_summary": return <section key={key} className="report-section break-inside-avoid rounded-lg border border-primary/20 bg-primary/5 p-5" aria-label="Executive summary"><p className="whitespace-pre-line text-base leading-7">{section.text}</p></section>;
        case "narrative": return <section key={key} className="report-section break-inside-avoid rounded-lg border bg-card p-5 shadow-sm" aria-label={section.title}><h2 className="text-lg font-semibold">{section.title}</h2><p className="mt-2 whitespace-pre-line leading-7 text-muted-foreground">{section.text}</p></section>;
        case "kpi_grid": return <ReportKpiGrid key={key} {...section} customerSafe={customerSafe} />;
        case "table": return <ReportTable key={key} {...section} customerSafe={customerSafe} />;
        case "bar_chart": return <ReportBarChart key={key} {...section} />;
        case "line_chart": return <ReportLineChart key={key} {...section} />;
        case "ranked_list": return <section key={key} className="report-section break-inside-avoid rounded-lg border bg-card p-4 shadow-sm" aria-label={section.title}><h2 className="text-base font-semibold">{section.title}</h2><ol className="mt-3 space-y-3">{section.items.map((item, itemIndex) => <li className="flex gap-3" key={`${item.label}-${itemIndex}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{itemIndex + 1}</span><div><p className="font-medium">{item.label} <span className="text-muted-foreground">{item.value}</span></p>{item.detail ? <p className="text-sm text-muted-foreground">{item.detail}</p> : null}</div></li>)}</ol></section>;
        case "callout": {
          const tone = section.tone === "warning" ? "border-amber-500/40 bg-amber-500/10" : section.tone === "success" ? "border-emerald-500/40 bg-emerald-500/10" : "border-primary/30 bg-primary/5";
          return <aside key={key} className={cn("report-section break-inside-avoid rounded-lg border p-4 text-sm leading-6", tone)}>{section.text}</aside>;
        }
        case "source_notes": return <section key={key} className="report-section break-inside-avoid rounded-lg border bg-muted/40 p-4" aria-label="Source notes"><h2 className="text-sm font-semibold">Source notes</h2><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{section.text}</p></section>;
        case "methodology": return <section key={key} className="report-section break-inside-avoid rounded-lg border bg-muted/40 p-4" aria-label="Methodology"><h2 className="text-sm font-semibold">Methodology</h2><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{section.text}</p></section>;
        case "page_break": return <div key={key} className="report-page-break hidden print:block" aria-hidden="true" />;
      }
    })}
  </article>;
}
