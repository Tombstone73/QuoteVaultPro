import * as React from "react";
import { Link } from "react-router-dom";
import { BarChart3, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type SavedReport = { id: string; title: string; description: string | null; status: string; updatedAt: string; audience: string };

export default function ReportsPage() {
  const [reports, setReports] = React.useState<SavedReport[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => { void (async () => { try { const response = await apiRequest("GET", "/api/ai-reports"); const body = await response.json() as { data: SavedReport[] }; setReports(body.data ?? []); } finally { setLoading(false); } })(); }, []);
  return <main className="mx-auto max-w-6xl p-4 sm:p-6"><header className="flex flex-wrap items-end justify-between gap-3 border-b pb-5"><div><p className="text-sm font-medium text-primary">Reporting</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Saved reports</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Validated analytical snapshots saved from the internal reporting workflow. Reports retain their own sources, methodology, and version history.</p></div></header>
    {loading ? <p className="py-10 text-sm text-muted-foreground">Loading reports…</p> : reports.length ? <div className="mt-6 grid gap-3 md:grid-cols-2">{reports.map((report) => <Link key={report.id} to={`/reports/${report.id}`} className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 text-primary" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-medium">{report.title}</h2><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{report.status}</span></div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{report.description || "No description"}</p><p className="mt-3 text-xs text-muted-foreground">Updated {new Date(report.updatedAt).toLocaleString()} · {report.audience.replace("_", " ")}</p></div></div></Link>)}</div> : <section className="mt-8 rounded-xl border border-dashed p-8 text-center"><BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-medium">No saved reports yet</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Ask the assistant for a bounded analytical report, then save its validated result from the reporting workflow. No live operational data is exposed by this page.</p><Button className="mt-4" asChild variant="outline"><Link to="/dashboard">Return to dashboard</Link></Button></section>}
  </main>;
}
