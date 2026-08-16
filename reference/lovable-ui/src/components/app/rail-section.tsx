import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fmtMinutes, type TimeCorrection } from "@/lib/mock/design";

/* ------------------------------------------------ collapsible rail section */

export function RailSection({
  title, unread = 0, open, onOpenChange, children,
}: {
  title: string;
  /** count of items the current user has not viewed; 0 = read */
  unread?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-border bg-surface-2/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {unread > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded border border-info/50 bg-info/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-info">
            {unread > 1 ? `${unread} new` : "new"}
            <span className="size-1.5 rounded-full bg-info" aria-hidden />
          </span>
        )}
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="border-t border-border px-2.5 py-2">{children}</div>}
    </section>
  );
}

/* ---------------------------------------------------- time correction UI */

export function TimeCorrectionDialog({
  open, onOpenChange, trackedMinutes, sessions, currentSessionSeconds, corrections, author, onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trackedMinutes: number;
  sessions: number;
  currentSessionSeconds: number;
  corrections: TimeCorrection[];
  author: string;
  onApply: (c: { deltaMinutes: number; reason: string }) => void;
}) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(20);
  const [reason, setReason] = useState("");

  const delta = sign * Math.max(0, Math.round(amount || 0));
  const resulting = Math.max(0, trackedMinutes + delta);
  const valid = delta !== 0 && reason.trim().length >= 3;

  const reset = () => { setSign(1); setAmount(20); setReason(""); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Time Correction</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded border border-border bg-surface-2/40 p-2.5">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current tracked total</div>
              <div className="num text-[17px] font-semibold">{fmtMinutes(trackedMinutes)}</div>
              <div className="text-[10.5px] text-muted-foreground">{sessions} session{sessions === 1 ? "" : "s"}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current session (live)</div>
              <div className="num text-[17px] font-semibold">{fmtMinutes(Math.floor(currentSessionSeconds / 60))}</div>
              <div className="text-[10.5px] text-muted-foreground">Not yet logged to total</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Adjustment</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Button size="sm" variant={sign === 1 ? "default" : "outline"} className="h-8 w-9 p-0 text-[15px]" aria-label="Add time" onClick={() => setSign(1)}>+</Button>
              <Button size="sm" variant={sign === -1 ? "default" : "outline"} className="h-8 w-9 p-0 text-[15px]" aria-label="Remove time" onClick={() => setSign(-1)}>−</Button>
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="num h-8 w-20 text-[12.5px]"
                aria-label="Minutes"
              />
              <span className="text-[12px] text-muted-foreground">minutes</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[15, 20, 30, 60].map((m) => (
                <Button key={m} size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => setAmount(m)}>{m}m</Button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Reason (required)</div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Forgot to restart timer after lunch."
              className="mt-1 min-h-[54px] text-[12px]"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {["Forgot to start timer", "Forgot to stop timer", "Lunch break", "Added missed design session"].map((r) => (
                <Button key={r} size="sm" variant="ghost" className="h-6 px-1.5 text-[10.5px]" onClick={() => setReason(r)}>{r}</Button>
              ))}
            </div>
          </div>

          <div className="rounded border border-primary/40 bg-primary/[0.06] px-2.5 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Resulting tracked total</div>
            <div className="num text-[18px] font-semibold">
              {fmtMinutes(resulting)}{" "}
              <span className={cn("text-[12px] font-medium", delta < 0 ? "text-late" : "text-ok")}>
                {delta !== 0 && `(${delta > 0 ? "+" : "−"}${Math.abs(delta)}m)`}
              </span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
              Logged as a correction record by {author} — original sessions are preserved.
            </div>
          </div>

          {corrections.length > 0 && (
            <div className="rounded border border-border px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Correction history</div>
              <ul className="mt-1 space-y-1">
                {corrections.map((c) => (
                  <li key={c.id} className="text-[11.5px]">
                    <span className={cn("num font-semibold", c.deltaMinutes < 0 ? "text-late" : "text-ok")}>
                      {c.deltaMinutes > 0 ? "+" : "−"}{Math.abs(c.deltaMinutes)}m
                    </span>{" "}
                    <span className="text-muted-foreground">{c.reason} · {c.author} · {c.when}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="h-8 text-[12px]"
            disabled={!valid}
            onClick={() => { onApply({ deltaMinutes: delta, reason: reason.trim() }); reset(); }}
          >
            Apply Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
