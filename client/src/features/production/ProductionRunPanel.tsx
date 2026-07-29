import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useProductionRunFiles,
  useReplaceProductionRunFile,
  useRetireProductionRunFile,
  useTransitionProductionRun,
  useUploadProductionRunFile,
  type ProductionRunFileSummary,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";
import { Upload, Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
export { isProductionRunItem, productionRunToBoardItem } from "@/lib/productionRuns";

function runAction(runStatus: ProductionRunListItem["runStatus"]): "release" | "start" | "complete" | null {
  if (runStatus === "draft") return "release";
  if (runStatus === "ready_for_production") return "start";
  if (runStatus === "in_production") return "complete";
  return null;
}

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

export function ProductionRunPanel({ run }: { run: ProductionRunListItem }) {
  const transition = useTransitionProductionRun();
  const filesQuery = useProductionRunFiles(run.id, true);
  const uploadFile = useUploadProductionRunFile();
  const replaceFile = useReplaceProductionRunFile();
  const retireFile = useRetireProductionRunFile();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceFileId, setReplaceFileId] = useState<string | null>(null);
  const action = runAction(run.runStatus);
  const placements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  const mismatch = placements > 0 && placements !== run.totalAllocatedQuantity;
  const fileState = filesQuery.data ?? { files: run.files ?? [], activeCount: run.fileCount ?? 0, replacementRequired: run.replacementRequired ?? (run.fileCount ?? 0) === 0 };
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

  return (
    <div className="rounded-md border border-titan-border-subtle bg-titan-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{run.displayNumber}</h3>
            <Badge variant="secondary">{run.runStatus.replace(/_/g, " ")}</Badge>
          </div>
          <div className="mt-1 text-xs text-titan-text-muted">
            Order {run.orderNumber} - {run.customerName} - {run.memberCount} line items
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {action ? (
            <Button
              size="sm"
              onClick={() => transition.mutate({ runId: run.id, action })}
              disabled={transition.isPending}
            >
              {action === "release" ? "Release" : action === "start" ? "Start" : "Complete"}
            </Button>
          ) : null}
          {run.runStatus !== "completed" && run.runStatus !== "canceled" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transition.mutate({ runId: run.id, action: "cancel", reason: "Canceled from production board" })}
              disabled={transition.isPending}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <div>Sheets: <span className="font-semibold">{run.plannedSheetCount ?? "—"}</span></div>
        <div>Pieces/sheet: <span className="font-semibold">{run.nominalPiecesPerSheet ?? "—"}</span></div>
        <div>Allocated: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
        <div>Files: <span className="font-semibold">{fileState.activeCount}</span></div>
      </div>
      {mismatch ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          {placements} expected placements differs from {run.totalAllocatedQuantity} allocated pieces.
        </div>
      ) : null}
      {fileState.replacementRequired ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          Shared nested final production file required before this run can be completed.
        </div>
      ) : null}
      <div className="mt-3 rounded-md border border-titan-border-subtle p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold">Shared Production Files</div>
            <div className="text-[11px] text-titan-text-muted">Stored once on the run; member line items remain listed below.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => uploadInputRef.current?.click()} disabled={terminalRun || fileMutationPending}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            Upload
          </Button>
          <input ref={uploadInputRef} type="file" className="hidden" onChange={handleUploadSelected} />
          <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplaceSelected} />
        </div>
        {filesQuery.isError ? (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">Unable to load shared files. Try refreshing the run.</div>
        ) : filesQuery.isLoading ? (
          <div className="mt-3 text-xs text-titan-text-muted">Loading shared files...</div>
        ) : activeFiles.length === 0 ? (
          <div className="mt-3 text-xs text-titan-text-muted">No active shared production files.</div>
        ) : (
          <div className="mt-3 divide-y divide-titan-border-subtle rounded border border-titan-border-subtle">
            {activeFiles.map((file) => (
              <div key={file.id} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[56px_minmax(0,1fr)_auto]">
                <div className="h-12 w-12 overflow-hidden rounded border border-titan-border-subtle bg-black/20">
                  {file.thumbnailUrl ? <img src={file.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-titan-text-muted">No preview</div>}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{file.fileName}</div>
                  <div className="text-titan-text-muted">
                    Uploaded {formatDateTime(file.createdAt)} by {file.uploadedByName || "Unknown user"} - {formatFileSize(file.sizeBytes)} - {file.mimeType || "Unknown MIME"}
                  </div>
                  <div className="text-titan-text-muted">{bridgeLabel(file)}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" aria-label={`Open ${file.fileName}`} title="Open file" onClick={() => window.open(file.openUrl, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Download ${file.fileName}`} title="Download file" onClick={() => void downloadAuthenticatedFile(file.downloadUrl, file.fileName)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Replace ${file.fileName}`} title="Replace file" disabled={terminalRun || fileMutationPending || file.localBridge?.unsafeToRetire} onClick={() => { setReplaceFileId(file.id); replaceInputRef.current?.click(); }}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Retire ${file.fileName}`} title="Retire file" disabled={fileMutationPending || file.localBridge?.unsafeToRetire} onClick={() => {
                    const reason = window.prompt("Reason for retiring this shared production file");
                    if (reason !== null) retireFile.mutate({ runId: run.id, fileId: file.id, reason });
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {historyFiles.length > 0 ? (
          <div className="mt-3 space-y-1 text-[11px] text-titan-text-muted">
            {historyFiles.map((file) => (
              <div key={file.id} className="truncate">
                {file.fileName} - {file.status} - {formatDateTime(file.createdAt)} - {bridgeLabel(file)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 divide-y divide-titan-border-subtle rounded-md border border-titan-border-subtle">
        {run.members.map((member) => (
          <div key={member.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="min-w-0 truncate">
              {member.lineNumber ? `Line ${member.lineNumber}: ` : ""}{member.description}
            </div>
            <div>Ordered {member.orderedQuantity}</div>
            <div>Run {member.allocatedQuantity}</div>
            <div>Remaining {member.remainingAfterRun}</div>
          </div>
        ))}
      </div>
      {run.notes ? <div className="mt-3 text-xs text-titan-text-muted">{run.notes}</div> : null}
    </div>
  );
}
