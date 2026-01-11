import * as React from "react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemMainBlockProps = {
  title?: string | null;
  description?: string | null;

  optionsSummary?: string | null;

  flags?: string[] | null;

  notesText?: string | null;
  onNotesClick?: () => void;

  onDescriptionCommit?: (nextDescription: string) => Promise<void> | void;
  className?: string;
};

function safeText(value: string | null | undefined) {
  return (value ?? "").trim();
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

      {safeText(optionsSummary) ? (
        <div className={styles.li__optionsText} title={safeText(optionsSummary)}>
          {safeText(optionsSummary)}
        </div>
      ) : null}

      {Array.isArray(flags) && flags.length ? (
        <div className={styles.li__flags} data-li-interactive="true">
          {flags.slice(0, 4).map((f) => (
            <span key={f} className={styles.li__flagChip}>
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
