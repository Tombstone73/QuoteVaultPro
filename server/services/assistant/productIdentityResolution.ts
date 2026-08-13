export function selectProductQueryCandidate<T extends { name: string }>(candidates: readonly T[], rawQuery: string): { resolution: "resolved"; candidate: T } | { resolution: "not_found" | "ambiguous" } {
  if (!candidates.length) return { resolution: "not_found" };
  if (candidates.length === 1) return { resolution: "resolved", candidate: candidates[0]! };
  const query = rawQuery.trim().toLocaleLowerCase();
  const exact = candidates.filter((candidate) => candidate.name.trim().toLocaleLowerCase() === query);
  return exact.length === 1 ? { resolution: "resolved", candidate: exact[0]! } : { resolution: "ambiguous" };
}
