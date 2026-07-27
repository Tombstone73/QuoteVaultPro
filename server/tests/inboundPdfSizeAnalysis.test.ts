import { PDFDocument, degrees } from "pdf-lib";
import { analyzeInboundPdfBytes } from "../services/inboundOrders/InboundPdfSizeAnalysisService";

async function pdfBytes(configure: (document: PDFDocument) => void | Promise<void>) {
  const document = await PDFDocument.create();
  await configure(document);
  return new Uint8Array(await document.save());
}

describe("inbound PDF size analysis", () => {
  test("converts PDF points to inches and uses the MediaBox when no preferred box exists", async () => {
    const analysis = await analyzeInboundPdfBytes(await pdfBytes((document) => { document.addPage([522, 252]); }), "file:standard");
    expect(analysis).toMatchObject({ status: "succeeded", pageCount: 1, uniformPageSize: true, effectiveWidthInches: 7.25, effectiveHeightInches: 3.5 });
    expect(analysis.pages[0]).toMatchObject({ sourceBox: "MediaBox", rotation: 0 });
  });

  test("uses TrimBox before CropBox and accounts for rotation", async () => {
    const analysis = await analyzeInboundPdfBytes(await pdfBytes((document) => {
      const page = document.addPage([720, 720]);
      page.setCropBox(0, 0, 576, 432);
      page.setTrimBox(0, 0, 360, 180);
      page.setRotation(degrees(90));
    }), "file:trim");
    expect(analysis.pages[0]).toMatchObject({ sourceBox: "TrimBox", widthInches: 2.5, heightInches: 5, rotation: 90 });
  });

  test("falls back to CropBox and records mixed multi-page geometry", async () => {
    const analysis = await analyzeInboundPdfBytes(await pdfBytes((document) => {
      const first = document.addPage([720, 720]);
      first.setCropBox(0, 0, 612, 792);
      document.addPage([792, 1224]);
    }), "file:mixed");
    expect(analysis).toMatchObject({ status: "succeeded", pageCount: 2, uniformPageSize: false, effectiveWidthInches: null });
    expect(analysis.pages[0].sourceBox).toBe("CropBox");
    expect(analysis.pages[1]).toMatchObject({ widthInches: 11, heightInches: 17 });
  });

  test("fails softly for malformed input", async () => {
    const analysis = await analyzeInboundPdfBytes(new Uint8Array([1, 2, 3, 4]), "file:bad");
    expect(analysis).toMatchObject({ status: "failed", errorCode: "INVALID_PDF", pages: [] });
  });
});
