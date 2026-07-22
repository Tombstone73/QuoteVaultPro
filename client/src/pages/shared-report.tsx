import * as React from "react";
import { useParams } from "react-router-dom";
import type { ReportDefinition } from "@shared/aiReportingContracts";
import { ReportRenderer } from "@/features/reporting/ReportRenderer";

type SharedReport = { title: string; description: string | null; definition: ReportDefinition; dataSnapshotAt: string; expiresAt: string; downloadAllowed: boolean };

export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = React.useState<SharedReport | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  React.useEffect(() => {
    if (!token) { setUnavailable(true); return; }
    void fetch(`/api/shared/reports/${encodeURIComponent(token)}`, { credentials: "omit" })
      .then(async (response) => response.ok ? response.json() as Promise<{ data: SharedReport }> : Promise.reject(new Error("unavailable")))
      .then((body) => setReport(body.data)).catch(() => setUnavailable(true));
  }, [token]);
  if (unavailable) return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-semibold">Report unavailable</h1><p className="mt-2 text-sm text-muted-foreground">This link may be expired, revoked, or invalid.</p></main>;
  if (!report) return <main className="p-8 text-sm text-muted-foreground">Loading report…</main>;
  return <main className="min-h-screen bg-muted/20 py-8"><article className="mx-auto max-w-5xl rounded-xl border bg-background p-5 shadow-sm sm:p-10"><header className="mb-8 border-b pb-5"><h1 className="text-2xl font-semibold">{report.title}</h1>{report.description ? <p className="mt-2 text-muted-foreground">{report.description}</p> : null}<p className="mt-3 text-xs text-muted-foreground">Data snapshot {new Date(report.dataSnapshotAt).toLocaleString()}</p></header><ReportRenderer definition={report.definition} customerSafe /></article></main>;
}
