import React, { useId, useRef, useState } from "react";

type ArtworkAutoUploadDropzoneProps = Readonly<{
  label: string;
  disabled?: boolean;
  fileName?: string;
  isUploading: boolean;
  isSuccess: boolean;
  error?: unknown;
  onFileSelected: (file: File) => void;
  onRetry?: () => void;
}>;

export const isArtworkPdf = (file: File): boolean => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

type CanonicalArtworkUploadError = Readonly<{ code: string; message?: string }>;

const isCanonicalArtworkUploadError = (error: unknown): error is CanonicalArtworkUploadError =>
  Boolean(error) && typeof error === "object" && typeof (error as { code?: unknown }).code === "string";

/** Never render an arbitrary failed response; known V2 codes get safe staff guidance. */
export const artworkUploadErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (!isCanonicalArtworkUploadError(error)) return error ? "Artwork upload failed. Existing artwork was not changed." : "";
  switch (error.code) {
    case "EMPTY_FILE": return "Choose a non-empty PDF file and try again.";
    case "SIZE_LIMIT": return "The selected PDF exceeds the 10 MB upload limit.";
    case "NOT_PDF":
    case "CORRUPT_PDF": return "The selected file is not a readable PDF. Choose a valid PDF and try again.";
    case "UPLOAD_TRANSPORT_CORRUPTION": return "Artwork upload could not be read. Retry the upload.";
    case "VALIDATION_ERROR":
      // The canonical upload also validates assignment and command metadata.
      // Only the dedicated PDF codes above establish a file-validation failure.
      if (error.message === "Artwork replacement must explicitly supersede the current customer-supplied Order-line slot")
        return "Artwork could not be assigned to this Order line because it already has Artwork in this position. Existing artwork was not changed.";
      return "Artwork upload could not be completed. Check the upload details and try again.";
    case "CONFLICT": return "Artwork changed while this upload was in progress. Refresh the Order and try again.";
    case "STALE_STATE": return "This Order changed. Refresh it before uploading Artwork again.";
    case "FORBIDDEN": return "You do not have permission to upload Artwork to this Order line.";
    default: return "Artwork upload failed. Existing artwork was not changed.";
  }
};

/** UI-only intake control; callers retain canonical Artwork upload authority. */
export const ArtworkAutoUploadDropzone = ({ label, disabled = false, fileName, isUploading, isSuccess, error, onFileSelected, onRetry }: ArtworkAutoUploadDropzoneProps) => {
  const input = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const [dragging, setDragging] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const unavailable = disabled || isUploading;
  const select = (file?: File) => {
    setDragging(false);
    setValidationMessage("");
    if (!file) return;
    if (!isArtworkPdf(file)) {
      setValidationMessage("Choose a PDF file. The server validates the final upload.");
      return;
    }
    onFileSelected(file);
  };
  const errorMessage = validationMessage || artworkUploadErrorMessage(error);
  const status = isUploading ? `Uploading ${fileName ?? "artwork"}…` : isSuccess ? "Artwork uploaded and assigned to this line." : fileName ? `Selected ${fileName}.` : "Drag a PDF here or click to select.";

  return <>
    <div
      className={`v2-artwork-dropzone${dragging ? " is-dragging" : ""}${unavailable ? " is-disabled" : ""}`}
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-label={label}
      aria-describedby={statusId}
      onClick={() => { if (!unavailable) input.current?.click(); }}
      onKeyDown={(event) => {
        if (unavailable || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        input.current?.click();
      }}
      onDragEnter={(event) => { event.preventDefault(); if (!unavailable) setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); if (!unavailable) select(event.dataTransfer.files?.[0]); }}
    >
      <input ref={input} aria-hidden="true" tabIndex={-1} type="file" accept="application/pdf,.pdf" disabled={unavailable} onClick={(event) => event.stopPropagation()} onChange={(event) => { select(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      <strong>{isUploading ? "Uploading artwork" : "Artwork PDF"}</strong>
      <span id={statusId} aria-live="polite">{status}</span>
      {!unavailable && <small>PDF only · Drop or click to upload</small>}
    </div>
    {errorMessage && <div className="v2-artwork-dropzone-error" role="alert"><span>{errorMessage}</span>{onRetry && fileName && <button type="button" onClick={onRetry}>Retry upload</button>}</div>}
  </>;
};
