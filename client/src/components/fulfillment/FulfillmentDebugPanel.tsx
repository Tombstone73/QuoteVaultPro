import { useState } from "react";
import { ChevronDown, ChevronUp, Bug } from "lucide-react";

interface FulfillmentDebugPanelProps {
  enabled: boolean;
  lastResponse: unknown;
  lastError: { code?: string; message?: string } | null;
}

export function FulfillmentDebugPanel({ enabled, lastResponse, lastError }: FulfillmentDebugPanelProps) {
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Bug className="h-3.5 w-3.5" />
          Debug API Panel
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Error</p>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
{JSON.stringify(lastError ?? null, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Response</p>
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
{JSON.stringify(lastResponse ?? null, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
