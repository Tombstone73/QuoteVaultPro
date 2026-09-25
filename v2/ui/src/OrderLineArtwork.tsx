import React, { useState } from "react";
import type { ArtworkOrderProjection } from "./api";
import { ArtworkUploadPanel, type ArtworkUploadTarget } from "./ArtworkUploadPanel";

export const artworkForOrderLine = (
  artwork: readonly ArtworkOrderProjection[],
  orderLineId: string,
): readonly ArtworkOrderProjection[] =>
  artwork.filter((entry) => entry.assignment.orderLineId === orderLineId);
export const protectedArtworkContentPath = (
  organizationId: string,
  entry: ArtworkOrderProjection,
): string =>
  `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/files/${encodeURIComponent(entry.file.id)}/content#page=${(entry.assignment.sourcePageIndex ?? 0) + 1}`;
export const lineArtworkUploadTarget = (
  orderId: string,
  orderNumber: string,
  line: Readonly<{ lineId: string; description: string; position: number }>,
): ArtworkUploadTarget => ({
  orderId,
  orderLineId: line.lineId,
  orderNumber,
  lineDescription: line.description || `Line ${line.position}`,
});

const label = (entry: ArtworkOrderProjection): string =>
  [
    entry.assignment.purpose
      .replaceAll("_", " ")
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()),
    entry.assignment.side,
    entry.assignment.sourcePageIndex === undefined
      ? undefined
      : `Page ${entry.assignment.sourcePageIndex + 1}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
type Props = Readonly<{
  organizationId: string;
  orderLineId: string;
  artwork: readonly ArtworkOrderProjection[];
  loading: boolean;
  canView: boolean;
  onOpen: () => void;
}>;
type DetailProps = Props &
  Readonly<{
    canAdopt?: boolean;
    uploadTarget?: ArtworkUploadTarget;
    onUploaded?: () => void;
  }>;
const Preview = ({
  organizationId,
  entry,
}: Readonly<{ organizationId: string; entry: ArtworkOrderProjection }>) => (
  <iframe
    className="v2-order-line-artwork-preview"
    title={`Artwork preview ${entry.file.displayFilename}`}
    src={protectedArtworkContentPath(organizationId, entry)}
  />
);

/** Read-only projection of Artwork-owned assignments for one saved Order line. */
export const OrderLineArtworkCompact = ({
  organizationId,
  orderLineId,
  artwork,
  loading,
  canView,
  onOpen,
}: Props) => {
  if (!canView)
    return (
      <span className="v2-order-line-artwork-unavailable">
        Artwork unavailable
      </span>
    );
  if (loading)
    return (
      <span className="v2-order-line-artwork-unavailable">
        Artwork loading…
      </span>
    );
  const assigned = artworkForOrderLine(artwork, orderLineId);
  if (!assigned.length)
    return (
      <button className="v2-sales-inline-button" type="button" onClick={onOpen}>
        No artwork
      </button>
    );
  return (
    <div className="v2-order-line-artwork-compact">
      <div>
        {assigned.slice(0, 2).map((entry) => (
          <Preview
            key={entry.assignment.id}
            organizationId={organizationId}
            entry={entry}
          />
        ))}
      </div>
      <button className="v2-sales-inline-button" type="button" onClick={onOpen}>
        {assigned.length} file{assigned.length === 1 ? "" : "s"}
      </button>
    </div>
  );
};

export const OrderLineArtworkDetail = ({
  organizationId,
  orderLineId,
  artwork,
  loading,
  canView,
  onOpen,
  canAdopt = false,
  uploadTarget,
  onUploaded,
}: DetailProps) => {
  const [uploading, setUploading] = useState(false);
  if (!canView && !canAdopt)
    return (
      <section className="v2-order-line-artwork-detail">
        <h3>Artwork</h3>
        <p>Artwork access is unavailable.</p>
      </section>
    );
  const assigned = artworkForOrderLine(artwork, orderLineId);
  return (
    <section className="v2-order-line-artwork-detail">
      <header>
        <div>
          <h3>Artwork</h3>
          <p>
            {!canView
              ? "Artwork details are unavailable, but you can upload a new file to this line."
              : loading
                ? "Loading Artwork…"
                : assigned.length
              ? `${assigned.length} canonical assignment${assigned.length === 1 ? "" : "s"} on this line.`
              : "No art assigned."}
          </p>
        </div>
        <div className="v2-order-line-artwork-actions">
          {canView && (
            <button className="button secondary" type="button" onClick={onOpen}>
              Open Artwork
            </button>
          )}
          {canAdopt && uploadTarget && (
            <button
              className="button secondary"
              type="button"
              onClick={() => setUploading((value) => !value)}
            >
              {uploading ? "Cancel upload" : "Upload Artwork"}
            </button>
          )}
        </div>
      </header>
      {canView && !loading && assigned.length ? (
        <ul>
          {assigned.map((entry) => (
            <li key={entry.assignment.id}>
              <Preview organizationId={organizationId} entry={entry} />
              <span>
                <b>{entry.file.displayFilename}</b>
                <small>{label(entry)}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {uploading && uploadTarget && (
        <ArtworkUploadPanel
          organizationId={organizationId}
          target={uploadTarget}
          currentAssignments={assigned.map((entry) => entry.assignment)}
          onUploaded={() => {
            setUploading(false);
            onUploaded?.();
          }}
        />
      )}
    </section>
  );
};
