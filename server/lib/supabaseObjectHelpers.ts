import { db, hasQuoteAttachmentPagesTable } from "../db";
import { quoteAttachmentPages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { applyThumbnailContract } from "./thumbnailContract";

export type FileRole = "artwork" | "proof" | "reference" | "customer_po" | "setup" | "output" | "other";
export type FileSide = "front" | "back" | "na";

/**
 * Creates a function that logs a message only once for a given key.
 * Used to avoid flooding logs with the same warning during a single request or batch operation.
 */
export function createRequestLogOnce() {
    const logged = new Set<string>();
    return (key: string, ...args: any[]) => {
        if (logged.has(key)) return;
        logged.add(key);
        console.warn(...args);
    };
}

/**
 * Normalizes a storage key for database storage.
 * Strips leading slashes and common accidental bucket prefixes.
 */
export function normalizeObjectKeyForDb(input: string): string {
    let key = (input || "").toString().trim();
    key = key.replace(/^\/+/, "");
    // Strip common accidental bucket prefix when client sends "<bucket>/<path>"
    if (key.startsWith("titan-private/")) {
        key = key.slice("titan-private/".length);
    }
    return key;
}

/**
 * Attempts to extract a Supabase object key from a full public/signed/download URL.
 * Recognizes various Supabase storage URL patterns and returns the decoded path without the bucket.
 */
export function tryExtractSupabaseObjectKeyFromUrl(inputUrl: string, bucket: string): string | null {
    const raw = (inputUrl || "").toString().trim();
    if (!raw) return null;

    // If it doesn't look like a URL, it might already be a key.
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
        return normalizeObjectKeyForDb(raw);
    }

    try {
        const url = new URL(raw);
        const path = url.pathname;

        const markers = [
            `/storage/v1/object/public/${bucket}/`,
            `/storage/v1/object/sign/${bucket}/`,
            `/storage/v1/object/authenticated/${bucket}/`,
            `/storage/v1/object/upload/sign/${bucket}/`,
            `/storage/v1/object/download/${bucket}/`,
            `/storage/v1/object/${bucket}/`,
        ];

        for (const marker of markers) {
            const idx = path.indexOf(marker);
            if (idx >= 0) {
                const remainder = path.slice(idx + marker.length);
                const decoded = decodeURIComponent(remainder);
                const normalized = normalizeObjectKeyForDb(decoded);
                return normalized || null;
            }
        }
    } catch {
        // ignore invalid URLs
    }

    return null;
}

/**
 * Enriches an attachment record with signed URLs for display.
 * Generates originalUrl, thumbUrl, and previewUrl.
 * For PDFs, also fetches and enriches page data with signed URLs.
 */
export async function enrichAttachmentWithUrls(
    attachment: any,
    options?: {
        logOnce?: (key: string, ...args: any[]) => void;
        bucket?: string;
    }
): Promise<any> {
    let originalUrl: string | null = null;
    let thumbUrl: string | null = null;
    let previewUrl: string | null = null;

    let objectPath: string | null = null;
    let downloadUrl: string | null = null;

    const logOnce = options?.logOnce;

    const rawFileUrl = (attachment.fileUrl ?? "").toString();
    const isHttpUrl = rawFileUrl.startsWith("http://") || rawFileUrl.startsWith("https://");
    const storageProvider = (attachment.storageProvider ?? null) as string | null;
    const bucket = (options?.bucket || attachment.bucket || undefined) as string | undefined;

    const objectsProxyUrl = (key: string) => `/objects/${key}`;

    // External URL: use as-is, unless it's a Supabase URL that needs signing.
    if (rawFileUrl && isHttpUrl) {
        const maybeSupabaseKey = isSupabaseConfigured()
            ? tryExtractSupabaseObjectKeyFromUrl(rawFileUrl, bucket || "titan-private")
            : null;

        if (maybeSupabaseKey) {
            objectPath = maybeSupabaseKey;
        }

        if (maybeSupabaseKey && isSupabaseConfigured()) {
            const supabaseService = new SupabaseStorageService(bucket);
            try {
                originalUrl = await supabaseService.getSignedDownloadUrl(maybeSupabaseKey, 3600);
            } catch (error: any) {
                if (logOnce) {
                    logOnce(
                        `orig:${attachment.id}`,
                        "[enrichAttachmentWithUrls] Supabase originalUrl missing (fail-soft):",
                        {
                            attachmentId: attachment.id,
                            bucket: bucket || "default",
                            path: maybeSupabaseKey,
                            message: error?.message || String(error),
                        }
                    );
                }
                originalUrl = null;
            }
        } else {
            originalUrl = rawFileUrl;
        }
    } else if (rawFileUrl && storageProvider === "local") {
        originalUrl = objectsProxyUrl(rawFileUrl);
        objectPath = normalizeObjectKeyForDb(rawFileUrl);
    } else if (rawFileUrl && storageProvider === "supabase" && isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService(bucket);
        try {
            originalUrl = await supabaseService.getSignedDownloadUrl(rawFileUrl, 3600);
        } catch (error: any) {
            if (logOnce) {
                logOnce(
                    `orig:${attachment.id}`,
                    "[enrichAttachmentWithUrls] Supabase originalUrl missing (fail-soft):",
                    {
                        attachmentId: attachment.id,
                        bucket: bucket || "default",
                        path: rawFileUrl,
                        message: error?.message || String(error),
                    }
                );
            } else {
                console.warn(
                    `[enrichAttachmentWithUrls] Failed to generate originalUrl for ${attachment.id} (fail-soft):`,
                    error
                );
            }
            originalUrl = null;
        }

        objectPath = normalizeObjectKeyForDb(rawFileUrl);
    } else if (rawFileUrl) {
        originalUrl = objectsProxyUrl(rawFileUrl);
        objectPath = normalizeObjectKeyForDb(rawFileUrl);
    }

    // Same-origin forced download URL (server enforces tenant scoping via key prefix)
    if (objectPath && objectPath.length) {
        const fileNameForDownload = String(attachment?.originalFilename ?? attachment?.fileName ?? "download");
        const bucketParam = bucket ? `&bucket=${encodeURIComponent(String(bucket))}` : "";
        downloadUrl = `/api/objects/download?key=${encodeURIComponent(objectPath)}&filename=${encodeURIComponent(fileNameForDownload)}${bucketParam}`;
    }

    // Derivative URLs (Thumbnails/Previews)
    const thumbKey = (attachment.thumbKey ?? null) as string | null;
    if (thumbKey) {
        thumbUrl = objectsProxyUrl(thumbKey);
    }

    const previewKey = (attachment.previewKey ?? null) as string | null;
    if (previewKey) {
        previewUrl = objectsProxyUrl(previewKey);
    }

    // Handle PDF pages if applicable
    let pages: any[] = [];
    const isPdf = attachment.mimeType === "application/pdf" ||
        (attachment.fileName || "").toLowerCase().endsWith(".pdf");

    if (isPdf && attachment.pageCount) {
        const tableExists = hasQuoteAttachmentPagesTable();

        if (tableExists === true) {
            try {
                const pageRecords = await db.select()
                    .from(quoteAttachmentPages)
                    .where(eq(quoteAttachmentPages.attachmentId, attachment.id))
                    .orderBy(quoteAttachmentPages.pageIndex);

                if (isSupabaseConfigured()) {
                    const supabaseService = new SupabaseStorageService(bucket);
                    pages = await Promise.all(pageRecords.map(async (page) => {
                        let pageThumbUrl: string | null = null;
                        let pagePreviewUrl: string | null = null;

                        if (page.thumbKey) {
                            try {
                                pageThumbUrl = await supabaseService.getSignedDownloadUrl(page.thumbKey, 3600);
                            } catch (error) {
                                if (logOnce) {
                                    logOnce(`pageThumb:${attachment.id}`, "[enrichAttachmentWithUrls] Failed to generate page thumbUrl (fail-soft)", error);
                                }
                            }
                        }

                        if (page.previewKey) {
                            try {
                                pagePreviewUrl = await supabaseService.getSignedDownloadUrl(page.previewKey, 3600);
                            } catch (error) {
                                if (logOnce) {
                                    logOnce(`pagePreview:${attachment.id}`, "[enrichAttachmentWithUrls] Failed to generate page previewUrl (fail-soft)", error);
                                }
                            }
                        }

                        return {
                            ...page,
                            thumbUrl: pageThumbUrl,
                            previewUrl: pagePreviewUrl,
                        };
                    }));
                } else {
                    pages = pageRecords.map((page) => ({
                        ...page,
                        thumbUrl: page.thumbKey ? objectsProxyUrl(page.thumbKey) : null,
                        previewUrl: page.previewKey ? objectsProxyUrl(page.previewKey) : null,
                    }));
                }
            } catch (error) {
                console.error(`[enrichAttachmentWithUrls] Failed to fetch pages for ${attachment.id}:`, error);
            }
        }
    }

    return applyThumbnailContract({
        ...attachment,
        originalUrl,
        thumbUrl,
        previewUrl,
        objectPath,
        downloadUrl,
        // `applyThumbnailContract` will set thumbnailUrl based on (pages[0]?.thumbUrl || previewThumbnailUrl || thumbUrl)
        pages,
    });
}

/**
 * Schedules an asynchronous check to verify if a Supabase object exists.
 * Logs a warning if the object is missing.
 */
export function scheduleSupabaseObjectSelfCheck(args: {
    bucket?: string | null;
    path: string;
    context: Record<string, any>;
}) {
    if (!isSupabaseConfigured()) return;
    const { bucket, path, context } = args;
    if (!path || path.startsWith("http://") || path.startsWith("https://")) return;

    setImmediate(() => {
        void (async () => {
            try {
                const svc = new SupabaseStorageService(bucket ?? undefined);
                const exists = await svc.fileExists(path);
                if (!exists) {
                    console.warn("[SupabaseStorage] Object self-check failed (missing):", {
                        bucket: bucket ?? "default",
                        path,
                        ...context,
                    });
                }
            } catch (error) {
                console.warn("[SupabaseStorage] Object self-check errored (fail-soft):", {
                    path,
                    ...context,
                    message: (error as any)?.message || String(error),
                });
            }
        })();
    });
}
