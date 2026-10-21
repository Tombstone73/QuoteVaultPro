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
  const { toasts, announcement, markRead, clearHistory, dismiss } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [rotationStep, setRotationStep] = React.useState(0);
  const recent = toasts.slice(0, 3);
  const newestId = toasts[0]?.id;
  const unread = toasts.filter((item) => !item.read).length;
  const unreadErrors = toasts.filter((item) => !item.read && item.severity === "error").length;
  const current = recent[rotationStep % Math.max(1, recent.length)];
  const CurrentIcon = current ? icons[current.severity] : Bell;

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  React.useEffect(() => { setRotationStep(0); }, [newestId]);
  React.useEffect(() => {
    if (open || paused || reducedMotion || recent.length < 2 || rotationStep >= recent.length * 2 - 1) return;
    const timer = window.setTimeout(() => setRotationStep((step) => step + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [open, paused, reducedMotion, recent.length, rotationStep, newestId]);

  return (
    <div
      className="min-w-0 shrink-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="relative flex h-9 max-w-[18rem] min-w-9 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:w-64"
            aria-label={`Notifications, ${unread} unread${unreadErrors ? `, ${unreadErrors} unread errors` : ""}`}
            aria-expanded={open}
          >
            <CurrentIcon aria-hidden="true" className={cn("h-4 w-4 shrink-0", current ? colors[current.severity] : "text-muted-foreground")} />
            <span className="hidden min-w-0 flex-1 truncate xl:block">
              {current ? <>{current.title || current.description || "Notification"}{current.count > 1 ? ` (×${current.count})` : ""}</> : "Notifications"}
            </span>
            {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
            {unreadErrors > 0 && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />}
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
              <button type="button" onClick={() => markRead()} disabled={!unread} className="rounded px-1 hover:underline disabled:opacity-50">Mark all read</button>
              <button type="button" onClick={clearHistory} disabled={!toasts.length} className="rounded px-1 hover:underline disabled:opacity-50">Clear history</button>
            </div>
          </div>
          <div className="max-h-[min(24rem,calc(100dvh-7rem))] overflow-y-auto overscroll-contain" aria-label="Notification history">
            {toasts.length === 0 && <p className="px-3 py-5 text-center text-sm text-muted-foreground">No recent notifications</p>}
            {toasts.map((item) => {
              const Icon = icons[item.severity];
              const onOriginalScreen = item.path === location.pathname + location.search;
              return (
                <div key={item.id} className={cn("flex gap-2 border-b px-3 py-2.5 last:border-b-0", !item.read && "bg-muted/40")}>
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
                      {!item.read && <button type="button" className="rounded text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => markRead(item.id)}>Mark read</button>}
                      {item.action && onOriginalScreen && <NotificationAction notification={item} onDone={() => { markRead(item.id); setOpen(false); }} />}
                      {item.path && !onOriginalScreen && <button type="button" className="rounded text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { markRead(item.id); navigate(item.path!); setOpen(false); }}>View screen</button>}
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
