import { describe, expect, it } from "@jest/globals";
import {
  PRODUCTION_COMPLETE_COLUMN_ID,
  buildProductionOverviewColumns,
  groupProductionOverviewJobsByColumn,
  productionOverviewStationColumnId,
  resolveProductionOverviewJobColumn,
} from "./productionOverviewBoard";

const stations = [
  { key: "flatbed", name: "Flatbed", sort: 50 },
  { key: "roll", name: "Roll", sort: 60 },
  { key: "finishing", name: "Finishing", sort: 80 },
];

describe("Production Overview station board", () => {
  it("places queued Flatbed and Roll jobs in their station columns", () => {
    expect(resolveProductionOverviewJobColumn({ id: "flat", stationKey: "flatbed", status: "queued" }))
      .toBe("station:flatbed");
    expect(resolveProductionOverviewJobColumn({ id: "roll", stationKey: "roll", status: "queued" }))
      .toBe("station:roll");
  });

  it("uses tenant stations and their sort order as columns", () => {
    const columns = buildProductionOverviewColumns([
      ...stations,
      { key: "cnc", name: "CNC", sort: 70 },
    ], []);
    expect(columns.map((column) => column.label)).toEqual([
      "Flatbed Printing",
      "Roll Printing",
      "CNC",
      "Finishing",
      "Production Complete",
    ]);
  });

  it("hides inactive stations unless an existing active job needs a fallback column", () => {
    expect(buildProductionOverviewColumns(stations, []).some((column) => column.id === "station:cnc")).toBe(false);
    const columns = buildProductionOverviewColumns(stations, [
      { id: "legacy", stationKey: "cnc", status: "in_progress" },
    ]);
    expect(columns.find((column) => column.id === "station:cnc")).toMatchObject({
      label: "CNC (Inactive)",
      fallback: true,
    });
  });

  it("places completed jobs in the fixed Production Complete column", () => {
    expect(resolveProductionOverviewJobColumn({ id: "done", stationKey: "flatbed", status: "done" }))
      .toBe(PRODUCTION_COMPLETE_COLUMN_ID);
  });

  it("uses stable station keys rather than labels for column identity", () => {
    expect(productionOverviewStationColumnId("Decoration / Shirts")).toBe("station:decoration_shirts");
  });

  it("returns board counts from the same station grouping used for cards", () => {
    const jobs = [
      { id: "flat-1", stationKey: "flatbed", status: "queued" },
      { id: "flat-2", stationKey: "flatbed", status: "in_progress" },
      { id: "roll-1", stationKey: "roll", status: "queued" },
      { id: "done-1", stationKey: "fulfillment", status: "done" },
    ];
    const columns = buildProductionOverviewColumns(stations, jobs);
    const grouped = groupProductionOverviewJobsByColumn(columns, jobs);
    expect(grouped.get("station:flatbed")).toHaveLength(2);
    expect(grouped.get("station:roll")).toHaveLength(1);
    expect(grouped.get(PRODUCTION_COMPLETE_COLUMN_ID)).toHaveLength(1);
  });
});
