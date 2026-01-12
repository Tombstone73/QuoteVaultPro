export const SUPABASE_MAX_UPLOAD_BYTES: number = (() => {
  const raw = (import.meta as any)?.env?.VITE_SUPABASE_MAX_UPLOAD_BYTES;
  const parsed = Number(raw);

  // Default: 50MB (matches current Supabase constraints used throughout the app)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50 * 1024 * 1024;
})();

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
