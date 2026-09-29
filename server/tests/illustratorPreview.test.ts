import { describe, expect, test } from '@jest/globals';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { detectArtworkFormat, isEpsArtwork, isVectorArtwork, artworkPreviewMessage } from '../../shared/artworkPreview';
import { ARTWORK_PREVIEW_MAX_BYTES, renderArtworkPdfFirstPage } from '../services/artworkPdfRenderer';
import { assertArtworkHeaderNotExecutable } from '../services/artworkUploadValidation';

async function fixture() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([4000, 2000]);
  first.drawRectangle({ x: 0, y: 0, width: 4000, height: 2000, color: rgb(1, 0, 0) });
  const second = pdf.addPage([100,100]);
  second.drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(0,0,1) });
  return Buffer.from(await pdf.save());
}

describe('Illustrator derivatives using the installed PDF renderer', () => {
  test('renders first artboard once, caps dimensions, preserves exact original bytes', async () => {
    const bytes = await fixture();
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(detectArtworkFormat(bytes)).toBe('pdf');
    const image = await renderArtworkPdfFirstPage(bytes);
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1600); expect(info.height).toBe(800);
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 0, 0]);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  });
  test('normal PDF uses the same renderer', async () => {
    expect((await sharp(await renderArtworkPdfFirstPage(await fixture())).metadata()).format).toBe('png');
  });
  test.each(['%!PS-Adobe-3.0', '%!PS-Adobe-3.0 EPSF-3.0', 'unknown illustrator data', 'MZpretend.ai'])('unsupported source %s never reaches PDF parsing', async text => {
    await expect(renderArtworkPdfFirstPage(Buffer.from(text))).rejects.toThrow('preview_unsupported');
  });
  test('malformed PDF-compatible AI fails safely', async () => {
    await expect(renderArtworkPdfFirstPage(Buffer.from('%PDF-1.7\ncorrupt'))).rejects.toThrow('preview_render_failed');
  });
  test('oversize source rejected before rendering', async () => {
    await expect(renderArtworkPdfFirstPage(Buffer.alloc(ARTWORK_PREVIEW_MAX_BYTES + 1))).rejects.toThrow('preview_size_limit');
  });
  test('timeout terminates worker and releases capacity for another conversion', async () => {
    await expect(renderArtworkPdfFirstPage(await fixture(), 1)).rejects.toThrow('preview_timeout');
    await expect(renderArtworkPdfFirstPage(await fixture())).resolves.toBeInstanceOf(Buffer);
  });
  test('generic MIME and misleading PDF MIME still identify vector originals by name', () => {
    expect(isVectorArtwork('logo.AI','application/octet-stream')).toBe(true);
    expect(isVectorArtwork('logo.ai','application/pdf')).toBe(true);
    expect(isVectorArtwork('art.eps',null)).toBe(true);
    expect(isVectorArtwork('photo.png','image/png')).toBe(false);
    expect(isVectorArtwork('photo.jpg','image/jpeg')).toBe(false);
  });
  test('states distinguish unsupported from failure and pending without raw diagnostics', () => {
    expect(artworkPreviewMessage('uploaded')).toBe('Generating preview...');
    expect(artworkPreviewMessage('thumb_failed','preview_unsupported_postscript')).toContain('unavailable');
    expect(artworkPreviewMessage('failed','private/server/path')).toBe('Preview generation failed. Download the original file.');
  });
  test('known executables disguised as AI are rejected; unsupported artwork is allowed', () => {
    expect(() => assertArtworkHeaderNotExecutable('logo.ai','application/octet-stream',Buffer.from('MZbinary'))).toThrow('Executable content');
    expect(() => assertArtworkHeaderNotExecutable('logo.ai','application/octet-stream',Buffer.from('%!PS-Adobe-3.0'))).not.toThrow();
    expect(() => assertArtworkHeaderNotExecutable('logo.ai','application/octet-stream',Buffer.from('unknown'))).not.toThrow();
  });
  test.each(['application/postscript', 'application/eps', 'image/x-eps', 'application/octet-stream'])(
    'valid EPS with %s is accepted without changing the source bytes', mimeType => {
      const original = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 20 20\nshowpage\n%%EOF\n');
      const before = createHash('sha256').update(original).digest('hex');
      expect(isEpsArtwork('logo.eps', mimeType)).toBe(true);
      expect(detectArtworkFormat(original)).toBe('postscript');
      expect(() => assertArtworkHeaderNotExecutable('logo.eps', mimeType, original)).not.toThrow();
      expect(createHash('sha256').update(original).digest('hex')).toBe(before);
    },
  );
  test('fake EPS is rejected even with an EPS MIME, while PDF and Illustrator classification stays separate', () => {
    for (const mimeType of ['application/postscript', 'application/octet-stream']) {
      expect(() => assertArtworkHeaderNotExecutable('logo.eps', mimeType, Buffer.from('not an EPS file'))).toThrow('recognizable PostScript header');
      expect(() => assertArtworkHeaderNotExecutable('logo.eps', mimeType, Buffer.from('MZbinary'))).toThrow('Executable content');
    }
    expect(isEpsArtwork('logo.ai', 'application/postscript')).toBe(false);
    expect(isEpsArtwork('logo.eps', 'application/pdf')).toBe(true);
    expect(isEpsArtwork('logo.pdf', 'application/postscript')).toBe(false);
    expect(isEpsArtwork('photo.png', 'image/png')).toBe(false);
    expect(() => assertArtworkHeaderNotExecutable('logo.ai', 'application/octet-stream', Buffer.from('unknown'))).not.toThrow();
  });
  test.each(['png','jpeg'] as const)('normal %s images retain their existing sharp derivative path', async format => {
    const original = await sharp({ create: { width:100, height:60, channels:3, background:'#0077ff' } }).toFormat(format).toBuffer();
    expect(detectArtworkFormat(original)).toBe('unknown');
    expect(isVectorArtwork(`photo.${format}`,`image/${format}`)).toBe(false);
    const preview = await sharp(original).resize(320,320,{fit:'inside',withoutEnlargement:true}).jpeg().toBuffer();
    expect((await sharp(preview).metadata()).width).toBe(100);
  });
});
