// Synthetic label and barcode geometry only. Never calls a carrier or prints.
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../../server/tests/fixtures/shipping-labels/', import.meta.url);
await mkdir(out, { recursive: true });
const bars = Array.from({ length: 65 }, (_, i) => `<rect x="${30 + i * 5}" y="400" width="${i % 3 + 1}" height="100" fill="black"/>`).join('');
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="white"/><rect x="1" y="1" width="398" height="598" stroke="black" fill="none"/><rect x="12" y="12" width="30" height="20" fill="black"/><text x="60" y="60" font-family="Arial" font-size="26">TOP - SYNTHETIC</text><text x="30" y="160" font-family="Arial" font-size="20">NOT FOR SHIPPING</text><text x="30" y="200" font-family="Arial" font-size="18">Geometry / orientation fixture</text>${bars}<text x="40" y="550" font-family="Arial" font-size="20">BOTTOM - TEST ONLY</text></svg>`);
const portrait = await sharp(svg).gif().toBuffer();
const landscape = await sharp(portrait).rotate(270).gif().toBuffer();
await writeFile(new URL('portrait.gif', out), portrait);
await writeFile(new URL('landscape-left.gif', out), landscape);
await writeFile(new URL('unsupported.gif', out), await sharp({ create: { width: 400, height: 700, channels: 3, background: 'white' } }).gif().toBuffer());
for (const [name, bytes, size, rotation] of [
  ['original-sideways.pdf', landscape, [432, 288], 0],
  ['portrait.pdf', portrait, [288, 432], 0],
  ['rotated-metadata.pdf', portrait, [288, 432], 90],
]) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage(size);
  const { degrees } = await import('pdf-lib'); page.setRotation(degrees(rotation));
  page.drawImage(await pdf.embedPng(await sharp(bytes).png().toBuffer()), { x: 0, y: 0, width: size[0], height: size[1] });
  await writeFile(new URL(name, out), await pdf.save());
}
