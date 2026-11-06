import { type ReactNode, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** Matches the Inbound Orders workspace's local UI preference pattern. */
export function InboundStatusDisclosure({
  preferenceKey, title, summary, children, openRequest,
}: {
  preferenceKey: string;
  title: string;
  summary: string;
  children: ReactNode;
  openRequest?: number;
}) {
  const [expanded, setExpanded] = useState(() => (
    typeof window !== "undefined" && window.localStorage.getItem(preferenceKey) === "true"
  ));
  const detailsId = useId();

  useEffect(() => {
    window.localStorage.setItem(preferenceKey, String(expanded));
  }, [expanded, preferenceKey]);

  useEffect(() => {
    if (openRequest) setExpanded(true);
  }, [openRequest]);

  return (
    <section aria-label={title} className="mt-2 shrink-0 rounded-md border border-border bg-background text-foreground">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="font-medium">{title}</span>
        <span className="min-w-0 text-xs text-muted-foreground" role="status" aria-live="polite">{summary}</span>
      </button>
      <div id={detailsId} hidden={!expanded} className="max-h-48 overflow-y-auto overscroll-contain border-t border-border px-3 py-2 text-sm">
        {children}
      </div>
    </section>
  );
}
