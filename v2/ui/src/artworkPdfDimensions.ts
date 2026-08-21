import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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

const rounded = (value: number): number => Math.round(value * 1000) / 1000;
const sameSize = (left: ArtworkPdfSize, right: ArtworkPdfSize): boolean =>
  Math.abs(left.widthIn - right.widthIn) < 0.001 &&
  Math.abs(left.heightIn - right.heightIn) < 0.001;

/**
 * Metadata-only browser inspection. pdf.js applies each page's rotation to the
 * viewport, so the returned width and height describe the effective artwork
 * orientation rather than the unrotated PDF coordinate space.
 */
export const inspectArtworkPdfBytes = async (
  bytes: Uint8Array,
): Promise<ArtworkPdfInspection> => {
  const loading = getDocument({ data: bytes, disableWorker: true } as never);
  try {
    const document = await loading.promise;
    const sizes: ArtworkPdfSize[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      sizes.push({
        widthIn: rounded(viewport.width / 72),
        heightIn: rounded(viewport.height / 72),
        pageCount: document.numPages,
        pageBox: "crop_or_media",
      });
      page.cleanup();
    }
    const first = sizes[0];
    if (!first) throw new Error("Artwork PDF has no pages.");
    return sizes.every((size) => sameSize(first, size))
      ? { kind: "common_size", size: first }
      : { kind: "mixed_sizes", pageCount: document.numPages };
  } finally {
    await loading.destroy();
  }
};

export const inspectArtworkPdf = async (file: Pick<File, "arrayBuffer">): Promise<ArtworkPdfInspection> =>
  inspectArtworkPdfBytes(new Uint8Array(await file.arrayBuffer()));

export const formatArtworkInches = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
