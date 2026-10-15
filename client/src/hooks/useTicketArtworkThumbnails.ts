import { useEffect, useState } from "react";
import { getArtworkObjectUrl } from "@/lib/artworkAccess";

export type TicketThumbnail = { status: "loading" | "ready" | "unavailable"; src?: string };

/** Authenticated thumbnail derivatives only. Object URLs live until the print page unmounts or retries. */
export function useTicketArtworkThumbnails(records: Array<{ id: string; fileRecordId: string | null }>, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; images: Record<string, TicketThumbnail> }>({ key: "", images: {} });
  const key = records.map(record => `${record.id}:${record.fileRecordId ?? ""}`).join("|");
  const images = snapshot.key === key && enabled ? snapshot.images : {};

  useEffect(() => {
    if (!enabled) { setSnapshot({ key, images: {} }); return; }
    let active = true;
    const objectUrls: string[] = [];
    setSnapshot({ key, images: Object.fromEntries(records.map(record => [record.id, { status: record.fileRecordId ? "loading" : "unavailable" }])) });
    for (const record of records) {
      if (!record.fileRecordId) continue;
      void getArtworkObjectUrl(record.fileRecordId, "thumbnail").then(async src => {
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
    return () => { active = false; objectUrls.forEach(url => URL.revokeObjectURL(url)); };
  // Stable record identities are sufficient; the caller may rebuild array objects on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt]);

  return {
    images,
    loading: enabled && records.some(record => images[record.id]?.status !== "ready" && images[record.id]?.status !== "unavailable"),
    unavailable: enabled && records.some(record => images[record.id]?.status === "unavailable"),
    retry: () => setAttempt(value => value + 1),
  };
}
