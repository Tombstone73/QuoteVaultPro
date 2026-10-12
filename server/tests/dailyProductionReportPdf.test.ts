import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DailyProductionReport, DailyProductionReportRow } from "@shared/dailyProductionReport";
import {
  buildDailyProductionReportPdfFilename,
  generateDailyProductionReportPdfBytes,
} from "../lib/dailyProductionReportPdf";

function row(index: number, overrides: Partial<DailyProductionReportRow> = {}): DailyProductionReportRow {
  return {
    orderId: `order-${index}`,
    customerId: `customer-${index}`,
    orderNumber: `ORD-${String(index).padStart(3, "0")}`,
    customerName: `Customer ${index}`,
    jobLabel: `Job ${index}`,
    poNumber: `PO-${index}`,
    dueDate: "2026-09-14",
    dueState: index % 5 === 0 ? "overdue" : index % 5 === 1 ? "today" : index % 5 === 2 ? "tomorrow" : "future",
    quantity: index + 1,
    destination: index % 2 ? "roll" : "flatbed",
    fulfillment: index % 2 ? "Ship" : "Pickup",
    orderStatus: { label: "In Production", color: "#0369a1" },
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
    fulfillment: rows.filter((value) => value.fulfillment === "Ship"),
    diagnostics: { unclassifiedProductionLines: 1, mixedOrders: 0, nonstandardFulfillmentOrders: 0, activeOrdersOutsideReportStatus: 0 },
  };
}

function extractContentStreams(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString("latin1");
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    try {
      return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      return "";
    }
  }).join(" ");
}

function extractText(bytes: Uint8Array): string {
  return [...extractContentStreams(bytes).matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)]
    .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
    .join(" ");
}

describe("Daily Production List PDF", () => {
  test.each(["overview", "roll", "flatbed", "fulfillment"] as const)("independently parses actual %s PDF text and Letter bounds with PDF.js", async (view) => {
    const rows = Array.from({ length: 72 }, (_, index) => row(index + 1));
    rows[0] = row(1, { orderStatus: { label: "Custom Production Status With A Long Configured Name", color: "#abcdef" } });
    const fixture = { ...report(rows), overview: rows, roll: rows, flatbed: rows, fulfillment: rows };
    const bytes = await generateDailyProductionReportPdfBytes(fixture, view);
    const document = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    let text = "";
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      expect(page.view).toEqual([0, 0, 612, 792]);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        text += `${item.str} `;
        expect(item.transform[4]).toBeGreaterThanOrEqual(30);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(582);
        expect(item.transform[5]).toBeGreaterThanOrEqual(24);
      }
    }
    expect(document.numPages).toBeGreaterThan(1);
    expect(text).toContain("Status");
    expect(text).toContain("In Production");
    expect(text).toContain("ORD-072");
    await document.destroy();
  });
  test("generates a valid US Letter overview PDF with the selected report and summary", async () => {
    const bytes = await generateDailyProductionReportPdfBytes(report([row(1), row(2, { destination: "unclassified", dueState: "none", dueDate: null })]), "overview");
    expect(Buffer.from(bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const document = await PDFDocument.load(bytes);
    const firstPage = document.getPages()[0];
    expect(firstPage.getWidth()).toBe(612);
    expect(firstPage.getHeight()).toBe(792);

    const text = extractText(bytes);
    expect(text).toContain("OPEN PRODUCTION REPORT");
    expect(text).toContain("OPEN JOBS");
    expect(text).toContain("OVERVIEW");
    expect(text).not.toContain("ROLL PRINTING");
    expect(text).not.toContain("FLATBED PRINTING");
    expect(text).toContain("not routed to Roll or Flatbed");
  });

  test("paginates long reports without losing rows and wraps long job values", async () => {
    const rows = Array.from({ length: 72 }, (_, index) => row(index + 1));
    rows[0] = row(1, {
      jobLabel: "A very long production job label that must wrap across table lines instead of clipping from the printed report",
      poNumber: "PO-THIS-IS-AN-EXTRA-LONG-VALUE-WITHOUT-WHITESPACE-TO-VERIFY-SAFE-WRAPPING",
    });
    const bytes = await generateDailyProductionReportPdfBytes(report(rows), "overview");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(3);

    const text = extractText(bytes);
    for (const value of ["ORD-001", "ORD-036", "ORD-072", "Customer 72"]) {
      expect(text).toContain(value);
    }
    expect(text).toContain("(CONTINUED)");
    expect(text.replace(/\s/g, "")).toContain("PO-THIS-IS-AN-EXTRA-");
  });

  test("draws one black outlined checkoff square for each printed job row", async () => {
    const bytes = await generateDailyProductionReportPdfBytes(report([
      row(1),
      row(2, { destination: "flatbed" }),
      row(3, { destination: "unclassified" }),
    ]), "overview");

    const squares = extractContentStreams(bytes).match(/0 0 m\n0 12 l\n12 12 l\n12 0 l\nh\nS/g) ?? [];
    expect(squares).toHaveLength(3);
  });

  test("isolates the selected fulfillment PDF from production rows", async () => {
    const bytes = await generateDailyProductionReportPdfBytes(report([row(1), row(2)]), "fulfillment");
    const text = extractText(bytes);
    expect(text).toContain("FULFILLMENT");
    expect(text).toContain("ORD-001");
    expect(text).not.toContain("ORD-002");
    expect(text).not.toContain("OVERVIEW");
    expect(text).not.toContain("OPEN JOBS");
    expect(text).not.toContain("not routed to Roll or Flatbed");
  });

  const isolatedReport: DailyProductionReport = {
    ...report([]),
    overview: [row(1, { orderNumber: "OVR1" })],
    roll: [row(2, { orderNumber: "ROL2" })],
    flatbed: [row(3, { orderNumber: "FLB3" })],
    fulfillment: [row(4, { orderNumber: "FUL4" })],
  };
  test.each([
    ["overview", "OVERVIEW", "OPEN PRODUCTION REPORT", "OVR1"],
    ["roll", "ROLL PRINTING", "ROLL PRINTING REPORT", "ROL2"],
    ["flatbed", "FLATBED PRINTING", "FLATBED PRINTING REPORT", "FLB3"],
    ["fulfillment", "FULFILLMENT", "FULFILLMENT REPORT", "FUL4"],
  ] as const)("renders only the selected %s section", async (view, section, heading, includedOrder) => {
    const bytes = await generateDailyProductionReportPdfBytes(isolatedReport, view);
    const text = extractText(bytes);
    expect(text).toContain(section);
    expect(text).toContain(heading);
    expect(text).toContain(includedOrder);
    expect(text).toContain("Status");
    expect(text).toContain("In Production");
    for (const otherOrder of ["OVR1", "ROL2", "FLB3", "FUL4"].filter((order) => order !== includedOrder)) expect(text).not.toContain(otherOrder);
    if (view !== "overview") expect(text).not.toContain("OPEN JOBS");
  });

  test("uses fulfillment-specific empty wording", async () => {
    const emptyReport = { ...report([]), fulfillment: [] };
    const text = extractText(await generateDailyProductionReportPdfBytes(emptyReport, "fulfillment"));
    expect(text).toContain("No outstanding fulfillment items.");
    expect(text).not.toContain("No qualifying production items.");
  });

  test("wraps configured status labels and retains their color with readable black text", async () => {
    const label = "Custom Production Status With A Long Configured Name";
    const bytes = await generateDailyProductionReportPdfBytes(report([row(1, { orderStatus: { label, color: "#ff0000" } })]));
    expect(extractText(bytes).replace(/\s/g, "")).toContain(label.replace(/\s/g, ""));
    expect(extractContentStreams(bytes)).toContain("1 0 0 rg");
    expect(extractContentStreams(bytes)).toContain("0.08 0.12 0.18 rg");
  });

  test("uses a safe, useful generated filename", () => {
    expect(buildDailyProductionReportPdfFilename("Titan Graphics / RIP", "2026-09-14"))
      .toBe("Titan-Graphics-RIP-Production-Report-2026-09-14.pdf");
  });
});
