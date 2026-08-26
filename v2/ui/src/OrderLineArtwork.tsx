import React from "react";
import type { ArtworkOrderProjection } from "./api";

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
    return <span className="v2-order-line-artwork-empty">No art</span>;
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
        Artwork{assigned.length > 1 ? ` · +${assigned.length - 1}` : ""}
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
}: Props) => {
  if (!canView)
    return (
      <section className="v2-order-line-artwork-detail">
        <h3>Artwork</h3>
        <p>Artwork access is unavailable.</p>
      </section>
    );
  if (loading)
    return (
      <section className="v2-order-line-artwork-detail">
        <h3>Artwork</h3>
        <p>Loading Artwork…</p>
      </section>
    );
  const assigned = artworkForOrderLine(artwork, orderLineId);
  return (
    <section className="v2-order-line-artwork-detail">
      <header>
        <div>
          <h3>Artwork</h3>
          <p>
            {assigned.length
              ? `${assigned.length} canonical assignment${assigned.length === 1 ? "" : "s"} on this line.`
              : "No art assigned."}
          </p>
        </div>
        <button className="button secondary" type="button" onClick={onOpen}>
          Open Artwork
        </button>
      </header>
      {assigned.length ? (
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
    </section>
  );
};
