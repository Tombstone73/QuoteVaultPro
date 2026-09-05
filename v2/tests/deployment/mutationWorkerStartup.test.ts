import { describe, expect, test } from "@jest/globals";
import { resolveV2MutationWorkerStartup } from "../../src/deployment/mutationWorkerStartup";

describe("V2 deployment mutation-worker startup control", () => {
  test("fails safe until an explicit release is granted", () => {
    expect(resolveV2MutationWorkerStartup({})).toEqual({ enabled: false, reason: "release_not_granted" });
    expect(resolveV2MutationWorkerStartup({ V2_MUTATION_WORKERS_ENABLED: "false" })).toEqual({ enabled: false, reason: "release_not_granted" });
    expect(resolveV2MutationWorkerStartup({ V2_MUTATION_WORKERS_ENABLED: "invalid" })).toEqual({ enabled: false, reason: "invalid_release_value" });
  });

  test("starts all deployment-owned mutation loops only after explicit release", () => {
    expect(resolveV2MutationWorkerStartup({ V2_MUTATION_WORKERS_ENABLED: " true " })).toEqual({ enabled: true, reason: "released" });
  });
});
