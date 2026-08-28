import { isSupabaseConfigured } from "../supabaseStorage";
import { normalizeTitanManagedStorageConfig, type TitanManagedStorageConfig } from "@shared/storageSettings";

export { normalizeTitanManagedStorageConfig };

export type StorageTarget = "supabase" | "local_dev";

/**
 * `local_dev` is an intentionally non-durable development fallback.  It must
 * never become the only canonical placement for a production file record:
 * Railway container files disappear on redeploy, while the database record
 * survives and would otherwise point at a permanently missing object.
 */
export function assertDurableCanonicalStorageTarget(
  storageTarget: StorageTarget,
  environment: Pick<NodeJS.ProcessEnv, "NODE_ENV"> = process.env,
): void {
  if (storageTarget !== "local_dev" || environment.NODE_ENV !== "production") return;

  throw Object.assign(
    new Error("A durable object-storage target is required for production uploads. Configure Supabase or another durable provider."),
    { code: "DURABLE_STORAGE_REQUIRED", statusCode: 409 },
  );
}

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

export function getEffectiveMaxCloudUploadBytes(providerConfigJson?: unknown): number {
  const normalized = normalizeTitanManagedStorageConfig(providerConfigJson);
  const override = normalized.maxCloudUploadBytesOverride;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }

  return getMaxCloudUploadBytes();
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
  providerConfigJson?: unknown;
}): StorageTarget {
  const fileSizeBytes = Number.isFinite(args.fileSizeBytes) && args.fileSizeBytes > 0 ? args.fileSizeBytes : 0;
  const requestedTarget = (args.requestedTarget ?? "").toString() || null;
  const normalizedConfig = normalizeTitanManagedStorageConfig(args.providerConfigJson);
  const maxCloudBytes = getEffectiveMaxCloudUploadBytes(args.providerConfigJson);
  const normalizedRequestedTarget = requestedTarget === "supabase" || requestedTarget === "local_dev"
    ? requestedTarget
    : null;

  // If Supabase isn't configured, we can only use local storage.
  if (!isSupabaseConfigured()) {
    if (shouldDebugStorage()) {
      console.log("[StorageDecision]", {
        fileName: args.fileName ?? null,
        fileSizeBytes,
        maxCloudBytes,
        requestedTarget,
        routingMode: normalizedConfig.routingMode,
        decidedTarget: "local_dev",
        reason: "supabase_not_configured",
        organizationId: args.organizationId ?? null,
        context: args.context ?? null,
      });
    }
    return "local_dev";
  }

  let decidedTarget: StorageTarget;
  let reason: string;

  if (normalizedConfig.routingMode === "local_dev") {
    decidedTarget = "local_dev";
    reason = "config_forces_local_dev";
  } else if (normalizedConfig.routingMode === "supabase") {
    decidedTarget = "supabase";
    reason = "config_forces_supabase";
  } else if (normalizedRequestedTarget === "local_dev") {
    decidedTarget = "local_dev";
    reason = "request_prefers_local_dev";
  } else if (normalizedRequestedTarget === "supabase") {
    decidedTarget = "supabase";
    reason = "request_prefers_supabase";
  } else {
    decidedTarget = fileSizeBytes <= maxCloudBytes ? "supabase" : "local_dev";
    reason = fileSizeBytes <= maxCloudBytes ? "under_or_equal_limit" : "over_limit";
  }

  if (shouldDebugStorage()) {
    console.log("[StorageDecision]", {
      fileName: args.fileName ?? null,
      fileSizeBytes,
      maxCloudBytes,
      requestedTarget,
      routingMode: normalizedConfig.routingMode,
      decidedTarget,
      reason,
      organizationId: args.organizationId ?? null,
      context: args.context ?? null,
    });
  }

  return decidedTarget;
}
