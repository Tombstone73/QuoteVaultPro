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
  const errorMessage = validationMessage || (error instanceof Error ? error.message : error ? "Artwork upload failed. Existing artwork was not changed." : "");
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
