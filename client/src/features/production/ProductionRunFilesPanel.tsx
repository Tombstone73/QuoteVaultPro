import { useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Download, ExternalLink, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useProductionRunFiles,
  useReplaceProductionRunFile,
  useRetireProductionRunFile,
  useUploadProductionRunFile,
  type ProductionRunFileSummary,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";

function formatFileSize(sizeBytes: number | null | undefined) {
  const size = Number(sizeBytes) || 0;
  if (size <= 0) return "Unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function bridgeLabel(file: ProductionRunFileSummary) {
  const status = file.localBridge?.status ?? "none";
  if (status === "none") return "Local Bridge: not queued";
  if (status === "claimed") return "Local Bridge: transferring";
  if (status === "succeeded") return "Local Bridge: copied";
  if (status === "failed") return `Local Bridge: failed${file.localBridge.lastError ? ` - ${file.localBridge.lastError}` : ""}`;
  if (status === "canceled") return "Local Bridge: canceled";
  return "Local Bridge: queued";
}

function productionQuantityLabel(file: ProductionRunFileSummary) {
  const quantity = Number(file.productionQuantity ?? file.allocatedQuantity);
  return Number.isInteger(quantity) && quantity > 0 ? `Design quantity: ${quantity}` : "Design quantity unresolved";
}

type ProductionRunFilesPanelProps = {
  run: ProductionRunListItem;
};

export function ProductionRunFilesPanel({ run }: ProductionRunFilesPanelProps) {
  const filesQuery = useProductionRunFiles(run.id, true);
  const uploadFile = useUploadProductionRunFile();
  const replaceFile = useReplaceProductionRunFile();
  const retireFile = useRetireProductionRunFile();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceFileId, setReplaceFileId] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<ProductionRunFileSummary | null>(null);
  const [retireReason, setRetireReason] = useState("");

  const fileState = filesQuery.data ?? {
    files: run.files ?? [],
    activeCount: run.fileCount ?? 0,
    replacementRequired: run.replacementRequired ?? (run.fileCount ?? 0) === 0,
  };
  const activeFiles = fileState.files.filter((file) => file.status === "active");
  const historyFiles = fileState.files.filter((file) => file.status !== "active");
  const fileMutationPending = uploadFile.isPending || replaceFile.isPending || retireFile.isPending;
  const terminalRun = run.runStatus === "completed" || run.runStatus === "canceled";

  const handleUploadSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadFile.mutate({ runId: run.id, file });
  };

  const handleReplaceSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const fileId = replaceFileId;
    setReplaceFileId(null);
    if (file && fileId) replaceFile.mutate({ runId: run.id, fileId, file });
  };

  const handleConfirmRetire = () => {
    const reason = retireReason.trim();
    if (!retireTarget || !reason) return;
    retireFile.mutate(
      { runId: run.id, fileId: retireTarget.id, reason },
      {
        onSuccess: () => {
          setRetireTarget(null);
          setRetireReason("");
        },
      },
    );
  };

  return (
    <div className="rounded-md border border-titan-border-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold">Shared Production Files</div>
          <div className="text-[11px] text-titan-text-muted">Stored once on the run; member line items remain listed below.</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => uploadInputRef.current?.click()} disabled={terminalRun || fileMutationPending}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          {uploadFile.isPending ? "Uploading..." : "Upload shared file"}
        </Button>
        <input ref={uploadInputRef} type="file" className="hidden" onChange={handleUploadSelected} />
        <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplaceSelected} />
      </div>
      {fileMutationPending ? (
        <div className="mt-3 rounded border border-[#1773cf]/30 bg-[#1773cf]/10 px-3 py-2 text-xs text-slate-200">
          Updating shared production files...
        </div>
      ) : null}
      {filesQuery.isError ? (
        <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">Unable to load shared files. Try refreshing the run.</div>
      ) : filesQuery.isLoading ? (
        <div className="mt-3 text-xs text-titan-text-muted">Loading shared files...</div>
      ) : activeFiles.length === 0 ? (
        <div className="mt-3 text-xs text-titan-text-muted">No active shared production files.</div>
      ) : (
        <div className="mt-3 divide-y divide-titan-border-subtle rounded border border-titan-border-subtle">
          {activeFiles.map((file) => {
            const unsafeToChange = file.localBridge?.unsafeToRetire === true;
            return (
              <div key={file.id} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[56px_minmax(0,1fr)_auto]">
                <div className="h-12 w-12 overflow-hidden rounded border border-titan-border-subtle bg-black/20">
                  {file.thumbnailUrl ? <img src={file.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-titan-text-muted">No preview</div>}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{file.fileName}</div>
                  <div className="text-titan-text-muted">
                    Uploaded {formatDateTime(file.createdAt)} by {file.uploadedByName || "Unknown user"} - {formatFileSize(file.sizeBytes)} - {file.mimeType || "Unknown MIME"}
                  </div>
                  <div className="text-titan-text-muted">{productionQuantityLabel(file)}</div>
                  <div className="text-titan-text-muted">{bridgeLabel(file)}</div>
                  {unsafeToChange ? (
                    <div className="mt-1 flex items-center gap-1 text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Local Bridge transfer is active; replace and retire are temporarily blocked.
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" aria-label={`Open ${file.fileName}`} title="Open file" onClick={() => window.open(file.openUrl, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Download ${file.fileName}`} title="Download file" onClick={() => void downloadAuthenticatedFile(file.downloadUrl, file.fileName)}>
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Download
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Replace ${file.fileName}`} title={unsafeToChange ? "Local Bridge transfer is active" : "Replace file"} disabled={terminalRun || fileMutationPending || unsafeToChange} onClick={() => { setReplaceFileId(file.id); replaceInputRef.current?.click(); }}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Replace
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Retire ${file.fileName}`} title={unsafeToChange ? "Local Bridge transfer is active" : "Retire file"} disabled={fileMutationPending || unsafeToChange} onClick={() => { setRetireTarget(file); setRetireReason(""); }}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Retire
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {historyFiles.length > 0 ? (
        <div className="mt-3 space-y-1 text-[11px] text-titan-text-muted">
          <div className="font-semibold text-slate-300">File history</div>
          {historyFiles.map((file) => (
            <div key={file.id} className="truncate">
              {file.fileName} - {file.status} - {formatDateTime(file.createdAt)} - {bridgeLabel(file)}
            </div>
          ))}
        </div>
      ) : null}

      <AlertDialog open={!!retireTarget} onOpenChange={(open) => { if (!open) setRetireTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire Shared Production File</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring this file preserves the stored object and history. If it is the last active shared file, the run will require a replacement before release or completion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="production-run-retire-reason">Reason</Label>
            <Textarea
              id="production-run-retire-reason"
              value={retireReason}
              onChange={(event) => setRetireReason(event.target.value)}
              placeholder="Why is this shared file being retired?"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retireFile.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!retireReason.trim() || retireFile.isPending} onClick={(event) => { event.preventDefault(); handleConfirmRetire(); }}>
              {retireFile.isPending ? "Retiring..." : "Retire file"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
