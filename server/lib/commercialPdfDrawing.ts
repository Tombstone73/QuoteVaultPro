import type { PDFFont } from "pdf-lib";

export function wrapText(params: {
  text: string;
  maxWidth: number;
  font: PDFFont;
  fontSize: number;
  maxLines?: number;
}): string[] {
  const raw = String(params.text || '').replace(/\r/g, '');
  const chunks = raw.split('\n');
  const lines: string[] = [];

  const pushLine = (s: string) => {
    if (!s) return;
    lines.push(s);
  };

  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let current = '';
    for (const w of words) {
      if (params.font.widthOfTextAtSize(w, params.fontSize) > params.maxWidth) {
        if (current) { pushLine(current); current = ''; }
        let piece = '';
        for (const char of w) {
          if (piece && params.font.widthOfTextAtSize(piece + char, params.fontSize) > params.maxWidth) { pushLine(piece); piece = char; }
          else piece += char;
        }
        current = piece;
        if (params.maxLines && lines.length >= params.maxLines) break;
        continue;
      }
      const next = current ? `${current} ${w}` : w;
      const width = params.font.widthOfTextAtSize(next, params.fontSize);
      if (width <= params.maxWidth) {
        current = next;
        continue;
      }
      if (current) pushLine(current);
      current = w;

      if (params.maxLines && lines.length >= params.maxLines) break;
    }
    if (params.maxLines && lines.length >= params.maxLines) break;
    if (current) pushLine(current);

    if (params.maxLines && lines.length >= params.maxLines) break;
  }

  if (params.maxLines && lines.length > params.maxLines) {
    return lines.slice(0, params.maxLines);
  }
  return lines;
}

export function tryDecodeDataUrl(dataUrl: string): { mime: 'png' | 'jpeg'; bytes: Uint8Array } | null {
  const raw = String(dataUrl || '').trim();
  if (!raw.startsWith('data:')) return null;

  const m = raw.match(/^data:(image\/(png|jpeg));base64,(.+)$/i);
  if (!m) return null;

  const subtype = String(m[2] || '').toLowerCase();
  const b64 = m[3] || '';
  if (!b64) return null;

  try {
    const buf = Buffer.from(b64, 'base64');
    return { mime: subtype === 'png' ? 'png' : 'jpeg', bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}
