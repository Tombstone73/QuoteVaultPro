import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
/** Local PDF.js assets only. Standard fonts are needed to paint non-embedded
 * fonts and AcroForm appearances; CMaps preserve existing encoded text support.
 * No document-controlled URL or external font request is used.
 */
export function pdfDocumentResources() {
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
    cMapUrl: path.join(root, "cmaps") + path.sep,
    cMapPacked: true,
  };
}
