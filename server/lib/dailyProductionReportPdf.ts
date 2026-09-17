import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DailyProductionReport, DailyProductionReportRow } from "@shared/dailyProductionReport";

const LETTER: [number, number] = [612, 792];
const MARGIN = 30;
const CONTENT_BOTTOM = 48;
const FOOTER_Y = 24;
const TEXT = rgb(0.08, 0.12, 0.18);
const MUTED = rgb(0.32, 0.37, 0.45);
const NAVY = rgb(0.09, 0.14, 0.23);
const RULE = rgb(0.75, 0.79, 0.84);
const ROW_COLORS = {
  overdue: rgb(0.99, 0.89, 0.89),
  today: rgb(1, 0.96, 0.79),
  tomorrow: rgb(0.86, 0.93, 1),
  future: rgb(1, 1, 1),
  none: rgb(0.92, 0.94, 0.96),
};

type Column = {
  key: "checkoff" | "due" | "order" | "customer" | "job" | "quantity" | "destination" | "fulfillment";
  label: string;
  width: number;
  align?: "left" | "right";
};

const OVERVIEW_COLUMNS: Column[] = [
  { key: "checkoff", label: "", width: 18 },
  { key: "due", label: "Due", width: 56 },
  { key: "order", label: "Order", width: 48 },
  { key: "customer", label: "Customer", width: 104 },
  { key: "job", label: "PO / Job", width: 104 },
  { key: "quantity", label: "Qty", width: 34, align: "right" },
  { key: "destination", label: "Roll / Flatbed", width: 84 },
  { key: "fulfillment", label: "Fulfillment", width: 104 },
];

const BREAKDOWN_COLUMNS: Column[] = [
  { key: "checkoff", label: "", width: 18 },
  { key: "due", label: "Due", width: 60 },
  { key: "order", label: "Order", width: 48 },
  { key: "customer", label: "Customer", width: 134 },
  { key: "job", label: "PO / Job", width: 138 },
  { key: "quantity", label: "Qty", width: 34, align: "right" },
  { key: "fulfillment", label: "Fulfillment", width: 120 },
];

const dueLabels: Record<DailyProductionReportRow["dueState"], string> = {
  overdue: "OVERDUE",
  today: "DUE TODAY",
  tomorrow: "DUE TOMORROW",
  future: "FUTURE",
  none: "NO DUE DATE",
};

const destinationLabels: Record<DailyProductionReportRow["destination"], string> = {
  roll: "Roll",
  flatbed: "Flatbed",
  mixed: "Roll + Flatbed",
  unclassified: "Unclassified",
  none: "No production items",
};

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No due date";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "No due date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function wrapText(value: unknown, font: PDFFont, size: number, maxWidth: number): string[] {
  const text = safeText(value) || "-";
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const pushWord = (word: string) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
    const pieces: string[] = [];
    let piece = "";
    for (const character of word) {
      const candidate = `${piece}${character}`;
      if (piece && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        pieces.push(piece);
        piece = character;
      } else {
        piece = candidate;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  };

  for (const sourceWord of words) {
    for (const word of pushWord(sourceWord)) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}

function jobLabel(row: DailyProductionReportRow): string {
  return [row.jobLabel, row.poNumber].map(safeText).filter(Boolean).join(" - ") || "-";
}

function rowCellLines(row: DailyProductionReportRow, column: Column, font: PDFFont): string[] {
  const width = column.width - 6;
  switch (column.key) {
    case "checkoff": return [];
    case "due": return [formatDate(row.dueDate), dueLabels[row.dueState]];
    case "order": return wrapText(row.orderNumber, font, 8.5, width);
    case "customer": return wrapText(row.customerName, font, 8.5, width);
    case "job": return wrapText(jobLabel(row), font, 8.5, width);
    case "quantity": return [safeText(row.quantity) || "0"];
    case "destination": return wrapText(destinationLabels[row.destination], font, 8.5, width);
    case "fulfillment": return wrapText(row.fulfillment, font, 8.5, width);
  }
}

class DailyProductionPdfWriter {
  private page: PDFPage;
  private y: number;
  private readonly contentWidth = LETTER[0] - MARGIN * 2;

  constructor(private readonly doc: PDFDocument, private readonly regular: PDFFont, private readonly bold: PDFFont) {
    this.page = doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }

  private newPage(): void {
    this.page = this.doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }

  private ensure(height: number): void {
    if (this.y - height >= CONTENT_BOTTOM) return;
    this.newPage();
  }

  drawPacketHeader(report: DailyProductionReport): void {
    this.page.drawText(safeText(report.organizationName) || "PrintersHero", { x: MARGIN, y: this.y, size: 14, font: this.bold, color: NAVY });
    this.y -= 22;
    this.page.drawText("OPEN PRODUCTION REPORT", { x: MARGIN, y: this.y, size: 18, font: this.bold, color: TEXT });
    this.y -= 14;
    this.page.drawText(`Daily Production List | As of ${formatDate(report.asOf)}`, { x: MARGIN, y: this.y, size: 9.5, font: this.regular, color: MUTED });
    this.y -= 16;

    const boxes = [
      ["OPEN JOBS", report.summary.open, rgb(0.97, 0.98, 0.99)],
      ["DUE TODAY", report.summary.dueToday, ROW_COLORS.today],
      ["DUE TOMORROW", report.summary.dueTomorrow, ROW_COLORS.tomorrow],
      ["OVERDUE", report.summary.overdue, ROW_COLORS.overdue],
      ["NO DUE DATE", report.summary.noDueDate, ROW_COLORS.none],
    ] as const;
    const gap = 4;
    const width = (this.contentWidth - gap * (boxes.length - 1)) / boxes.length;
    const height = 39;
    boxes.forEach(([label, value, color], index) => {
      const x = MARGIN + index * (width + gap);
      this.page.drawRectangle({ x, y: this.y - height, width, height, color, borderColor: RULE, borderWidth: 0.5 });
      this.page.drawText(label, { x: x + 5, y: this.y - 12, size: 6.6, font: this.bold, color: MUTED });
      this.page.drawText(String(value), { x: x + 5, y: this.y - 29, size: 15, font: this.bold, color: TEXT });
    });
    this.y -= height + 10;

    if (report.diagnostics.unclassifiedProductionLines > 0) {
      const count = report.diagnostics.unclassifiedProductionLines;
      const warning = `${count} production line${count === 1 ? " is" : "s are"} not routed to Roll or Flatbed.`;
      this.page.drawRectangle({ x: MARGIN, y: this.y - 19, width: this.contentWidth, height: 19, color: rgb(1, 0.95, 0.78), borderColor: rgb(0.88, 0.69, 0.18), borderWidth: 0.5 });
      this.page.drawText(warning, { x: MARGIN + 6, y: this.y - 12.5, size: 8, font: this.regular, color: TEXT });
      this.y -= 27;
    }
  }

  private drawSectionHeading(title: string): void {
    const height = 21;
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: this.contentWidth, height, color: NAVY });
    this.page.drawText(title, { x: MARGIN + 7, y: this.y - 14, size: 10, font: this.bold, color: rgb(1, 1, 1) });
    this.y -= height;
  }

  private drawTableHeader(columns: Column[]): void {
    const height = 18;
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: this.contentWidth, height, color: rgb(0.2, 0.25, 0.33) });
    let x = MARGIN;
    for (const column of columns) {
      const text = column.label;
      if (text) {
        const width = this.bold.widthOfTextAtSize(text, 7);
        this.page.drawText(text, { x: column.align === "right" ? x + column.width - width - 3 : x + 3, y: this.y - 12, size: 7, font: this.bold, color: rgb(1, 1, 1) });
      }
      x += column.width;
    }
    this.y -= height;
  }

  private rowHeight(row: DailyProductionReportRow, columns: Column[]): number {
    const lineCount = Math.max(...columns.map((column) => rowCellLines(row, column, this.regular).length));
    return Math.max(27, lineCount * 10 + 9);
  }

  private drawRow(row: DailyProductionReportRow, columns: Column[], height: number): void {
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: this.contentWidth, height, color: ROW_COLORS[row.dueState], borderColor: RULE, borderWidth: 0.35 });
    let x = MARGIN;
    for (const column of columns) {
      if (column.key === "checkoff") {
        const size = 12;
        this.page.drawRectangle({
          x: x + (column.width - size) / 2,
          y: this.y - (height + size) / 2,
          width: size,
          height: size,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });
        x += column.width;
        continue;
      }
      const lines = rowCellLines(row, column, this.regular);
      lines.forEach((line, index) => {
        const size = column.key === "due" && index === 1 ? 6.5 : 8.5;
        const font = column.key === "due" && index === 1 ? this.bold : this.regular;
        const width = font.widthOfTextAtSize(line, size);
        this.page.drawText(line, {
          x: column.align === "right" ? x + column.width - width - 3 : x + 3,
          y: this.y - 11 - index * 10,
          size,
          font,
          color: column.key === "due" && index === 1 ? MUTED : TEXT,
        });
      });
      x += column.width;
    }
    this.y -= height;
  }

  renderTable(title: string, rows: DailyProductionReportRow[], columns: Column[]): void {
    const drawStart = (continued = false) => {
      const firstHeight = rows.length ? this.rowHeight(rows[0], columns) : 27;
      this.ensure(21 + 18 + firstHeight);
      this.drawSectionHeading(continued ? `${title} (CONTINUED)` : title);
      this.drawTableHeader(columns);
    };

    drawStart();
    if (!rows.length) {
      this.page.drawText("No qualifying production items.", { x: MARGIN + 5, y: this.y - 15, size: 9, font: this.regular, color: MUTED });
      this.y -= 28;
      return;
    }

    for (const row of rows) {
      const height = this.rowHeight(row, columns);
      if (this.y - height < CONTENT_BOTTOM) {
        this.newPage();
        drawStart(true);
      }
      this.drawRow(row, columns, height);
    }
    this.y -= 10;
  }

  drawFooters(asOf: string): void {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      const text = `Open Production Report | ${formatDate(asOf)} | Page ${index + 1} of ${pages.length}`;
      const width = this.regular.widthOfTextAtSize(text, 7.5);
      page.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 13 }, end: { x: LETTER[0] - MARGIN, y: FOOTER_Y + 13 }, thickness: 0.45, color: RULE });
      page.drawText(text, { x: LETTER[0] - MARGIN - width, y: FOOTER_Y, size: 7.5, font: this.regular, color: MUTED });
    });
  }
}

export async function generateDailyProductionReportPdfBytes(report: DailyProductionReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`${safeText(report.organizationName) || "PrintersHero"} Production Report`);
  doc.setSubject("Daily Production List");
  doc.setCreator("PrintersHero");
  doc.setProducer("PrintersHero");

  const writer = new DailyProductionPdfWriter(doc, regular, bold);
  writer.drawPacketHeader(report);
  writer.renderTable("OVERVIEW", report.overview, OVERVIEW_COLUMNS);
  writer.renderTable("ROLL PRINTING", report.roll, BREAKDOWN_COLUMNS);
  writer.renderTable("FLATBED PRINTING", report.flatbed, BREAKDOWN_COLUMNS);
  writer.drawFooters(report.asOf);
  return doc.save({ useObjectStreams: false });
}

export function buildDailyProductionReportPdfFilename(organizationName: string, asOf: string): string {
  const safeOrganization = safeText(organizationName).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "PrintersHero";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
  return `${safeOrganization}-Production-Report-${safeDate}.pdf`;
}
