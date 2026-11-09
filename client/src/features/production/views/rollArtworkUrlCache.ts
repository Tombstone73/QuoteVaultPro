import { getArtworkObjectUrl, type ArtworkAccessVariant } from "@/lib/artworkAccess";

/** Keeps only artwork already viewed on this mounted Roll Board. */
export class RollArtworkUrlCache {
  private urls = new Map<string, Promise<string>>();

  get(fileRecordId: string, variant: Exclude<ArtworkAccessVariant, "original">): Promise<string> {
    const key = `${variant}:${fileRecordId}`;
    let pending = this.urls.get(key);
    if (!pending) {
      pending = getArtworkObjectUrl(fileRecordId, variant).catch((error) => {
        if (this.urls.get(key) === pending) this.urls.delete(key);
        throw error;
      });
      this.urls.set(key, pending);
    }
    return pending;
  }

  dispose(): void {
    for (const pending of Array.from(this.urls.values())) {
      void pending.then((url) => URL.revokeObjectURL(url), () => undefined);
    }
    this.urls.clear();
  }
}
