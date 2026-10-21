import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast, type AppNotification } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const icons = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: AlertCircle };
const colors = {
  success: "text-emerald-600 dark:text-emerald-400",
  info: "text-sky-600 dark:text-sky-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};
type ScrollSnapshot = { top: number; anchors: { id: string; offset: number }[] };

function captureScroll(list: HTMLDivElement): ScrollSnapshot {
  const bounds = list.getBoundingClientRect();
  const anchors = Array.from(list.querySelectorAll<HTMLElement>("[data-notification-id]"))
    .filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    })
    .slice(0, 3)
    .map((row) => ({ id: row.dataset.notificationId!, offset: row.getBoundingClientRect().top - bounds.top }));
  return { top: list.scrollTop, anchors };
}

function NotificationAction({ notification, onDone }: { notification: AppNotification; onDone: () => void }) {
  const action = notification.action;
  if (!React.isValidElement<{ children?: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement>; altText?: string; disabled?: boolean }>(action)) return null;
  return (
    <button
      type="button"
      className="rounded border px-2 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={action.props.altText}
      disabled={action.props.disabled}
      onClick={(event) => { action.props.onClick?.(event); onDone(); }}
    >
      {action.props.children}
    </button>
  );
}

export function NotificationArea() {
  const { toasts, announcement, clearHistory, dismiss } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState<{ id: number; active: boolean } | null>(null);
  const [newMessages, setNewMessages] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollSnapshot = React.useRef<ScrollSnapshot>({ top: 0, anchors: [] });
  const handledArrival = React.useRef(announcement?.id);
  const current = toasts[0];
  const CurrentIcon = current ? icons[current.severity] : Bell;
  const highlightActive = !!current && !!announcement && (highlight?.id !== announcement.id || highlight.active);

  React.useEffect(() => {
    if (!announcement) return;
    setHighlight({ id: announcement.id, active: true });
    const timer = window.setTimeout(() => setHighlight({ id: announcement.id, active: false }), 4000);
    return () => window.clearTimeout(timer);
  }, [announcement?.id]);

  React.useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = 0;
    scrollSnapshot.current = captureScroll(listRef.current);
    setNewMessages(0);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!announcement || handledArrival.current === announcement.id) return;
    handledArrival.current = announcement.id;
    const list = listRef.current;
    if (!open || !list) return;
    const snapshot = scrollSnapshot.current;
    if (snapshot.top <= 16) {
      list.scrollTop = 0;
      scrollSnapshot.current = captureScroll(list);
      return;
    }
    const anchor = snapshot.anchors.find(({ id }) => id !== toasts[0]?.id) ?? snapshot.anchors[0];
    const row = anchor && Array.from(list.querySelectorAll<HTMLElement>("[data-notification-id]"))
      .find((candidate) => candidate.dataset.notificationId === anchor.id);
    if (row && anchor) {
      const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += offset - anchor.offset;
    } else {
      list.scrollTop = snapshot.top;
    }
    scrollSnapshot.current = captureScroll(list);
    setNewMessages((count) => count + 1);
  }, [announcement?.id]);

  return (
    <div className="min-w-0 shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn("flex h-9 max-w-[18rem] min-w-9 items-center gap-2 rounded-md border px-2 text-left text-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none xl:w-64", highlightActive ? "border-primary bg-primary text-primary-foreground hover:bg-primary" : "border-transparent hover:bg-muted")}
            aria-label={`Notifications${current ? `, latest ${current.severity}: ${current.title || current.description || "Notification"}` : ""}`}
            aria-expanded={open}
          >
            <CurrentIcon aria-hidden="true" className={cn("h-4 w-4 shrink-0", highlightActive ? "text-primary-foreground" : current ? colors[current.severity] : "text-muted-foreground")} />
            {current && <span className="sr-only capitalize">{current.severity}: </span>}
            <span className="hidden min-w-0 flex-1 truncate xl:block">
              {current ? <>{current.title || current.description || "Notification"}{current.count > 1 ? ` (×${current.count})` : ""}</> : "Notifications"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="z-40 w-[min(26rem,calc(100vw-1.5rem))] p-0 motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Recent notifications</h2>
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={clearHistory} disabled={!toasts.length} className="rounded px-1 hover:underline disabled:opacity-50">Clear history</button>
            </div>
          </div>
          {newMessages > 0 && <button type="button" className="w-full border-b bg-accent px-3 py-1.5 text-center text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { if (listRef.current) { listRef.current.scrollTop = 0; scrollSnapshot.current = captureScroll(listRef.current); } setNewMessages(0); }}>New messages ({newMessages})</button>}
          <div ref={listRef} onScroll={(event) => { scrollSnapshot.current = captureScroll(event.currentTarget); if (event.currentTarget.scrollTop <= 16) setNewMessages(0); }} className="max-h-[min(24rem,calc(100dvh-7rem))] overflow-y-auto overscroll-contain [overflow-anchor:none]" aria-label="Notification history">
            {toasts.length === 0 && <p className="px-3 py-5 text-center text-sm text-muted-foreground">No recent notifications</p>}
            {toasts.map((item) => {
              const Icon = icons[item.severity];
              const onOriginalScreen = item.path === location.pathname + location.search;
              return (
                <div key={item.id} data-notification-id={item.id} className="flex gap-2 border-b px-3 py-2.5 last:border-b-0">
                  <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", colors[item.severity])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="break-words text-sm font-medium">{item.title || item.description || "Notification"}{item.count > 1 && <span className="ml-1 text-xs text-muted-foreground">×{item.count}</span>}</p>
                      <button type="button" className="rounded p-0.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X className="h-3.5 w-3.5" /></button>
                    </div>
                    {item.title && item.description && <div className="mt-0.5 break-words text-xs text-muted-foreground">{item.description}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <time dateTime={new Date(item.createdAt).toISOString()} className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                      <span className="text-[11px] capitalize text-muted-foreground">{item.severity}</span>
                      {item.action && onOriginalScreen && <NotificationAction notification={item} onDone={() => setOpen(false)} />}
                      {item.path && !onOriginalScreen && <button type="button" className="rounded text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { navigate(item.path!); setOpen(false); }}>View screen</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <span key={announcement?.id} className="sr-only" role={announcement?.error ? "alert" : "status"} aria-live={announcement?.error ? "assertive" : "polite"}>{announcement?.text}</span>
    </div>
  );
}
