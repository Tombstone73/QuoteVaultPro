import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared low-friction editing primitives for the Sales workspace.
 * Quotes and Orders use the same components — nothing here is Order-specific.
 */

export type SaveState = "clean" | "dirty" | "saving" | "saved";

export function SaveButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "dirty" ? "Save changes" : "Saved";
  return (
    <div className="flex items-center gap-2">
      {state === "dirty" && (
        <span className="inline-flex items-center gap-1 rounded border border-warn/50 bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">
          Unsaved changes
        </span>
      )}
      <Button
        size="sm"
        variant={state === "dirty" ? "default" : "outline"}
        className="h-8 min-w-[112px] gap-1.5"
        disabled={state !== "dirty"}
        onClick={onSave}
      >
        {state === "saving" && <Loader2 className="size-3.5 animate-spin" />}
        {state === "saved" && <Check className="size-3.5 text-ok" />}
        {label}
      </Button>
    </div>
  );
}

/** Label + value that reads as text but is obviously clickable. */
function FieldShell({
  label, dirty, children, className,
}: { label: string; dirty?: boolean | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 shrink-0", className)}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {dirty && <span className="size-1.5 rounded-full bg-warn" aria-label="Edited" />}
      </div>
      {children}
    </div>
  );
}

const trigger =
  "group -mx-1 mt-0.5 flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[13px] hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function InlineText({
  label, value, placeholder = "—", numeric, dirty, onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  numeric?: boolean;
  dirty?: boolean | undefined;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };

  return (
    <FieldShell label={label} dirty={dirty}>
      {editing ? (
        <Input
          ref={ref}
          value={draft}
          className={cn("mt-0.5 h-7 w-[150px] px-1.5 text-[13px]", numeric && "num")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
        />
      ) : (
        <button type="button" className={trigger} onClick={() => setEditing(true)}>
          <span className={cn("whitespace-nowrap", numeric && "num", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <Pencil className="size-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
        </button>
      )}
    </FieldShell>
  );
}

export function InlineSelect<T extends string>({
  label, value, options, dirty, onChange, render, width = "w-56",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  dirty?: boolean | undefined;
  onChange: (v: T) => void;
  render?: (v: T) => ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <FieldShell label={label} dirty={dirty}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={trigger}>
            <span className="whitespace-nowrap">{render ? render(value) : current?.label ?? value}</span>
            <ChevronDown className="size-3 shrink-0 opacity-40 transition group-hover:opacity-80" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn("p-1", width)}>
          <ul className="max-h-72 overflow-y-auto">
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent",
                    o.value === value && "bg-accent",
                  )}
                >
                  <Check className={cn("mt-0.5 size-3.5 shrink-0", o.value === value ? "opacity-100 text-primary" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-[11px] text-muted-foreground">{o.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 19, 2026" <-> "2026-08-19" */
export function labelToISO(label: string): string {
  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(label.trim());
  if (!m) return "";
  const mi = MONTHS.indexOf(m[1] as string);
  if (mi < 0) return "";
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

export function isoToLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function InlineDate({
  label, value, dirty, onChange,
}: { label: string; value: string; dirty?: boolean | undefined; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const iso = labelToISO(value);
  return (
    <FieldShell label={label} dirty={dirty}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={trigger}>
            <span className="num whitespace-nowrap">{value || "—"}</span>
            <Pencil className="size-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Input
            type="date"
            defaultValue={iso}
            className="num h-8 w-[170px]"
            onChange={(e) => { if (e.target.value) onChange(isoToLabel(e.target.value)); }}
          />
          <div className="mt-1.5 flex gap-1">
            {[
              ["Today", 0], ["+3 days", 3], ["+1 week", 7],
            ].map(([l, d]) => (
              <Button
                key={l as string} size="sm" variant="outline" className="h-6 px-1.5 text-[11px]"
                onClick={() => {
                  const base = new Date();
                  base.setDate(base.getDate() + Number(d));
                  onChange(isoToLabel(base.toISOString().slice(0, 10)));
                  setOpen(false);
                }}
              >
                {l as string}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
}

export function LifecycleStrip({ stages }: { stages: { name: string; state: "done" | "active" | "mixed" | "todo"; detail?: string | undefined }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {stages.map((s, i) => (
        <li key={s.name} className="flex items-center gap-1">
          <span
            title={s.detail}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
              s.state === "done" && "border-ok/50 bg-ok/15 text-ok",
              s.state === "active" && "border-primary/60 bg-primary/15 text-primary",
              s.state === "mixed" && "border-warn/50 bg-warn/15 text-warn",
              s.state === "todo" && "border-border text-muted-foreground",
            )}
          >
            {s.state === "done" && <Check className="size-3" />}
            {s.name}
            {s.detail && <span className="num opacity-70">{s.detail}</span>}
          </span>
          {i < stages.length - 1 && <span className="text-[11px] text-muted-foreground/60">›</span>}
        </li>
      ))}
    </ol>
  );
}
