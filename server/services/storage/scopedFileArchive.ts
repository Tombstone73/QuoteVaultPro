import fs from "node:fs";
import { Readable } from "node:stream";
import type { Response } from "express";
import { canonicalFileReadResolver } from "./CanonicalFileReadResolver";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storageRegistry } from "./StorageRegistry";
import { writeScopedZip, type ArchiveFile } from "./scopedFileArchiveWriter";

/** Membership is selected by the caller's authorized scope, never by client-supplied file IDs. */
export async function sendScopedFileArchive(args: {
  organizationId: string;
  files: ArchiveFile[];
  downloadName: string;
  res: Response;
}): Promise<void> {
  const { organizationId, files, res } = args;
  if (!files.length) {
    res.status(404).json({ error: "No files available for download" });
    return;
  }

  const sources: Readable[] = [];
  const localPaths: Array<string | null> = [];
  try {
    // Resolve and open every object before sending ZIP headers. A missing object
    // fails the whole download instead of producing an incomplete successful ZIP.
    for (const file of files) {
      const record = await fileRecordRepository.getByIdForOrganization(organizationId, file.fileRecordId);
      if (!record) throw new Error("A file is unavailable in storage");
      const resolved = await canonicalFileReadResolver.resolveOriginal(file.fileRecordId);
      if (resolved.status !== "available" || !resolved.providerConfigId) throw new Error("A file is unavailable in storage");
      const config = await storageProviderConfigRepository.getById(resolved.providerConfigId);
      if (!config) throw new Error("A file is unavailable in storage");
      const handle = await storageRegistry.getAdapter(config.providerType).getDownloadHandle({
        providerConfig: config,
        objectKey: resolved.objectKey,
        localPathRef: resolved.localPathRef,
      });
      if (handle.kind === "local_path") {
        await fs.promises.access(handle.value, fs.constants.R_OK);
        localPaths.push(handle.value);
      } else {
        const upstream = await fetch(handle.value);
        if (!upstream.ok || !upstream.body) throw new Error("A file is unavailable in storage");
        const source = Readable.fromWeb(upstream.body as any);
        source.on("error", () => { /* The ZIP writer also observes errors after preflight. */ });
        sources.push(source);
        localPaths.push(null);
      }
    }
  } catch (error) {
    sources.forEach((source) => source.destroy());
    if (!res.headersSent) res.status(503).json({ error: "A file is unavailable in storage; no ZIP was downloaded" });
    return;
  }

  let remoteIndex = 0;
  const orderedSources = localPaths.map((path) => path ? fs.createReadStream(path) : sources[remoteIndex++]);
  if (orderedSources.some((source) => source.destroyed)) {
    orderedSources.forEach((source) => source.destroy());
    res.status(503).json({ error: "A file is unavailable in storage; no ZIP was downloaded" });
    return;
  }
  await writeScopedZip(files, orderedSources, args.downloadName, res);
}
