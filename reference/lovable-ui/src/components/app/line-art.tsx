import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Image as ImageIcon, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { artForSide, lineSides } from "@/lib/mock/order-context";
import type { ArtSide, LineArt, LineItem } from "@/lib/mock/data";

/**
 * Sales-level artwork presentation.
 * Sales shows Line Item Art and can attach a file to a line; Artwork still owns
 * versions, relationships and derived/production files.
 */

export function makeLineArt(
  name: string,
  side: ArtSide,
  kind: "line" | "production" = "line",
): LineArt {
  return {
    id: `art-${Math.random().toString(36).slice(2, 9)}`,
    name,
    side,
    kind,
    addedBy: "Dale",
    addedAt: "Today",
  };
}

export function ArtThumb({
  art,
  side,
  size = "md",
  muted,
}: {
  art?: LineArt | undefined;
  side: ArtSide;
  size?: "sm" | "md";
  muted?: boolean;
}) {
  const box = size === "sm" ? "size-8" : "size-10";
  const seed = (art?.name ?? side).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        className={cn(
          box,
          "flex items-center justify-center overflow-hidden rounded border border-border",
          muted && "opacity-70",
        )}
        style={{ background: `oklch(0.72 0.09 ${seed % 360} / 0.35)` }}
        title={art?.name}
        aria-hidden
      >
        <ImageIcon className="size-3.5 text-foreground/70" />
      </span>
      {side !== "Single" && (
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {side}
        </span>
      )}
    </span>
  );
}

/** Hidden input + trigger, reusable from a row or the line editor. */
export function useArtUpload(onFiles: (names: string[]) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      className="hidden"
      accept=".pdf,.ai,.eps,.svg,.png,.jpg,.jpeg,.tif,.tiff"
      onChange={(e) => {
        const names = Array.from(e.target.files ?? []).map((f) => f.name);
        if (names.length) onFiles(names);
        e.target.value = "";
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/** ART cell for the line-item table: thumbnails per side, or an explicit upload placeholder. */
export function LineArtCell({
  line,
  orderNumber,
  onUpload,
}: {
  line: LineItem;
  orderNumber: string;
  onUpload: (names: string[]) => void;
}) {
  const sides = lineSides(line);
  const { input, open } = useArtUpload(onUpload);
  const present = sides.map((s) => artForSide(line, s)).filter(Boolean).length;

  if (present === 0) {
    return (
      <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {input}
        <span className="flex size-10 flex-col items-center justify-center rounded border border-dashed border-border bg-surface-2/50 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          No art
        </span>
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-accent"
        >
          <Upload className="size-3" /> Upload
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {input}
      {sides.map((s) => {
        const art = artForSide(line, s);
        return art ? (
          <ArtThumb key={s} art={art} side={s} />
        ) : (
          <button
            key={s}
            type="button"
            onClick={open}
            title={`Upload ${s} art`}
            className="flex size-10 flex-col items-center justify-center rounded border border-dashed border-warn/60 bg-warn/10 text-[9px] font-semibold uppercase text-warn"
          >
            {s}
          </button>
        );
      })}
      {line.art?.some((a) => a.kind === "production") && (
        <span
          className="rounded border border-ok/50 bg-ok/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-ok"
          title="Production art exists (owned by Prepress/Artwork)"
        >
          PRD
        </span>
      )}
      <Link
        to="/artwork"
        search={{ order: orderNumber, line: line.id }}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] text-primary hover:underline"
      >
        Open
      </Link>
    </span>
  );
}
