import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { ReportStudioPage, type ReportStudioReport } from "@/features/reporting/ReportStudioPage";

type ReportApiResponse = { success: boolean; data: ReportStudioReport };

export default function ReportStudioRoute() {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = React.useState<ReportStudioReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    if (!reportId) return;
    setLoading(true); setError(null);
    try { const response = await apiRequest("GET", `/api/ai-reports/${encodeURIComponent(reportId)}`); const body = await response.json() as ReportApiResponse; setReport(body.data); }
    catch { setError("This report could not be loaded. It may no longer be available to you."); }
    finally { setLoading(false); }
  }, [reportId]);
  React.useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading report…</div>;
  if (!report || error) return <main className="mx-auto max-w-xl p-8"><div className="rounded-xl border bg-card p-6"><AlertCircle className="h-5 w-5 text-destructive" /><h1 className="mt-3 text-lg font-semibold">Report unavailable</h1><p className="mt-1 text-sm text-muted-foreground">{error ?? "This report is unavailable."}</p><Button className="mt-4" asChild variant="outline"><Link to="/reports"><ArrowLeft className="mr-2 h-4 w-4" />Back to reports</Link></Button></div></main>;

  return <><ReportStudioPage report={report}
    onSaveMetadata={async (input) => { const response = await apiRequest("PATCH", `/api/ai-reports/${encodeURIComponent(report.id)}`, input); const body = await response.json() as ReportApiResponse; setReport(body.data); }}
    onArchive={async () => { const response = await apiRequest("POST", `/api/ai-reports/${encodeURIComponent(report.id)}/archive`); const body = await response.json() as ReportApiResponse; setReport(body.data); }}
    onShare={report.audience === "customer_safe" ? async () => { if (!window.confirm("Create a customer-safe public link for this report? Anyone with the link can view it until it expires.")) return; const response = await apiRequest("POST", `/api/ai-reports/${encodeURIComponent(report.id)}/shares`, {}); const body = await response.json() as { data: { url: string } }; const url = new URL(body.data.url, window.location.origin).toString(); setShareUrl(url); try { await navigator.clipboard?.writeText(url); } catch { /* visible link remains available */ } } : undefined}
    onPrint={() => window.print()}
  />
  {shareUrl ? <div className="fixed bottom-4 right-4 max-w-md rounded-lg border bg-card p-3 text-sm shadow-lg"><p className="font-medium">Customer-safe link created</p><a className="mt-1 block break-all text-primary underline" href={shareUrl}>{shareUrl}</a><Button className="mt-2" size="sm" variant="ghost" onClick={() => setShareUrl(null)}>Dismiss</Button></div> : null}</>;
}
