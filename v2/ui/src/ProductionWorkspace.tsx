import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  newBusinessRequestId,
  productionApi,
  type ProductionAttempt,
  type ProductionMaterialProjection,
  type ProductionWorkProjection,
} from "./api";

type Station = "flatbed" | "roll";
type ProductionView = "overview" | "board" | "calendar" | "stations";

const keys = {
  queue: (scope: string, organizationId: string, station: Station) =>
    ["v2", scope, organizationId, "production", station, "queue"] as const,
};

const requirementLabel = (work: ProductionWorkProjection) => {
  const requirement = work.work.requirement;
  if (!requirement.side) return requirement.key;
  const side = `${requirement.side[0]!.toUpperCase()}${requirement.side.slice(1)}`;
  const page =
    requirement.sourcePageIndex === undefined
      ? ""
      : ` · Page ${requirement.sourcePageIndex + 1}`;
  const layer = requirement.layerKey
    ? ` · ${requirement.layerKey} ${requirement.layerOrder! + 1}`
    : "";
  return `${side}${page}${layer}`;
};

const workState = (work: ProductionWorkProjection) => {
  if (work.unitQuantitySatisfied) return "Unit satisfied";
  if (work.attempts.some((attempt) => !attempt.completedAt))
    return "Attempt active";
  return "Ready for attempt";
};

const statusClass = (work: ProductionWorkProjection) =>
  work.unitQuantitySatisfied
    ? "ok"
    : work.attempts.some((attempt) => !attempt.completedAt)
      ? "active"
      : "ready";

const materialKeys = {
  detail: (scope: string, organizationId: string, workId: string) =>
    ["v2", scope, organizationId, "production", workId, "materials"] as const,
};

const ProductionMaterials = ({
  organizationId,
  sessionScope,
  workId,
  activeAttempt,
  canWork,
}: {
  organizationId: string;
  sessionScope: string;
  workId: string;
  activeAttempt?: ProductionAttempt;
  canWork: boolean;
}) => {
  const client = useQueryClient();
  const projection = useQuery({
    queryKey: materialKeys.detail(sessionScope, organizationId, workId),
    queryFn: () => productionApi.materials(organizationId, workId),
    enabled: Boolean(organizationId && sessionScope && workId),
    retry: false,
  });
  const [quantity, setQuantity] = useState("1");
  const [kind, setKind] = useState<"consumed" | "waste" | "correction">(
    "consumed",
  );
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [correctsConsumptionId, setCorrectsConsumptionId] = useState("");
  const refresh = () =>
    client.invalidateQueries({
      queryKey: materialKeys.detail(sessionScope, organizationId, workId),
    });
  const reserve = useMutation({
    mutationFn: () =>
      productionApi.reserveMaterials(
        organizationId,
        workId,
        newBusinessRequestId(),
      ),
    onSuccess: refresh,
  });
  const release = useMutation({
    mutationFn: () =>
      productionApi.releaseUnusedMaterials(
        organizationId,
        workId,
        newBusinessRequestId(),
      ),
    onSuccess: refresh,
  });
  const record = useMutation({
    mutationFn: (
      requirement: ProductionMaterialProjection["usage"]["comparison"][number],
    ) =>
      productionApi.recordMaterial(
        organizationId,
        workId,
        activeAttempt!.productionAttemptId,
        newBusinessRequestId(),
        {
          materialId: requirement.materialId,
          ...(requirement.requirementId
            ? { requirementId: requirement.requirementId }
            : {}),
          quantity,
          unit: requirement.unit,
          kind,
          ...(kind === "correction" && correctsConsumptionId
            ? { correctsConsumptionId }
            : {}),
        },
      ),
    onSuccess: refresh,
  });
  const reconcile = useMutation({
    mutationFn: (consumptionId: string) =>
      productionApi.reconcileMaterial(
        organizationId,
        workId,
        consumptionId,
        newBusinessRequestId(),
      ),
    onSuccess: refresh,
  });
  const comparison = projection.data?.usage.comparison ?? [];
  const selected =
    comparison.find((item) => item.materialId === selectedMaterialId) ??
    comparison[0];
  const error =
    record.error ?? reserve.error ?? release.error ?? reconcile.error;
  return (
    <article className="v2-production-materials">
      <header>
        <div>
          <h3>Materials</h3>
          <p>
            Expected requirements, physical usage, and stock reconciliation
            remain separate facts.
          </p>
        </div>
        <div>
          <button
            type="button"
            disabled={!canWork || reserve.isPending}
            onClick={() => reserve.mutate()}
          >
            {reserve.isPending ? "Reserving…" : "Reserve materials"}
          </button>
          <button
            type="button"
            disabled={!canWork || release.isPending}
            onClick={() => release.mutate()}
          >
            {release.isPending ? "Releasing…" : "Release unused"}
          </button>
        </div>
      </header>
      {projection.isLoading ? (
        <p>Loading material status…</p>
      ) : projection.isError ? (
        <p className="v2-proof-empty">
          Material status is unavailable for this Production work.
        </p>
      ) : (
        <>
          <div className="v2-production-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Expected</th>
                  <th>Used</th>
                  <th>Waste</th>
                  <th>Variance</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((item) => {
                  const balance = projection.data?.inventory.balances.find(
                    (candidate) => candidate.materialId === item.materialId,
                  );
                  return (
                    <tr
                      key={`${item.materialId}:${item.requirementId ?? "unplanned"}`}
                    >
                      <td>{item.materialName}</td>
                      <td>
                        {item.expectedQuantity} {item.unit}
                      </td>
                      <td>
                        {item.consumedQuantity} {item.unit}
                      </td>
                      <td>
                        {item.wasteQuantity} {item.unit}
                      </td>
                      <td>
                        {item.varianceQuantity} {item.unit}
                      </td>
                      <td>
                        {balance
                          ? `${balance.availableQuantity} available`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!comparison.length && (
                  <tr>
                    <td colSpan={6}>
                      No frozen material requirements apply to this Production
                      work.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {activeAttempt && selected ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                record.mutate(selected);
              }}
            >
              <label>
                Material
                <select
                  value={selectedMaterialId || selected.materialId}
                  onChange={(event) =>
                    setSelectedMaterialId(event.target.value)
                  }
                >
                  {comparison.map((item) => (
                    <option key={item.materialId} value={item.materialId}>
                      {item.materialName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Physical event
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as typeof kind)
                  }
                >
                  <option value="consumed">Record usage</option>
                  <option value="waste">Record waste</option>
                  <option value="correction">Correct prior usage</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  required
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              {kind === "correction" && (
                <label>
                  Corrects
                  <select
                    required
                    value={correctsConsumptionId}
                    onChange={(event) =>
                      setCorrectsConsumptionId(event.target.value)
                    }
                  >
                    <option value="">Select consumption fact</option>
                    {projection.data?.usage.facts
                      .filter((fact) => fact.kind !== "correction")
                      .map((fact) => (
                        <option
                          key={fact.consumptionId}
                          value={fact.consumptionId}
                        >
                          {fact.kind} · {fact.quantity} {fact.unit}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <button type="submit" disabled={!canWork || record.isPending}>
                {record.isPending
                  ? "Recording…"
                  : kind === "waste"
                    ? "Record waste"
                    : kind === "correction"
                      ? "Record correction"
                      : "Record usage"}
              </button>
            </form>
          ) : (
            <p>
              {activeAttempt
                ? "No frozen material requirement is available to record."
                : "Start a Production attempt before recording actual material usage."}
            </p>
          )}
          <section>
            <h4>Reconciliation</h4>
            {projection.data?.inventory.facts.length ? (
              projection.data.inventory.facts.map((fact) => (
                <p key={fact.consumptionId}>
                  <span>{fact.status}</span>
                  {fact.lastFailureMessage
                    ? ` · ${fact.lastFailureMessage}`
                    : ""}
                  {fact.status !== "applied" && (
                    <button
                      type="button"
                      disabled={!canWork || reconcile.isPending}
                      onClick={() => reconcile.mutate(fact.consumptionId)}
                    >
                      Retry reconciliation
                    </button>
                  )}
                </p>
              ))
            ) : (
              <p>No unapplied material consumption is recorded.</p>
            )}
          </section>
          {error && (
            <p className="v2-product-version-message">
              {(error as { message?: string }).message ??
                "Material operation could not be completed."}
            </p>
          )}
        </>
      )}
    </article>
  );
};

const attemptLabel = (attempt: ProductionAttempt) =>
  `${attempt.kind[0]!.toUpperCase()}${attempt.kind.slice(1)} · ${attempt.stationKey} · ${attempt.goodQuantity} good${
    attempt.wasteQuantity ? ` · ${attempt.wasteQuantity} waste` : ""
  }`;

/**
 * The approved Production station presentation backed entirely by real M2.3
 * ProductionWork/ProductionAttempt projections. Board and Calendar deliberately
 * remain read-only projections: no scheduling or Kanban state is introduced.
 */
export const ProductionWorkspace = ({
  organizationId,
  sessionScope,
  canView,
  canWork,
  canComplete,
  station: routedStation,
  onStationChange,
}: {
  organizationId: string;
  sessionScope: string;
  canView: boolean;
  canWork: boolean;
  canComplete: boolean;
  station?: Station;
  onStationChange: (station?: Station) => void;
}) => {
  const [station, setStation] = useState<Station>("flatbed");
  const [view, setView] = useState<ProductionView>("overview");
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [goodQuantity, setGoodQuantity] = useState("1");
  const queryClient = useQueryClient();
  const canRead = Boolean(organizationId && sessionScope && canView);
  const flatbedQueue = useQuery({
    queryKey: keys.queue(sessionScope, organizationId, "flatbed"),
    queryFn: () => productionApi.queue(organizationId, "flatbed"),
    enabled: canRead,
  });
  const rollQueue = useQuery({
    queryKey: keys.queue(sessionScope, organizationId, "roll"),
    queryFn: () => productionApi.queue(organizationId, "roll"),
    enabled: canRead,
  });
  const queue = station === "flatbed" ? flatbedQueue : rollQueue;
  const stationQueues = useMemo(
    () => ({ flatbed: flatbedQueue.data ?? [], roll: rollQueue.data ?? [] }),
    [flatbedQueue.data, rollQueue.data],
  );
  useEffect(() => {
    if (!routedStation) return;
    setStation(routedStation);
    setView("stations");
    setSelectedWorkId("");
  }, [routedStation]);

  useEffect(() => {
    if (!selectedWorkId && queue.data?.[0])
      setSelectedWorkId(queue.data[0].work.productionWorkId);
  }, [queue.data, selectedWorkId]);

  const work = queue.data?.find(
    (item) => item.work.productionWorkId === selectedWorkId,
  );
  const activeAttempt = work?.attempts.find((attempt) => !attempt.completedAt);
  const remainingGoodQuantity = work
    ? Math.max(0, work.work.orderedQuantity - work.completedGoodQuantity)
    : 0;

  useEffect(() => {
    if (activeAttempt)
      setGoodQuantity(String(Math.max(1, remainingGoodQuantity)));
  }, [activeAttempt?.productionAttemptId, remainingGoodQuantity]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.queue(sessionScope, organizationId, "flatbed"),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.queue(sessionScope, organizationId, "roll"),
      }),
    ]);
  const start = useMutation({
    mutationFn: (kind: "initial" | "reprint" | "correction") =>
      productionApi.start(
        organizationId,
        work!.work.productionWorkId,
        newBusinessRequestId(),
        station,
        kind,
      ),
    onSuccess: refresh,
  });
  const output = useMutation({
    mutationFn: (attemptId: string) =>
      productionApi.output(
        organizationId,
        attemptId,
        newBusinessRequestId(),
        Math.max(
          1,
          Math.min(
            remainingGoodQuantity || 1,
            Number.parseInt(goodQuantity, 10) || 1,
          ),
        ),
      ),
    onSuccess: refresh,
  });
  const complete = useMutation({
    mutationFn: (attemptId: string) =>
      productionApi.complete(organizationId, attemptId, newBusinessRequestId()),
    onSuccess: refresh,
  });

  const selectStation = (nextStation: Station) => {
    setStation(nextStation);
    setSelectedWorkId("");
    setView("stations");
    onStationChange(nextStation);
    // A station can receive work from another authenticated operator while this
    // workspace remains open. Selecting the station is an intentional refresh
    // point, so the queue stays an authoritative projection rather than a
    // browser-local snapshot.
    void (nextStation === "flatbed"
      ? flatbedQueue.refetch()
      : rollQueue.refetch());
  };

  if (!organizationId) {
    return (
      <section className="v2-production">
        <div className="v2-proof-empty">
          Enter an authenticated organization in Sales before opening
          Production.
        </div>
      </section>
    );
  }
  if (!canView) {
    return (
      <section className="v2-production">
        <div className="v2-proof-empty">
          You do not have permission to view Production.
        </div>
      </section>
    );
  }

  const allWork = [
    ...new Map(
      [...stationQueues.flatbed, ...stationQueues.roll].map((item) => [
        item.work.productionWorkId,
        item,
      ]),
    ).values(),
  ];
  const totalWork = allWork.length;
  const activeWork = allWork.filter((item) =>
    item.attempts.some((attempt) => !attempt.completedAt),
  ).length;
  const satisfiedWork = allWork.filter(
    (item) => item.unitQuantitySatisfied,
  ).length;

  return (
    <section className="v2-production">
      <header className="v2-production-page-header">
        <div>
          <h1>Production</h1>
          <p>
            {totalWork} real production unit{totalWork === 1 ? "" : "s"} across
            Flatbed and Roll
          </p>
        </div>
        <div className="v2-production-view-toggle" aria-label="Production view">
          {(["overview", "board", "calendar", "stations"] as const).map(
            (option) => (
              <button
                key={option}
                type="button"
                className={view === option ? "active" : ""}
                onClick={() => {
                  setView(option);
                  if (option === "overview") onStationChange(undefined);
                }}
              >
                {option[0]!.toUpperCase()}
                {option.slice(1)}
              </button>
            ),
          )}
        </div>
      </header>

      {view === "board" ? (
        <section className="v2-production-board" aria-label="Production board">
          <p>
            Station columns are a read-only projection of real Production work.
            Reassignment and Kanban movement await a separately owned scheduling
            decision.
          </p>
          <div>
            {(["flatbed", "roll"] as const).map((stationKey) => (
              <article key={stationKey}>
                <header>
                  <h2>
                    {stationKey[0]!.toUpperCase()}
                    {stationKey.slice(1)}
                  </h2>
                  <span>{stationQueues[stationKey].length}</span>
                </header>
                {stationQueues[stationKey].map((item) => (
                  <button
                    key={item.work.productionWorkId}
                    type="button"
                    onClick={() => {
                      setStation(stationKey);
                      setSelectedWorkId(item.work.productionWorkId);
                      setView("stations");
                    }}
                  >
                    <b>{requirementLabel(item)}</b>
                    <small>
                      Line {item.work.orderLineId} ·{" "}
                      {item.completedGoodQuantity} / {item.work.orderedQuantity}{" "}
                      good
                    </small>
                    <em className={statusClass(item)}>{workState(item)}</em>
                  </button>
                ))}
                {!stationQueues[stationKey].length && (
                  <small className="v2-production-empty-column">
                    No active Production work.
                  </small>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : view === "calendar" ? (
        <section
          className="v2-production-calendar"
          aria-label="Production calendar"
        >
          <h2>Calendar</h2>
          <p>
            Production scheduling, machine reservations, capacity, and scheduled
            start times are not yet authoritative V2 facts. This view
            intentionally does not fabricate a calendar.
          </p>
          <div>
            <b>{activeWork}</b>
            <span>active attempts</span>
            <b>{satisfiedWork}</b>
            <span>satisfied units</span>
          </div>
        </section>
      ) : view === "overview" ? (
        <>
          <section
            className="v2-production-metrics"
            aria-label="Production summary"
          >
            <article>
              <small>In production</small>
              <b>{activeWork}</b>
            </article>
            <article>
              <small>Flatbed queue</small>
              <b>{stationQueues.flatbed.length}</b>
            </article>
            <article>
              <small>Roll queue</small>
              <b>{stationQueues.roll.length}</b>
            </article>
            <article>
              <small>Units satisfied</small>
              <b>{satisfiedWork}</b>
            </article>
          </section>
          <section className="v2-production-overview">
            <article className="v2-production-overview-table">
              <header>
                <h2>Job queue</h2>
              </header>
              <div className="v2-production-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Order line</th>
                      <th>Required unit</th>
                      <th>Qty</th>
                      <th>Station</th>
                      <th>Production</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allWork.map((item) => (
                      <tr key={item.work.productionWorkId}>
                        <td className="num">{item.work.orderLineId}</td>
                        <td>{requirementLabel(item)}</td>
                        <td className="num">{item.work.orderedQuantity}</td>
                        <td>{item.attempts[0]?.stationKey ?? "Next up"}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              setStation(
                                item.attempts[0]?.stationKey ?? "flatbed",
                              );
                              setSelectedWorkId(item.work.productionWorkId);
                              setView("stations");
                            }}
                          >
                            {workState(item)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <aside className="v2-production-overview-side">
              <article>
                <header>
                  <h2>Station load</h2>
                </header>
                {(["flatbed", "roll"] as const).map((stationKey) => (
                  <div key={stationKey}>
                    <span>
                      {stationKey[0]!.toUpperCase()}
                      {stationKey.slice(1)}
                    </span>
                    <b>{stationQueues[stationKey].length} units</b>
                    <i>
                      <em
                        style={{
                          width: `${Math.min(100, stationQueues[stationKey].length * 25)}%`,
                        }}
                      />
                    </i>
                  </div>
                ))}
              </article>
              <article>
                <header>
                  <h2>Operational truth</h2>
                </header>
                <p>
                  Queue values use real ProductionWork and attempts only.
                  Scheduling, machine load, and fulfillment readiness remain
                  deferred.
                </p>
              </article>
            </aside>
          </section>
        </>
      ) : view === "stations" ? (
        <>
          <div
            className="v2-production-station-tabs"
            role="tablist"
            aria-label="Production stations"
          >
            <button type="button" onClick={() => setView("overview")}>
              ← All stations
            </button>
            {(["flatbed", "roll"] as const).map((stationKey) => (
              <button
                key={stationKey}
                type="button"
                role="tab"
                aria-selected={station === stationKey}
                className={station === stationKey ? "active" : ""}
                onClick={() => selectStation(stationKey)}
              >
                {stationKey[0]!.toUpperCase()}
                {stationKey.slice(1)}
                <span>{stationQueues[stationKey].length}</span>
              </button>
            ))}
            <small>{activeAttempt ? "In Progress" : "Next up"}</small>
          </div>
          <section className="v2-production-station">
            <aside className="v2-production-rail">
              {work ? (
                <>
                  <section>
                    <small>Selected production unit</small>
                    <h2>{requirementLabel(work)}</h2>
                    <dl>
                      <div>
                        <dt>Target</dt>
                        <dd>{work.work.orderedQuantity}</dd>
                      </div>
                      <div>
                        <dt>Good output</dt>
                        <dd>{work.completedGoodQuantity}</dd>
                      </div>
                      <div>
                        <dt>Station</dt>
                        <dd>{station}</dd>
                      </div>
                      <div>
                        <dt>Unit</dt>
                        <dd>
                          {work.unitQuantitySatisfied
                            ? "Satisfied"
                            : "Not satisfied"}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section className="v2-production-actions">
                    <button
                      className="v2-production-rail-button future"
                      disabled
                    >
                      Print ticket
                    </button>
                    {!activeAttempt ? (
                      <>
                        <button
                          className="v2-production-rail-button go"
                          disabled={
                            !canWork ||
                            start.isPending ||
                            work.unitQuantitySatisfied
                          }
                          onClick={() =>
                            start.mutate(
                              work.attempts.length ? "reprint" : "initial",
                            )
                          }
                        >
                          {work.attempts.length
                            ? "Start reprint"
                            : "Start production"}
                        </button>
                        {work.unitQuantitySatisfied && (
                          <p>
                            Unit satisfaction is derived from Production output.
                            Fulfillment remains independent.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <label>
                          Good output
                          <input
                            aria-label="Good output"
                            type="number"
                            min="1"
                            max={Math.max(1, remainingGoodQuantity)}
                            step="1"
                            value={goodQuantity}
                            onChange={(event) =>
                              setGoodQuantity(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="v2-production-rail-button go"
                          disabled={
                            !canWork ||
                            output.isPending ||
                            remainingGoodQuantity === 0
                          }
                          onClick={() =>
                            output.mutate(activeAttempt.productionAttemptId)
                          }
                        >
                          Record good output
                        </button>
                        <button
                          className="v2-production-rail-button neutral"
                          disabled={!canComplete || complete.isPending}
                          onClick={() =>
                            complete.mutate(activeAttempt.productionAttemptId)
                          }
                        >
                          Complete attempt
                        </button>
                      </>
                    )}
                    <button
                      className="v2-production-rail-button future"
                      disabled
                    >
                      Pause
                    </button>
                    <button
                      className="v2-production-rail-button future"
                      disabled
                    >
                      Return to Prepress
                    </button>
                    <button
                      className="v2-production-rail-button future"
                      disabled
                    >
                      Add Production Note
                    </button>
                  </section>
                </>
              ) : (
                <p className="v2-proof-empty">Select a Production unit.</p>
              )}
            </aside>

            <main className="v2-production-detail">
              {work ? (
                <>
                  <header className="v2-production-detail-header">
                    <div>
                      <span>Order line {work.work.orderLineId}</span>
                      <h2>{requirementLabel(work)}</h2>
                      <p>
                        Exact required unit · {station} · Production uses the
                        frozen Artwork evidence below.
                      </p>
                    </div>
                    <div>
                      <b>
                        {work.completedGoodQuantity} /{" "}
                        {work.work.orderedQuantity} good
                      </b>
                      <small>
                        {work.unitQuantitySatisfied
                          ? "Unit satisfied"
                          : "Operational output only"}
                      </small>
                    </div>
                  </header>
                  <section className="v2-production-artwork">
                    <header>
                      <small>Production art</small>
                      <strong>{requirementLabel(work)}</strong>
                      <em
                        className={work.work.prepressUnitId ? "ok" : "neutral"}
                      >
                        {work.work.prepressUnitId
                          ? "Prepress evidence recorded"
                          : "No Prepress evidence required"}
                      </em>
                    </header>
                    <div className="v2-production-art-cards">
                      <div>
                        <small>Line item art</small>
                        <b>Unavailable</b>
                        <span>
                          Line-item artwork projection is not selected by
                          Production.
                        </span>
                      </div>
                      <div className="selected">
                        <small>Production art</small>
                        <b>{requirementLabel(work)}</b>
                        <span>Preview unavailable</span>
                        <em>{work.work.artworkFileId}</em>
                      </div>
                    </div>
                    <footer>
                      Artwork assignment {work.work.artworkAssignmentId} ·
                      Artwork file {work.work.artworkFileId}
                    </footer>
                  </section>
                  <ProductionMaterials
                    organizationId={organizationId}
                    sessionScope={sessionScope}
                    workId={work.work.productionWorkId}
                    activeAttempt={activeAttempt}
                    canWork={canWork}
                  />
                  <section className="v2-production-detail-lower">
                    <article>
                      <h3>Attempt history</h3>
                      {work.attempts.length ? (
                        work.attempts.map((attempt) => (
                          <p key={attempt.productionAttemptId}>
                            <b>#{attempt.sequence}</b> {attemptLabel(attempt)}{" "}
                            <span>
                              {attempt.completedAt ? "Completed" : "Active"}
                            </span>
                          </p>
                        ))
                      ) : (
                        <p>No Production attempts recorded.</p>
                      )}
                    </article>
                    <article>
                      <h3>Routing</h3>
                      <p>
                        Routing eligibility is read-only. Production work never
                        advances or rebuilds the frozen route.
                      </p>
                    </article>
                    <article>
                      <h3>Fulfillment</h3>
                      <p>
                        Produced quantity is operational context only; it never
                        caps pickup or shipment authority.
                      </p>
                    </article>
                  </section>
                </>
              ) : (
                <div className="v2-proof-empty">
                  No real Production work is available at this station.
                </div>
              )}
            </main>

            <aside className="v2-production-queue">
              <header>
                <div>
                  <h2>
                    {station[0]!.toUpperCase()}
                    {station.slice(1)} queue
                  </h2>
                  <span>{queue.data?.length ?? 0} units</span>
                </div>
              </header>
              <div>
                {queue.data?.map((item) => (
                  <button
                    key={item.work.productionWorkId}
                    type="button"
                    className={
                      item.work.productionWorkId === selectedWorkId
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setSelectedWorkId(item.work.productionWorkId)
                    }
                  >
                    <b>{requirementLabel(item)}</b>
                    <small>Line {item.work.orderLineId}</small>
                    <small>
                      Target {item.work.orderedQuantity} · Good{" "}
                      {item.completedGoodQuantity}
                    </small>
                    <em className={statusClass(item)}>{workState(item)}</em>
                  </button>
                ))}
                {queue.isSuccess && !queue.data?.length && (
                  <p className="v2-proof-empty">
                    No Production work has been opened at this station.
                  </p>
                )}
              </div>
            </aside>
          </section>
        </>
      ) : null}
    </section>
  );
};
