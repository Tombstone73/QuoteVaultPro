import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/queryClient";
import { THERMAL_PRINT_STYLES } from "@/lib/ticketRender";
import { ThermalPrintPage, ThermalValue } from "@/components/production/ticketPrintPrimitives";
import { travelerFeedSpacerMm } from "@/lib/travelerTrailingFeed";
import { hasValidDirectPrintJobId } from "@/pages/order-traveler";

type QuickNoteSource = { headline: string; body: string; receiptWidthMm: number };
export default function DirectPrintQuickNoteRoute() {
  const [params] = useSearchParams(); const jobId = params.get("directPrintJobId"); const feedMm = Number(params.get("feedMm"));
  const source = useQuery<QuickNoteSource>({ queryKey: ["quick-note", jobId], enabled: hasValidDirectPrintJobId(jobId), queryFn: async () => { const res = await apiFetch(`/api/local-bridge/direct-print/jobs/${encodeURIComponent(jobId!)}/quick-note`); if (!res.ok) throw new Error("Failed to load Quick Note"); return (await res.json()).data; } });
  if (!hasValidDirectPrintJobId(jobId) || source.isLoading) return <p>Loading Quick Note...</p>;
  if (source.error || !source.data) return <p>Failed to load Quick Note.</p>;
  const width = Math.min(120, Math.max(40, Number(source.data.receiptWidthMm) || 80));
  return <div className="min-h-screen bg-white"><style dangerouslySetInnerHTML={{ __html: THERMAL_PRINT_STYLES }} /><div className="mx-auto max-w-md px-4 py-6"><ThermalPrintPage ready paperWidth={`${width}mm`} feedSpacer={travelerFeedSpacerMm(feedMm)} forceFeedSentinel><div data-testid="quick-note-content" className="py-5"><ThermalValue align="center" size="large" style={{ fontWeight: 800, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{source.data.headline}</ThermalValue>{source.data.body ? <ThermalValue align="center" size="normal" strong={false} style={{ marginTop: source.data.headline ? "5mm" : 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{source.data.body}</ThermalValue> : null}</div></ThermalPrintPage></div></div>;
}
