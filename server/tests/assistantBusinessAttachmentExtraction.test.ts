import { describe, expect, test } from "@jest/globals";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { extractAssistantAttachment } from "../services/assistantAttachmentExtraction";
import { renderAssistantPdfPages } from "../services/assistantPdfVision";

async function officeZip(parts: Record<string, string>) {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<Buffer>((resolve, reject) => { stream.on("end", () => resolve(Buffer.concat(chunks))); stream.on("error", reject); });
  const zip = archiver("zip", { zlib: { level: 1 } });
  zip.on("error", error => stream.destroy(error));
  zip.pipe(stream);
  for (const [name, content] of Object.entries(parts)) zip.append(content, { name });
  await zip.finalize();
  return finished;
}

describe("assistant business attachment extraction", () => {
  test("preserves CSV leading zeros, currency text, and source rows", async () => {
    const file = await extractAssistantAttachment(Buffer.from("PO,Amount\n0012,12.30\n0013,0.05\n"), "orders.csv");
    expect(file.tables[0]?.headers).toEqual(["PO", "Amount"]);
    expect(file.tables[0]?.rows).toEqual([{ rowNumber: 2, values: ["0012", "12.30"] }, { rowNumber: 3, values: ["0013", "0.05"] }]);
    expect(file.text).toContain("orders.csv row 2");
  });

  test("reads a bounded XLSX with sheet and row references without executing formulas", async () => {
    const bytes = await officeZip({
      "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>",
      "xl/workbook.xml": "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Orders\" r:id=\"rId1\"/></sheets></workbook>",
      "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>PO</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>Amount</t></is></c></row><row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>00042</t></is></c><c r=\"B2\"><f>10+2</f><v>12.00</v></c></row></sheetData></worksheet>",
    });
    const file = await extractAssistantAttachment(bytes, "orders.xlsx");
    expect(file.tables[0]).toMatchObject({ sheetName: "Orders", headers: ["PO", "Amount"], rows: [{ rowNumber: 2, values: ["00042", "12.00"] }] });
    expect(file.warnings.join(" ")).toContain("cached values");
  });

  test("reads DOCX body text and headings", async () => {
    const bytes = await officeZip({
      "[Content_Types].xml": "<Types><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Purchase Order</w:t></w:r></w:p><w:p><w:r><w:t>PO 00042</w:t></w:r></w:p></w:body></w:document>",
    });
    const file = await extractAssistantAttachment(bytes, "po.docx");
    expect(file.text).toContain("[Section: Purchase Order]");
    expect(file.text).toContain("PO 00042");
  });

  test("reads text PDF pages and marks an image-only PDF for visual reading", async () => {
    const textPdf = await PDFDocument.create();
    const page = textPdf.addPage([300, 300]);
    page.drawText("Customer PO 00042 - 12 signs", { x: 20, y: 250, size: 12, font: await textPdf.embedFont(StandardFonts.Helvetica) });
    const textFile = await extractAssistantAttachment(Buffer.from(await textPdf.save()), "po.pdf");
    expect(textFile.text).toContain("[PDF page 1]");
    expect(textFile.text).toContain("00042");
    const scanned = await PDFDocument.create();
    scanned.addPage([300, 300]);
    const scannedFile = await extractAssistantAttachment(Buffer.from(await scanned.save()), "scan.pdf");
    expect(scannedFile.scannedPageNumbers).toEqual([1]);
    const visionPages = await renderAssistantPdfPages(Buffer.from(await scanned.save()), scannedFile.scannedPageNumbers);
    expect(visionPages[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("rejects malformed content and oversized tables, while keeping existing image behavior", async () => {
    await expect(extractAssistantAttachment(Buffer.from("garbage"), "bad.pdf")).rejects.toMatchObject({ statusCode: 415 });
    await expect(extractAssistantAttachment(Buffer.from("A,B\n" + "1,2\n".repeat(5_001)), "too-many.csv")).rejects.toMatchObject({ statusCode: 413 });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    expect((await extractAssistantAttachment(png, "photo.png")).mimeType).toBe("image/png");
  });
});
