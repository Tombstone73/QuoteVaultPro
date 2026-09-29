import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { detectArtworkFormat } from '@shared/artworkPreview';

export const ARTWORK_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;
export const ARTWORK_PREVIEW_TIMEOUT_MS = 30_000;
let activeRenders = 0;

/** Existing PDF.js + napi canvas stack, isolated so malformed artwork cannot pin the web thread.
 * No shell, filenames, temporary files, embedded JavaScript, or external document resources.
 */
export async function renderArtworkPdfFirstPage(bytes: Buffer, timeoutMs = ARTWORK_PREVIEW_TIMEOUT_MS): Promise<Buffer> {
  if (bytes.length > ARTWORK_PREVIEW_MAX_BYTES) throw new Error('preview_size_limit');
  if (detectArtworkFormat(bytes) !== 'pdf') throw new Error(`preview_unsupported_${detectArtworkFormat(bytes)}`);
  if (activeRenders >= 2) throw new Error('preview_renderer_busy');
  activeRenders++;
  try {
    const require = createRequire(import.meta.url);
    const pdfModule = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
    const canvasModule = require.resolve('@napi-rs/canvas');
    const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const canvasLib = require(workerData.canvasModule);
        for (const key of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[key] = canvasLib[key];
        const { getDocument } = await import(workerData.pdfModule);
        let task;
        try {
          task = getDocument({ data: workerData.bytes, isEvalSupported: false,
            useSystemFonts: false, disableFontFace: true, maxImageSize: 16000000,
            standardFontDataUrl: workerData.standardFonts, cMapUrl: workerData.cMaps, cMapPacked: true,
            useWasm: false, isOffscreenCanvasSupported: false });
          const doc = await task.promise;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) throw new Error('invalid dimensions');
          const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
          const canvas = canvasLib.createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          parentPort.postMessage({ image: canvas.toBuffer('image/png') });
        } finally { if (task) await task.destroy(); }
      })().catch(() => parentPort.postMessage({ error: 'preview_render_failed' }));
    `, { eval: true, execArgv: [], workerData: { bytes: new Uint8Array(bytes), pdfModule, canvasModule,
      standardFonts: path.join(pdfRoot, 'standard_fonts') + path.sep, cMaps: path.join(pdfRoot, 'cmaps') + path.sep },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true });
    // Do not retain or expose parser output (it can contain source content).
    worker.stdout?.resume(); worker.stderr?.resume();
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('preview_timeout')), Math.min(timeoutMs, ARTWORK_PREVIEW_TIMEOUT_MS));
        const finish = (error?: Error, image?: Uint8Array) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve(Buffer.from(image!));
        };
        worker.once('message', result => finish(result.error ? new Error(result.error) : undefined, result.image));
        worker.once('error', () => finish(new Error('preview_render_failed')));
        worker.once('exit', code => { if (code !== 0) finish(new Error('preview_render_failed')); });
      });
    } finally { await worker.terminate(); }
  } finally { activeRenders--; }
}
