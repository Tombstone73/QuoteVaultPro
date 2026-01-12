import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

import type { LineItemOptionSummaryVM } from "@/lib/lineItems/lineItemDerivation";

export type LineItemMainBlockProps = {
  title?: string | null;
  description?: string | null;

  optionsSummary?: LineItemOptionSummaryVM | null;

  flags?: string[] | null;

  notesText?: string | null;
  onNotesClick?: () => void;

  onDescriptionCommit?: (nextDescription: string) => Promise<void> | void;
  className?: string;
};

function safeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function formatOptionSummary(summary: LineItemOptionSummaryVM | null | undefined): string {
  if (!summary) return "";
  const primary = Array.isArray(summary.primary) ? summary.primary.filter(Boolean) : [];
  if (!primary.length) return "";
  const base = primary.join(" • ");
  const extra = typeof summary.secondaryCount === "number" && summary.secondaryCount > 0
    ? ` +${summary.secondaryCount} more`
    : "";
  return `${base}${extra}`;
}

export default function LineItemMainBlock({
  title,
  description,
  optionsSummary,
  flags,
  onDescriptionCommit,
  className,
}: LineItemMainBlockProps) {
  const safeDescription = safeText(description);
  // Notes indicator is rendered in the row's right-side flag lane.
  // Keep notesText/onNotesClick in props to avoid changing the public API.

  const optionSummaryText = formatOptionSummary(optionsSummary);

  const canEditDescription = typeof onDescriptionCommit === "function";
  const [draftDescription, setDraftDescription] = React.useState(safeDescription);

  React.useEffect(() => {
    setDraftDescription(safeDescription);
  }, [safeDescription]);

  const commitDescription = async () => {
    if (!canEditDescription) return;
    const next = draftDescription.trimEnd();
    if (next === safeDescription) return;
    try {
      await onDescriptionCommit?.(next);
    } catch (e) {
      console.error("Failed to save line item description", e);
      setDraftDescription(safeDescription);
    }
  };

  return (
    <div className={`${styles.li__main} ${className ?? ""}`}>
      <div className={styles.li__titleRow}>
        <div className={styles.li__title}>{safeText(title) || "Untitled item"}</div>
      </div>

      {canEditDescription ? (
        <input
          className={styles.li__descInput}
          data-li-interactive="true"
          value={draftDescription}
          placeholder="Add description"
          onChange={(e) => setDraftDescription(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => void commitDescription()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void commitDescription();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraftDescription(safeDescription);
            }
            if (e.key === " ") {
              e.stopPropagation();
            }
          }}
        />
      ) : safeDescription ? (
        <div className={styles.li__subtitle}>{safeDescription}</div>
      ) : null}

      {optionSummaryText ? (
        <div className={styles.li__optionsText} title={optionSummaryText}>
          {optionSummaryText}
        </div>
      ) : null}
    </div>
  );
}
