import { useEffect, useState } from "react";
import { getArtworkObjectUrl } from "@/lib/artworkAccess";
import { apiFetch } from "@/lib/queryClient";

export type TicketThumbnail = { status: "loading" | "ready" | "unavailable"; src?: string };

/** Authenticated thumbnail derivatives only. Object URLs live until the print page unmounts or retries. */
export function useTicketArtworkThumbnails(records: Array<{ id: string; fileRecordId: string | null }>, enabled: boolean, directPrintJobId?: string) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; images: Record<string, TicketThumbnail> }>({ key: "", images: {} });
  const key = `${directPrintJobId ?? ""}:${records.map(record => `${record.id}:${record.fileRecordId ?? ""}`).join("|")}`;
  const images = snapshot.key === key && enabled ? snapshot.images : {};

  useEffect(() => {
    if (!enabled) { setSnapshot({ key, images: {} }); return; }
    let active = true;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    setSnapshot({ key, images: Object.fromEntries(records.map(record => [record.id, { status: record.fileRecordId ? "loading" : "unavailable" }])) });
    for (const record of records) {
      if (!record.fileRecordId) continue;
      const read = directPrintJobId
        ? apiFetch(`/api/local-bridge/direct-print/jobs/${encodeURIComponent(directPrintJobId)}/item-tag/thumbnails/${encodeURIComponent(record.id)}`, { signal: controller.signal })
          .then(async response => {
            if (!response.ok) throw new Error("Claimed thumbnail is unavailable.");
            return URL.createObjectURL(await response.blob());
          })
        : getArtworkObjectUrl(record.fileRecordId, "thumbnail");
      void read.then(async src => {
        if (!active) { URL.revokeObjectURL(src); return; }
        objectUrls.push(src);
        const image = new Image();
        image.src = src;
        await image.decode();
        if (active) setSnapshot(previous => ({ key, images: { ...previous.images, [record.id]: { status: "ready", src } } }));
      }).catch(() => {
        if (active) setSnapshot(previous => ({ key, images: { ...previous.images, [record.id]: { status: "unavailable" } } }));
      });
    }
    return () => { active = false; controller.abort(); objectUrls.forEach(url => URL.revokeObjectURL(url)); };
  // Stable record identities are sufficient; the caller may rebuild array objects on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt, directPrintJobId]);

  return {
    images,
    loading: enabled && records.some(record => images[record.id]?.status !== "ready" && images[record.id]?.status !== "unavailable"),
    unavailable: enabled && records.some(record => images[record.id]?.status === "unavailable"),
    retry: () => setAttempt(value => value + 1),
  };
}
