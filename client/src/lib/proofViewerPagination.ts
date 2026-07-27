export function clampProofViewerPage(page: number, pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount < 1) return 1;
  return Math.max(1, Math.min(pageCount, page));
}

export function getProofViewerNavigation(page: number, pageCount: number) {
  const currentPage = clampProofViewerPage(page, pageCount);
  return {
    currentPage,
    canGoPrevious: pageCount > 1 && currentPage > 1,
    canGoNext: pageCount > 1 && currentPage < pageCount,
  };
}
