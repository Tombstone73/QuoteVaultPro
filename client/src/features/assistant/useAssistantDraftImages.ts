import * as React from "react";
import { apiUrl, resolveCanonicalApiRequestUrl } from "@/lib/apiConfig";
import type { AssistantImageAttachment } from "@shared/assistantContracts";

export const ASSISTANT_IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif";
export const ASSISTANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ASSISTANT_IMAGE_MAX_COUNT = 4;

export type AssistantDraftImage = {
  key: string;
  file: File;
  previewUrl: string;
  conversationId: string | null;
  attachment: AssistantImageAttachment | null;
  state: "uploading" | "ready" | "failed";
  progress: number;
  error: string | null;
};

export function assistantImageUrl(conversationId: string, id: string) {
  return apiUrl("/api/assistant/conversations/" + encodeURIComponent(conversationId) + "/images/" + encodeURIComponent(id));
}

export function useAssistantDraftImages(ensureConversation: () => Promise<string>) {
  const [images, setImages] = React.useState<AssistantDraftImage[]>([]);
  const imagesRef = React.useRef(images);
  const uploadRequests = React.useRef(new Map<string, XMLHttpRequest>());
  const change = React.useCallback((update: (rows: AssistantDraftImage[]) => AssistantDraftImage[]) => {
    const next = update(imagesRef.current);
    imagesRef.current = next;
    setImages(next);
  }, []);
  const update = React.useCallback((key: string, patch: Partial<AssistantDraftImage>) =>
    change(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row)), [change]);

  const uploadOne = React.useCallback(async (key: string) => {
    const row = imagesRef.current.find(item => item.key === key);
    if (!row) return;
    update(key, { state: "uploading", progress: 0, error: null });
    try {
      const conversationId = await ensureConversation();
      if (!imagesRef.current.some(item => item.key === key)) return;
      const body = new FormData();
      body.append("image", row.file, row.file.name);
      const attachment = await new Promise<AssistantImageAttachment>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRequests.current.set(key, xhr);
        xhr.open("POST", resolveCanonicalApiRequestUrl("/api/assistant/conversations/" + encodeURIComponent(conversationId) + "/images"));
        xhr.withCredentials = true;
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) update(key, { progress: Math.round(event.loaded / event.total * 100) });
        };
        xhr.onload = () => {
          let payload: { data?: AssistantImageAttachment; error?: { message?: string } } = {};
          try { payload = JSON.parse(xhr.responseText); } catch { /* safe fallback below */ }
          if (xhr.status >= 200 && xhr.status < 300 && payload.data) resolve(payload.data);
          else reject(new Error(payload.error?.message || "Image upload failed. Retry."));
        };
        xhr.onerror = () => reject(new Error("Image upload failed. Check the connection and retry."));
        xhr.onabort = () => reject(new Error("Image upload was interrupted. Retry."));
        xhr.send(body);
      });
      uploadRequests.current.delete(key);
      if (!imagesRef.current.some(item => item.key === key)) {
        void fetch(assistantImageUrl(conversationId, attachment.id), { method: "DELETE", credentials: "include" }).catch(() => undefined);
        return;
      }
      update(key, { state: "ready", progress: 100, attachment, conversationId });
    } catch (error) {
      uploadRequests.current.delete(key);
      update(key, { state: "failed", error: error instanceof Error ? error.message : "Image upload failed. Retry." });
    }
  }, [ensureConversation, update]);

  const add = React.useCallback((files: FileList | readonly File[]) => {
    const candidates = Array.from(files);
    const available = Math.max(0, ASSISTANT_IMAGE_MAX_COUNT - imagesRef.current.length);
    const accepted = candidates.slice(0, available);
    const added = accepted.map(file => ({
      key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), conversationId: null,
      attachment: null, state: "uploading" as const, progress: 0, error: null,
    }));
    change(rows => [...rows, ...added]);
    for (const item of added) {
      if (!item.file.size || item.file.size > ASSISTANT_IMAGE_MAX_BYTES) {
        update(item.key, { state: "failed", error: "Choose an image up to 5 MB." });
      } else {
        void uploadOne(item.key);
      }
    }
    return candidates.length > available ? "Attach at most four images per message." : null;
  }, [change, update, uploadOne]);

  const remove = React.useCallback(async (key: string) => {
    const row = imagesRef.current.find(item => item.key === key);
    if (!row) return;
    if (row.state === "uploading") uploadRequests.current.get(key)?.abort();
    if (row.attachment && row.conversationId) {
      try {
        const response = await fetch(assistantImageUrl(row.conversationId, row.attachment.id), {
          method: "DELETE", credentials: "include",
        });
        if (!response.ok) throw new Error("Could not remove the image. Retry.");
      } catch (error) {
        update(key, { error: error instanceof Error ? error.message : "Could not remove the image." });
        return;
      }
    }
    URL.revokeObjectURL(row.previewUrl);
    change(rows => rows.filter(item => item.key !== key));
  }, [change, update]);

  const clear = React.useCallback(() => {
    for (const row of imagesRef.current) {
      uploadRequests.current.get(row.key)?.abort();
      URL.revokeObjectURL(row.previewUrl);
    }
    change(() => []);
  }, [change]);

  React.useEffect(() => () => {
    for (const row of imagesRef.current) URL.revokeObjectURL(row.previewUrl);
    uploadRequests.current.forEach(xhr => xhr.abort());
  }, []);

  const markForResend = React.useCallback((attachmentIds: readonly string[]) => {
    change(rows => rows.map(row => row.attachment && attachmentIds.includes(row.attachment.id)
      ? { ...row, attachment: null, conversationId: null, state: "failed" as const, progress: 0,
          error: "This message was saved, but the assistant failed. Retry this image upload before sending again." }
      : row));
  }, [change]);

  return { images, add, remove, clear, retry: uploadOne, markForResend };
}
