import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AiTriageBriefDto, AiTriageBriefResult } from "@shared/aiTriageBriefContracts";

type PdfColor = ReturnType<typeof rgb>;

const LETTER_PORTRAIT: [number, number] = [612, 792];
const MARGIN = 54;
const FOOTER_Y = 30;
const CONTENT_BOTTOM = 58;
const TEXT_COLOR = rgb(0.08, 0.09, 0.11);
const MUTED_COLOR = rgb(0.34, 0.37, 0.43);
const RULE_COLOR = rgb(0.82, 0.84, 0.88);

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return `${date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not scored";
  return `${Math.round(value * 100)}%`;
}

function formatFilters(filters: Record<string, unknown> | null | undefined): string {
  if (!filters || typeof filters !== "object") return "Active reports only: open and in review.";
  const status = safeText(filters.status || "open, in_review");
  const severity = safeText(filters.severity || "all");
  const type = safeText(filters.type || "all");
  const limit = safeText(filters.limit || "default");
  return `Status: ${status}; Severity: ${severity}; Type: ${type}; Limit: ${limit}. Resolved and closed reports excluded.`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = safeText(text).split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const paragraph of paragraphs.length ? paragraphs : [""]) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      let chunk = "";
      for (const char of word) {
        const candidateChunk = `${chunk}${char}`;
        if (font.widthOfTextAtSize(candidateChunk, size) <= maxWidth) {
          chunk = candidateChunk;
        } else {
          if (chunk) lines.push(chunk);
          chunk = char;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

class PdfWriter {
  private page: PDFPage;
  private y: number;
  private readonly width: number;
  private readonly contentWidth: number;

  constructor(
    private readonly pdfDoc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = this.pdfDoc.addPage(LETTER_PORTRAIT);
    this.width = this.page.getWidth();
    this.contentWidth = this.width - MARGIN * 2;
    this.y = this.page.getHeight() - MARGIN;
  }

  get cursorY(): number {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  get pageWidth(): number {
    return this.width;
  }

  get maxWidth(): number {
    return this.contentWidth;
  }

  ensure(space: number): void {
    if (this.y - space >= CONTENT_BOTTOM) return;
    this.page = this.pdfDoc.addPage(LETTER_PORTRAIT);
    this.y = this.page.getHeight() - MARGIN;
  }

  text(text: string, options: { size?: number; bold?: boolean; color?: PdfColor; indent?: number; lineHeight?: number; maxWidth?: number } = {}): void {
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size + 4;
    const font = options.bold ? this.bold : this.font;
    const indent = options.indent ?? 0;
    const maxWidth = options.maxWidth ?? this.contentWidth - indent;
    const lines = wrapText(text, font, size, maxWidth);

    for (const line of lines) {
      this.ensure(lineHeight + 2);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y,
        font,
        size,
        color: options.color ?? TEXT_COLOR,
      });
      this.y -= lineHeight;
    }
  }

  section(title: string): void {
    this.ensure(42);
    this.y -= this.y > this.page.getHeight() - MARGIN - 4 ? 0 : 12;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 8 },
      end: { x: this.width - MARGIN, y: this.y + 8 },
      thickness: 0.8,
      color: RULE_COLOR,
    });
    this.text(title.toUpperCase(), { size: 10, bold: true, color: MUTED_COLOR, lineHeight: 16 });
  }

  bullet(text: string): void {
    this.ensure(24);
    this.page.drawText("-", { x: MARGIN + 8, y: this.y, font: this.font, size: 10, color: TEXT_COLOR });
    this.text(text, { size: 10, indent: 22, lineHeight: 14 });
    this.y -= 2;
  }

  labelValue(label: string, value: string): void {
    this.ensure(26);
    this.text(`${label}: ${value}`, { size: 9, color: MUTED_COLOR, lineHeight: 13 });
  }

  drawFooter(pageNumber: number, pageCount: number): void {
    const footer = `AI Advisory Only | Page ${pageNumber} of ${pageCount}`;
    const textWidth = this.font.widthOfTextAtSize(footer, 8);
    this.page.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 18 },
      end: { x: this.width - MARGIN, y: FOOTER_Y + 18 },
      thickness: 0.6,
      color: RULE_COLOR,
    });
    this.page.drawText(footer, {
      x: this.width - MARGIN - textWidth,
      y: FOOTER_Y,
      font: this.font,
      size: 8,
      color: MUTED_COLOR,
    });
  }

  drawFooterOn(page: PDFPage, pageNumber: number, pageCount: number): void {
    const footer = `AI Advisory Only | Page ${pageNumber} of ${pageCount}`;
    const textWidth = this.font.widthOfTextAtSize(footer, 8);
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 18 },
      end: { x: this.width - MARGIN, y: FOOTER_Y + 18 },
      thickness: 0.6,
      color: RULE_COLOR,
    });
    page.drawText(footer, {
      x: this.width - MARGIN - textWidth,
      y: FOOTER_Y,
      font: this.font,
      size: 8,
      color: MUTED_COLOR,
    });
  }
}

function renderRiskSection(writer: PdfWriter, title: string, items: AiTriageBriefResult["topOperationalRisks"]): void {
  writer.section(title);
  if (!items.length) {
    writer.text("None identified.", { size: 10, color: MUTED_COLOR });
    return;
  }
  items.forEach((item, index) => {
    writer.bullet(`${index + 1}. ${item.title} (${formatPercent(item.confidence)} confidence)`);
    writer.text(`Impact: ${item.impact}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
    writer.text(`Rationale: ${item.rationale}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
  });
}

function renderPrioritySection(writer: PdfWriter, title: string, items: AiTriageBriefResult["suggestedPriorityOrder"]): void {
  writer.section(title);
  if (!items.length) {
    writer.text("None identified.", { size: 10, color: MUTED_COLOR });
    return;
  }
  items.forEach((item, index) => {
    writer.bullet(`${index + 1}. ${item.item} (${item.urgency})`);
    writer.text(item.rationale, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
  });
}

export async function generateAiTriageBriefPdfBytes(brief: AiTriageBriefDto): Promise<Uint8Array> {
  if (brief.status !== "completed" || !brief.result) {
    throw new Error("AI triage brief must be completed before PDF export.");
  }

  const result = brief.result;
  const generatedAt = brief.completedAt ?? brief.createdAt;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(pdfDoc, font, bold);

  pdfDoc.setTitle("Printers Hero AI Triage Brief");
  pdfDoc.setSubject("AI advisory triage brief");
  pdfDoc.setCreator("Printers Hero");
  pdfDoc.setProducer("Printers Hero");
  pdfDoc.setCreationDate(new Date(generatedAt));
  pdfDoc.setModificationDate(new Date());

  writer.text("Printers Hero", { size: 13, bold: true, lineHeight: 18 });
  writer.text("AI Triage Brief", { size: 24, bold: true, lineHeight: 30 });
  writer.labelValue("Generated", formatDateTime(generatedAt));
  writer.labelValue("Requested by", safeText(brief.requestedByEmail || "Not recorded"));
  writer.labelValue("Filters used", formatFilters(brief.filtersSnapshot));
  writer.cursorY -= 8;
  writer.text(
    "AI Advisory Only. This document is planning guidance only. It does not change ticket status, severity, priority, roadmap data, or work items.",
    { size: 10, bold: true, lineHeight: 15 },
  );

  writer.section("Executive Summary");
  writer.text(result.executiveSummary, { size: 10.5, lineHeight: 15 });

  renderRiskSection(writer, "Top Operational Risks", result.topOperationalRisks);
  renderRiskSection(writer, "Top Workflow Risks", result.topWorkflowRisks);
  renderRiskSection(writer, "Top Revenue Risks", result.topRevenueRisks);

  writer.section("Top Bug Clusters");
  if (!result.topBugClusters.length) {
    writer.text("None identified.", { size: 10, color: MUTED_COLOR });
  } else {
    result.topBugClusters.forEach((item, index) => {
      writer.bullet(`${index + 1}. ${item.issue} (${item.reportCount} report${item.reportCount === 1 ? "" : "s"})`);
      writer.text(`Modules: ${item.affectedModules.join(", ") || "Unknown"}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
      writer.text(`Impact: ${item.impact}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
    });
  }

  writer.section("Top Feature Requests");
  if (!result.topFeatureRequests.length) {
    writer.text("None identified.", { size: 10, color: MUTED_COLOR });
  } else {
    result.topFeatureRequests.forEach((item, index) => {
      writer.bullet(`${index + 1}. ${item.feature} (${item.requestCount} request${item.requestCount === 1 ? "" : "s"})`);
      writer.text(`Value: ${item.value}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
      writer.text(`Complexity: ${item.complexity}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
    });
  }

  renderPrioritySection(writer, "Suggested Priority Order", result.suggestedPriorityOrder);
  renderPrioritySection(writer, "Recommended Next Sprint", result.recommendedNextSprint);

  writer.section("Duplicate Signals");
  if (!result.duplicateSignals.length) {
    writer.text("None identified.", { size: 10, color: MUTED_COLOR });
  } else {
    result.duplicateSignals.forEach((item, index) => {
      writer.bullet(`${index + 1}. ${item.theme} (${formatPercent(item.confidence)} confidence)`);
      writer.text(`Reports: ${item.reportIds.join(", ")}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
      writer.text(`Rationale: ${item.rationale}`, { size: 9.5, indent: 22, color: MUTED_COLOR, lineHeight: 13 });
    });
  }

  writer.section("Unknowns");
  if (!result.unknowns.length) {
    writer.text("None listed.", { size: 10, color: MUTED_COLOR });
  } else {
    result.unknowns.forEach((item) => writer.bullet(item));
  }

  writer.section("Confidence");
  writer.text(formatPercent(result.confidence), { size: 12, bold: true });

  const pages = pdfDoc.getPages();
  pages.forEach((page, index) => writer.drawFooterOn(page, index + 1, pages.length));

  return pdfDoc.save({ useObjectStreams: false });
}

export function buildAiTriageBriefPdfFilename(generatedAt: string | null | undefined): string {
  const date = generatedAt && !Number.isNaN(new Date(generatedAt).getTime()) ? new Date(generatedAt) : new Date();
  const day = date.toISOString().slice(0, 10);
  return `printers-hero-ai-triage-brief-${day}.pdf`;
}
