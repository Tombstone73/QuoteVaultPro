import type { QueryClient } from "@tanstack/react-query";
import type { ArtworkOrderProjection, ArtworkUploadResult } from "./api";

export const orderArtworkKey = (sessionScope: string, organizationId: string, orderId: string) =>
  ["v2", sessionScope, organizationId, "artwork", "order", orderId] as const;

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
