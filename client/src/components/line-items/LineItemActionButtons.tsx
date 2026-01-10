import * as React from "react";

import { Copy, Trash2 } from "lucide-react";

import styles from "./lineItemRowEnterprise.module.css";

export type LineItemActionButtonsProps = {
  onDuplicate?: () => void;
  onDelete?: () => void;
  className?: string;
};

export default function LineItemActionButtons({
  onDuplicate,
  onDelete,
  className,
}: LineItemActionButtonsProps) {
  return (
    <div className={`${styles.li__actions} ${className ?? ""}`}>
      <button
        type="button"
        className={styles.li__iconBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={!onDuplicate}
        aria-label="Duplicate"
        title="Duplicate"
      >
        <Copy size={18} />
      </button>
      <button
        type="button"
        className={styles.li__iconBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDelete?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={!onDelete}
        aria-label="Delete"
        title="Delete"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}
