import { describe, expect, test } from "@jest/globals";
import { dedupeProductionJobIds, validateProductionBulkSelection } from "../productionBulk";

const jobs = [
  { id: "flatbed-1", stationKey: "flatbed", status: "queued", orderId: "order-1", lineItemId: "line-1" },
  { id: "flatbed-2", stationKey: "flatbed", status: "queued", orderId: "order-2", lineItemId: "line-2" },
];

describe("production bulk selection", () => {
  test("deduplicates explicit identifiers before processing", () => {
    expect(dedupeProductionJobIds(["flatbed-1", "flatbed-1", "flatbed-2"])).toEqual(["flatbed-1", "flatbed-2"]);
  });

  test("accepts two independently queued Flatbed jobs", () => {
    expect(validateProductionBulkSelection({
      jobIds: ["flatbed-1", "flatbed-2"], jobs, station: "flatbed", allowedStatuses: ["queued"],
    })).toEqual({ ok: true });
  });

  test("accepts Roll and wide-roll jobs for the Roll station", () => {
    expect(validateProductionBulkSelection({
      jobIds: ["roll-1", "roll-2"],
      jobs: [
        { id: "roll-1", stationKey: "roll", status: "queued", orderId: "order-1", lineItemId: "line-1" },
        { id: "roll-2", stationKey: "wide_roll", status: "queued", orderId: "order-2", lineItemId: "line-2" },
      ],
      station: "roll",
      allowedStatuses: ["queued"],
    })).toEqual({ ok: true });
  });

  test("rejects empty, mixed-station, active, and parent-only selections", () => {
    expect(validateProductionBulkSelection({ jobIds: [], jobs: [], station: "flatbed", allowedStatuses: ["queued"] })).toEqual({ ok: false, reason: "invalid_selection" });
    expect(validateProductionBulkSelection({
      jobIds: ["flatbed-1", "roll-1"],
      jobs: [jobs[0], { id: "roll-1", stationKey: "roll", status: "queued", orderId: "order-3", lineItemId: "line-3" }],
      station: "flatbed", allowedStatuses: ["queued"],
    })).toEqual({ ok: false, reason: "invalid_selection" });
    expect(validateProductionBulkSelection({
      jobIds: ["flatbed-1"], jobs: [{ ...jobs[0], status: "in_progress" }], station: "flatbed", allowedStatuses: ["queued"],
    })).toEqual({ ok: false, reason: "invalid_selection" });
    expect(validateProductionBulkSelection({
      jobIds: ["parent"], jobs: [{ id: "parent", stationKey: "flatbed", status: "queued", orderId: "order-1", lineItemId: null }], station: "flatbed", allowedStatuses: ["queued"],
    })).toEqual({ ok: false, reason: "invalid_selection" });
  });
});
