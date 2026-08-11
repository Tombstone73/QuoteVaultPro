import { promises as fsPromises } from "fs";

import type { ProofArtifactPreviewStatus } from "@shared/proofing";
import type { FileDerivative, StorageProviderConfig } from "@shared/schema";

import { storageProviderConfigRepository } from "../storage/storageProviderConfig.repo";
import { storagePolicyResolver } from "./storage/StoragePolicyResolver";
import { canonicalDerivativeReadResolver } from "./storage/CanonicalDerivativeReadResolver";
import { canonicalFileReadResolver } from "./storage/CanonicalFileReadResolver";
import { storageRegistry } from "./storage/StorageRegistry";

export type ProofPreviewKind = "image" | "pdf" | "unavailable";

export type ProofPreviewCandidate = {
  candidateId: string;
  fileName: string;
  mimeType: string | null;
  fileRecordId: string | null;
  previewStorageKey?: string | null;
  thumbStorageKey?: string | null;
  storageProviderHint?: string | null;
  pagePreviewFileRecordId?: string | null;
  pageThumbFileRecordId?: string | null;
  allowOriginalPdf?: boolean;
  preferOriginalPdf?: boolean;
};

export type ProofPreviewResolution =
  | {
      kind: "image" | "pdf";
      sourceBuffer: Buffer;
      mimeType: string;
      filename: string;
      reason: null;
      previewStatus: "ready";
      previewError: null;
      candidateId: string;
    }
  | {
      kind: "unavailable";
      sourceBuffer: null;
      mimeType: null;
      filename: string | null;
      reason: string;
      previewStatus: Exclude<ProofArtifactPreviewStatus, "ready">;
      previewError: string | null;
      candidateId: string | null;
    };

export type ProofPreviewResolveContext = {
  organizationId: string;
  orderId: string | null;
  lineItemId: string;
};

type PreviewBufferResult = {
  buffer: Buffer | null;
  mimeType: string | null;
  providerType: string | null;
  status: "ready" | "missing" | "pending" | "failed";
  error: string | null;
};

type ProofPreviewLoader = {
  readCanonicalFileRecord: (fileRecordId: string, context: ProofPreviewResolveContext) => Promise<PreviewBufferResult>;
  readCanonicalDerivative: (
    fileRecordId: string,
    derivativeType: FileDerivative["derivativeType"],
    context: ProofPreviewResolveContext,
  ) => Promise<PreviewBufferResult>;
  readLegacyStorageKey: (
    storageKey: string,
    providerHint: string | null | undefined,
    context: ProofPreviewResolveContext,
  ) => Promise<PreviewBufferResult>;
};

const IMAGE_PREVIEW_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

function toLowerMime(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isEmbeddableImageMime(mimeType: string | null | undefined) {
  return IMAGE_PREVIEW_MIME_TYPES.has(toLowerMime(mimeType));
}

function buildPreviewError(reason: string) {
  switch (reason) {
    case "no_preview_source":
      return "No artwork attachment is available for preview generation.";
    case "missing_file_record":
      return "The selected preview source is missing its canonical file record.";
    case "preview_derivative_pending":
      return "Artwork preview generation is still pending.";
    case "no_pdf_preview_derivative":
      return "A PDF artwork preview derivative is required before this proof can include artwork.";
    case "unsupported_image_format":
      return "This artwork format is not directly embeddable in the generated proof.";
    case "storage_read_failed":
      return "The server could not read the artwork preview from storage.";
    default:
      return "Artwork preview is unavailable for the generated proof.";
  }
}

export async function readBufferFromDownloadHandle(args: {
  handle: { kind: "signed_url" | "local_path"; value: string };
  fetchImpl?: typeof fetch;
  readFileImpl?: typeof fsPromises.readFile;
}) {
  if (args.handle.kind === "local_path") {
    return args.readFileImpl ? args.readFileImpl(args.handle.value) : fsPromises.readFile(args.handle.value);
  }

  const response = await (args.fetchImpl ?? fetch)(args.handle.value);
  if (!response.ok) {
    throw new Error(`Storage download failed with ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function logStorageReadFailure(args: {
  context: ProofPreviewResolveContext;
  fileRecordId?: string | null;
  providerType?: string | null;
  stage: string;
  error: unknown;
}) {
  console.error("[ProofPreviewResolver] Failed to read preview source", {
    organizationId: args.context.organizationId,
    orderId: args.context.orderId,
    lineItemId: args.context.lineItemId,
    fileRecordId: args.fileRecordId ?? null,
    providerType: args.providerType ?? null,
    stage: args.stage,
    error: args.error instanceof Error ? args.error.message : String(args.error),
  });
}

async function readBufferWithProvider(args: {
  providerConfig: StorageProviderConfig;
  objectKey?: string | null;
  localPathRef?: string | null;
}) {
  const adapter = storageRegistry.getAdapter(args.providerConfig.providerType);
  const handle = await adapter.getDownloadHandle({
    providerConfig: args.providerConfig,
    objectKey: args.objectKey ?? null,
    localPathRef: args.localPathRef ?? null,
  });

  return readBufferFromDownloadHandle({ handle });
}

function createProductionLoader(): ProofPreviewLoader {
  return {
    async readCanonicalFileRecord(fileRecordId, context) {
      try {
        const resolved = await canonicalFileReadResolver.resolveOriginal(fileRecordId);
        if (resolved.status === "restoring") {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: resolved.providerType ?? null,
            status: "pending",
            error: buildPreviewError("preview_derivative_pending"),
          };
        }

        if (resolved.status !== "available" || !resolved.providerConfigId || (!resolved.objectKey && !resolved.localPathRef)) {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: resolved.providerType ?? null,
            status: "missing",
            error: buildPreviewError("missing_file_record"),
          };
        }

        const providerConfig = await storageProviderConfigRepository.getById(String(resolved.providerConfigId));
        if (!providerConfig) {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: resolved.providerType ?? null,
            status: "missing",
            error: buildPreviewError("missing_file_record"),
          };
        }

        const buffer = await readBufferWithProvider({
          providerConfig,
          objectKey: resolved.objectKey,
          localPathRef: resolved.localPathRef,
        });

        return {
          buffer,
          mimeType: resolved.mimeType ?? null,
          providerType: resolved.providerType ?? null,
          status: buffer.length > 0 ? "ready" : "missing",
          error: buffer.length > 0 ? null : buildPreviewError("missing_file_record"),
        };
      } catch (error) {
        logStorageReadFailure({ context, fileRecordId, providerType: null, stage: "canonical-file", error });
        return {
          buffer: null,
          mimeType: null,
          providerType: null,
          status: "failed",
          error: buildPreviewError("storage_read_failed"),
        };
      }
    },

    async readCanonicalDerivative(fileRecordId, derivativeType, context) {
      try {
        const resolved = await canonicalDerivativeReadResolver.resolveDerivative(fileRecordId, derivativeType);
        if (resolved.status === "pending") {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: null,
            status: "pending",
            error: buildPreviewError("preview_derivative_pending"),
          };
        }

        if (resolved.status !== "available" || !resolved.providerConfigId || !resolved.objectKey) {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: null,
            status: "missing",
            error: buildPreviewError("no_pdf_preview_derivative"),
          };
        }

        const providerConfig = await storageProviderConfigRepository.getById(String(resolved.providerConfigId));
        if (!providerConfig) {
          return {
            buffer: null,
            mimeType: resolved.mimeType ?? null,
            providerType: null,
            status: "missing",
            error: buildPreviewError("missing_file_record"),
          };
        }

        const buffer = await readBufferWithProvider({
          providerConfig,
          objectKey: resolved.objectKey,
          localPathRef: null,
        });

        return {
          buffer,
          mimeType: resolved.mimeType ?? null,
          providerType: providerConfig.providerType,
          status: buffer.length > 0 ? "ready" : "missing",
          error: buffer.length > 0 ? null : buildPreviewError("no_pdf_preview_derivative"),
        };
      } catch (error) {
        logStorageReadFailure({ context, fileRecordId, providerType: null, stage: `canonical-derivative:${derivativeType}`, error });
        return {
          buffer: null,
          mimeType: null,
          providerType: null,
          status: "failed",
          error: buildPreviewError("storage_read_failed"),
        };
      }
    },

    async readLegacyStorageKey(storageKey, providerHint, context) {
      try {
        const policy = await storagePolicyResolver.resolve(context.organizationId);
        const providerConfig = storagePolicyResolver.resolveCanonicalStorageBehavior(policy);
        const normalizedKey = String(storageKey || "").trim().replace(/^\/objects\//, "").replace(/^\/+/, "");
        if (!normalizedKey) {
          return {
            buffer: null,
            mimeType: null,
            providerType: providerConfig.providerType,
            status: "missing",
            error: buildPreviewError("missing_file_record"),
          };
        }

        const normalizedHint = String(providerHint || "").trim().toLowerCase();
        const useLocalPath = normalizedHint === "local" || normalizedHint === "local_filesystem";
        const buffer = await readBufferWithProvider({
          providerConfig,
          objectKey: useLocalPath ? null : normalizedKey,
          localPathRef: useLocalPath ? normalizedKey : null,
        });

        return {
          buffer,
          mimeType: null,
          providerType: providerConfig.providerType,
          status: buffer.length > 0 ? "ready" : "missing",
          error: buffer.length > 0 ? null : buildPreviewError("missing_file_record"),
        };
      } catch (error) {
        logStorageReadFailure({ context, fileRecordId: null, providerType: null, stage: "legacy-storage-key", error });
        return {
          buffer: null,
          mimeType: null,
          providerType: null,
          status: "failed",
          error: buildPreviewError("storage_read_failed"),
        };
      }
    },
  };
}

async function resolveCandidatePreview(args: {
  candidate: ProofPreviewCandidate;
  context: ProofPreviewResolveContext;
  loader: ProofPreviewLoader;
}): Promise<ProofPreviewResolution> {
  const { candidate, context, loader } = args;
  const normalizedMime = toLowerMime(candidate.mimeType);

  if (candidate.pagePreviewFileRecordId) {
    const result = await loader.readCanonicalFileRecord(candidate.pagePreviewFileRecordId, context);
    if (result.status === "ready" && result.buffer) {
      return {
        kind: "image",
        sourceBuffer: result.buffer,
        mimeType: result.mimeType || "image/jpeg",
        filename: candidate.fileName,
        reason: null,
        previewStatus: "ready",
        previewError: null,
        candidateId: candidate.candidateId,
      };
    }
    if (result.status === "failed") {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "storage_read_failed",
        previewStatus: "generation_failed",
        previewError: result.error,
        candidateId: candidate.candidateId,
      };
    }
  }

  if (candidate.pageThumbFileRecordId) {
    const result = await loader.readCanonicalFileRecord(candidate.pageThumbFileRecordId, context);
    if (result.status === "ready" && result.buffer) {
      return {
        kind: "image",
        sourceBuffer: result.buffer,
        mimeType: result.mimeType || "image/jpeg",
        filename: candidate.fileName,
        reason: null,
        previewStatus: "ready",
        previewError: null,
        candidateId: candidate.candidateId,
      };
    }
    if (result.status === "failed") {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "storage_read_failed",
        previewStatus: "generation_failed",
        previewError: result.error,
        candidateId: candidate.candidateId,
      };
    }
  }

  if (candidate.fileRecordId) {
    if (normalizedMime === "application/pdf" && candidate.allowOriginalPdf && candidate.preferOriginalPdf) {
      const original = await loader.readCanonicalFileRecord(candidate.fileRecordId, context);
      if (original.status === "ready" && original.buffer) {
        return {
          kind: "pdf",
          sourceBuffer: original.buffer,
          mimeType: "application/pdf",
          filename: candidate.fileName,
          reason: null,
          previewStatus: "ready",
          previewError: null,
          candidateId: candidate.candidateId,
        };
      }
      if (original.status === "failed") {
        return {
          kind: "unavailable",
          sourceBuffer: null,
          mimeType: null,
          filename: candidate.fileName,
          reason: "storage_read_failed",
          previewStatus: "generation_failed",
          previewError: original.error,
          candidateId: candidate.candidateId,
        };
      }
    }

    const previewDerivative = await loader.readCanonicalDerivative(candidate.fileRecordId, "preview", context);
    if (previewDerivative.status === "ready" && previewDerivative.buffer) {
      return {
        kind: "image",
        sourceBuffer: previewDerivative.buffer,
        mimeType: previewDerivative.mimeType || "image/jpeg",
        filename: candidate.fileName,
        reason: null,
        previewStatus: "ready",
        previewError: null,
        candidateId: candidate.candidateId,
      };
    }
    if (previewDerivative.status === "failed") {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "storage_read_failed",
        previewStatus: "generation_failed",
        previewError: previewDerivative.error,
        candidateId: candidate.candidateId,
      };
    }

    const thumbDerivative = await loader.readCanonicalDerivative(candidate.fileRecordId, "thumbnail", context);
    if (thumbDerivative.status === "ready" && thumbDerivative.buffer) {
      return {
        kind: "image",
        sourceBuffer: thumbDerivative.buffer,
        mimeType: thumbDerivative.mimeType || "image/jpeg",
        filename: candidate.fileName,
        reason: null,
        previewStatus: "ready",
        previewError: null,
        candidateId: candidate.candidateId,
      };
    }
    if (thumbDerivative.status === "failed") {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "storage_read_failed",
        previewStatus: "generation_failed",
        previewError: thumbDerivative.error,
        candidateId: candidate.candidateId,
      };
    }

    if (isEmbeddableImageMime(normalizedMime)) {
      const original = await loader.readCanonicalFileRecord(candidate.fileRecordId, context);
      if (original.status === "ready" && original.buffer) {
        return {
          kind: "image",
          sourceBuffer: original.buffer,
          mimeType: normalizedMime,
          filename: candidate.fileName,
          reason: null,
          previewStatus: "ready",
          previewError: null,
          candidateId: candidate.candidateId,
        };
      }
      if (original.status === "failed") {
        return {
          kind: "unavailable",
          sourceBuffer: null,
          mimeType: null,
          filename: candidate.fileName,
          reason: "storage_read_failed",
          previewStatus: "generation_failed",
          previewError: original.error,
          candidateId: candidate.candidateId,
        };
      }
    }

    if (normalizedMime === "application/pdf") {
      if (!candidate.allowOriginalPdf) {
        return {
          kind: "unavailable",
          sourceBuffer: null,
          mimeType: null,
          filename: candidate.fileName,
          reason: "no_pdf_preview_derivative",
          previewStatus: "missing_preview",
          previewError: buildPreviewError("no_pdf_preview_derivative"),
          candidateId: candidate.candidateId,
        };
      }

      const original = await loader.readCanonicalFileRecord(candidate.fileRecordId, context);
      if (original.status === "ready" && original.buffer) {
        return {
          kind: "pdf",
          sourceBuffer: original.buffer,
          mimeType: "application/pdf",
          filename: candidate.fileName,
          reason: null,
          previewStatus: "ready",
          previewError: null,
          candidateId: candidate.candidateId,
        };
      }
      if (original.status === "failed") {
        return {
          kind: "unavailable",
          sourceBuffer: null,
          mimeType: null,
          filename: candidate.fileName,
          reason: "storage_read_failed",
          previewStatus: "generation_failed",
          previewError: original.error,
          candidateId: candidate.candidateId,
        };
      }
    }

    if (normalizedMime.startsWith("image/")) {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "unsupported_image_format",
        previewStatus: "missing_preview",
        previewError: buildPreviewError("unsupported_image_format"),
        candidateId: candidate.candidateId,
      };
    }
  }

  const legacyPreviewKey = candidate.previewStorageKey || candidate.thumbStorageKey || null;
  if (legacyPreviewKey) {
    const legacyPreview = await loader.readLegacyStorageKey(legacyPreviewKey, candidate.storageProviderHint, context);
    if (legacyPreview.status === "ready" && legacyPreview.buffer) {
      return {
        kind: "image",
        sourceBuffer: legacyPreview.buffer,
        mimeType: legacyPreview.mimeType || "image/jpeg",
        filename: candidate.fileName,
        reason: null,
        previewStatus: "ready",
        previewError: null,
        candidateId: candidate.candidateId,
      };
    }
    if (legacyPreview.status === "failed") {
      return {
        kind: "unavailable",
        sourceBuffer: null,
        mimeType: null,
        filename: candidate.fileName,
        reason: "storage_read_failed",
        previewStatus: "generation_failed",
        previewError: legacyPreview.error,
        candidateId: candidate.candidateId,
      };
    }
  }

  return {
    kind: "unavailable",
    sourceBuffer: null,
    mimeType: null,
    filename: candidate.fileName,
    reason: candidate.fileRecordId ? "missing_file_record" : "no_preview_source",
    previewStatus: "missing_preview",
    previewError: buildPreviewError(candidate.fileRecordId ? "missing_file_record" : "no_preview_source"),
    candidateId: candidate.candidateId,
  };
}

export async function resolveProofPreviewSource(args: {
  context: ProofPreviewResolveContext;
  candidates: ProofPreviewCandidate[];
  loader?: ProofPreviewLoader;
}): Promise<ProofPreviewResolution> {
  const loader = args.loader ?? createProductionLoader();
  let firstUnavailable: ProofPreviewResolution | null = null;
  let firstFailure: ProofPreviewResolution | null = null;

  for (const candidate of args.candidates) {
    const resolved = await resolveCandidatePreview({ candidate, context: args.context, loader });
    if (resolved.kind !== "unavailable") {
      return resolved;
    }

    if (resolved.previewStatus === "generation_failed" && !firstFailure) {
      firstFailure = resolved;
    }

    if (!firstUnavailable) {
      firstUnavailable = resolved;
    }
  }

  return firstFailure ?? firstUnavailable ?? {
    kind: "unavailable",
    sourceBuffer: null,
    mimeType: null,
    filename: null,
    reason: "no_preview_source",
    previewStatus: "missing_preview",
    previewError: buildPreviewError("no_preview_source"),
    candidateId: null,
  };
}
