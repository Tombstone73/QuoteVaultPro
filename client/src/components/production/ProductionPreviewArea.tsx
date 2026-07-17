import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ProductionPreviewSize = "compact" | "normal" | "large";

export function ProductionPreviewArea({
  collapsed,
  size,
  artworkCount,
  productionFileName,
  productionFileStatus,
  onToggle,
  onSizeChange,
  children,
}: {
  collapsed: boolean;
  size: ProductionPreviewSize;
  artworkCount: number;
  productionFileName?: string | null;
  productionFileStatus?: string | null;
  onToggle: () => void;
  onSizeChange: (size: ProductionPreviewSize) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-titan-border-subtle bg-titan-bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-titan-text-primary">Artwork & production files</div>
          <div className="truncate text-[11px] text-titan-text-muted">
            {artworkCount} artwork {artworkCount === 1 ? "file" : "files"}
            {productionFileName ? ` · ${productionFileName}` : " · No final production file"}
            {productionFileStatus === "pending" ? " · Preview processing" : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!collapsed ? (
            <div className="flex rounded-md border border-titan-border-subtle p-0.5" aria-label="Preview area size">
              {(["compact", "normal", "large"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={size === option ? "secondary" : "ghost"}
                  className="h-7 px-2 text-[11px] capitalize"
                  onClick={() => onSizeChange(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={onToggle}>
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            {collapsed ? "Expand previews" : "Collapse previews"}
          </Button>
        </div>
      </div>
      {!collapsed ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
