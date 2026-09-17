import * as React from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { apiFetchBlob, apiRequest } from "@/lib/queryClient";
import type { DailyProductionReport, DailyProductionReportRow } from "@shared/dailyProductionReport";

type View = "overview" | "breakdown";

const dueLabel: Record<DailyProductionReportRow["dueState"], string> = {
  overdue: "OVERDUE",
  today: "DUE TODAY",
  tomorrow: "DUE TOMORROW",
  future: "FUTURE",
  none: "NO DUE DATE",
};

const destinationLabel: Record<DailyProductionReportRow["destination"], string> = {
  roll: "Roll",
  flatbed: "Flatbed",
  mixed: "Roll + Flatbed",
  unclassified: "Unclassified",
  none: "No production items",
};

const urgencyClass: Record<DailyProductionReportRow["dueState"], string> = {
  overdue: "bg-red-500/15",
  today: "bg-yellow-400/15",
  tomorrow: "bg-sky-500/15",
  future: "",
  none: "bg-muted/70",
};

function formatDueDate(value: string | null): string {
  if (!value) return "No due date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function ReportTable({ rows, title, showProduction = true }: { rows: DailyProductionReportRow[]; title?: string; showProduction?: boolean }) {
  return <section className={title ? "daily-production-section mt-6" : "daily-production-section"}>
    {title ? <h2 className="mb-3 text-lg font-semibold">{title}</h2> : null}
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr>
          <th scope="col" aria-label="Check off" className="w-10 px-3 py-3 font-semibold" /><th className="px-3 py-3 font-semibold">Due</th><th className="px-3 py-3 font-semibold">Order</th><th className="px-3 py-3 font-semibold">Customer</th><th className="px-3 py-3 font-semibold">PO / Job</th><th className="px-3 py-3 text-right font-semibold">Qty</th>{showProduction ? <th className="px-3 py-3 font-semibold">Roll / Flatbed</th> : null}<th className="px-3 py-3 font-semibold">Fulfillment</th>
        </tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={`${title ?? "overview"}-${row.orderId}`} data-due-state={row.dueState} className={`daily-production-report-row break-inside-avoid border-t align-top ${urgencyClass[row.dueState]}`}>
          <td className="w-10 px-3 py-3 text-center align-middle"><span aria-hidden="true" className="daily-production-checkoff inline-block h-4 w-4 border border-solid border-black print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]" /></td>
          <td className="px-3 py-3"><div className="font-medium">{formatDueDate(row.dueDate)}</div><div className="mt-1 text-[11px] font-bold tracking-wide">{dueLabel[row.dueState]}</div></td>
          <td className="px-3 py-3 font-medium tabular-nums">{row.orderNumber}</td><td className="px-3 py-3">{row.customerName}</td>
          <td className="px-3 py-3 text-muted-foreground">{[row.jobLabel, row.poNumber].filter(Boolean).join(" · ") || "—"}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{row.quantity}</td>
          {showProduction ? <td className="px-3 py-3">{destinationLabel[row.destination]}</td> : null}<td className="px-3 py-3">{row.fulfillment}</td>
        </tr>) : <tr><td colSpan={showProduction ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">No qualifying production items.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

export default function DailyProductionListPage() {
  const [view, setView] = React.useState<View>("overview");
  const [report, setReport] = React.useState<DailyProductionReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false);

  React.useEffect(() => { void (async () => {
    try {
      const response = await apiRequest("GET", "/api/reports/daily-production");
      const body = await response.json() as { data?: DailyProductionReport };
      setReport(body.data ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the Daily Production List");
    }
  })(); }, []);

  const openPdf = async () => {
    setIsGeneratingPdf(true);
    setPdfError(null);
    const pdfWindow = window.open("", "_blank");
    try {
      const blob = await apiFetchBlob("/api/reports/daily-production/pdf", { method: "GET" });
      const objectUrl = URL.createObjectURL(blob);
      if (pdfWindow) {
        pdfWindow.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "daily-production-report.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (reason) {
      pdfWindow?.close();
      setPdfError(reason instanceof Error ? reason.message : "Could not generate the Daily Production List PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  if (error) return <main className="mx-auto max-w-6xl p-4 sm:p-6"><div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div></main>;
  if (!report) return <main className="mx-auto max-w-6xl p-4 sm:p-6"><p className="text-sm text-muted-foreground">Loading Daily Production List…</p></main>;

  return <main className="daily-production-report mx-auto max-w-6xl p-4 sm:p-6">
    <style>{`@media print {
      .daily-production-report-row { break-inside: avoid; page-break-inside: avoid; }
      .daily-production-checkoff { border-color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`}</style>
    <div className="daily-production-no-print mb-5"><Button asChild variant="ghost" size="sm"><Link to={ROUTES.reports}><ArrowLeft className="mr-2 h-4 w-4" />Reports</Link></Button></div>
    <header className="border-b pb-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-wide text-primary">{report.organizationName}</p><h1 className="mt-1 text-2xl font-bold tracking-tight">OPEN PRODUCTION REPORT</h1><p className="mt-1 text-sm text-muted-foreground">Daily Production List · As of {formatDueDate(report.asOf)}</p></div><Button className="daily-production-no-print" onClick={() => void openPdf()} disabled={isGeneratingPdf}>{isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}{isGeneratingPdf ? "Generating PDF…" : "Print / PDF"}</Button></div></header>
    {pdfError ? <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{pdfError}</div> : null}
    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
      ["Open Jobs", report.summary.open, ""], ["Due Today", report.summary.dueToday, "bg-yellow-400/15"], ["Due Tomorrow", report.summary.dueTomorrow, "bg-sky-500/15"], ["Overdue", report.summary.overdue, "bg-red-500/15"], ["No Due Date", report.summary.noDueDate, "bg-muted/70"],
    ].map(([label, value, className]) => <div key={String(label)} className={`rounded-lg border bg-card p-4 ${className}`}><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></div>)}</section>
    {report.diagnostics.unclassifiedProductionLines > 0 ? <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertCircle className="h-4 w-4 shrink-0 text-amber-600" /><span>{report.diagnostics.unclassifiedProductionLines} production line{report.diagnostics.unclassifiedProductionLines === 1 ? " is" : "s are"} not routed to Roll or Flatbed. They remain visible in Overview as Unclassified.</span></div> : null}
    <div className="daily-production-no-print mt-6 inline-flex rounded-lg border bg-card p-1"><Button size="sm" variant={view === "overview" ? "default" : "ghost"} onClick={() => setView("overview")}>Overview</Button><Button size="sm" variant={view === "breakdown" ? "default" : "ghost"} onClick={() => setView("breakdown")}>Production Breakdown</Button></div>
    {view === "overview" ? <ReportTable rows={report.overview} /> : <><ReportTable title="Roll Printing" rows={report.roll} showProduction={false} /><ReportTable title="Flatbed Printing" rows={report.flatbed} showProduction={false} /></>}
  </main>;
}
