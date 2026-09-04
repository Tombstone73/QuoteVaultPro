import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  newBusinessRequestId,
  prepressApi,
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
const eligibleKey = (scope: string, organizationId: string) => ["v2", scope, organizationId, "production", "eligible"] as const;

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

export const orderLabel = (work: ProductionWorkProjection) =>
  work.operatorContext?.orderNumber ?? `Order ${work.work.orderId}`;

export const productLabel = (work: ProductionWorkProjection) =>
  work.operatorContext?.product?.displayName ?? "Product unavailable";

export const customerLabel = (work: ProductionWorkProjection) =>
  work.operatorContext?.customer?.displayName ?? "Customer unavailable";

const materialKeys = {
  detail: (scope: string, organizationId: string, workId: string) =>
    ["v2", scope, organizationId, "production", workId, "materials"] as const,
};

type MaterialRequirementComparison =
  ProductionMaterialProjection["usage"]["comparison"][number];

export type MaterialRequirementChoice = Readonly<{
  value: string;
  label: string;
  requirement: MaterialRequirementComparison;
}>;

/**
 * Frozen requirements, rather than Materials, are the operational identity for
 * Production usage. A single Material can legitimately appear in more than
 * one requirement (for example separate Recipe components), so each choice
 * must retain its exact frozen requirement id.
 */
export const materialRequirementChoices = (
  comparison: readonly MaterialRequirementComparison[],
): readonly MaterialRequirementChoice[] => {
  const materialCounts = new Map<string, number>();
  for (const item of comparison)
    materialCounts.set(item.materialId, (materialCounts.get(item.materialId) ?? 0) + 1);
  const materialPositions = new Map<string, number>();
  return comparison.map((requirement) => {
    const position = (materialPositions.get(requirement.materialId) ?? 0) + 1;
    materialPositions.set(requirement.materialId, position);
    const duplicateMaterial = (materialCounts.get(requirement.materialId) ?? 0) > 1;
    const source = duplicateMaterial && requirement.requirementId
      ? `Requirement ${position}`
      : undefined;
    return Object.freeze({
      // Frozen requirements are the primary selection identity. The fallback
      // is retained only for legacy/unplanned material facts that have no
      // frozen requirement to select.
      value: requirement.requirementId ?? `unplanned:${requirement.materialId}:${requirement.unit}`,
      label: [
        requirement.materialName,
        requirement.materialSku ? `SKU ${requirement.materialSku}` : undefined,
        source,
        `${requirement.expectedQuantity} ${requirement.unit}`,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      requirement,
    });
  });
};

export const materialConsumptionRequest = (
  requirement: MaterialRequirementComparison,
  input: Readonly<{
    quantity: string;
    kind: "consumed" | "waste" | "correction";
    correctsConsumptionId?: string;
  }>,
) => ({
  materialId: requirement.materialId,
  ...(requirement.requirementId
    ? { requirementId: requirement.requirementId }
    : {}),
  quantity: input.quantity,
  unit: requirement.unit,
  kind: input.kind,
  ...(input.correctsConsumptionId
    ? { correctsConsumptionId: input.correctsConsumptionId }
    : {}),
});

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
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
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
      requirement: MaterialRequirementComparison,
    ) =>
      productionApi.recordMaterial(
        organizationId,
        workId,
        activeAttempt!.productionAttemptId,
        newBusinessRequestId(),
        materialConsumptionRequest(requirement, {
          quantity,
          kind,
          ...(kind === "correction" && correctsConsumptionId
            ? { correctsConsumptionId }
            : {}),
        }),
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
  const choices = materialRequirementChoices(comparison);
  const selected =
    choices.find((choice) => choice.value === selectedRequirementId) ??
    choices[0];
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
                {choices.map(({ label, requirement: item }) => {
                  const balance = projection.data?.inventory.balances.find(
                    (candidate) => candidate.materialId === item.materialId,
                  );
                  return (
                    <tr
                      key={`${item.materialId}:${item.requirementId ?? "unplanned"}`}
                    >
                      <td>{label}</td>
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
                record.mutate(selected.requirement);
              }}
            >
              <label>
                Material
                <select
                  value={selected.value}
                  onChange={(event) =>
                    setSelectedRequirementId(event.target.value)
                  }
                >
                  {choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
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
  productionWorkId: routedProductionWorkId,
  onStationChange,
  onSelectWork,
  openOrder,
  openCustomer,
  openArtwork,
}: {
  organizationId: string;
  sessionScope: string;
  canView: boolean;
  canWork: boolean;
  canComplete: boolean;
  station?: Station;
  productionWorkId?: string;
  onStationChange: (station?: Station) => void;
  onSelectWork: (productionWorkId?: string) => void;
  openOrder: (orderId: string) => void;
  openCustomer: (customerId: string) => void;
  openArtwork: (artworkFileId: string) => void;
}) => {
  const [station, setStation] = useState<Station>("flatbed");
  const [view, setView] = useState<ProductionView>("overview");
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [goodQuantity, setGoodQuantity] = useState("1");
  const [queueState, setQueueState] = useState<Record<Station, { page: number; pageSize: 25 | 50 | 100; search: string }>>({ flatbed: { page: 1, pageSize: 25, search: "" }, roll: { page: 1, pageSize: 25, search: "" } });
  const queryClient = useQueryClient();
  const canRead = Boolean(organizationId && sessionScope && canView);
  const flatbedQueue = useQuery({
    queryKey: [...keys.queue(sessionScope, organizationId, "flatbed"), queueState.flatbed.page, queueState.flatbed.pageSize, queueState.flatbed.search],
    queryFn: () => productionApi.queue(organizationId, "flatbed", queueState.flatbed),
    enabled: canRead,
  });
  const rollQueue = useQuery({
    queryKey: [...keys.queue(sessionScope, organizationId, "roll"), queueState.roll.page, queueState.roll.pageSize, queueState.roll.search],
    queryFn: () => productionApi.queue(organizationId, "roll", queueState.roll),
    enabled: canRead,
  });
  const routedWork = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "work", routedProductionWorkId],
    queryFn: () => productionApi.get(organizationId, routedProductionWorkId!),
    enabled: canRead && Boolean(routedProductionWorkId),
    retry: false,
  });
  const eligible = useQuery({queryKey:eligibleKey(sessionScope,organizationId),queryFn:()=>prepressApi.list(organizationId,{page:1,pageSize:100}),enabled:canRead,retry:false});
  const queue = station === "flatbed" ? flatbedQueue : rollQueue;
  const stationQueues = useMemo(
    () => ({ flatbed: flatbedQueue.data?.items ?? [], roll: rollQueue.data?.items ?? [] }),
    [flatbedQueue.data, rollQueue.data],
  );
  useEffect(() => {
    if (!routedStation) return;
    setStation(routedStation);
    setView("stations");
    if (!routedProductionWorkId) setSelectedWorkId("");
  }, [routedStation, routedProductionWorkId]);

  useEffect(() => {
    if (!routedProductionWorkId) return;
    setSelectedWorkId(routedProductionWorkId);
    setView("stations");
  }, [routedProductionWorkId]);

  useEffect(() => {
    if (!selectedWorkId && queue.data?.items[0])
      setSelectedWorkId(queue.data.items[0].work.productionWorkId);
  }, [queue.data, selectedWorkId]);

  const work = routedProductionWorkId
    ? routedWork.data
    : queue.data?.items.find((item) => item.work.productionWorkId === selectedWorkId);
  const activeAttempt = work?.attempts.find((attempt) => !attempt.completedAt);
  const mostRecentAttempt = work?.attempts[work.attempts.length - 1];
  const workStation = activeAttempt?.stationKey ?? mostRecentAttempt?.stationKey ?? station;
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
      ...(routedProductionWorkId
        ? [queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "production", "work", routedProductionWorkId] })]
        : []),
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
  const open = useMutation({mutationFn:(artworkAssignmentId:string)=>productionApi.open(organizationId,newBusinessRequestId(),artworkAssignmentId),onSuccess:refresh});

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

  const selectWork = (item: ProductionWorkProjection, stationKey?: Station) => {
    if (stationKey) setStation(stationKey);
    setSelectedWorkId(item.work.productionWorkId);
    setView("stations");
    onSelectWork(item.work.productionWorkId);
  };
  const activeQueueState = queueState[station];
  const updateQueueState = (next: Partial<{ page: number; pageSize: 25 | 50 | 100; search: string }>) => setQueueState((current) => ({ ...current, [station]: { ...current[station], ...next } }));

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
  const openable = (eligible.data?.items ?? []).flatMap((item) => item.routingStepKind === "production" && item.coverage.productionArtworkComplete && item.coverage.allRequiredPrepressUnitsComplete ? item.coverage.requirements.flatMap((requirement) => requirement.artworkAssignmentIds.map((artworkAssignmentId) => ({ item, requirement, artworkAssignmentId }))) : []);

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

      {!!openable.length && <section className="v2-production-open-work"><h2>Ready to open</h2>{openable.map(({item,requirement,artworkAssignmentId})=><article key={artworkAssignmentId}><div><b>{item.orderNumber} · {item.lineDescription}</b><small>{item.quantity} ordered · {requirementLabel({work:{requirement:requirement.requirement} as ProductionWorkProjection["work"]} as ProductionWorkProjection)} · Prepress complete</small></div><button type="button" disabled={!canWork||open.isPending} onClick={()=>open.mutate(artworkAssignmentId)}>{open.isPending?"Opening…":"Open Production Work"}</button></article>)}{open.isError&&<p className="v2-product-version-message">{(open.error as Error).message}</p>}</section>}

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
                      selectWork(item, stationKey);
                    }}
                  >
                    <b>{productLabel(item)}</b>
                    <small>
                      {orderLabel(item)} · {customerLabel(item)} · {requirementLabel(item)} ·{" "}
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
                      <th>Order / Product</th>
                      <th>Required unit</th>
                      <th>Qty</th>
                      <th>Station</th>
                      <th>Production</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allWork.map((item) => (
                      <tr key={item.work.productionWorkId}>
                        <td>
                          <button type="button" onClick={() => openOrder(item.work.orderId)}>
                            {orderLabel(item)}
                          </button>
                          <small>{productLabel(item)} · {customerLabel(item)} · Line {item.work.orderLineId}</small>
                        </td>
                        <td>{requirementLabel(item)}</td>
                        <td className="num">{item.work.orderedQuantity}</td>
                        <td>{item.attempts[0]?.stationKey ?? "Next up"}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              selectWork(item, item.attempts[0]?.stationKey ?? "flatbed");
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
            <button
              type="button"
              onClick={() => {
                setView("overview");
                setSelectedWorkId("");
                onSelectWork(undefined);
              }}
            >
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
                    <h2>{productLabel(work)}</h2>
                    <dl>
                      <div>
                        <dt>Customer</dt>
                        <dd>{customerLabel(work)}</dd>
                      </div>
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
                    <button className="v2-production-rail-button neutral" type="button" onClick={() => window.open(`/v2/organizations/${encodeURIComponent(organizationId)}/production/works/${encodeURIComponent(work.work.productionWorkId)}/traveler.pdf`, "_blank", "noopener,noreferrer")}>Preview traveler</button>
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
                      <span>
                        <button type="button" onClick={() => openOrder(work.work.orderId)}>
                          {orderLabel(work)}
                        </button>
                        {" · "}line {work.work.orderLineId}
                      </span>
                      <h2>{productLabel(work)}</h2>
                      {work.operatorContext?.customer ? (
                        <button
                          type="button"
                          onClick={() => openCustomer(work.operatorContext!.customer!.customerId)}
                        >
                          {customerLabel(work)}
                        </button>
                      ) : (
                        <small>{customerLabel(work)}</small>
                      )}
                      <p>
                        {requirementLabel(work)} · {workStation} · Production uses the
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
                        <button type="button" onClick={() => openArtwork(work.work.artworkFileId)}>
                          Open Artwork
                        </button>
                      </div>
                    </div>
                    <footer>Exact frozen Production artwork evidence is retained by the canonical work record.</footer>
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
                  {routedProductionWorkId
                    ? "The selected Production work is unavailable in this organization."
                    : "No real Production work is available at this station."}
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
                  <span>{queue.data?.pagination.totalCount ?? 0} units</span>
                </div>
                <input aria-label={`Search ${station} queue`} placeholder="Search order, customer, item…" value={activeQueueState.search} onChange={(event) => updateQueueState({ search: event.target.value, page: 1 })} />
              </header>
              <QueuePager page={activeQueueState.page} pageSize={activeQueueState.pageSize} total={queue.data?.pagination.totalCount ?? 0} totalPages={queue.data?.pagination.totalPages ?? 0} onPage={(page) => updateQueueState({ page })} onPageSize={(pageSize) => updateQueueState({ pageSize, page: 1 })} />
              <div>
                {queue.data?.items.map((item) => (
                  <button
                    key={item.work.productionWorkId}
                    type="button"
                    className={
                      item.work.productionWorkId === selectedWorkId
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      selectWork(item, station)
                    }
                  >
                    <b>{productLabel(item)}</b>
                    <small>{orderLabel(item)} · {customerLabel(item)} · Line {item.work.orderLineId}</small>
                    <small>
                      Target {item.work.orderedQuantity} · Good{" "}
                      {item.completedGoodQuantity}
                    </small>
                    <em className={statusClass(item)}>{workState(item)}</em>
                  </button>
                ))}
                {queue.isSuccess && !queue.data?.items.length && (
                  <p className="v2-proof-empty">
                    No Production work has been opened at this station.
                  </p>
                )}
              </div>
              <QueuePager page={activeQueueState.page} pageSize={activeQueueState.pageSize} total={queue.data?.pagination.totalCount ?? 0} totalPages={queue.data?.pagination.totalPages ?? 0} onPage={(page) => updateQueueState({ page })} onPageSize={(pageSize) => updateQueueState({ pageSize, page: 1 })} />
            </aside>
          </section>
        </>
      ) : null}
    </section>
  );
};

const QueuePager = ({ page, pageSize, total, totalPages, onPage, onPageSize }: Readonly<{ page: number; pageSize: 25 | 50 | 100; total: number; totalPages: number; onPage: (page: number) => void; onPageSize: (pageSize: 25 | 50 | 100) => void }>) => <div className="v2-queue-pager"><small>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 work items"}</small><label>Rows <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value) as 25 | 50 | 100)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><small>Page {page} of {Math.max(totalPages, 1)}</small><button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button></div>;
