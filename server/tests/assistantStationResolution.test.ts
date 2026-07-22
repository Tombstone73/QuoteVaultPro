import { describe, expect, test } from "@jest/globals";
import {
  AssistantStationResolutionService,
  resolveAssistantStationReference,
} from "../services/assistant/assistantStationResolution";

const stations = [
  { id: "flatbed", key: "flatbed", name: "Flatbed", active: true },
  { id: "roll", key: "roll", name: "Roll", active: true },
  { id: "prepress", key: "prepress", name: "Prepress", active: true },
  { id: "design", key: "design", name: "Design", active: true },
  { id: "finishing", key: "finishing", name: "Finishing", active: true },
  { id: "fulfillment", key: "fulfillment", name: "Fulfillment", active: true },
  { id: "legacy-roll", key: "wide_roll", name: "Wide Roll", active: false },
];

describe("assistant station resolution", () => {
  test.each([
    ["Flatbed", "flatbed"],
    ["Flatbed printing", "flatbed"],
    ["Flat bed", "flatbed"],
    ["ROLL", "roll"],
    ["Roll printing", "roll"],
    ["pre press", "prepress"],
    ["Finishing", "finishing"],
    ["fulfilment", "fulfillment"],
    ["design", "design"],
  ])("resolves safe alias %s", (query, key) => {
    expect(resolveAssistantStationReference(query, stations)).toMatchObject({ kind: "unique", station: { key } });
  });

  test("does not turn an unknown station into an arbitrary current-board station", () => {
    expect(resolveAssistantStationReference("Screen printing", stations)).toEqual({ kind: "no_match", query: "Screen printing" });
  });

  test("requires a clarification where an active alias matches multiple tenant stations", () => {
    const result = resolveAssistantStationReference("Roll printing", [
      ...stations,
      { id: "roll-2", key: "wide_roll", name: "Wide Roll", active: true },
    ]);
    expect(result).toMatchObject({ kind: "ambiguous", candidates: [{ key: "roll" }, { key: "wide_roll" }] });
  });

  test("reports an inactive match instead of routing it to an active station", () => {
    const result = resolveAssistantStationReference("Wide roll", stations);
    expect(result).toMatchObject({ kind: "inactive", candidates: [{ id: "legacy-roll", active: false }] });
  });

  test("fetches stations for the requesting organization only", async () => {
    const getStations = async (organizationId: string) => organizationId === "org-a"
      ? stations
      : [{ id: "other-flatbed", key: "flatbed", name: "Flatbed", active: true }];
    const service = new AssistantStationResolutionService({ getStations });
    await expect(service.resolve("org-a", "Flatbed")).resolves.toMatchObject({ kind: "unique", station: { id: "flatbed" } });
    await expect(service.resolve("org-b", "Roll")).resolves.toEqual({ kind: "no_match", query: "Roll" });
  });
});
