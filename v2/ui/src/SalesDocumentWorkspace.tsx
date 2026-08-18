import { GripVertical } from "lucide-react";
import React, { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

export type SalesDocumentTab = "Items" | "Artwork" | "Notes" | "History";

const tabs: readonly SalesDocumentTab[] = ["Items", "Artwork", "Notes", "History"];
const DEFAULT_SPLIT = 45;
const MIN_SPLIT = 30;
const MAX_SPLIT = 65;
const splitKey = "ph.sales.splitPct";
const clamp = (value: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));

/** Shared frame adapted from the approved Sales document workspace. Order detail can reuse it later. */
export const SalesDocumentFrame = ({
  documentType,
  number,
  status,
  headerActions,
  metadata,
  panels,
  readOnly = false,
  readOnlyLabel = "Legacy · read only",
}: Readonly<{
  documentType: "Quote" | "Order";
  number: string;
  status: ReactNode;
  headerActions?: ReactNode;
  metadata: ReactNode;
  panels: Readonly<Record<SalesDocumentTab, ReactNode>>;
  readOnly?: boolean;
  readOnlyLabel?: string;
}>) => {
  const [activeTab, setActiveTab] = useState<SalesDocumentTab>("Items");
  return <section className="v2-sales-document" data-read-only={readOnly || undefined}>
    <header className="v2-sales-document-header">
      <div className="v2-sales-document-title">
        <div><span>{documentType}</span><h1>{number}</h1></div>
        {readOnly && <em>{readOnlyLabel}</em>}
        {status}
      </div>
      {headerActions && <div className="v2-sales-document-actions">{headerActions}</div>}
      <div className="v2-sales-document-meta">{metadata}</div>
    </header>
    <nav className="v2-sales-document-tabs" aria-label={`${documentType} workspace sections`}>
      {tabs.map((tab) => <button key={tab} type="button" aria-current={activeTab === tab || undefined} onClick={() => setActiveTab(tab)}>{tab}</button>)}
    </nav>
    <div className="v2-sales-document-panel">{panels[activeTab]}</div>
  </section>;
};

export const SalesDocumentSplit = ({ left, right }: Readonly<{ left: ReactNode; right: ReactNode | null }>) => {
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const splitRef = useRef(split);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(splitKey));
      if (Number.isFinite(stored)) setSplit(clamp(stored));
    } catch { /* Preference storage is optional. */ }
  }, []);
  useEffect(() => {
    splitRef.current = split;
    try { window.localStorage.setItem(splitKey, String(split)); } catch { /* Preference storage is optional. */ }
  }, [split]);
  const resize = (clientX: number, root: HTMLElement) => {
    const rect = root.getBoundingClientRect();
    if (rect.width) setSplit(clamp(((clientX - rect.left) / rect.width) * 100));
  };
  if (right === null) return <div className="v2-sales-split v2-sales-split-closed">
    <div className="v2-sales-split-left">{left}</div>
  </div>;
  return <div className="v2-sales-split" style={{ "--sales-split": `${split}%` } as CSSProperties}>
    <div className="v2-sales-split-left">{left}</div>
    <div
      className="v2-sales-split-handle"
      role="separator"
      aria-label="Resize document editor"
      aria-orientation="vertical"
      aria-valuemin={MIN_SPLIT}
      aria-valuemax={MAX_SPLIT}
      aria-valuenow={Math.round(split)}
      tabIndex={0}
      onDoubleClick={() => setSplit(DEFAULT_SPLIT)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setSplit(clamp(splitRef.current + (event.key === "ArrowLeft" ? -2 : 2)));
      }}
      onPointerDown={(event) => {
        const root = event.currentTarget.parentElement;
        if (!root) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent) => resize(next.clientX, root);
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
      }}
    ><GripVertical aria-hidden /></div>
    <aside className="v2-sales-split-right">{right}</aside>
  </div>;
};

export const SalesDocumentEmpty = ({ children }: Readonly<{ children: ReactNode }>) =>
  <div className="v2-sales-document-empty">{children}</div>;
