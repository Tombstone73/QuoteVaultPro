import { describe, expect, test } from "@jest/globals";

import { normalizeProductionStationKey, readPrepressProductionDestinationOverride, writePrepressProductionDestinationOverride } from "@shared/productionStations";

describe("production station normalization", () => {
  test("maps legacy wide_roll to canonical roll", () => {
    expect(normalizeProductionStationKey("wide_roll")).toBe("roll");
    expect(normalizeProductionStationKey("wide roll")).toBe("roll");
    expect(normalizeProductionStationKey("wide-format")).toBe("roll");
  });

  test("keeps canonical roll and flatbed values", () => {
    expect(normalizeProductionStationKey("roll")).toBe("roll");
    expect(normalizeProductionStationKey("flatbed")).toBe("flatbed");
  });

  test("stores prepress override as editable prep data in specs json", () => {
    const specs = writePrepressProductionDestinationOverride({
      specsJson: { color: "blue" },
      selectedStationKey: "flatbed",
      actorUserId: "user-1",
      reason: "operator override",
      updatedAt: "2026-05-26T12:00:00.000Z",
    });

    expect(readPrepressProductionDestinationOverride(specs)).toEqual({
      selectedStationKey: "flatbed",
      source: "override",
      actorUserId: "user-1",
      updatedAt: "2026-05-26T12:00:00.000Z",
      reason: "operator override",
    });
  });

  test("clearing prepress override removes the temp destination only", () => {
    const withOverride = writePrepressProductionDestinationOverride({
      specsJson: {},
      selectedStationKey: "roll",
    });
    const cleared = writePrepressProductionDestinationOverride({
      specsJson: withOverride,
      selectedStationKey: null,
    });

    expect(readPrepressProductionDestinationOverride(cleared)).toBeNull();
  });
});

