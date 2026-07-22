import * as React from "react";
import { Archive, ChevronDown, FileDown, PanelRight, Printer, RefreshCw, Share2, ZoomIn, ZoomOut } from "lucide-react";
import type { ReportDefinition } from "@shared/aiReportingContracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ReportRenderer } from "./ReportRenderer";

export type ReportStudioReport = {
  id: string;
  title: string;
  description?: string | null;
  status: "draft" | "ready" | "archived" | "failed";
  audience?: "private" | "organization" | "shared_link" | "customer_safe";
  updatedAt: string;
  definition: ReportDefinition;
};

export type ReportStudioPageProps = {
  report: ReportStudioReport;
  onSaveMetadata?: (input: { title: string; description: string }) => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  onShare?: () => Promise<void> | void;
  /** Browser-PDF workflow; a server export callback may replace it later. */
  onExportPdf?: () => Promise<void> | void;
  onPrint?: () => void;
  className?: string;
};

const statusLabel: Record<ReportStudioReport["status"], string> = { draft: "Draft", ready: "Ready", archived: "Archived", failed: "Needs attention" };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Data-agnostic internal studio shell. The route and persistence layer supply
 * a tenant-authorized report; this component never fetches a report by ID.
 */
export function ReportStudioPage({ report, onSaveMetadata, onArchive, onRefresh, onShare, onExportPdf, onPrint, className }: ReportStudioPageProps) {
  const [zoom, setZoom] = React.useState(100);
  const [title, setTitle] = React.useState(report.title);
  const [description, setDescription] = React.useState(report.description ?? report.definition.description ?? "");
  const [saving, setSaving] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const sectionTitles = report.definition.sections.flatMap((section, index) => "title" in section ? [{ label: section.title, index }] : section.kind === "executive_summary" ? [{ label: "Executive summary", index }] : []);

  React.useEffect(() => { setTitle(report.title); setDescription(report.description ?? report.definition.description ?? ""); }, [report.id, report.title, report.description, report.definition.description]);

  const save = async () => {
    if (!onSaveMetadata || !title.trim()) return;
    setSaving(true);
    try { await onSaveMetadata({ title: title.trim(), description: description.trim() }); setEditing(false); } finally { setSaving(false); }
  };
  const print = () => { if (onPrint) onPrint(); else window.print(); };
  const exportPdf = () => { if (onExportPdf) void onExportPdf(); else print(); };

  return <main className={cn("min-h-full bg-muted/30 pb-10 print:bg-white print:pb-0", className)} data-testid="report-studio">
    <style>{`@media print { @page { size: auto; margin: 15mm; } body { background: #fff !important; } .report-studio-controls, .report-studio-navigator { display: none !important; } .report-studio-canvas { max-width: none !important; transform: none !important; box-shadow: none !important; } .report-page-break { break-before: page; page-break-before: always; } .report-section { break-inside: avoid; page-break-inside: avoid; } table { break-inside: auto; } tr { break-inside: avoid; page-break-inside: avoid; } }`}</style>
    <header className="report-studio-controls sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-lg font-semibold">{report.title}</h1><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{statusLabel[report.status]}</span></div><p className="mt-0.5 text-xs text-muted-foreground">Updated {formatDate(report.updatedAt)} · Data snapshot {formatDate(report.definition.dataSnapshotAt)} · {report.definition.timezone}</p></div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.max(70, value - 10))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></Button><span className="w-10 text-center text-xs text-muted-foreground" aria-label={`Zoom ${zoom}%`}>{zoom}%</span><Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.min(130, value + 10))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />Print</Button><Button size="sm" variant="outline" onClick={exportPdf}><FileDown className="mr-1.5 h-4 w-4" />Save as PDF</Button>{onShare ? <Button size="sm" variant="outline" onClick={() => void onShare()}><Share2 className="mr-1.5 h-4 w-4" />Share</Button> : null}
          {onRefresh ? <Button size="sm" variant="outline" onClick={() => void onRefresh()} disabled={report.status === "archived"}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button> : null}
        </div>
      </div>
    </header>
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="report-studio-navigator hidden lg:block"><div className="sticky top-24 rounded-lg border bg-card p-3"><p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Report sections</p><nav className="mt-2 space-y-1">{sectionTitles.map((section) => <a className="block rounded px-2 py-1.5 text-sm hover:bg-muted" href={`#report-section-${section.index}`} key={section.index}>{section.label}</a>)}</nav><button className="mt-4 flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" type="button" onClick={() => setEditing((value) => !value)}>Edit details <ChevronDown className="h-3 w-3" /></button></div></aside>
      <div className="min-w-0">
        <div className="report-studio-controls mb-4 flex flex-wrap justify-between gap-3"><div>{editing ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><div><Label htmlFor="report-title">Report title</Label><Input className="mt-1" id="report-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></div><div className="flex items-end gap-2"><Button size="sm" onClick={() => void save()} disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save"}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div><div className="sm:col-span-2"><Label htmlFor="report-description">Description</Label><Textarea className="mt-1" id="report-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></div></div> : <><p className="text-sm text-muted-foreground">{report.description ?? report.definition.description}</p><Button className="mt-2" size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit title and description</Button></>}</div>
          <Sheet><SheetTrigger asChild><Button size="sm" variant="outline"><PanelRight className="mr-1.5 h-4 w-4" />Sources & methodology</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Sources & methodology</SheetTitle><SheetDescription>Snapshot and source information retained with this report.</SheetDescription></SheetHeader><dl className="mt-5 space-y-3 text-sm"><div><dt className="font-medium">Data freshness</dt><dd className="text-muted-foreground">Snapshot created {formatDate(report.definition.dataSnapshotAt)}</dd></div>{report.definition.sources.map((source) => <div key={source.label}><dt className="font-medium">{source.label}</dt><dd className="text-muted-foreground">{source.count} records · refreshed {formatDate(source.freshness)}</dd></div>)}</dl></SheetContent></Sheet></div>
        <div className="overflow-auto pb-5"><div className="report-studio-canvas origin-top rounded-xl border bg-background p-4 shadow-sm transition-transform sm:p-8" style={{ width: `${10000 / zoom}%`, transform: `scale(${zoom / 100})` }}><div className="mb-7 border-b pb-5"><h2 className="text-2xl font-semibold tracking-tight">{report.title}</h2>{(report.description ?? report.definition.description) ? <p className="mt-2 max-w-3xl text-muted-foreground">{report.description ?? report.definition.description}</p> : null}</div><ReportRenderer definition={report.definition} /></div></div>
        {onArchive ? <div className="report-studio-controls mt-4 border-t pt-4"><Button variant="outline" size="sm" onClick={() => void onArchive()} disabled={report.status === "archived"}><Archive className="mr-1.5 h-4 w-4" />{report.status === "archived" ? "Archived" : "Archive report"}</Button></div> : null}
      </div>
    </div>
  </main>;
}
