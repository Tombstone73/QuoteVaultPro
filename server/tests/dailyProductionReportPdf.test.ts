import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";
import type { DailyProductionReport, DailyProductionReportRow } from "@shared/dailyProductionReport";
import {
  buildDailyProductionReportPdfFilename,
  generateDailyProductionReportPdfBytes,
} from "../lib/dailyProductionReportPdf";

function row(index: number, overrides: Partial<DailyProductionReportRow> = {}): DailyProductionReportRow {
  return {
    orderId: `order-${index}`,
    orderNumber: `ORD-${String(index).padStart(3, "0")}`,
    customerName: `Customer ${index}`,
    jobLabel: `Job ${index}`,
    poNumber: `PO-${index}`,
    dueDate: "2026-09-14",
    dueState: index % 5 === 0 ? "overdue" : index % 5 === 1 ? "today" : index % 5 === 2 ? "tomorrow" : "future",
    quantity: index + 1,
    destination: index % 2 ? "roll" : "flatbed",
    fulfillment: index % 2 ? "Ship" : "Pickup",
    ...overrides,
  };
}

function report(rows: DailyProductionReportRow[]): DailyProductionReport {
  return {
    organizationName: "Titan Graphics",
    asOf: "2026-09-14",
    timezone: "America/Indiana/Indianapolis",
    summary: { open: rows.length, dueToday: 1, dueTomorrow: 1, overdue: 1, noDueDate: 0 },
    overview: rows,
    roll: rows.filter((value) => value.destination === "roll"),
    flatbed: rows.filter((value) => value.destination === "flatbed"),
    diagnostics: { unclassifiedProductionLines: 1, mixedOrders: 0, nonstandardFulfillmentOrders: 0, activeOrdersOutsideReportStatus: 0 },
  };
}

function extractText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString("latin1");
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    try {
      const stream = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      return [...stream.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)]
        .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
        .join(" ");
    } catch {
      return "";
    }
  }).join(" ");
}

describe("Daily Production List PDF", () => {
  test("generates a valid US Letter PDF with the complete report sections and summary", async () => {
    const bytes = await generateDailyProductionReportPdfBytes(report([row(1), row(2, { destination: "unclassified", dueState: "none", dueDate: null })]));
    expect(Buffer.from(bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const document = await PDFDocument.load(bytes);
    const firstPage = document.getPages()[0];
    expect(firstPage.getWidth()).toBe(612);
    expect(firstPage.getHeight()).toBe(792);

    const text = extractText(bytes);
    expect(text).toContain("OPEN PRODUCTION REPORT");
    expect(text).toContain("OPEN JOBS");
    expect(text).toContain("OVERVIEW");
    expect(text).toContain("ROLL PRINTING");
    expect(text).toContain("FLATBED PRINTING");
    expect(text).toContain("not routed to Roll or Flatbed");
  });

  test("paginates long reports without losing rows and wraps long job values", async () => {
    const rows = Array.from({ length: 72 }, (_, index) => row(index + 1));
    rows[0] = row(1, {
      jobLabel: "A very long production job label that must wrap across table lines instead of clipping from the printed report",
      poNumber: "PO-THIS-IS-AN-EXTRA-LONG-VALUE-WITHOUT-WHITESPACE-TO-VERIFY-SAFE-WRAPPING",
    });
    const bytes = await generateDailyProductionReportPdfBytes(report(rows));
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(3);

    const text = extractText(bytes);
    for (const value of ["ORD-001", "ORD-036", "ORD-072", "Customer 72"]) {
      expect(text).toContain(value);
    }
    expect(text).toContain("(CONTINUED)");
    expect(text).toContain("PO-THIS-IS-AN-EXTRA-LONG");
  });

  test("uses a safe, useful generated filename", () => {
    expect(buildDailyProductionReportPdfFilename("Titan Graphics / RIP", "2026-09-14"))
      .toBe("Titan-Graphics-RIP-Production-Report-2026-09-14.pdf");
  });
});
