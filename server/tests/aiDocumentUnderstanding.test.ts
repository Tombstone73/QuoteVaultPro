import { describe, expect, jest, test } from "@jest/globals";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { formPoFixture } from "./helpers/offsetHousePoRegression";
import { extractAssistantAttachment } from "../services/assistantAttachmentExtraction";
import { extractMachineReadablePdfText } from "../services/pdfDocumentText";
import { renderAssistantPdfPages } from "../services/assistantPdfVision";
import { InboundOrderEvidenceService } from "../services/inboundOrders/InboundOrderEvidenceService";
import { createAssistantAttachmentAnalysisTools } from "../services/assistant/attachmentAnalysisTools";
import { documentImages, observationDocumentImages } from "../services/ai/documentImages";

const attachmentId = "00000000-0000-4000-8000-000000000042";
const record = { id: "inbound_fixture", organizationId: "org_test", receivedAt: new Date("2026-11-02"), rawPayloadJson: { subject: "Purchase order attached", bodyText: "Read the PO." } } as any;
const file = { id: "file_fixture", fileRecordId: "canonical_fixture", status: "available", sourceFilename: "purchase-order.pdf", mimeType: "application/pdf", role: "po" } as any;
async function scannedPdf(count = 1) {
  const pdf = await PDFDocument.create();
  const png = await sharp(Buffer.from('<svg width="300" height="100"><rect width="300" height="100" fill="white"/><text x="10" y="50">Purchase Order 42</text></svg>')).png().toBuffer();
  const image = await pdf.embedPng(png);
  for (let i = 0; i < count; i++) pdf.addPage([400, 300]).drawImage(image, { x: 10, y: 120, width: 300, height: 100 });
  return Buffer.from(await pdf.save());
}

describe("shared document understanding", () => {
  test("visual evidence paints non-embedded standard-font text instead of silently returning an empty page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 150]);
    page.drawText("PO quantity 5300", { x: 25, y: 75, size: 22, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const bytes = Buffer.from(await pdf.save());
    const [image] = await renderAssistantPdfPages(bytes, [1]);
    const pixels = await sharp(Buffer.from(image.dataUrl.split(",")[1], "base64")).removeAlpha().stats();
    expect(pixels.channels[0].min).toBeLessThan(32);
    expect(pixels.channels[0].stdev).toBeGreaterThan(10);
  });
  test("Assistant and inbound share AcroForm values and page geometry without interpreting arbitrary field names", async () => {
    const bytes = await formPoFixture(true);
    const inbound = await extractMachineReadablePdfText(bytes);
    const assistant = await extractAssistantAttachment(bytes, "form.pdf");
    expect(assistant.text).toBe(inbound.text);
    for (const fact of ["26-109691", "Offset House", "5,300", "$718.25", "Permanent Adhesive", "We will pick up"]) expect(assistant.text).toContain(fact);
    expect(inbound.formPageNumbers).toEqual([1]);
  });
  test("real image-only PDF reaches existing renderer for vision instead of requiring transcription", async () => {
    const bytes = await scannedPdf();
    const extracted = await extractAssistantAttachment(bytes, "scanned.pdf");
    expect(extracted.scannedPageNumbers).toEqual([1]);
    expect(extracted.text).not.toContain("Purchase Order 42"); // no fabricated OCR
    const evidence = new InboundOrderEvidenceService();
    jest.spyOn(evidence as any, "readCanonicalFile").mockResolvedValue(bytes);
    const result = await evidence.buildEvidenceBundle({ organizationId: "org_test", record, files: [file], vision: true });
    expect(result.pageImages).toHaveLength(1);
    expect(result.pageImages?.[0]).toMatchObject({ sourceId: file.id, page: 1, image: { dataUrl: expect.stringMatching(/^data:image\/png;base64,/) } });
    expect(result.items.find(item => item.sourceId === file.id)?.extractionStatus).toBe("successful");
    expect(result.items.find(item => item.sourceId === file.id)?.poSummary).toBeNull();
  });
  test("unsupported vision fails clearly and quarantine never reads bytes", async () => {
    const evidence = new InboundOrderEvidenceService();
    const read = jest.spyOn(evidence as any, "readCanonicalFile").mockResolvedValue(await scannedPdf());
    const unsupported = await evidence.buildEvidenceBundle({ organizationId: "org_test", record, files: [file], vision: false });
    expect(unsupported.items.find(item => item.sourceId === file.id)).toMatchObject({ extractionStatus: "failed", warnings: [expect.objectContaining({ code: "pdf_no_text", message: expect.stringContaining("no validated vision") })] });
    read.mockClear();
    await evidence.buildEvidenceBundle({ organizationId: "org_test", record, files: [{ ...file, status: "quarantined" }], vision: true });
    expect(read).not.toHaveBeenCalled();
  });
  test("uninspected pages remain explicit and cannot imply complete evidence", async () => {
    const evidence = new InboundOrderEvidenceService();
    jest.spyOn(evidence as any, "readCanonicalFile").mockResolvedValue(await scannedPdf(5));
    const result = await evidence.buildEvidenceBundle({ organizationId: "org_test", record, files: [file], vision: true });
    expect(result.pageImages).toHaveLength(4);
    expect(result.items.find(item => item.sourceId === file.id)?.warnings).toContainEqual(expect.objectContaining({ code: "pdf_visual_coverage_limited", severity: "blocking" }));
  });
  test("existing attachment inspector reads explicit additional pages in owning scope; bytes never serialize", async () => {
    const bytes = await scannedPdf(5);
    const readPages = jest.fn(async (_scope: unknown, _id: string, pages: readonly number[]) => renderAssistantPdfPages(bytes, pages));
    const [inspect] = createAssistantAttachmentAnalysisTools({ readFile: async () => ({ attachment: { id: attachmentId, fileName: "po.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }, extracted: await extractAssistantAttachment(bytes, "po.pdf") }), readPdfPages: readPages });
    const context = { scope: { organizationId: "org_test", userId: "staff_test" }, conversationId: "conversation_test", permissions: ["assistant.internal_staff"] } as any;
    const result = await inspect.execute({ arguments: { attachmentId, pages: [5] }, context });
    expect(readPages).toHaveBeenCalledWith({ organizationId: "org_test", userId: "staff_test", conversationId: "conversation_test" }, attachmentId, [5]);
    expect(observationDocumentImages([result])).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("data:image");
    expect((result as { [documentImages]?: unknown })[documentImages]).toBeDefined();
    expect((await inspect.execute({ arguments: { attachmentId, pages: [1, 2, 3, 4, 5] }, context })).status).toBe("rejected");
    expect((await inspect.execute({ arguments: { attachmentId, pages: [5] }, context: { ...context, permissions: [] } })).status).toBe("permission_denied");
  });
});


test("short but real embedded text is not mislabeled as an image-only PDF", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]).drawText("PO 42 Qty 10", { x: 20, y: 100, size: 10, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const bytes = Buffer.from(await pdf.save());
  expect(await extractMachineReadablePdfText(bytes)).toMatchObject({ hasExtractableText: true, scannedPageNumbers: [1] });
  const evidence = new InboundOrderEvidenceService();
  jest.spyOn(evidence as any, "readCanonicalFile").mockResolvedValue(bytes);
  const result = await evidence.buildEvidenceBundle({ organizationId: "org_test", record, files: [file], vision: false });
  expect(result.items.find(item => item.sourceId === file.id)?.extractionStatus).toBe("successful");
});
