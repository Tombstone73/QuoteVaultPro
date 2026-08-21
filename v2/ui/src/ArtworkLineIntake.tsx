import React, { useEffect, useMemo, useState } from "react";
import { newBusinessRequestId, type ProductionRequirementPreview } from "./api";
import { ArtworkPdfInspectionError, formatArtworkInches, inspectArtworkPdf, type ArtworkPdfFailureKind, type ArtworkPdfInspection } from "./artworkPdfDimensions";

export type DraftLineArtwork = Readonly<{
  clientArtworkKey: string;
  uploadRequestId: string;
  file: File;
  purpose: "customer_supplied" | "production" | "proof" | "reference";
  side?: "front" | "back";
  inspection?: ArtworkPdfInspection;
  inspectionFailure?: ArtworkPdfFailureKind;
  autoFilledDimensions?: boolean;
}>;

const artworkKey = (): string => newBusinessRequestId().replace(/[^A-Za-z0-9_-]/gu, "");

const sideChoices = (requirements: ProductionRequirementPreview | undefined): readonly ("front" | "back")[] => {
  if (requirements?.state !== "configured") return ["front"];
  const sides = requirements.units.flatMap((unit) => unit.side ? [unit.side] : []);
  return Array.from(new Set(sides)).length ? Array.from(new Set(sides)) : ["front"];
};

const inspectionMessage = (failure: ArtworkPdfFailureKind): string =>
  failure === "encrypted"
    ? "This PDF is password protected. Enter dimensions manually."
    : failure === "no_pages"
      ? "This PDF has no readable pages. Enter dimensions manually."
      : failure === "invalid_page_size"
        ? "This PDF has an invalid page size. Enter dimensions manually."
        : "Artwork size could not be read. You can still enter dimensions manually.";

const reportInspectionFailure = (file: File, error: ArtworkPdfInspectionError): void => {
  if (import.meta.env?.DEV)
    console.warn("Artwork PDF sizing failed", {
      kind: error.kind,
      parserError: error.causeName,
      name: file.name,
      size: file.size,
      type: file.type,
    });
};

export const ArtworkLineIntake = ({
  productionRequirements,
  onChange,
  onDetectedDimensions,
}: Readonly<{
  productionRequirements?: ProductionRequirementPreview;
  onChange: (artwork: readonly DraftLineArtwork[]) => void;
  /** Returns true only when the owning line accepted the detected dimensions. */
  onDetectedDimensions: (size: Readonly<{ widthIn: number; heightIn: number }>) => boolean;
}>) => {
  const [artwork, setArtwork] = useState<readonly DraftLineArtwork[]>([]);
  const sides = useMemo(() => sideChoices(productionRequirements), [productionRequirements]);
  useEffect(() => onChange(artwork), [artwork, onChange]);
  const select = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const clientArtworkKey = artworkKey();
      const selected: DraftLineArtwork = {
        clientArtworkKey,
        uploadRequestId: newBusinessRequestId(),
        file,
        purpose: "customer_supplied",
        side: sides[0],
      };
      setArtwork((current) => [...current, selected]);
      void inspectArtworkPdf(file).then((inspection) => {
        const accepted = inspection.kind === "common_size" && onDetectedDimensions({ widthIn: inspection.size.widthIn, heightIn: inspection.size.heightIn });
        setArtwork((current) => current.map((entry) => entry.clientArtworkKey === clientArtworkKey ? { ...entry, inspection, ...(accepted ? { autoFilledDimensions: true } : {}) } : entry));
      }).catch((error: unknown) => {
        const failure = error instanceof ArtworkPdfInspectionError
          ? error
          : new ArtworkPdfInspectionError("implementation_failure", "Artwork PDF inspection failed.");
        reportInspectionFailure(file, failure);
        setArtwork((current) => current.map((entry) => entry.clientArtworkKey === clientArtworkKey ? { ...entry, inspectionFailure: failure.kind } : entry));
      });
    }
  };
  return <section className="v2-sales-line-artwork" aria-label="Line artwork">
    <header><div><h4>Artwork <small>Optional</small></h4><p>Keep a PDF with this line. It is uploaded only after a real Order line exists.</p></div><label className="v2-artwork-file-picker"><input aria-label="Choose Artwork PDF" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => select(event.currentTarget.files)} /><b>Choose PDF</b></label></header>
    {!artwork.length && <p className="muted">No artwork selected.</p>}
    {artwork.map((entry) => <article key={entry.clientArtworkKey} className="v2-sales-line-artwork-file"><div><b>{entry.file.name}</b>{entry.inspection?.kind === "common_size" && <small>Detected size: {formatArtworkInches(entry.inspection.size.widthIn)} × {formatArtworkInches(entry.inspection.size.heightIn)} in{entry.autoFilledDimensions ? " · Width and height filled" : ""}</small>}{entry.inspection?.kind === "mixed_sizes" && <small>Artwork contains multiple page sizes. Enter the intended finished dimensions.</small>}{entry.inspectionFailure && <small role="alert">{inspectionMessage(entry.inspectionFailure)}</small>}<small>Purpose: {entry.purpose.replaceAll("_", " ")}</small></div><div className="v2-sales-line-artwork-controls"><label>Purpose<select aria-label={`Artwork purpose for ${entry.file.name}`} value={entry.purpose} onChange={(event) => setArtwork((current) => current.map((candidate) => candidate.clientArtworkKey === entry.clientArtworkKey ? { ...candidate, purpose: event.target.value as DraftLineArtwork["purpose"] } : candidate))}><option value="customer_supplied">Customer supplied</option><option value="production">Production</option><option value="proof">Proof</option><option value="reference">Reference</option></select></label>{sides.length > 1 ? <label>Side<select aria-label={`Artwork side for ${entry.file.name}`} value={entry.side ?? sides[0]} onChange={(event) => setArtwork((current) => current.map((candidate) => candidate.clientArtworkKey === entry.clientArtworkKey ? { ...candidate, side: event.target.value as "front" | "back" } : candidate))}>{sides.map((side) => <option key={side} value={side}>{side === "front" ? "Front" : "Back"}</option>)}</select></label> : <small>Side: {entry.side === "back" ? "Back" : "Front"}</small>}<button type="button" onClick={() => setArtwork((current) => current.filter((candidate) => candidate.clientArtworkKey !== entry.clientArtworkKey))}>Remove</button></div></article>)}
  </section>;
};
