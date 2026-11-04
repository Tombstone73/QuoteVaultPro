import { expect, test } from '@jest/globals';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { renderUpsLabelImage, renderUpsLabelPdf } from '../services/ups/upsLabelRendering';

const fixture = (name: string) => readFileSync(`server/tests/fixtures/shipping-labels/${name}`);
test('landscape carrier pixels rotate clockwise once, portrait pixels remain untouched, barcode pixels preserved', async () => {
  const original = fixture('landscape-left.gif'), copy = Buffer.from(original);
  const normalized = await renderUpsLabelImage(original);
  expect(normalized).toMatchObject({ rotation: 90, width: 400, height: 600, mimeType: 'image/png' });
  const actual = await sharp(normalized.bytes).removeAlpha().raw().toBuffer();
  const portrait = await renderUpsLabelImage(fixture('portrait.gif'));
  expect(portrait.rotation).toBe(0);
  expect(actual).toEqual(await sharp(portrait.bytes).removeAlpha().raw().toBuffer());
  expect(original).toEqual(copy);
});
test('real PDF fixtures distinguish page geometry from /Rotate and output has portrait 4x6 boxes without metadata rotation', async () => {
  const sideways = (await PDFDocument.load(fixture('original-sideways.pdf'))).getPage(0);
  expect(sideways.getSize()).toEqual({ width: 432, height: 288 }); expect(sideways.getRotation().angle).toBe(0);
  expect((await PDFDocument.load(fixture('rotated-metadata.pdf'))).getPage(0).getRotation().angle).toBe(90);
  for (const name of ['landscape-left.gif', 'portrait.gif']) {
    const bytes = await renderUpsLabelPdf(fixture(name));
    const pdf = await PDFDocument.load(bytes); const page = pdf.getPage(0);
    expect(pdf.getPageCount()).toBe(1); expect(page.getRotation().angle).toBe(0);
    expect(page.getMediaBox()).toEqual({ x: 0, y: 0, width: 288, height: 432 });
    expect(page.getCropBox()).toEqual(page.getMediaBox());
    mkdirSync('node_modules/.cache/print-bridge-pdfs', { recursive: true });
    writeFileSync(`node_modules/.cache/print-bridge-pdfs/${name}.pdf`, bytes);
  }
});
test('unexpected geometry and invalid bytes fail clearly rather than cropping or distorting barcodes', async () => {
  await expect(renderUpsLabelPdf(fixture('unsupported.gif'))).rejects.toThrow('do not match 4 × 6');
  await expect(renderUpsLabelPdf(Buffer.from('not a label'))).rejects.toThrow();
  await expect(renderUpsLabelPdf(fixture('portrait.pdf'))).rejects.toThrow();
});
