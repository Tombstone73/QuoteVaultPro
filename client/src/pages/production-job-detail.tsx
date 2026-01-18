import { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ROUTES } from "@/config/routes";
import {
  useAddProductionNote,
  useCompleteProductionJob,
  useProductionJob,
  useReopenProductionJob,
  useReprintProductionJob,
  useSetProductionMediaUsed,
  useStartProductionTimer,
  useStopProductionTimer,
} from "@/hooks/useProduction";
import { Play, Square, CheckCircle2, RotateCcw, ArrowLeft, Printer } from "lucide-react";

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatEventLabel(type: string) {
  switch (type) {
    case "timer_started":
      return "Timer started";
    case "timer_stopped":
      return "Timer stopped";
    case "reprint_incremented":
      return "Reprint recorded";
    case "media_used_set":
      return "Media used set";
    case "note":
      return "Note";
    default:
      return type;
  }
}

export default function ProductionJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useProductionJob(jobId);

  const start = useStartProductionTimer(jobId || "");
  const stop = useStopProductionTimer(jobId || "");
  const complete = useCompleteProductionJob(jobId || "");
  const reopen = useReopenProductionJob(jobId || "");
  const reprint = useReprintProductionJob(jobId || "");
  const setMedia = useSetProductionMediaUsed(jobId || "");
  const addNote = useAddProductionNote(jobId || "");

  const [tickSeconds, setTickSeconds] = useState(0);
  const [mediaText, setMediaText] = useState("");
  const [mediaQty, setMediaQty] = useState<string>("");
  const [mediaUnit, setMediaUnit] = useState("");
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (!data) return;
    setTickSeconds(data.timer.currentSeconds);
  }, [data?.timer.currentSeconds]);

  useEffect(() => {
    if (!data?.timer.isRunning) return;
    const t = window.setInterval(() => setTickSeconds((p) => p + 1), 1000);
    return () => window.clearInterval(t);
  }, [data?.timer.isRunning]);

  const dueLabel = useMemo(() => {
    if (!data?.order.dueDate) return null;
    const d = new Date(data.order.dueDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
  }, [data?.order.dueDate]);

  const isBusy =
    start.isPending ||
    stop.isPending ||
    complete.isPending ||
    reopen.isPending ||
    reprint.isPending ||
    setMedia.isPending ||
    addNote.isPending;

  if (isLoading) {
    return (
      <Page maxWidth="full">
        <PageHeader title="Production Job" subtitle="Loading…" />
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page maxWidth="full">
        <PageHeader title="Production Job" subtitle="Not found" />
        <ContentLayout>
          <Card className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-4 text-sm text-titan-text-muted">
              Failed to load production job.
            </CardContent>
          </Card>
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page maxWidth="full">
      <PageHeader
        title={`Production Job`}
        subtitle={`Order ${data.order.orderNumber} • ${data.order.customerName}${dueLabel ? ` • Due ${dueLabel}` : ""}`}
        backButton={
          <Button variant="ghost" size="icon" onClick={() => navigate(ROUTES.production.board)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        }
        actions={
          <div className="flex items-center gap-2">
            {data.order.priority === "rush" && <Badge variant="destructive">RUSH</Badge>}
            <Badge variant="outline" className="text-titan-text-secondary">
              {data.status.replace("_", " ")}
            </Badge>
          </div>
        }
      />

      <ContentLayout>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Timer</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-2xl font-mono text-titan-text-primary">{formatSeconds(tickSeconds)}</div>
                    {data.timer.isRunning && (
                      <div className="text-xs text-titan-text-secondary">Running</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => (data.timer.isRunning ? stop.mutate() : start.mutate())}
                      disabled={isBusy}
                    >
                      {data.timer.isRunning ? (
                        <>
                          <Square className="w-4 h-4 mr-2" /> Stop
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" /> Start
                        </>
                      )}
                    </Button>

                    {data.status === "done" ? (
                      <Button size="sm" variant="outline" onClick={() => reopen.mutate()} disabled={isBusy}>
                        <RotateCcw className="w-4 h-4 mr-2" /> Reopen
                      </Button>
                    ) : data.status === "queued" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => complete.mutate({ skipProduction: true })}
                        disabled={isBusy}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Skip & Complete
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => complete.mutate({})} disabled={isBusy}>
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Complete
                      </Button>
                    )}

                    <Button size="sm" variant="secondary" onClick={() => reprint.mutate()} disabled={isBusy}>
                      <Printer className="w-4 h-4 mr-2" /> Reprint
                    </Button>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="flex items-center justify-between text-xs text-titan-text-muted">
                  <div>Reprints: {data.reprintCount}</div>
                  <Link className="underline" to={ROUTES.orders.detail(data.order.id)}>
                    Open order
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                {data.events.length === 0 ? (
                  <div className="text-sm text-titan-text-muted">No events yet.</div>
                ) : (
                  <div className="space-y-3">
                    {data.events.map((e) => (
                      <div key={e.id} className="border border-titan-border-subtle rounded-md p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-titan-text-primary">{formatEventLabel(e.type)}</div>
                          <div className="text-xs text-titan-text-muted">
                            {new Date(e.createdAt).toLocaleString()}
                          </div>
                        </div>
                        {e.type === "note" && e.payload?.text && (
                          <div className="text-sm text-titan-text-secondary mt-2 whitespace-pre-wrap">{e.payload.text}</div>
                        )}
                        {e.type === "timer_stopped" && typeof e.payload?.seconds === "number" && (
                          <div className="text-xs text-titan-text-muted mt-2">+{e.payload.seconds}s</div>
                        )}
                        {e.type === "media_used_set" && (
                          <div className="text-sm text-titan-text-secondary mt-2">
                            {String(e.payload?.text || "")}
                            {e.payload?.qty != null ? ` • ${e.payload.qty}` : ""}
                            {e.payload?.unit ? ` ${e.payload.unit}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Media Used</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-3">
                <Input
                  placeholder={`e.g. 3/4" PVC, 54" roll`}
                  value={mediaText}
                  onChange={(e) => setMediaText(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Qty" value={mediaQty} onChange={(e) => setMediaQty(e.target.value)} />
                  <Input placeholder="Unit" value={mediaUnit} onChange={(e) => setMediaUnit(e.target.value)} />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const qtyNum = mediaQty.trim() ? Number(mediaQty) : undefined;
                    setMedia.mutate({
                      text: mediaText,
                      qty: Number.isFinite(qtyNum as any) ? qtyNum : undefined,
                      unit: mediaUnit.trim() || undefined,
                    });
                  }}
                  disabled={isBusy || !mediaText.trim()}
                >
                  Save
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">Add Note</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-3">
                <Textarea
                  placeholder="Add a production note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    addNote.mutate(noteText);
                    setNoteText("");
                  }}
                  disabled={isBusy || !noteText.trim()}
                >
                  Add
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </ContentLayout>
    </Page>
  );
}
