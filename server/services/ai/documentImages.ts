/** Provider-only image bytes. Symbols survive in-memory object spreads but
 * never JSON serialization, audit persistence, or browser responses. */
export const documentImages = Symbol("ephemeralDocumentImages");
export type DocumentImage = { mimeType: string; dataUrl: string };
export type WithDocumentImages = { [documentImages]?: readonly DocumentImage[] };

export function observationDocumentImages(observations: readonly object[]): DocumentImage[] {
  return observations.flatMap(item => [...((item as WithDocumentImages)[documentImages] ?? [])]).slice(-4);
}
