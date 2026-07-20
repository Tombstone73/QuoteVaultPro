type ArtworkSide = "front" | "back" | "both" | "na" | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const ARTWORK_FILE_REFERENCE_KEYS = [
  "fileId",
  "frontFileId",
  "backFileId",
  "bothFileId",
  "sharedFileId",
] as const;

/**
 * Removes references to an unlinked artwork file without disturbing unrelated
 * line-item specifications. Per-file Front/Back/Both metadata remains owned by
 * the attachment record; this only repairs the line-item intent snapshot.
 */
export function removeArtworkFileReferencesFromSpecs(args: {
  specsJson: unknown;
  fileIds: Array<string | null | undefined>;
  removedSide?: ArtworkSide;
}): Record<string, unknown> {
  const specs = asRecord(args.specsJson) ?? {};
  const assignment = asRecord(specs.artworkSideAssignment);
  if (!assignment) return { ...specs };

  const removedIds = new Set(args.fileIds.filter((value): value is string => (
    typeof value === "string" && value.trim().length > 0
  )));
  const nextAssignment = { ...assignment };
  let removedReferencedFile = false;

  for (const key of ARTWORK_FILE_REFERENCE_KEYS) {
    const value = nextAssignment[key];
    if (typeof value === "string" && removedIds.has(value)) {
      delete nextAssignment[key];
      removedReferencedFile = true;
    }
  }

  if (
    nextAssignment.useSameArtworkBothSides === true
    && (removedReferencedFile || args.removedSide === "both")
  ) {
    nextAssignment.useSameArtworkBothSides = false;
  }

  return {
    ...specs,
    artworkSideAssignment: nextAssignment,
  };
}
