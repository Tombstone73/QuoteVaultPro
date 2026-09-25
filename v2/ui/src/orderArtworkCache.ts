import type { QueryClient } from "@tanstack/react-query";
import type { ArtworkOrderProjection, ArtworkUploadResult } from "./api";

export const orderArtworkKey = (sessionScope: string, organizationId: string, orderId: string) =>
  ["v2", sessionScope, organizationId, "artwork", "order", orderId] as const;

/** Reject stale reconciliation instead of overwriting committed assignment evidence. */
export const confirmArtworkProjection = (
  entries: readonly ArtworkOrderProjection[],
  pending: readonly ArtworkUploadResult[],
  removed: readonly string[] = [],
): readonly ArtworkOrderProjection[] => {
  if (entries.some((entry) => removed.includes(entry.assignment.id)) || pending.some((result) => !entries.some((entry) =>
    entry.assignment.id === result.assignment.id && entry.file.id === result.artworkFile.id &&
    entry.assignment.artworkFileId === result.artworkFile.id &&
    entry.assignment.orderId === result.assignment.orderId && entry.assignment.orderLineId === result.assignment.orderLineId))) {
    throw { code: "UPLOAD_REFRESH_UNCONFIRMED" };
  }
  return entries;
};

/** Remove only the committed assignment, never every assignment of its file. */
export const cacheOrderArtworkRemoval = async (
  client: QueryClient,
  key: ReturnType<typeof orderArtworkKey>,
  assignmentId: string,
): Promise<void> => {
  await client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData<readonly ArtworkOrderProjection[]>(key, (entries = []) => entries.filter((entry) => entry.assignment.id !== assignmentId));
};

/** Publish committed canonical evidence to the one projection shared by all Order views. */
export const cacheOrderArtworkUpload = async (
  client: QueryClient,
  key: ReturnType<typeof orderArtworkKey>,
  result: ArtworkUploadResult,
): Promise<boolean> => {
  // An older in-flight read must not overwrite the just-committed assignment.
  await client.cancelQueries({ queryKey: key, exact: true });
  const existing = client.getQueryData<readonly ArtworkOrderProjection[]>(key) ?? [];
  const reused = existing.some((entry) => entry.assignment.id === result.assignment.id);
  client.setQueryData<readonly ArtworkOrderProjection[]>(key, (entries = []) => [
    ...entries.filter((entry) => entry.assignment.id !== result.assignment.id &&
      entry.assignment.id !== result.assignment.supersedesArtworkAssignmentId),
    { file: result.artworkFile, assignment: result.assignment },
  ]);
  return reused;
};
