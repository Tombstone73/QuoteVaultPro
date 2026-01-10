import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemNotesDraft = {
  sku?: string | null;
  descShort?: string | null;
  descLong?: string | null;
};

export type LineItemMainBlockProps = {
  title?: string | null;
  subtitle?: string | null;

  flags?: string[] | null;

  sku?: string | null;
  descShort?: string | null;
  descLong?: string | null;

  onSaveNotes?: (draft: { sku: string; descShort: string; descLong: string }) => Promise<void> | void;
  className?: string;
};

function safeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

export default function LineItemMainBlock({
  title,
  subtitle,
  flags,
  sku,
  descShort,
  descLong,
  onSaveNotes,
  className,
}: LineItemMainBlockProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [currentSku, setCurrentSku] = React.useState(safeText(sku));
  const [currentDescShort, setCurrentDescShort] = React.useState(safeText(descShort));
  const [currentDescLong, setCurrentDescLong] = React.useState(safeText(descLong));

  const [draftSku, setDraftSku] = React.useState(currentSku);
  const [draftDescShort, setDraftDescShort] = React.useState(currentDescShort);
  const [draftDescLong, setDraftDescLong] = React.useState(currentDescLong);

  React.useEffect(() => {
    if (isOpen) return;
    setCurrentSku(safeText(sku));
    setCurrentDescShort(safeText(descShort));
    setCurrentDescLong(safeText(descLong));
  }, [sku, descShort, descLong, isOpen]);

  const hasNotes = currentDescLong.trim().length > 0;

  const canEdit = typeof onSaveNotes === "function";

  const open = () => {
    setError(null);
    setDraftSku(currentSku);
    setDraftDescShort(currentDescShort);
    setDraftDescLong(currentDescLong);
    setIsOpen(true);
  };

  const close = () => {
    setError(null);
    setIsOpen(false);
  };

  const metaLineText = (() => {
    const parts = [currentSku.trim(), currentDescShort.trim()].filter(Boolean);
    return parts.length ? parts.join(" • ") : "Add notes";
  })();

  const handleSave = async () => {
    setError(null);

    const payload = {
      sku: safeText(draftSku),
      descShort: safeText(draftDescShort),
      descLong: safeText(draftDescLong),
    };

    try {
      await onSaveNotes?.(payload);
      setCurrentSku(payload.sku);
      setCurrentDescShort(payload.descShort);
      setCurrentDescLong(payload.descLong);
      setIsOpen(false);
    } catch (e) {
      console.error("Failed to save line item notes", e);
      setError("Could not save. Please try again.");
      setIsOpen(true);
    }
  };

  return (
    <div className={`${styles.li__main} ${className ?? ""}`}>
      <div className={styles.li__title}>{safeText(title) || "Untitled item"}</div>
      <div className={styles.li__subtitle}>{safeText(subtitle) || ""}</div>

      {Array.isArray(flags) && flags.length ? (
        <div className={styles.li__flags} data-li-interactive="true">
          {flags.slice(0, 4).map((f) => (
            <span key={f} className={styles.li__flagChip}>
              {f}
            </span>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <Popover
          open={isOpen}
          onOpenChange={(next) => {
            if (next) {
              open();
            } else {
              close();
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className={styles.li__metaLine}
              data-li-interactive="true"
              onClick={(e) => {
                e.stopPropagation();
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className={styles.li__metaText} title={hasNotes ? currentDescLong : undefined}>
                {metaLineText}
              </span>
              {hasNotes ? <span className={styles.li__notesBadge}>NOTES</span> : null}
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={10}
            className={styles.li__popoverContent}
            data-li-interactive="true"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDownCapture={(e) => {
              // Prevent Space/Enter/etc from bubbling to the row container (which toggles expand/collapse)
              if (e.key === " " || e.key === "Enter" || e.key === "Escape") {
                e.stopPropagation();
              }
            }}
          >
            <div className={styles.li__popoverHeader}>
              <div className={styles.li__popoverTitle}>Edit notes</div>
              <button
                type="button"
                className={styles.li__popoverClose}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className={styles.li__popoverBody}>
              <label className={styles.li__popLabel}>
                SKU
                <input
                  className={styles.li__popInput}
                  data-li-interactive="true"
                  value={draftSku}
                  onChange={(e) => setDraftSku(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
                  }}
                />
              </label>

              <label className={styles.li__popLabel}>
                Short description
                <input
                  className={styles.li__popInput}
                  data-li-interactive="true"
                  value={draftDescShort}
                  onChange={(e) => setDraftDescShort(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
                  }}
                />
              </label>

              <label className={styles.li__popLabel}>
                Full notes
                <textarea
                  className={styles.li__popTextarea}
                  data-li-interactive="true"
                  value={draftDescLong}
                  onChange={(e) => setDraftDescLong(e.target.value)}
                  rows={5}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
                  }}
                />
              </label>

              {error ? (
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>
                  <span style={{ color: "rgba(245, 158, 11, 0.95)" }}>{error}</span>
                </div>
              ) : null}

              <div className={styles.li__popoverActions}>
                <button
                  type="button"
                  className={`${styles.li__popBtn} ${styles.li__popBtnGhost}`}
                  data-li-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.li__popBtn} ${styles.li__popBtnPrimary}`}
                  data-li-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSave();
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <button
          type="button"
          className={styles.li__metaLine}
          disabled
          data-li-interactive="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className={styles.li__metaText} title={hasNotes ? currentDescLong : undefined}>
            {metaLineText}
          </span>
          {hasNotes ? <span className={styles.li__notesBadge}>NOTES</span> : null}
        </button>
      )}

      {hasNotes ? <div className={styles.li__notesHover}>{currentDescLong}</div> : null}
    </div>
  );
}
