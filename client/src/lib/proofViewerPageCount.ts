export function getProofPdfPageCountLabel({
  pageCount,
  isLoading,
  unavailable,
}: {
  pageCount: number;
  isLoading: boolean;
  unavailable: boolean;
}) {
  if (isLoading) return "PDF page count loading…";
  if (unavailable || !Number.isInteger(pageCount) || pageCount < 1) {
    return "PDF page count unavailable";
  }
  return `${pageCount}-page PDF`;
}
