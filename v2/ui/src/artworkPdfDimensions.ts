import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Vite must publish the PDF.js worker; getDocument's disableWorker option is not a browser worker contract. */
const browserWorkerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();
if (typeof window !== "undefined") GlobalWorkerOptions.workerSrc = browserWorkerSrc;

export type ArtworkPdfSize = Readonly<{
  widthIn: number;
  heightIn: number;
  pageCount: number;
  /** pdf.js page view: CropBox where present, otherwise MediaBox. */
  pageBox: "crop_or_media";
}>;

export type ArtworkPdfInspection =
  | Readonly<{ kind: "common_size"; size: ArtworkPdfSize }>
  | Readonly<{ kind: "mixed_sizes"; pageCount: number }>;

export type ArtworkPdfFailureKind =
  | "encrypted"
  | "parser_failure"
  | "no_pages"
  | "invalid_page_size"
  | "implementation_failure";

export class ArtworkPdfInspectionError extends Error {
  constructor(
    readonly kind: ArtworkPdfFailureKind,
    message: string,
    readonly causeName?: string,
  ) {
    super(message);
    this.name = "ArtworkPdfInspectionError";
  }
}

const rounded = (value: number): number => Math.round(value * 1000) / 1000;
const sameSize = (left: ArtworkPdfSize, right: ArtworkPdfSize): boolean =>
  Math.abs(left.widthIn - right.widthIn) < 0.001 &&
  Math.abs(left.heightIn - right.heightIn) < 0.001;

const failureFrom = (error: unknown): ArtworkPdfInspectionError => {
  if (error instanceof ArtworkPdfInspectionError) return error;
  const name = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : "Unknown PDF inspection failure.";
  if (/password|encrypted/iu.test(`${name ?? ""} ${message}`))
    return new ArtworkPdfInspectionError("encrypted", "The PDF is password protected.", name);
  if (/invalid.*pdf|xref|cross-reference|format|corrupt|missing/iu.test(`${name ?? ""} ${message}`))
    return new ArtworkPdfInspectionError("parser_failure", "The PDF could not be parsed.", name);
  return new ArtworkPdfInspectionError("implementation_failure", "Artwork PDF inspection failed.", name);
};

/**
 * Metadata-only browser inspection. pdf.js applies each page's rotation to the
 * viewport, so the returned width and height describe the effective artwork
 * orientation rather than the unrotated PDF coordinate space.
 */
export const inspectArtworkPdfBytes = async (
  bytes: Uint8Array,
): Promise<ArtworkPdfInspection> => {
  const loading = getDocument({ data: bytes });
  try {
    const document = await loading.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1)
      throw new ArtworkPdfInspectionError("no_pages", "Artwork PDF has no pages.");
    const sizes: ArtworkPdfSize[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0)
        throw new ArtworkPdfInspectionError("invalid_page_size", "Artwork PDF has an invalid page size.");
      sizes.push({
        widthIn: rounded(viewport.width / 72),
        heightIn: rounded(viewport.height / 72),
        pageCount: document.numPages,
        pageBox: "crop_or_media",
      });
      page.cleanup();
    }
    const first = sizes[0];
    if (!first) throw new ArtworkPdfInspectionError("no_pages", "Artwork PDF has no pages.");
    return sizes.every((size) => sameSize(first, size))
      ? { kind: "common_size", size: first }
      : { kind: "mixed_sizes", pageCount: document.numPages };
  } catch (error) {
    throw failureFrom(error);
  } finally {
    await loading.destroy().catch(() => undefined);
  }
};

export const inspectArtworkPdf = async (file: Pick<File, "arrayBuffer">): Promise<ArtworkPdfInspection> =>
  inspectArtworkPdfBytes(new Uint8Array(await file.arrayBuffer()));

export const formatArtworkInches = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
