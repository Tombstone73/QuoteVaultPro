declare module "word-extractor" {
  type WordDocument = {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
  };

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }
}
