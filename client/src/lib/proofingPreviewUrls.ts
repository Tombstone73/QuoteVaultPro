export type ProofPreviewFileLike = {
  authenticatedUrl?: string | null;
  originalUrl?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  fileUrl?: string | null;
  thumbUrl?: string | null;
  objectPath?: string | null;
  mimeType?: string | null;
  originalFilename?: string | null;
  fileName?: string | null;
};

function isObjectOrApiFilePath(pathname: string) {
  return pathname === "/objects" ||
    pathname.startsWith("/objects/") ||
    pathname === "/api/objects/download" ||
    pathname.startsWith("/api/objects/");
}

export function normalizeStaffProofFileUrl(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("objects/")) return `/${raw}`;

  if (!/^https?:\/\//i.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    if (isObjectOrApiFilePath(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return raw;
  }

  return raw;
}

export function shouldFetchStaffPreviewAsBlob(value?: string | null) {
  const url = normalizeStaffProofFileUrl(value);
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;
  if (url.startsWith("/")) return true;

  try {
    return typeof window !== "undefined" && new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function getStaffProofPreviewUrl(file: ProofPreviewFileLike | null | undefined, isPdf: boolean) {
  if (!file) return null;

  const serverProvidedUrl =
    file.authenticatedUrl ||
    file.originalUrl ||
    file.previewUrl ||
    file.downloadUrl ||
    file.fileUrl ||
    null;

  if (serverProvidedUrl) {
    return normalizeStaffProofFileUrl(serverProvidedUrl);
  }

  if (isPdf && file.objectPath) {
    return normalizeStaffProofFileUrl(`/objects/${file.objectPath}`);
  }

  return normalizeStaffProofFileUrl(file.thumbUrl ?? null);
}

export function getStaffProofDownloadUrl(file: ProofPreviewFileLike | null | undefined) {
  if (!file) return null;
  return normalizeStaffProofFileUrl(file.downloadUrl || file.authenticatedUrl || file.originalUrl || file.fileUrl || null);
}
