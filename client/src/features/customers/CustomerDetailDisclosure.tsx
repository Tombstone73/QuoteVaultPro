import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** UI preference only; customer data and editor state remain outside storage. */
export function CustomerDetailDisclosure({ title, preferenceKey, summary, actions, children }: {
  title: string;
  preferenceKey: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    try { return window.localStorage.getItem(preferenceKey) !== "false"; }
    catch { return true; }
  });
  const contentId = useId();
  useEffect(() => {
    try { window.localStorage.setItem(preferenceKey, String(expanded)); }
    catch { /* A blocked preference store must not prevent editing. */ }
  }, [expanded, preferenceKey]);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return <section aria-label={`${title} disclosure`} className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <button type="button" aria-expanded={expanded} aria-controls={contentId}
        className="flex min-w-0 flex-wrap items-center gap-2 rounded text-left text-sm text-titan-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onClick={() => setExpanded(value => !value)}>
        <Chevron className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-semibold">{title}</span>
        {summary && <span className="text-xs font-normal text-titan-text-secondary">{summary}</span>}
      </button>
      {actions}
    </div>
    <div id={contentId} hidden={!expanded}>{children}</div>
  </section>;
}
