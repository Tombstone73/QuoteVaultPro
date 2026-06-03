type UploadPurpose = "quote-attachment" | "order-attachment";

type ChunkedUploadArgs = {
  file: File;
  purpose: UploadPurpose;
  parentId: string;
  linkUrl: string;
  linkBody?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
};

export type ChunkedUploadResult = {
  uploadId: string;
  finalizedFileId: string;
  linkResponse: any;
};

type UploadChunksArgs = {
  file: File;
  purpose: UploadPurpose;
  parentId?: string | null;
  temporaryOrderAttachment?: boolean;
  onProgress?: (percent: number) => void;
};

async function uploadChunks(args: UploadChunksArgs): Promise<{ uploadId: string; fileId: string }> {
  const initPayload = {
    filename: args.file.name,
    mimeType: args.file.type || "application/octet-stream",
    size: args.file.size,
    purpose: args.purpose,
    quoteId: args.purpose === "quote-attachment" ? args.parentId : undefined,
    orderId: args.purpose === "order-attachment" ? args.parentId : undefined,
    temporary: args.temporaryOrderAttachment === true ? true : undefined,
  };

  const initResp = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(initPayload),
  });

  if (!initResp.ok) {
    const json = await initResp.json().catch(() => ({}));
    throw new Error(json.error || "Failed to initialize upload");
  }

  const initJson = await initResp.json().catch(() => ({}));
  const { uploadId, chunkSizeBytes, totalChunks } = initJson.data || {};
  if (!uploadId || !chunkSizeBytes || !totalChunks) {
    throw new Error("Invalid init response");
  }

  let uploadedBytes = 0;
  const concurrency = 3;
  let nextChunkIndex = 0;

  const uploadChunk = async (chunkIndex: number) => {
    const start = chunkIndex * chunkSizeBytes;
    const end = Math.min(args.file.size, start + chunkSizeBytes);
    const blob = args.file.slice(start, end);

    const resp = await fetch(`/api/uploads/${uploadId}/chunks/${chunkIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      credentials: "include",
      body: blob,
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json.error || `Failed to upload chunk ${chunkIndex}`);
    }

    uploadedBytes += blob.size;
    const percent = Math.min(99, Math.floor((uploadedBytes / args.file.size) * 100));
    args.onProgress?.(percent);
  };

  const workers = Array.from({ length: Math.min(concurrency, totalChunks) }, () =>
    (async () => {
      while (true) {
        const idx = nextChunkIndex;
        nextChunkIndex += 1;
        if (idx >= totalChunks) return;
        await uploadChunk(idx);
      }
    })(),
  );

  await Promise.all(workers);

  const finalizeResp = await fetch(`/api/uploads/${uploadId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(
      args.purpose === "quote-attachment"
        ? { quoteId: args.parentId, totalChunks }
        : args.temporaryOrderAttachment
          ? { temporary: true, totalChunks }
          : { orderId: args.parentId, totalChunks },
    ),
  });

  if (!finalizeResp.ok) {
    const json = await finalizeResp.json().catch(() => ({}));
    throw new Error(json.error || "Failed to finalize upload");
  }

  const finalizeJson = await finalizeResp.json().catch(() => ({}));
  const { fileId } = finalizeJson.data || {};
  if (!fileId) {
    throw new Error("Finalize did not return fileId");
  }

  return { uploadId, fileId };
}

export async function uploadAttachmentViaChunked(args: ChunkedUploadArgs): Promise<ChunkedUploadResult> {
  const { uploadId, fileId } = await uploadChunks(args);

  const linkResp = await fetch(args.linkUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...(args.linkBody || {}), uploadId: fileId }),
  });

  if (!linkResp.ok) {
    const json = await linkResp.json().catch(() => ({}));
    throw new Error(json.error || "Failed to link attachment");
  }

  const linkResponse = await linkResp.json().catch(() => ({}));
  args.onProgress?.(100);

  return {
    uploadId,
    finalizedFileId: fileId,
    linkResponse,
  };
}

export type TemporaryOrderAttachmentUpload = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export async function uploadTemporaryOrderAttachmentViaChunked(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<TemporaryOrderAttachmentUpload> {
  const { fileId } = await uploadChunks({
    file,
    purpose: "order-attachment",
    temporaryOrderAttachment: true,
    onProgress,
  });

  onProgress?.(100);

  return {
    uploadId: fileId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}
