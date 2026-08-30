import { createClient } from "@supabase/supabase-js";

export type StoredArtworkObject = Readonly<{ storageProvider: "supabase"; objectKey: string; created: boolean }>;

/** Safe diagnostic classification: no provider message, object key, or credential is retained. */
export type ArtworkStorageFailureReason = "access_denied" | "bucket_unavailable" | "upload_unavailable";
export class ArtworkStorageUnavailableError extends Error {
  override readonly name = "ArtworkStorageUnavailableError";
  constructor(readonly reason: ArtworkStorageFailureReason) { super("Artwork storage is unavailable."); }
}

/** Provider errors are untrusted; only a status may affect safe classification. */
export function classifyArtworkStorageFailure(error: unknown): ArtworkStorageFailureReason {
  const status = storageErrorStatus(error);
  return status === 401 || status === 403 ? "access_denied" : status === 404 ? "bucket_unavailable" : "upload_unavailable";
}

function storageErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

export interface ArtworkBinaryStorage {
  put(input: Readonly<{ organizationId: string; objectKey: string; contentType: string; bytes: Buffer }>): Promise<StoredArtworkObject>;
  remove(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
  read(objectKey: string): Promise<Buffer>;
}

/** Server-only V2 Artwork object storage. Object keys are constructed by Artwork, never supplied by a browser. */
export class SupabaseArtworkBinaryStorage implements ArtworkBinaryStorage {
  private readonly bucket: string;
  private readonly url: string | undefined;
  private readonly serviceRoleKey: string | undefined;
  private client: ReturnType<typeof createClient> | undefined;

  constructor(environment: Readonly<Record<string, string | undefined>> = process.env) {
    this.url = environment.SUPABASE_URL?.trim();
    this.serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
    this.bucket = environment.SUPABASE_BUCKET?.trim() || "titan-private";
  }

  private getClient(): ReturnType<typeof createClient> {
    if (!this.url || !this.serviceRoleKey) throw new Error("V2 Artwork storage is not configured.");
    this.client ??= createClient(this.url, this.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    return this.client;
  }

  async put(input: Readonly<{ organizationId: string; objectKey: string; contentType: string; bytes: Buffer }>): Promise<StoredArtworkObject> {
    if (!input.objectKey.startsWith(`v2-artwork/${input.organizationId}/`)) throw new Error("Artwork object key is outside its tenant prefix.");
    const { error } = await this.getClient().storage.from(this.bucket).upload(input.objectKey, input.bytes, { contentType: input.contentType, upsert: false });
    if (!error) return { storageProvider: "supabase", objectKey: input.objectKey, created: true };
    if (await this.exists(input.objectKey)) return { storageProvider: "supabase", objectKey: input.objectKey, created: false };
    throw new ArtworkStorageUnavailableError(classifyArtworkStorageFailure(error));
  }

  async remove(objectKey: string): Promise<void> {
    const { error } = await this.getClient().storage.from(this.bucket).remove([objectKey]);
    if (error) throw new Error("Artwork object cleanup failed.");
  }

  async exists(objectKey: string): Promise<boolean> {
    const parts = objectKey.split("/");
    const filename = parts.pop();
    if (!filename) return false;
    const { data, error } = await this.getClient().storage.from(this.bucket).list(parts.join("/"), { search: filename, limit: 1 });
    return !error && data.some((entry) => entry.name === filename);
  }
  async read(objectKey: string): Promise<Buffer> {
    const { data, error } = await this.getClient().storage.from(this.bucket).download(objectKey);
    if (error || !data) throw new ArtworkStorageUnavailableError("upload_unavailable");
    return Buffer.from(await data.arrayBuffer());
  }
}
