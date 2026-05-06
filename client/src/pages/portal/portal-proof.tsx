import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useProofToken,
  useSubmitProofAction,
  type ProofAction,
  type PortalProofAttachment,
  type LineItemDisplay,
  type PortalProofText,
} from "@/hooks/portal/useProofToken";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

// ---- Image proof viewer (zoom + drag-to-pan) ------------------------------------

function ImageProofViewer({ attachment }: { attachment: PortalProofAttachment }) {
  const [zoom, setZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const panRef = useRef<HTMLDivElement | null>(null);

  const src = attachment.previewUrl ?? attachment.originalUrl;
  const displayName = attachment.originalFilename ?? attachment.fileName;

  return (
    <div className="flex flex-col gap-2 md:flex-1 md:min-h-0">
      {/* Zoom toolbar */}
      <div className="flex shrink-0 items-center gap-1 rounded-lg border bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setZoom((v) => Math.max(25, v - 10))}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs font-medium tabular-nums">{zoom}%</span>
        <button
          type="button"
          onClick={() => setZoom((v) => Math.min(300, v + 10))}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-1 h-3 w-px bg-border" />
        <button
          type="button"
          onClick={() => setZoom(100)}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
          title="Reset to 100%"
        >
          Reset
        </button>
      </div>
      {/* Scroll / pan container */}
      <div
        ref={panRef}
        className="max-h-[65vh] overflow-auto rounded border md:max-h-none md:flex-1 md:min-h-0"
        style={{
          cursor: zoom > 100 ? (isDragging ? "grabbing" : "grab") : "default",
          userSelect: "none",
        }}
        onMouseDown={(e) => {
          if (zoom <= 100 || !panRef.current) return;
          e.preventDefault();
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            scrollLeft: panRef.current.scrollLeft,
            scrollTop: panRef.current.scrollTop,
          };
          setIsDragging(true);
        }}
        onMouseMove={(e) => {
          if (!isDragging || !dragRef.current || !panRef.current) return;
          panRef.current.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX);
          panRef.current.scrollTop = dragRef.current.scrollTop - (e.clientY - dragRef.current.startY);
        }}
        onMouseUp={() => { setIsDragging(false); dragRef.current = null; }}
        onMouseLeave={() => { setIsDragging(false); dragRef.current = null; }}
      >
        <img
          src={src!}
          alt={displayName}
          className="block h-auto max-w-none"
          style={{ width: `${zoom}%`, pointerEvents: isDragging ? "none" : "auto" }}
          draggable={false}
        />
      </div>
      {attachment.downloadUrl && (
        <a
          href={attachment.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Download className="h-3.5 w-3.5" />
          Download original
        </a>
      )}
    </div>
  );
}

// ---- Order specs section -------------------------------------------------------

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function ProofSpecsSection({ display }: { display: LineItemDisplay }) {
  const na = <span className="italic text-muted-foreground">Not specified</span>;

  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <p className="text-sm font-medium">Order Specs</p>
      <div className="space-y-2">
        {/* Core fixed rows */}
        <SpecRow label="Job Number" value={display.orderNumber ?? na} />
        <SpecRow label="Product" value={display.productName ?? na} />
        <SpecRow label="Ordered Size" value={display.orderedSize ?? na} />
        <SpecRow label="Quantity" value={display.quantity != null ? display.quantity : na} />
        {/* Dynamic option rows — only rendered when values are present */}
        {display.options.map(({ label, value }) => (
          <SpecRow key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

// ---- Proof text section (customer note + disclaimer) --------------------------

function ProofTextSection({ proofText }: { proofText: PortalProofText }) {
  return (
    <div className="space-y-3">
      {proofText.customerNote && (
        <div className="rounded-lg border bg-card p-4 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proof Note
          </p>
          <p className="text-sm">{proofText.customerNote}</p>
        </div>
      )}
      {proofText.disclaimer && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Standard Approval Notice
          </p>
          <p className="text-sm text-muted-foreground">{proofText.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

// ---- Attachment preview --------------------------------------------------------

function AttachmentPreview({ attachment }: { attachment: PortalProofAttachment }) {
  const isImage = attachment.mimeType?.startsWith("image/") ?? false;
  const isPdf = attachment.mimeType === "application/pdf";
  const displayName = attachment.originalFilename ?? attachment.fileName;

  // Multi-page PDF: show page thumbnails
  if (isPdf && attachment.pages.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {attachment.pages.length} page{attachment.pages.length !== 1 ? "s" : ""}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {attachment.pages.map((page) => {
            const src = page.thumbUrl ?? page.previewUrl;
            return src ? (
              <a
                key={page.pageIndex}
                href={attachment.downloadUrl ?? attachment.originalUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block border rounded overflow-hidden hover:ring-2 hover:ring-primary transition"
              >
                <img
                  src={src}
                  alt={`Page ${page.pageIndex + 1}`}
                  className="w-full object-cover"
                />
                <p className="text-xs text-center py-1 text-muted-foreground">
                  p.{page.pageIndex + 1}
                </p>
              </a>
            ) : null;
          })}
        </div>
        {attachment.downloadUrl && (
          <a
            href={attachment.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            Download full PDF
          </a>
        )}
      </div>
    );
  }

  if (isPdf && attachment.originalUrl) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded border bg-white">
          <iframe
            title={displayName}
            src={attachment.originalUrl}
            className="h-[70vh] w-full"
          />
        </div>
        {attachment.downloadUrl && (
          <a
            href={attachment.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            Download full PDF
          </a>
        )}
      </div>
    );
  }

  // Image
  if (isImage) {
    const src = attachment.previewUrl ?? attachment.originalUrl;
    if (src) {
      return (
        <div className="space-y-2">
          <img
            src={src}
            alt={displayName}
            className="max-w-full rounded border object-contain max-h-[70vh]"
          />
          {attachment.downloadUrl && (
            <a
              href={attachment.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download original
            </a>
          )}
        </div>
      );
    }
  }

  // Fallback: download link only
  return (
    <div className="flex items-center gap-3 rounded border p-4 bg-muted/30">
      <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{displayName}</p>
        {attachment.downloadUrl ? (
          <a
            href={attachment.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
          >
            <Download className="h-3 w-3" />
            Download to review
          </a>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">No preview available</p>
        )}
      </div>
    </div>
  );
}

// ---- Shell layouts ------------------------------------------------------------

function ProofShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">{children}</div>
    </div>
  );
}

function ProofHeader({ versionNumber, createdAt }: { versionNumber: number; createdAt: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Proof for Review</p>
      <h1 className="text-2xl font-semibold">Version {versionNumber}</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        Sent {new Date(createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
    </div>
  );
}

// ---- Status badge -------------------------------------------------------------

const STATUS_CONFIG = {
  approved: {
    icon: CheckCircle2,
    label: "Approved",
    color: "text-green-600",
    bg: "bg-green-50 border-green-200",
  },
  rejected: {
    icon: XCircle,
    label: "Rejected",
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
  },
  revision_requested: {
    icon: RotateCcw,
    label: "Revision Requested",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
} as const;

function AlreadyReviewedBanner({
  status,
}: {
  status: "approved" | "rejected" | "revision_requested";
}) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${cfg.bg}`}>
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg.color}`} />
      <div>
        <p className={`font-medium ${cfg.color}`}>{cfg.label}</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          This proof has already been reviewed. Contact your account manager if you need to make
          a change.
        </p>
      </div>
    </div>
  );
}

// ---- Action panel ------------------------------------------------------------

const ACTION_LABELS: Record<ProofAction, string> = {
  approve: "Approve",
  reject: "Reject",
  revision_request: "Request Revision",
};

const COMMENT_REQUIRED_HINT: Partial<Record<ProofAction, string>> = {
  reject: "Please describe why you are rejecting this proof.",
  revision_request: "Please describe what changes are needed.",
};

function ActionPanel({
  isPending,
  disableApprove,
  onSubmit,
}: {
  isPending: boolean;
  disableApprove: boolean;
  onSubmit: (action: ProofAction, comment: string) => void;
}) {
  const [selected, setSelected] = useState<ProofAction | null>(null);
  const [comment, setComment] = useState("");

  const needsComment = selected === "reject" || selected === "revision_request";
  const canSubmit = selected !== null && (!needsComment || comment.trim().length > 0);

  function handleSelect(action: ProofAction) {
    setSelected(action);
    setComment("");
  }

  function handleSubmit() {
    if (!selected) return;
    onSubmit(selected, comment);
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <p className="text-sm font-medium">Your decision</p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={selected === "approve" ? "default" : "outline"}
          className={selected === "approve" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
          onClick={() => handleSelect("approve")}
          disabled={isPending || disableApprove}
        >
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
          Approve
        </Button>
        <Button
          variant={selected === "revision_request" ? "default" : "outline"}
          className={
            selected === "revision_request" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""
          }
          onClick={() => handleSelect("revision_request")}
          disabled={isPending}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Request Revision
        </Button>
        <Button
          variant={selected === "reject" ? "destructive" : "outline"}
          onClick={() => handleSelect("reject")}
          disabled={isPending}
        >
          <XCircle className="mr-1.5 h-4 w-4" />
          Reject
        </Button>
      </div>

      {/* Comment field */}
      {selected !== null && (
        <div className="space-y-1.5">
          <label className="text-sm text-muted-foreground">
            {needsComment ? (
              <>
                {COMMENT_REQUIRED_HINT[selected]}{" "}
                <span className="text-destructive">*</span>
              </>
            ) : (
              "Add a note (optional)"
            )}
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={needsComment ? "Describe the issue…" : "Any additional notes…"}
            rows={3}
            disabled={isPending}
          />
        </div>
      )}

      {/* Submit */}
      {selected !== null && (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Submitting as:{" "}
              <span className="font-medium text-foreground">{ACTION_LABELS[selected]}</span>
            </p>
            <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm {ACTION_LABELS[selected]}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Main page ---------------------------------------------------------------

export default function PortalProofPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useProofToken(token ?? "");
  const mutation = useSubmitProofAction(token ?? "");

  // Track local success state so we can show confirmation even before refetch
  const [successDecision, setSuccessDecision] = useState<ProofAction | null>(null);

  function handleSubmit(action: ProofAction, comment: string) {
    mutation.mutate(
      { action, comment },
      {
        onSuccess: () => setSuccessDecision(action),
        onError: () => {
          // Handled inline via mutation.error below
        },
      },
    );
  }

  // ---- Loading ----
  if (isLoading) {
    return (
      <ProofShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </ProofShell>
    );
  }

  // ---- Error loading proof ----
  if (error || !data) {
    const httpStatus = (error as any)?.status;
    // 403 = invalid / expired / revoked token; 404 = not found
    // 409 = draft proof (internal error — tokens should never be issued for drafts)
    // Superseded proofs now return 200 with a resolved status, not 409.
    const isInvalidLink = !httpStatus || httpStatus === 403 || httpStatus === 404;
    return (
      <ProofShell>
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-5">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">
              {isInvalidLink ? "This link is no longer valid" : "Unable to load proof"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {isInvalidLink
                ? "This proof link may have expired or already been used. Please check your email for the correct link, or contact your account manager."
                : "Something went wrong. Please try refreshing the page or contact your account manager."}
            </p>
          </div>
        </div>
      </ProofShell>
    );
  }

  const primaryAttachment = data.attachments[0] ?? null;
  const proofPreviewUnavailable = !primaryAttachment || primaryAttachment.previewStatus !== "ready";
  const primaryIsImage = (primaryAttachment?.mimeType?.startsWith("image/") ?? false)
    && Boolean(primaryAttachment?.previewUrl ?? primaryAttachment?.originalUrl);

  // ---- Success confirmation ----
  if (successDecision !== null) {
    const cfg = STATUS_CONFIG[
      successDecision === "approve"
        ? "approved"
        : successDecision === "reject"
          ? "rejected"
          : "revision_requested"
    ];
    const Icon = cfg.icon;
    return (
      <ProofShell>
        <ProofHeader
          versionNumber={data.proofVersion.versionNumber}
          createdAt={data.proofVersion.createdAt}
        />
        <div className={`flex items-start gap-3 rounded-lg border p-5 ${cfg.bg}`}>
          <Icon className={`h-6 w-6 mt-0.5 shrink-0 ${cfg.color}`} />
          <div>
            <p className={`text-lg font-semibold ${cfg.color}`}>
              {successDecision === "approve" && "Proof approved — thank you!"}
              {successDecision === "reject" && "Proof rejected"}
              {successDecision === "revision_request" && "Revision requested"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {successDecision === "approve" &&
                "Your approval has been recorded. We will proceed with production."}
              {successDecision === "reject" &&
                "Your rejection has been recorded. Your account manager will be in touch."}
              {successDecision === "revision_request" &&
                "Your revision request has been recorded. We will send an updated proof soon."}
            </p>
          </div>
        </div>
      </ProofShell>
    );
  }

  // ---- Already reviewed (GET returned non-pending status) ----
  if (data.status !== "pending") {
    return (
      <div className="flex min-h-screen flex-col bg-background md:h-screen md:flex-row md:overflow-hidden">
        {/* Left: viewer */}
        <div className="flex flex-col md:flex-1 md:min-h-0">
          <div className="shrink-0 border-b px-4 py-4 md:px-6">
            <ProofHeader
              versionNumber={data.proofVersion.versionNumber}
              createdAt={data.proofVersion.createdAt}
            />
          </div>
          <div className="flex flex-col p-4 md:flex-1 md:min-h-0 md:overflow-y-auto md:p-6">
            {primaryAttachment ? (
              primaryIsImage
                ? <ImageProofViewer attachment={primaryAttachment} />
                : <AttachmentPreview attachment={primaryAttachment} />
            ) : (
              <div className="rounded border p-6 text-center text-sm text-muted-foreground">
                No preview available. Contact your account manager.
              </div>
            )}
          </div>
        </div>
        {/* Right: sidebar */}
        <div className="border-t md:w-[360px] md:shrink-0 md:border-l md:border-t-0 md:overflow-y-auto">
          <div className="space-y-4 p-4 md:p-5">
            {data.lineItemDisplay && <ProofSpecsSection display={data.lineItemDisplay} />}
            {data.proofText && (data.proofText.customerNote || data.proofText.disclaimer) && (
              <ProofTextSection proofText={data.proofText} />
            )}
            <AlreadyReviewedBanner status={data.status} />
          </div>
        </div>
      </div>
    );
  }

  // ---- Pending: ready for customer action ----
  return (
    <div className="flex min-h-screen flex-col bg-background md:h-screen md:flex-row md:overflow-hidden">
      {/* Left: viewer */}
      <div className="flex flex-col md:flex-1 md:min-h-0">
        <div className="shrink-0 border-b px-4 py-4 md:px-6">
          <ProofHeader
            versionNumber={data.proofVersion.versionNumber}
            createdAt={data.proofVersion.createdAt}
          />
        </div>
        <div className="flex flex-col p-4 md:flex-1 md:min-h-0 md:overflow-y-auto md:p-6">
          {primaryAttachment ? (
            primaryIsImage
              ? <ImageProofViewer attachment={primaryAttachment} />
              : <AttachmentPreview attachment={primaryAttachment} />
          ) : (
            <div className="rounded border p-6 text-center text-sm text-muted-foreground">
              No preview available. Contact your account manager.
            </div>
          )}
        </div>
      </div>

      {/* Right: sidebar */}
      <div className="border-t md:w-[360px] md:shrink-0 md:border-l md:border-t-0 md:overflow-y-auto">
        <div className="space-y-4 p-4 md:p-5">
          {data.lineItemDisplay && <ProofSpecsSection display={data.lineItemDisplay} />}
          {data.proofText && (data.proofText.customerNote || data.proofText.disclaimer) && (
            <ProofTextSection proofText={data.proofText} />
          )}

          {mutation.error && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">
                {mutation.error?.message === "This proof does not include an artwork preview and cannot be sent to the customer."
                  ? "This proof preview is unavailable. Please contact us before approving."
                  : mutation.error?.message?.startsWith("409")
                    ? "This proof has already been reviewed. Please refresh the page."
                    : "Something went wrong. Please try again or contact your account manager."}
              </p>
            </div>
          )}

          {proofPreviewUnavailable ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-medium text-amber-900">This proof preview is unavailable. Please contact us before approving.</p>
                {primaryAttachment?.previewError ? (
                  <p className="mt-1 text-sm text-amber-800">{primaryAttachment.previewError}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <ActionPanel isPending={mutation.isPending} disableApprove={proofPreviewUnavailable} onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
