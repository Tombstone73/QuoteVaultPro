import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { productionApi, type ProductionAttempt, type ProductionWorkProjection } from "./api";

/**
 * Presentation facts are deliberately optional because they are an extension
 * of the canonical Production work projection, not a browser-owned job model.
 * The station can render a truthful compact queue while a richer server
 * projection supplies frozen Order, material, and artwork facts.
 */
export type FlatbedPresentation = Readonly<{
  orderNumber?: string;
  customerDisplayName?: string;
  purchaseOrderNumber?: string;
  lineDescription?: string;
  requestedDueDate?: string;
  dimensions?: string;
  materialName?: string;
  routeLabel?: string;
  notes?: string;
  artworkLabel?: string;
  artworkPreviewUrl?: string;
}>;

export type FlatbedStationItem = ProductionWorkProjection &
  Readonly<{ presentation?: FlatbedPresentation }>;

const requirementLabel = (item: ProductionWorkProjection) => {
  const requirement = item.work.requirement;
  const side = requirement.side
    ? `${requirement.side[0]!.toUpperCase()}${requirement.side.slice(1)}`
    : requirement.key;
  const page = requirement.sourcePageIndex === undefined ? "" : ` · Page ${requirement.sourcePageIndex + 1}`;
  return `${side}${page}`;
};

export const flatbedState = (item: ProductionWorkProjection) =>
  item.unitQuantitySatisfied
    ? "Complete"
    : item.attempts.some((attempt) => !attempt.completedAt)
      ? "In progress"
      : "Ready";

const remaining = (item: ProductionWorkProjection) =>
  item.remainingGoodQuantity;

const displayDate = (value?: string) => {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No due date" : date.toLocaleDateString();
};

const queueSort = (left: FlatbedStationItem, right: FlatbedStationItem) => {
  const leftDue = left.presentation?.requestedDueDate ?? "9999-12-31";
  const rightDue = right.presentation?.requestedDueDate ?? "9999-12-31";
  return leftDue.localeCompare(rightDue) || left.work.productionWorkId.localeCompare(right.work.productionWorkId);
};

/**
 * A port of the V1 Flatbed operator composition: dense queue first, then the
 * selected job with artwork and large, touch-friendly canonical actions.
 * It never starts/completes work itself; every mutation is supplied by the
 * Production application service through the parent workspace.
 */
export const FlatbedStationPanel = ({
  queue,
  organizationId,
  sessionScope,
  selectedWorkId,
  activeAttempt,
  canWork,
  canComplete,
  goodQuantity,
  busy,
  onSelect,
  onGoodQuantityChange,
  onStart,
  onRecordOutput,
  onCompleteAttempt,
  onOpenArtwork,
  onOpenTraveler,
}: Readonly<{
  queue: readonly FlatbedStationItem[];
  organizationId: string;
  sessionScope: string;
  selectedWorkId: string;
  activeAttempt?: ProductionAttempt;
  canWork: boolean;
  canComplete: boolean;
  goodQuantity: string;
  busy?: boolean;
  onSelect: (workId: string) => void;
  onGoodQuantityChange: (value: string) => void;
  onStart: (kind: "initial" | "reprint") => void;
  onRecordOutput: (attemptId: string) => void;
  onCompleteAttempt: (attemptId: string) => void;
  onOpenArtwork?: (item: FlatbedStationItem) => void;
  onOpenTraveler?: (item: FlatbedStationItem) => void;
}>) => {
  const [materialFilter, setMaterialFilter] = useState("all");
  const selected = queue.find((item) => item.work.productionWorkId === selectedWorkId);
  const materialOptions = useMemo(
    () => [...new Set(queue.map((item) => item.presentation?.materialName).filter((value): value is string => Boolean(value)))].sort(),
    [queue],
  );
  const visible = useMemo(
    () => queue
      .filter((item) => materialFilter === "all" || item.presentation?.materialName === materialFilter)
      .slice()
      .sort(queueSort),
    [queue, materialFilter],
  );
  const selectedRemaining = selected ? remaining(selected) : 0;
  const materialContext = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "flatbed", selected?.work.productionWorkId, "materials"],
    queryFn: () => productionApi.materials(organizationId, selected!.work.productionWorkId),
    enabled: Boolean(organizationId && sessionScope && selected),
    retry: false,
  });
  const selectedMaterial = materialContext.data?.usage.comparison
    .map((item) => item.materialSku ? `${item.materialName} · ${item.materialSku}` : item.materialName)
    .join(", ") || selected?.presentation?.materialName || "No frozen material requirement";

  return <section className="v2-flatbed-station" aria-label="Flatbed station">
    <aside className="v2-flatbed-queue">
      <header>
        <div><small>Production station</small><h2>Flatbed Queue</h2><span>{queue.length} job{queue.length === 1 ? "" : "s"}</span></div>
        <label>Material
          <select aria-label="Filter Flatbed queue by material" value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)}>
            <option value="all">All materials</option>
            {materialOptions.map((material) => <option key={material} value={material}>{material}</option>)}
          </select>
        </label>
      </header>
      <div className="v2-flatbed-queue-list">
        {visible.map((item) => {
          const presentation = item.presentation;
          const isSelected = item.work.productionWorkId === selectedWorkId;
          return <button key={item.work.productionWorkId} type="button" className={isSelected ? "active" : ""} onClick={() => onSelect(item.work.productionWorkId)}>
            <span className="v2-flatbed-thumb" aria-hidden="true">{presentation?.artworkPreviewUrl ? <img src={presentation.artworkPreviewUrl} alt="" /> : <b>ART</b>}</span>
            <span className="v2-flatbed-queue-copy">
              <strong>{presentation?.orderNumber ? `#${presentation.orderNumber}` : "Production work"}</strong>
              <b>{presentation?.lineDescription ?? requirementLabel(item)}</b>
              <small>{presentation?.customerDisplayName ?? "Order details load with the selected job"}</small>
              <small>{presentation?.materialName ?? "Material not projected"} · {presentation?.dimensions ?? "Dimensions not projected"}</small>
            </span>
            <span className="v2-flatbed-queue-meta"><em className={flatbedState(item).toLowerCase().replace(" ", "-")}>{flatbedState(item)}</em><small>{remaining(item)} remaining</small><small>{displayDate(presentation?.requestedDueDate)}</small></span>
          </button>;
        })}
        {!visible.length && <p className="v2-proof-empty">No Flatbed work matches this material filter.</p>}
      </div>
    </aside>

    <main className="v2-flatbed-detail">
      {selected ? <>
        <header className="v2-flatbed-detail-heading">
          <div><small>Flatbed production</small><h1>{selected.presentation?.lineDescription ?? requirementLabel(selected)}</h1><p>{selected.presentation?.orderNumber ? `Order #${selected.presentation.orderNumber}` : "Canonical production work"}{selected.presentation?.customerDisplayName ? ` · ${selected.presentation.customerDisplayName}` : ""}{selected.presentation?.purchaseOrderNumber ? ` · PO ${selected.presentation.purchaseOrderNumber}` : ""}</p></div>
          <div><b>{selected.completedGoodQuantity} / {selected.work.orderedQuantity}</b><small>good output · {selectedRemaining} remaining</small></div>
        </header>
        <section className="v2-flatbed-artwork">
          <header><div><small>Production artwork</small><h2>{selected.presentation?.artworkLabel ?? requirementLabel(selected)}</h2><p>Frozen canonical Artwork assigned for this Production unit.</p></div><span>{selected.work.requirement.side ?? "production"}</span></header>
          <div className="v2-flatbed-art-canvas">{selected.presentation?.artworkPreviewUrl ? <img src={selected.presentation.artworkPreviewUrl} alt={`Production artwork for ${selected.presentation?.lineDescription ?? requirementLabel(selected)}`} /> : <><b>Production artwork</b><small>Authenticated rendition is not available in the station projection.</small></>}</div>
          <footer><button type="button" disabled={!onOpenArtwork} onClick={() => onOpenArtwork?.(selected)}>Open Artwork</button><span>Current production revision remains Artwork/Prepress-owned.</span></footer>
        </section>
        <section className="v2-flatbed-facts">
          <article><small>Material</small><b>{materialContext.isLoading ? "Loading frozen material…" : selectedMaterial}</b></article>
          <article><small>Dimensions</small><b>{selected.presentation?.dimensions ?? "Not projected"}</b></article>
          <article><small>Route</small><b>{selected.presentation?.routeLabel ?? "Flatbed destination"}</b></article>
          <article><small>Due</small><b>{displayDate(selected.presentation?.requestedDueDate)}</b></article>
          {selected.presentation?.notes && <article className="notes"><small>Notes</small><b>{selected.presentation.notes}</b></article>}
        </section>
      </> : <div className="v2-proof-empty">Select a Flatbed production job.</div>}
    </main>

    <aside className="v2-flatbed-actions">
      {selected ? <>
        <section><small>Selected job</small><h2>{requirementLabel(selected)}</h2><dl><div><dt>Status</dt><dd>{flatbedState(selected)}</dd></div><div><dt>Remaining</dt><dd>{selectedRemaining}</dd></div><div><dt>Destination</dt><dd>Flatbed</dd></div></dl></section>
        <section className="v2-flatbed-action-list">
          <button type="button" disabled={!onOpenTraveler} onClick={() => onOpenTraveler?.(selected)}>Open Traveler</button>
          {!activeAttempt ? <button className="go" type="button" disabled={!canWork || busy || selected.unitQuantitySatisfied} onClick={() => onStart(selected.attempts.length ? "reprint" : "initial")}>{selected.attempts.length ? "Start reprint" : "Start production"}</button> : <>
            <label>Good output<input aria-label="Flatbed good output" type="number" min="1" max={Math.max(1, selectedRemaining)} step="1" value={goodQuantity} onChange={(event) => onGoodQuantityChange(event.target.value)} /></label>
            <button className="go" type="button" disabled={!canWork || busy || selectedRemaining === 0} onClick={() => onRecordOutput(activeAttempt.productionAttemptId)}>Record good output</button>
            <button type="button" disabled={!canComplete || busy} onClick={() => onCompleteAttempt(activeAttempt.productionAttemptId)}>Complete attempt</button>
          </>}
          {selected.unitQuantitySatisfied && <p className="v2-flatbed-complete">Production quantity is satisfied. Fulfillment remains a separate authority.</p>}
        </section>
      </> : <p className="v2-proof-empty">No job selected.</p>}
    </aside>
  </section>;
};
