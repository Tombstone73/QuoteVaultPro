import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

type QBStatusLike = {
  authState?: string;
  healthState?: string;
  healthMessage?: string;
  lastErrorAt?: string;
};

function getSnoozeKey(params: { organizationId: string; userId: string }) {
  return `qbTransientSnoozeUntil:${params.organizationId}:${params.userId}`;
}

function parseMs(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function QBTransientDisconnectBanner(props: {
  qbStatus: QBStatusLike | undefined;
  className?: string;
  showOpenIntegrations?: boolean;
}) {
  const { qbStatus, className, showOpenIntegrations = false } = props;
  const { user } = useAuth();

  const { data: org } = useQuery<{ id: string }>({
    queryKey: ["/api/organization/current"],
    queryFn: async () => {
      const response = await fetch("/api/organization/current", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      const data = await response.json();
      return { id: String((data as any)?.id || "") };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const organizationId = org?.id || "";
  const userId = String((user as any)?.id || "");

  const storageKey = useMemo(() => {
    if (!organizationId || !userId) return null;
    return getSnoozeKey({ organizationId, userId });
  }, [organizationId, userId]);

  const [snoozeUntilMs, setSnoozeUntilMs] = useState<number>(0);

  useEffect(() => {
    if (!storageKey) return;
    if (typeof window === "undefined") return;
    setSnoozeUntilMs(parseMs(window.localStorage.getItem(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const now = Date.now();
    if (!snoozeUntilMs || snoozeUntilMs <= now) return;

    const delay = Math.min(2 ** 31 - 1, snoozeUntilMs - now + 250);
    const t = window.setTimeout(() => {
      setSnoozeUntilMs(0);
    }, delay);
    return () => window.clearTimeout(t);
  }, [storageKey, snoozeUntilMs]);

  const authState = qbStatus?.authState || "";
  const healthState = qbStatus?.healthState || "";
  const snoozed = !!snoozeUntilMs && snoozeUntilMs > Date.now();

  const shouldShow = authState === "connected" && healthState === "transient_error" && !snoozed;
  if (!shouldShow) return null;

  const onDismiss = (hours: number) => {
    if (!storageKey) return;
    const until = Date.now() + hours * 60 * 60 * 1000;
    window.localStorage.setItem(storageKey, String(until));
    setSnoozeUntilMs(until);
  };

  const lastErrorText = qbStatus?.lastErrorAt ? new Date(qbStatus.lastErrorAt).toLocaleString() : null;

  return (
    <div className={className ? className : ""}>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-amber-50/50 px-4 py-3 text-sm dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
          <div>
            <div className="font-medium text-foreground">QuickBooks is temporarily unavailable. Sync will resume automatically.</div>
            {(qbStatus?.healthMessage || lastErrorText) ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {lastErrorText ? `Last error: ${lastErrorText}` : null}
                {lastErrorText && qbStatus?.healthMessage ? " — " : null}
                {qbStatus?.healthMessage ? qbStatus.healthMessage : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" size="sm" onClick={() => onDismiss(8)}>
            Dismiss 8 hours
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onDismiss(24)}>
            Dismiss 24 hours
          </Button>
          {showOpenIntegrations ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                window.location.href = "/settings/integrations";
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Integrations
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
