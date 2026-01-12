import { isSupabaseConfigured } from "../supabaseStorage";

export type StorageTarget = "supabase" | "local_dev";

export const DEFAULT_MAX_CLOUD_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

function parseBytes(raw: string | undefined | null): number | null {
  const value = (raw ?? "").toString().trim();
  if (!value) return null;

  // Pure integer bytes
  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return null;

    // Guardrail: if someone accidentally sets "50" thinking MB, treat small values as MB.
    // This prevents catastrophically low limits due to misconfiguration.
    if (n > 0 && n < 1024 * 1024 && n <= 1024) {
      return n * 1024 * 1024;
    }

    return n;
  }

  // Human-readable forms: 50mb, 10m, 2gb, 512kb
  const m = value.match(/^\s*(\d+(?:\.\d+)?)\s*(b|bytes|kb|k|mb|m|gb|g)\s*$/i);
  if (!m) return null;

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = m[2].toLowerCase();
  const multiplier =
    unit === "b" || unit === "bytes"
      ? 1
      : unit === "kb" || unit === "k"
        ? 1024
        : unit === "mb" || unit === "m"
          ? 1024 * 1024
          : 1024 * 1024 * 1024;

  const bytes = Math.floor(amount * multiplier);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

export function getMaxCloudUploadBytes(): number {
  const parsed = parseBytes(process.env.SUPABASE_MAX_UPLOAD_BYTES);
  return parsed ?? DEFAULT_MAX_CLOUD_UPLOAD_BYTES;
}

function shouldDebugStorage(): boolean {
  const raw = (process.env.DEBUG_STORAGE ?? "").toString().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function decideStorageTarget(args: {
  fileSizeBytes: number;
  requestedTarget?: string | null;
  fileName?: string | null;
  organizationId?: string | null;
  context?: string;
}): StorageTarget {
  const fileSizeBytes = Number.isFinite(args.fileSizeBytes) && args.fileSizeBytes > 0 ? args.fileSizeBytes : 0;
  const requestedTarget = (args.requestedTarget ?? "").toString() || null;

  const maxCloudBytes = getMaxCloudUploadBytes();

  // If Supabase isn't configured, we can only use local storage.
  if (!isSupabaseConfigured()) {
    if (shouldDebugStorage()) {
      console.log("[StorageDecision]", {
        fileName: args.fileName ?? null,
        fileSizeBytes,
        maxCloudBytes,
        requestedTarget,
        decidedTarget: "local_dev",
        reason: "supabase_not_configured",
        organizationId: args.organizationId ?? null,
        context: args.context ?? null,
      });
    }
    return "local_dev";
  }

  const decidedTarget: StorageTarget = fileSizeBytes <= maxCloudBytes ? "supabase" : "local_dev";

  if (shouldDebugStorage()) {
    console.log("[StorageDecision]", {
      fileName: args.fileName ?? null,
      fileSizeBytes,
      maxCloudBytes,
      requestedTarget,
      decidedTarget,
      reason: fileSizeBytes <= maxCloudBytes ? "under_or_equal_limit" : "over_limit",
      organizationId: args.organizationId ?? null,
      context: args.context ?? null,
    });
  }

  return decidedTarget;
}
