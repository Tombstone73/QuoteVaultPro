import { inflateSync } from "node:zlib";
import { pdfDocumentResources } from "./pdfDocumentResources";

export type PdfDocumentText = { text: string; pageCount: number; formPageNumbers?: number[]; scannedPageNumbers: number[]; hasExtractableText: boolean; truncated: boolean };
export class PdfDocumentLimitError extends Error {}
const MAX_ATTACHMENT_TEXT_CHARS = 50_000;
function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Shared extraction preserves page geometry and AcroForm values. It never
// executes document actions or infers business fields from PDF content.
export async function extractMachineReadablePdfText(buffer: Buffer | Uint8Array, signal?: AbortSignal, limits = { maxPages: 20, maxChars: 50_000, strict: false }): Promise<PdfDocumentText> {
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfjs = (mod as any).default ?? mod;
    const data = buffer instanceof Buffer
      ? new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
      : buffer;
    const task = pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false, ...pdfDocumentResources() });
    const cancel = () => { void task.destroy().catch(() => undefined); };
    signal?.addEventListener('abort', cancel, {once:true});
    try {
    signal?.throwIfAborted();
    const document = await task.promise;
    if (document.numPages > limits.maxPages) throw new PdfDocumentLimitError(`The PDF has more than ${limits.maxPages} pages.`);
    const pages: string[] = [];
    const scannedPageNumbers: number[] = [];
    let textCharacters = 0;
    const formPageNumbers: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const annotations = await page.getAnnotations();
      const fields = annotations.filter((item: { subtype?: string; fieldType?: string; fieldValue?: unknown }) => item.subtype === 'Widget' && item.fieldType === 'Tx' && typeof item.fieldValue === 'string' && item.fieldValue.trim());
      if (fields.length) formPageNumbers.push(pageNumber);
      const pageText = [...content.items.map((item: { str?: string }) => item.str ?? ''), ...fields.map((item: { fieldValue: string }) => item.fieldValue)].join(' ').trim();
      textCharacters += pageText.length;
      if (pageText.length < 20) scannedPageNumbers.push(pageNumber);
      if (!fields.length) {
        pages.push(`[PDF page ${pageNumber}] ${pageText}`);
        continue;
      }
      // Retain page geometry instead of trusting arbitrary AcroForm names such
      // as "Company Name" inside a ship-to box or numeric field identifiers.
      const runs: Array<{ text: string; x: number; y: number }> = content.items.filter((item: { str?: string }) => item.str?.trim()).map((item: { str: string; transform: number[] }) => ({ text: item.str, x: item.transform[4], y: item.transform[5] }));
      for (const field of fields) runs.push({ text: field.fieldValue, x: field.rect[0], y: field.rect[1] });
      runs.sort((a,b) => b.y - a.y || a.x - b.x);
      const lines: Array<{ y: number; runs: typeof runs }> = [];
      for (const run of runs) {
        const line = lines.find(candidate => Math.abs(candidate.y - run.y) <= 5);
        if (line) line.runs.push(run); else lines.push({ y: run.y, runs: [run] });
      }
      pages.push(`[PDF page ${pageNumber}]\n` + lines.map(line => line.runs.sort((a,b)=>a.x-b.x).map(run=>run.text).join(' | ')).join('\n'));
    }
    await document.destroy?.();
    return {
      text: normalizeWhitespace(pages.join("\n\n")).slice(0, limits.maxChars),
      scannedPageNumbers,
      hasExtractableText: textCharacters > 0,
      truncated: pages.join("\n\n").length > limits.maxChars,
      pageCount: document.numPages,
      formPageNumbers,
    };
    } finally { signal?.removeEventListener("abort",cancel); await task.destroy().catch(() => undefined); }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PdfDocumentLimitError || limits.strict) throw error;
    return extractPdfTextFromCompressedStreams(buffer);
  }
}

function extractPdfTextFromCompressedStreams(buffer: Buffer | Uint8Array): PdfDocumentText {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const binary = bytes.toString("latin1");
  const pageCount = Math.max(1, (binary.match(/\/Type\s*\/Page\b/g) ?? []).length);
  const texts: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(binary)) !== null) {
    const raw = Buffer.from(match[1], "latin1");
    let decoded: string | null = null;
    try {
      decoded = inflateSync(raw, { maxOutputLength: 1_000_000 }).toString("latin1");
    } catch {
      decoded = raw.toString("latin1");
    }
    for (const hex of Array.from(decoded.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g))) {
      const compact = hex[1].replace(/\s+/g, "");
      if (compact.length % 2 === 0) texts.push(Buffer.from(compact, "hex").toString("utf8"));
    }
    for (const literal of Array.from(decoded.matchAll(/\(([^()]*)\)\s*Tj/g))) {
      texts.push(literal[1].replace(/\\([()\\])/g, "$1"));
    }
  }
  return {
    text: normalizeWhitespace(texts.join("\n")).slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    pageCount,
    scannedPageNumbers: texts.join("").trim().length < 20 ? Array.from({ length: Math.min(pageCount, 20) }, (_, index) => index + 1) : [],
    formPageNumbers: [],
    hasExtractableText: texts.join("").trim().length > 0,
    truncated: true,
  };
}

