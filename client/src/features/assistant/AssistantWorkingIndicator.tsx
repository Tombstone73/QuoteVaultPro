import * as React from "react";
import { LoaderCircle } from "lucide-react";

export function formatAssistantWorkingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function resolveAssistantWorkingState(input: { turnPending: boolean; planPreparationPending: boolean; planExecutionPending: boolean }) {
  if (input.planExecutionPending) return { active: true, label: "Applying changes…" };
  if (input.planPreparationPending) return { active: true, label: "Preparing changes…" };
  return { active: input.turnPending, label: "Thinking…" };
}

/** A client-only lifecycle indicator. It deliberately exposes no model
 * reasoning or guessed tool stages: callers supply only verified request state. */
export function AssistantWorkingIndicator({ active, label = "Thinking…" }: { active: boolean; label?: string }) {
  const [elapsedMs, setElapsedMs] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [active]);

  if (!active) return null;

  return (
    <article className="max-w-3xl" data-testid="assistant-working-indicator">
      <div role="status" aria-live="polite" aria-atomic="true" aria-label="AI is working" className="inline-flex min-h-10 items-center gap-2 rounded-2xl rounded-bl-md border border-border/70 bg-muted/45 px-3 py-2 text-sm text-muted-foreground shadow-sm">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <span aria-hidden="true" className="font-medium text-foreground">{label}</span>
        <span aria-hidden="true" className="tabular-nums">{formatAssistantWorkingElapsed(elapsedMs)}</span>
      </div>
    </article>
  );
}
