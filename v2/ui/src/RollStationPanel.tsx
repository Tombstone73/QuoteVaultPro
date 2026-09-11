import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  artworkApi,
  productionApi,
  type ArtworkOrderProjection,
  type ProductionWorkProjection,
} from "./api";

/**
 * The Roll station is deliberately a presentation adapter over ProductionWork.
 * It does not select a different route, create artwork, or own attempt state.
 *
 * V2 represents each production requirement as a separate immutable work unit.
 * A double-sided Roll line therefore has one front and one back unit when both
 * requirements were frozen; this panel makes that relationship visible without
 * fabricating a single mutable "double-sided job".
 */
type RollStationPanelProps = Readonly<{
  organizationId: string;
  sessionScope: string;
  queue: readonly ProductionWorkProjection[];
  selectedWorkId: string;
  compact?: boolean;
  onSelectWork: (productionWorkId: string) => void;
  onOpenArtworkWorkflow?: (orderId: string, orderLineId: string) => void;
}>;

const titleCase = (value: string) =>
  `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;

const requirementLabel = (work: ProductionWorkProjection) => {
  const requirement = work.work.requirement;
  const side = requirement.side ? ` · ${titleCase(requirement.side)}` : "";
  const page =
    requirement.sourcePageIndex === undefined
      ? ""
      : ` · Page ${requirement.sourcePageIndex + 1}`;
  return `${requirement.key}${side}${page}`;
};

const workState = (work: ProductionWorkProjection) => {
  if (work.state === "held") return "On hold";
  if (work.state === "rework_requested") return "Prepress rework requested";
  if (work.unitQuantitySatisfied) return "Complete";
  if (work.attempts.some((attempt) => !attempt.completedAt)) return "In progress";
  return "Ready";
};

const materialLabel = (work: ProductionWorkProjection) =>
  work.unitQuantitySatisfied
    ? "Produced"
    : work.attempts.some((attempt) => !attempt.completedAt)
      ? "Running"
      : "Queued";

const productionArtFor = (
  artwork: readonly ArtworkOrderProjection[],
  work: ProductionWorkProjection,
) =>
  artwork.find(
    (entry) =>
      entry.assignment.id === work.work.artworkAssignmentId ||
      entry.file.id === work.work.artworkFileId,
  );

const sideLabel = (work: ProductionWorkProjection) =>
  work.work.requirement.side
    ? titleCase(work.work.requirement.side)
    : "Production artwork";

const queueMaterials = (items: readonly { materialName: string }[]) =>
  [...new Set(items.map((item) => item.materialName).filter(Boolean))];

export const RollStationPanel = ({
  organizationId,
  sessionScope,
  queue,
  selectedWorkId,
  compact = false,
  onSelectWork,
  onOpenArtworkWorkflow,
}: RollStationPanelProps) => {
  const selected =
    queue.find((item) => item.work.productionWorkId === selectedWorkId) ??
    queue[0];
  const artwork = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "roll", selected?.work.orderId, "artwork"],
    queryFn: () => artworkApi.forOrder(organizationId, selected!.work.orderId),
    enabled: Boolean(organizationId && sessionScope && selected),
    retry: false,
  });
  const materials = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "roll", selected?.work.productionWorkId, "materials"],
    queryFn: () => productionApi.materials(organizationId, selected!.work.productionWorkId),
    enabled: Boolean(organizationId && sessionScope && selected),
    retry: false,
  });
  const siblingUnits = useMemo(
    () =>
      selected
        ? queue.filter(
            (item) =>
              item.work.orderLineId === selected.work.orderLineId &&
              item.work.orderId === selected.work.orderId,
          )
        : [],
    [queue, selected],
  );
  const frontUnit = siblingUnits.find(
    (item) => item.work.requirement.side === "front",
  );
  const backUnit = siblingUnits.find(
    (item) => item.work.requirement.side === "back",
  );
  const currentArt = selected
    ? productionArtFor(artwork.data ?? [], selected)
    : undefined;
  const materialNames = queueMaterials(
    materials.data?.usage.comparison ?? [],
  );

  if (!selected) {
    return (
      <section className="v2-roll-station" aria-label="Roll production station">
        <div className="v2-proof-empty">No Production work is open at Roll.</div>
      </section>
    );
  }

  const remaining = selected.remainingGoodQuantity;
  const doubleSided = Boolean(frontUnit && backUnit);

  return (
    <section className="v2-roll-station" aria-label="Roll production station">
      <header className="v2-roll-station-heading">
        <div>
          <small>Roll production</small>
          <h2>{requirementLabel(selected)}</h2>
          <p>
            Order line {selected.work.orderLineId} · frozen destination and
            Production artwork only
          </p>
        </div>
        <span className={`v2-roll-status ${materialLabel(selected).toLowerCase().replace(" ", "-")}`}>
          {workState(selected)}
        </span>
      </header>

      <div className="v2-roll-station-layout">
        <section className="v2-roll-production-art" aria-label="Production artwork">
          <header>
            <div>
              <small>Production artwork</small>
              <h3>{doubleSided ? "Double-sided production" : sideLabel(selected)}</h3>
            </div>
            <button
              type="button"
              disabled={!onOpenArtworkWorkflow}
              onClick={() =>
                onOpenArtworkWorkflow?.(
                  selected.work.orderId,
                  selected.work.orderLineId,
                )
              }
            >
              Open Artwork
            </button>
          </header>
          <div className="v2-roll-art-sides">
            {[frontUnit, backUnit]
              .filter((unit): unit is ProductionWorkProjection => Boolean(unit))
              .map((unit) => {
                const sideArt = productionArtFor(artwork.data ?? [], unit);
                const current =
                  unit.work.productionWorkId === selected.work.productionWorkId;
                return (
                  <button
                    key={unit.work.productionWorkId}
                    type="button"
                    className={current ? "active" : ""}
                    onClick={() => onSelectWork(unit.work.productionWorkId)}
                  >
                    <span>{sideLabel(unit)}</span>
                    <b>{sideArt?.file.displayFilename ?? "Production file"}</b>
                    <small>
                      {sideArt
                        ? `${sideArt.file.contentType} · revision evidence frozen`
                        : `File ${unit.work.artworkFileId}`}
                    </small>
                    <em>{workState(unit)}</em>
                  </button>
                );
              })}
            {!frontUnit && !backUnit && (
              <div className="v2-roll-art-missing">
                <b>Production art reference</b>
                <small>{currentArt?.file.displayFilename ?? selected.work.artworkFileId}</small>
              </div>
            )}
          </div>
          <footer>
            Artwork remains Prepress/Artwork-owned. Production cannot replace
            this frozen evidence.
          </footer>
        </section>

        <section className="v2-roll-context" aria-label="Roll production context">
          <article>
            <small>Quantity</small>
            <b>{selected.work.orderedQuantity}</b>
            <span>required</span>
          </article>
          <article>
            <small>Good output</small>
            <b>{selected.completedGoodQuantity}</b>
            <span>recorded</span>
          </article>
          <article>
            <small>Remaining</small>
            <b>{remaining}</b>
            <span>to satisfy this unit</span>
          </article>
          <article>
            <small>Production path</small>
            <b>{selected.work.prepressUnitId ? "Prepress" : "Direct"}</b>
            <span>
              {selected.work.prepressUnitId
                ? "Prepress evidence recorded"
                : "No Prepress evidence required"}
            </span>
          </article>
        </section>

        <section className="v2-roll-material-context" aria-label="Roll material context">
          <header>
            <small>Material / media</small>
            <span>{materials.isLoading ? "Loading…" : "Frozen requirements"}</span>
          </header>
          {materialNames.length ? (
            <ul>
              {materialNames.map((material) => (
                <li key={material}>{material}</li>
              ))}
            </ul>
          ) : materials.isError ? (
            <p>Material context is unavailable for this work.</p>
          ) : (
            <p>No frozen material requirement is available for this work.</p>
          )}
          <small className="v2-roll-material-note">
            Material grouping is intentionally server-owned; this station does
            not infer media from product names.
          </small>
        </section>
      </div>

      {!compact && <section className="v2-roll-queue" aria-label="Roll queue">
        <header>
          <div>
            <small>Job queue</small>
            <h3>Roll work</h3>
          </div>
          <span>{queue.length} unit{queue.length === 1 ? "" : "s"}</span>
        </header>
        <div>
          {queue.map((item) => (
            <button
              key={item.work.productionWorkId}
              type="button"
              className={
                item.work.productionWorkId === selected.work.productionWorkId
                  ? "active"
                  : ""
              }
              onClick={() => onSelectWork(item.work.productionWorkId)}
            >
              <span className="v2-roll-queue-thumb">
                {item.work.requirement.side === "front"
                  ? "FRONT"
                  : item.work.requirement.side === "back"
                    ? "BACK"
                    : "ART"}
              </span>
              <span>
                <b>{requirementLabel(item)}</b>
                <small>Line {item.work.orderLineId} · {item.completedGoodQuantity} / {item.work.orderedQuantity} good</small>
              </span>
              <em>{workState(item)}</em>
            </button>
          ))}
        </div>
      </section>}
    </section>
  );
};
