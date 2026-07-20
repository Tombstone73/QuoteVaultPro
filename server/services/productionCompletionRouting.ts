export type ProductionCompletionRoute = {
  stationKey: string;
  stepKey: string;
  source: "step_trigger" | "configured_finishing" | "default_fulfillment";
};

type CompletionTrigger = {
  type: string;
  config?: Record<string, unknown>;
};

export type ProductionCompletionRouteResult =
  | { kind: "complete" }
  | { kind: "managed_elsewhere" }
  | { kind: "route"; route: ProductionCompletionRoute }
  | { kind: "missing_mapping"; stationKey: string; stepKey: string };

const PRINT_STATIONS = new Set(["print", "flatbed", "roll", "wide_roll"]);
const BUILT_IN_FULFILLMENT_PREDECESSORS = new Set(["finishing", "cutting"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveProductionCompletionRoute(args: {
  stationKey: string | null | undefined;
  stepKey: string | null | undefined;
  finishingMode: string;
  triggers?: readonly CompletionTrigger[] | null;
}): ProductionCompletionRouteResult {
  const stationKey = normalize(args.stationKey);
  const stepKey = normalize(args.stepKey) || "queued";

  const routeTrigger = (args.triggers ?? []).find((trigger) => {
    const type = normalize(trigger.type).replace(/-/g, "_");
    return type === "on_complete_route" || type === "route_on_complete";
  });
  if (routeTrigger) {
    const targetStationKey = normalize(routeTrigger.config?.stationKey ?? routeTrigger.config?.targetStationKey);
    const targetStepKey = normalize(routeTrigger.config?.stepKey ?? routeTrigger.config?.targetStepKey) || targetStationKey;
    if (targetStationKey) {
      return {
        kind: "route",
        route: { stationKey: targetStationKey, stepKey: targetStepKey, source: "step_trigger" },
      };
    }
  }

  if (stationKey === "fulfillment" || stationKey === "done" || stationKey === "completed") {
    return { kind: "complete" };
  }
  if (stationKey === "design" || stationKey === "proofing" || stationKey === "prepress") {
    return { kind: "managed_elsewhere" };
  }
  if (PRINT_STATIONS.has(stationKey) && args.finishingMode === "dedicated_finishing_queue") {
    return {
      kind: "route",
      route: { stationKey: "finishing", stepKey: "finishing", source: "configured_finishing" },
    };
  }
  if (PRINT_STATIONS.has(stationKey) || BUILT_IN_FULFILLMENT_PREDECESSORS.has(stationKey)) {
    return {
      kind: "route",
      route: { stationKey: "fulfillment", stepKey: "fulfillment", source: "default_fulfillment" },
    };
  }
  return { kind: "missing_mapping", stationKey: stationKey || "unassigned", stepKey };
}
