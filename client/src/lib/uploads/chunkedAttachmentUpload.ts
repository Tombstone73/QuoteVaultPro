type UploadPurpose = "quote-attachment" | "order-attachment";

type ChunkedUploadArgs = {
  file: File;
  purpose: UploadPurpose;
  parentId: string;
  linkUrl: string;
  linkBody?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
};

export async function uploadAttachmentViaChunked(args: ChunkedUploadArgs): Promise<void> {
  const initPayload = {
    filename: args.file.name,
    mimeType: args.file.type || "application/octet-stream",
    size: args.file.size,
    purpose: args.purpose,
    quoteId: args.purpose === "quote-attachment" ? args.parentId : undefined,
    orderId: args.purpose === "order-attachment" ? args.parentId : undefined,
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

  args.onProgress?.(100);
}
