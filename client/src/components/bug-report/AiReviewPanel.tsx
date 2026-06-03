import { Brain, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiReviewDto, CurrentBugAiReviewResponse } from "@shared/aiReviewContracts";

interface AiReviewPanelProps {
  data: CurrentBugAiReviewResponse | null | undefined;
  feedbackType: "bug" | "feature";
  referenceNumber?: string | null;
  canRunFallback?: boolean;
  error?: Error | null;
  isLoading: boolean;
  isActionPending: boolean;
  onRun: () => void;
  onRerun: (reviewId: string) => void;
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return "Unknown confidence";
  if (confidence >= 0.8) return "High confidence";
  if (confidence >= 0.5) return "Medium confidence";
  return "Low confidence";
}

function AdvisoryBadge() {
  return <Badge variant="outline">AI Advisory</Badge>;
}

function MetricBadge({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge variant="secondary" className="max-w-full whitespace-normal text-left">
        {formatLabel(value)}
      </Badge>
    </div>
  );
}

function ReviewList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="space-y-1 text-sm text-foreground">
        {items.map((item, index) => (
          <li key={`${label}-${index}`} className="rounded-md bg-muted/30 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedReview({ review, canRun, isActionPending, onRerun }: {
  review: AiReviewDto;
  canRun: boolean;
  isActionPending: boolean;
  onRerun: (reviewId: string) => void;
}) {
  const confidence = review.confidence;
  const confidencePct = confidence == null ? 0 : Math.round(confidence * 100);
  const result = review.result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdvisoryBadge />
        <Badge variant="secondary">Completed</Badge>
        {review.completedAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(review.completedAt).toLocaleString()}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
        <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-foreground">
          {review.summary ?? result?.summary ?? "No summary returned."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Confidence</p>
          <span className="text-xs text-muted-foreground">{confidenceLabel(confidence)} ({confidencePct}%)</span>
        </div>
        <Progress value={confidencePct} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricBadge label="Severity Assessment" value={review.severityAssessment} />
        <MetricBadge label="Workflow Impact" value={review.workflowImpact} />
        <MetricBadge label="Revenue Risk" value={review.revenueRisk} />
        <MetricBadge label="Suggested Owner" value={review.suggestedOwner} />
        <MetricBadge label="Business Impact" value={review.businessImpact} />
        <MetricBadge label="Urgency" value={review.urgency} />
        <MetricBadge label="Implementation Priority" value={review.implementationPriority} />
      </div>

      <ReviewList label="Affected Modules" items={result?.affectedModules ?? []} />
      <ReviewList label="Reasoning" items={result?.reasoning ?? []} />
      <ReviewList label="Unknowns" items={result?.unknowns ?? []} />

      {canRun && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => onRerun(review.id)}
          disabled={isActionPending}
        >
          <RefreshCw className={isActionPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Rerun AI Review
        </Button>
      )}
    </div>
  );
}

function getErrorStatus(error: Error | null | undefined): number | null {
  const candidate = error as (Error & { status?: unknown }) | null | undefined;
  return typeof candidate?.status === "number" ? candidate.status : null;
}

export function AiReviewPanel({
  data,
  feedbackType,
  referenceNumber,
  canRunFallback = false,
  error,
  isLoading,
  isActionPending,
  onRun,
  onRerun,
}: AiReviewPanelProps) {
  const review = data?.review ?? null;
  const isBugReport = feedbackType === "bug";
  const canRun = isBugReport && Boolean(data?.canRun ?? canRunFallback);
  const featureEnabled = data?.featureFlags.enabled ?? true;
  const errorStatus = getErrorStatus(error);
  const permissionDenied = errorStatus === 401 || errorStatus === 403;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4" />
          {referenceNumber ? `AI Review for ${referenceNumber}` : "AI Review"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !review ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdvisoryBadge />
              <Badge variant="secondary">No review yet</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              AI can produce an advisory review for human triage. It will not change this bug report.
            </p>
            {!isBugReport ? (
              <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                AI bug review is available for bug reports only in Phase 1.
              </p>
            ) : !featureEnabled ? (
              <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                AI review is disabled.
              </p>
            ) : permissionDenied || !canRun ? (
              <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                AI review available to admins/owners only.
              </p>
            ) : (
              <Button type="button" size="sm" className="gap-2" onClick={onRun} disabled={isActionPending}>
                <Sparkles className="h-4 w-4" />
                Run AI Review
              </Button>
            )}
          </div>
        ) : review.status === "pending" || review.status === "processing" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdvisoryBadge />
              <Badge variant="secondary">{formatLabel(review.status)}</Badge>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {review.status === "pending" ? "AI review is queued." : "AI review is processing."}
              </p>
              <Progress value={review.status === "pending" ? 35 : 65} />
            </div>
          </div>
        ) : review.status === "failed" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdvisoryBadge />
              <Badge variant="destructive">Failed</Badge>
            </div>
            <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-foreground">
              {review.errorMessage ?? "AI review failed."}
            </p>
            {canRun && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onRerun(review.id)}
                disabled={isActionPending}
              >
                <RefreshCw className={isActionPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Rerun AI Review
              </Button>
            )}
          </div>
        ) : (
          <CompletedReview review={review} canRun={canRun} isActionPending={isActionPending} onRerun={onRerun} />
        )}
      </CardContent>
    </Card>
  );
}
