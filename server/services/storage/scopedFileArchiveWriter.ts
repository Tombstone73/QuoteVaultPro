import archiver from "archiver";
import { Readable } from "node:stream";
import type { Response } from "express";

export type ArchiveFile = { fileRecordId: string; filename: string };

export function archiveEntryNames(files: ArchiveFile[]): string[] {
  const used = new Set<string>();
  return files.map(({ filename }) => {
    const basename = String(filename || "file").replace(/\\/g, "/").split("/").pop() || "file";
    const normalized = basename.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^\.+/, "").trim().replace(/[. ]+$/, "") || "file";
    const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized) ? `_${normalized}` : normalized;
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : "";
    let candidate = safe;
    for (let index = 2; used.has(candidate.toLowerCase()); index++) candidate = `${stem} (${index})${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Stream already-authorized and preflighted sources to the response. */
export async function writeScopedZip(files: ArchiveFile[], sources: Readable[], downloadName: string, res: Response): Promise<void> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const fail = (error: Error) => {
    console.error("[ScopedFileArchive] ZIP stream failed", error);
    sources.forEach((source) => source.destroy());
    archive.abort();
    if (!res.destroyed) res.destroy(error);
  };
  archive.on("error", fail);
  sources.forEach((source) => source.on("error", fail));
  res.on("close", () => { if (!res.writableFinished) { sources.forEach((source) => source.destroy()); archive.abort(); } });
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    "Cache-Control": "private, no-store",
  });
  archive.pipe(res);
  const names = archiveEntryNames(files);
  sources.forEach((source, index) => archive.append(source, { name: names[index] }));
  await archive.finalize();
}
