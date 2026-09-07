import { useCallback, useRef, useState } from "react";
import type React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ArtworkFile } from "@/lib/portal/types";

/** Customer source artwork upload. Files here are not production-ready art. */
export function ArtworkUpload({
  files,
  onChange,
  max = 3,
  artworkLater,
  onArtworkLater,
}: {
  files: ArtworkFile[];
  onChange: React.Dispatch<React.SetStateAction<ArtworkFile[]>>;
  max?: number;
  artworkLater: boolean;
  onArtworkLater: (v: boolean) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const incoming = Array.from(list).slice(0, Math.max(0, max - files.length));
      const mapped: ArtworkFile[] = incoming.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        name: f.name,
        sizeLabel: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
        status: "uploading",
        progress: 8,
        hue: (f.name.length * 37) % 360,
      }));
      onChange((prev) => [...prev, ...mapped]);
      // Mock upload progression against the future PrintersHero upload service.
      mapped.forEach((m) => {
        let p = 8;
        const tick = setInterval(() => {
          p += 24;
          const failed = m.name.toLowerCase().endsWith(".bmp");
          const done = p >= 100;
          onChange((prev) =>
            prev.map((f) =>
              f.id === m.id
                ? { ...f, progress: Math.min(100, p), status: done ? (failed ? "failed" : "uploaded") : "uploading" }
                : f,
            ),
          );
          if (done) clearInterval(tick);
        }, 260);
      });
    },
    [files, max, onChange],
  );

  const remaining = max - files.length;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!artworkLater) accept(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
          (artworkLater || remaining <= 0) && "opacity-50",
        )}
      >
        <Upload className="mx-auto size-5 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium">Drag artwork here, or browse</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          PDF, AI, EPS, TIFF or high-resolution JPG. Up to {max} file{max === 1 ? "" : "s"}. Include bleed where possible.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3 h-8"
          disabled={artworkLater || remaining <= 0}
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </Button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => accept(e.target.files)} />
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-2.5">
              <div
                className="size-10 shrink-0 rounded-md border border-border"
                style={{ background: `linear-gradient(140deg, oklch(0.84 0.08 ${f.hue} / 0.6), oklch(0.7 0.1 ${f.hue} / 0.35))` }}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{f.name}</p>
                <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {f.status === "uploading" && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  {f.status === "uploaded" && <CheckCircle2 className="size-3 text-ok" aria-hidden />}
                  {f.status === "failed" && <AlertTriangle className="size-3 text-late" aria-hidden />}
                  {f.status === "uploading"
                    ? `Uploading ${f.progress}%`
                    : f.status === "failed"
                      ? "Upload failed — try again or send a different format"
                      : `${f.sizeLabel} · received`}
                </p>
                {f.status === "uploading" && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange((prev) => prev.filter((x) => x.id !== f.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
        <Checkbox
          checked={artworkLater}
          onCheckedChange={(v) => onArtworkLater(Boolean(v))}
          className="mt-0.5"
          aria-label="I'll send artwork later"
        />
        <span className="text-[13px]">
          I&apos;ll send artwork later
          <span className="block text-[12px] text-muted-foreground">
            We&apos;ll hold this item until your artwork arrives. Production does not start without it.
          </span>
        </span>
      </label>
    </div>
  );
}
