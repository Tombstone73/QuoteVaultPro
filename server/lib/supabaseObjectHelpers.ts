import { db, hasQuoteAttachmentPagesTable } from "../db";
import { quoteAttachmentPages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { applyThumbnailContract } from "./thumbnailContract";
import { canonicalFileReadResolver, type CanonicalFileReadStatus } from "../services/storage/CanonicalFileReadResolver";
import { canonicalDerivativeReadResolver, type CanonicalDerivativeReadStatus } from "../services/storage/CanonicalDerivativeReadResolver";

export type FileRole = "artwork" | "proof" | "reference" | "customer_po" | "setup" | "output" | "other";
export type FileSide = "front" | "back" | "na";

export type OriginalFileAccessResult = {
    displayFilename: string;
    mimeType: string | null;
    objectPath: string | null;
    originalUrl: string | null;
    downloadUrl: string | null;
    availabilityStatus: CanonicalFileReadStatus;
};

export type DerivativeFileAccessResult = {
    objectPath: string | null;
    url: string | null;
    availabilityStatus: CanonicalDerivativeReadStatus;
};

function objectsProxyUrl(key: string, params?: { download?: boolean; filename?: string; bucket?: string | null; providerConfigId?: string | null }) {
    const download = params?.download ? "download=1" : "";
    const filename = params?.filename ? `filename=${encodeURIComponent(params.filename)}` : "";
    const bucketParam = params?.bucket ? `bucket=${encodeURIComponent(params.bucket)}` : "";
    const providerConfigParam = params?.providerConfigId ? `providerConfigId=${encodeURIComponent(params.providerConfigId)}` : "";
    const query = [download, filename, bucketParam, providerConfigParam].filter(Boolean).join("&");
    return `/objects/${key}${query ? `?${query}` : ""}`;
}

function extractLegacyObjectPath(candidate: string | null | undefined): string | null {
    const raw = (candidate ?? "").toString().trim();
    if (!raw) return null;

    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            const objectPath = url.pathname.match(/^\/objects\/(.+)$/)?.[1] ?? null;
            return objectPath ? normalizeObjectKeyForDb(decodeURIComponent(objectPath)) : null;
        } catch {
            return null;
        }
    }

    const [pathOnly] = raw.split("?");

    if (pathOnly.startsWith("/objects/")) {
        return normalizeObjectKeyForDb(decodeURIComponent(pathOnly.slice("/objects/".length)));
    }

    if (pathOnly.startsWith("objects/")) {
        return normalizeObjectKeyForDb(decodeURIComponent(pathOnly.slice("objects/".length)));
    }

    if (pathOnly.startsWith("/") || pathOnly.startsWith("thumbs/") || pathOnly.startsWith("thumbnails/") || pathOnly.startsWith("uploads/")) {
        return normalizeObjectKeyForDb(decodeURIComponent(pathOnly));
    }

    return normalizeObjectKeyForDb(decodeURIComponent(pathOnly));
}

function buildLegacyReadableUrls(args: {
    candidate: string | null | undefined;
    filename?: string | null;
    bucket?: string | null;
    providerConfigId?: string | null;
}): { objectPath: string | null; originalUrl: string | null; downloadUrl: string | null } {
    const raw = (args.candidate ?? "").toString().trim();
    if (!raw) {
        return { objectPath: null, originalUrl: null, downloadUrl: null };
    }

    if (/^https?:\/\//i.test(raw)) {
        const objectPath = extractLegacyObjectPath(raw);
        if (objectPath) {
            return {
                objectPath,
                originalUrl: objectsProxyUrl(objectPath, { bucket: args.bucket ?? null, providerConfigId: args.providerConfigId ?? null }),
                downloadUrl: objectsProxyUrl(objectPath, {
                    download: true,
                    filename: args.filename ?? undefined,
                    bucket: args.bucket ?? null,
                    providerConfigId: args.providerConfigId ?? null,
                }),
            };
        }

        return {
            objectPath: null,
            originalUrl: raw,
            downloadUrl: raw,
        };
    }

    const objectPath = extractLegacyObjectPath(raw);
    if (!objectPath) {
        return { objectPath: null, originalUrl: null, downloadUrl: null };
    }

    return {
        objectPath,
        originalUrl: objectsProxyUrl(objectPath, { bucket: args.bucket ?? null, providerConfigId: args.providerConfigId ?? null }),
        downloadUrl: objectsProxyUrl(objectPath, {
            download: true,
            filename: args.filename ?? undefined,
            bucket: args.bucket ?? null,
            providerConfigId: args.providerConfigId ?? null,
        }),
    };
}

function buildLegacyDerivativeAccess(args: {
    derivativeCandidate: string | null | undefined;
    bucket?: string | null;
}): DerivativeFileAccessResult {
    const urls = buildLegacyReadableUrls({
        candidate: args.derivativeCandidate,
        bucket: args.bucket ?? null,
    });

    if (!urls.originalUrl) {
        return {
            objectPath: null,
            url: null,
            availabilityStatus: "missing",
        };
    }

    return {
        objectPath: urls.objectPath,
        url: urls.originalUrl,
        availabilityStatus: "available",
    };
}

export async function resolveOriginalFileAccess(
    attachment: {
        id?: string | null;
        fileRecordId?: string | null;
        fileName?: string | null;
        originalFilename?: string | null;
        mimeType?: string | null;
        fileUrl?: string | null;
        fileKey?: string | null;
        bucket?: string | null;
        providerConfigId?: string | null;
    },
    options?: {
        logOnce?: (key: string, ...args: any[]) => void;
    }
): Promise<OriginalFileAccessResult> {
    const displayFilename = String(attachment.originalFilename || attachment.fileName || `attachment-${attachment.id || "unknown"}`);
    const fallbackMimeType = attachment.mimeType ?? null;
    const logOnce = options?.logOnce;
    const legacyOriginal = buildLegacyReadableUrls({
        candidate: attachment.fileUrl ?? attachment.fileKey ?? null,
        filename: displayFilename,
        bucket: attachment.bucket ?? null,
        providerConfigId: attachment.providerConfigId ?? null,
    });

    if (!attachment.fileRecordId) {
        if (legacyOriginal.originalUrl) {
            logOnce?.(
                `canonical-missing-legacy:${attachment.id ?? displayFilename}`,
                "[CanonicalOriginalRead] Missing fileRecordId; falling back to legacy file location",
                { attachmentId: attachment.id ?? null, displayFilename, objectPath: legacyOriginal.objectPath }
            );

            return {
                displayFilename,
                mimeType: fallbackMimeType,
                objectPath: legacyOriginal.objectPath,
                originalUrl: legacyOriginal.originalUrl,
                downloadUrl: legacyOriginal.downloadUrl,
                availabilityStatus: "available",
            };
        }

        logOnce?.(
            `canonical-missing:${attachment.id ?? displayFilename}`,
            "[CanonicalOriginalRead] Missing fileRecordId; original file read unavailable",
            { attachmentId: attachment.id ?? null, displayFilename }
        );

        return {
            displayFilename,
            mimeType: fallbackMimeType,
            objectPath: null,
            originalUrl: null,
            downloadUrl: null,
            availabilityStatus: "missing",
        };
    }

    const resolved = await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId));
    const objectPath = resolved.objectKey ?? resolved.localPathRef ?? null;
    const availabilityStatus = resolved.status;
    const canonicalDisplayName = resolved.displayFilename ?? displayFilename;
    const canonicalMimeType = resolved.mimeType ?? fallbackMimeType;

    if (availabilityStatus !== "available" || !objectPath) {
        if (legacyOriginal.originalUrl) {
            logOnce?.(
                `canonical-fallback:${attachment.fileRecordId}`,
                "[CanonicalOriginalRead] Canonical original unavailable; falling back to legacy file location",
                {
                    attachmentId: attachment.id ?? null,
                    fileRecordId: attachment.fileRecordId,
                    availabilityStatus,
                    fallbackObjectPath: legacyOriginal.objectPath,
                }
            );

            return {
                displayFilename: canonicalDisplayName,
                mimeType: canonicalMimeType,
                objectPath: legacyOriginal.objectPath,
                originalUrl: legacyOriginal.originalUrl,
                downloadUrl: legacyOriginal.downloadUrl,
                availabilityStatus: "available",
            };
        }

        logOnce?.(
            `canonical-unavailable:${attachment.fileRecordId}`,
            "[CanonicalOriginalRead] Canonical original unavailable",
            {
                attachmentId: attachment.id ?? null,
                fileRecordId: attachment.fileRecordId,
                availabilityStatus,
                objectPath,
            }
        );

        return {
            displayFilename: canonicalDisplayName,
            mimeType: canonicalMimeType,
            objectPath: null,
            originalUrl: null,
            downloadUrl: null,
            availabilityStatus,
        };
    }

    return {
        displayFilename: canonicalDisplayName,
        mimeType: canonicalMimeType,
        objectPath,
        originalUrl: objectsProxyUrl(objectPath, { bucket: resolved.bucket ?? null, providerConfigId: resolved.providerConfigId }),
        downloadUrl: objectsProxyUrl(objectPath, {
            download: true,
            filename: canonicalDisplayName,
            bucket: resolved.bucket ?? null,
            providerConfigId: resolved.providerConfigId,
        }),
        availabilityStatus,
    };
}

export async function resolveDerivativeFileAccess(
    attachment: {
        id?: string | null;
        fileRecordId?: string | null;
        thumbKey?: string | null;
        previewKey?: string | null;
        thumbUrl?: string | null;
        previewUrl?: string | null;
        thumbnailUrl?: string | null;
        previewThumbnailUrl?: string | null;
        bucket?: string | null;
    },
    derivativeType: "thumbnail" | "preview",
    options?: {
        logOnce?: (key: string, ...args: any[]) => void;
    }
): Promise<DerivativeFileAccessResult> {
    const logOnce = options?.logOnce;
    const legacyDerivative = buildLegacyDerivativeAccess({
        derivativeCandidate:
            derivativeType === "thumbnail"
                ? (attachment.thumbUrl ?? attachment.thumbnailUrl ?? attachment.thumbKey ?? null)
                : (attachment.previewUrl ?? attachment.previewThumbnailUrl ?? attachment.previewKey ?? null),
        bucket: attachment.bucket ?? null,
    });

    if (!attachment.fileRecordId) {
        if (legacyDerivative.url) {
            logOnce?.(
                `canonical-derivative-missing-legacy:${derivativeType}:${attachment.id ?? "unknown"}`,
                `[CanonicalDerivativeRead] Missing fileRecordId; falling back to legacy ${derivativeType} location`,
                { attachmentId: attachment.id ?? null, derivativeType, objectPath: legacyDerivative.objectPath }
            );

            return legacyDerivative;
        }

        logOnce?.(
            `canonical-derivative-missing:${derivativeType}:${attachment.id ?? "unknown"}`,
            `[CanonicalDerivativeRead] Missing fileRecordId; ${derivativeType} read unavailable`,
            { attachmentId: attachment.id ?? null, derivativeType }
        );

        return {
            objectPath: null,
            url: null,
            availabilityStatus: "missing",
        };
    }

    const resolved = await canonicalDerivativeReadResolver.resolveDerivative(String(attachment.fileRecordId), derivativeType);
    const objectPath = resolved.objectKey ?? null;

    if (resolved.status !== "available" || !objectPath) {
        if (legacyDerivative.url) {
            logOnce?.(
                `canonical-derivative-fallback:${derivativeType}:${attachment.fileRecordId}`,
                `[CanonicalDerivativeRead] Canonical ${derivativeType} unavailable; falling back to legacy location`,
                {
                    attachmentId: attachment.id ?? null,
                    fileRecordId: attachment.fileRecordId,
                    derivativeType,
                    availabilityStatus: resolved.status,
                    fallbackObjectPath: legacyDerivative.objectPath,
                }
            );

            return legacyDerivative;
        }

        if (resolved.status === "missing") {
            logOnce?.(
                `canonical-derivative-unavailable:${derivativeType}:${attachment.fileRecordId}`,
                `[CanonicalDerivativeRead] Canonical derivative unavailable`,
                {
                    attachmentId: attachment.id ?? null,
                    fileRecordId: attachment.fileRecordId,
                    derivativeType,
                    availabilityStatus: resolved.status,
                }
            );
        }

        return {
            objectPath: null,
            url: null,
            availabilityStatus: resolved.status,
        };
    }

    return {
        objectPath,
        url: objectsProxyUrl(objectPath, { bucket: resolved.bucket ?? null }),
        availabilityStatus: resolved.status,
    };
}

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
    const originalAccess = await resolveOriginalFileAccess(attachment, { logOnce: options?.logOnce });
    let originalUrl: string | null = originalAccess.originalUrl;
    let thumbUrl: string | null = null;
    let previewUrl: string | null = null;

    let objectPath: string | null = originalAccess.objectPath;
    let downloadUrl: string | null = originalAccess.downloadUrl;

    const logOnce = options?.logOnce;

    const bucket = (options?.bucket || attachment.bucket || undefined) as string | undefined;

    // Derivative URLs (Thumbnails/Previews)
    const [thumbAccess, previewAccess] = await Promise.all([
        resolveDerivativeFileAccess(attachment, "thumbnail", { logOnce }),
        resolveDerivativeFileAccess(attachment, "preview", { logOnce }),
    ]);

    thumbUrl = thumbAccess.url;
    previewUrl = previewAccess.url;

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
                pages = await Promise.all(pageRecords.map(async (page) => {
                    const [pageThumbAccess, pagePreviewAccess] = await Promise.all([
                        resolveOriginalFileAccess({
                            id: page.id,
                            fileRecordId: page.thumbFileRecordId,
                            fileName: `${attachment.fileName || attachment.id || "attachment"}-page-${page.pageIndex + 1}.thumb.jpg`,
                            mimeType: "image/jpeg",
                        }, { logOnce }),
                        resolveOriginalFileAccess({
                            id: page.id,
                            fileRecordId: page.previewFileRecordId,
                            fileName: `${attachment.fileName || attachment.id || "attachment"}-page-${page.pageIndex + 1}.preview.jpg`,
                            mimeType: "image/jpeg",
                        }, { logOnce }),
                    ]);

                    return {
                        ...page,
                        thumbUrl: pageThumbAccess.originalUrl,
                        previewUrl: pagePreviewAccess.originalUrl,
                    };
                }));
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
        availabilityStatus: originalAccess.availabilityStatus,
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
