import { describe, expect, it } from "@jest/globals";
import { resolveProductionCompletionRoute } from "../services/productionCompletionRouting";

describe("production completion routing", () => {
  it("routes Flatbed completion to configured dedicated finishing", () => {
    expect(resolveProductionCompletionRoute({
      stationKey: "flatbed",
      stepKey: "print",
      finishingMode: "dedicated_finishing_queue",
    })).toEqual({
      kind: "route",
      route: { stationKey: "finishing", stepKey: "finishing", source: "configured_finishing" },
    });
  });

  it("routes Flatbed completion directly to fulfillment when finishing is integrated", () => {
    expect(resolveProductionCompletionRoute({
      stationKey: "flatbed",
      stepKey: "print",
      finishingMode: "integrated_with_print",
    })).toEqual({
      kind: "route",
      route: { stationKey: "fulfillment", stepKey: "fulfillment", source: "default_fulfillment" },
    });
  });

  it("routes finishing completion to fulfillment and fulfillment completion to done", () => {
    expect(resolveProductionCompletionRoute({
      stationKey: "finishing",
      stepKey: "finishing",
      finishingMode: "dedicated_finishing_queue",
    }).kind).toBe("route");
    expect(resolveProductionCompletionRoute({
      stationKey: "fulfillment",
      stepKey: "fulfillment",
      finishingMode: "integrated_with_print",
    })).toEqual({ kind: "complete" });
  });

  it("uses a tenant step completion mapping for custom stations", () => {
    expect(resolveProductionCompletionRoute({
      stationKey: "cnc",
      stepKey: "cut",
      finishingMode: "integrated_with_print",
      triggers: [{ type: "on_complete_route", config: { stationKey: "installation", stepKey: "install" } }],
    })).toEqual({
      kind: "route",
      route: { stationKey: "installation", stepKey: "install", source: "step_trigger" },
    });
  });

  it("fails visibly for a custom station without a completion mapping", () => {
    expect(resolveProductionCompletionRoute({
      stationKey: "cnc",
      stepKey: "cut",
      finishingMode: "integrated_with_print",
    })).toEqual({ kind: "missing_mapping", stationKey: "cnc", stepKey: "cut" });
  });
});
