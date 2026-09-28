import { describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { archiveEntryNames, writeScopedZip } from "../services/storage/scopedFileArchiveWriter";

function zipEntries(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Missing ZIP central directory");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP entry");
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataOffset, dataOffset + compressed);
    entries.push({ name, data: method === 8 ? inflateRawSync(stored) : stored });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("scoped file ZIP", () => {
  test("sanitizes paths and deterministically distinguishes duplicate names", () => {
    expect(archiveEntryNames([
      { fileRecordId: "a", filename: "../../logo.pdf" },
      { fileRecordId: "b", filename: "logo.pdf" },
      { fileRecordId: "c", filename: "C:\\art\\logo.pdf" },
      { fileRecordId: "d", filename: "CON.txt" },
    ])).toEqual(["logo.pdf", "logo (2).pdf", "logo (3).pdf", "_CON.txt"]);
  });

  test("streams extractable one-file and mixed-extension ZIPs with original bytes", async () => {
    const app = express();
    app.get("/archive/:count", async (req, res) => {
      const files = [
        { fileRecordId: "a", filename: "logo.pdf" },
        { fileRecordId: "b", filename: "logo.pdf" },
        { fileRecordId: "c", filename: "artwork.ai" },
        { fileRecordId: "d", filename: "cutline.eps" },
      ].slice(0, Number(req.params.count));
      await writeScopedZip(files, files.map((file) => Readable.from(Buffer.from(`bytes-${file.fileRecordId}`))), "files.zip", res);
    });
    for (const count of [1, 4]) {
      const response = await request(app).get(`/archive/${count}`).buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/zip/);
      const entries = zipEntries(response.body as Buffer);
      expect(entries.map((entry) => entry.name)).toEqual(["logo.pdf", "logo (2).pdf", "artwork.ai", "cutline.eps"].slice(0, count));
      expect(entries.map((entry) => entry.data.toString())).toEqual(["bytes-a", "bytes-b", "bytes-c", "bytes-d"].slice(0, count));
    }
  });

  test("empty scope and unavailable canonical file produce explicit errors before ZIP headers", async () => {
    process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
    const { sendScopedFileArchive } = await import("../services/storage/scopedFileArchive");
    const { fileRecordRepository } = await import("../storage/fileRecord.repo");
    const missingRecord = jest.spyOn(fileRecordRepository, "getByIdForOrganization").mockResolvedValue(null);
    const app = express();
    app.get("/empty", (_req, res) => { void sendScopedFileArchive({ organizationId: "org-1", files: [], downloadName: "empty.zip", res }); });
    app.get("/missing", (_req, res) => { void sendScopedFileArchive({ organizationId: "org-1", files: [{ fileRecordId: "missing", filename: "art.pdf" }], downloadName: "missing.zip", res }); });
    try {
      const empty = await request(app).get("/empty");
      const missing = await request(app).get("/missing");
      expect(empty.status).toBe(404);
      expect(empty.body.error).toMatch(/No files/);
      expect(missing.status).toBe(503);
      expect(missing.body.error).toMatch(/no ZIP was downloaded/);
      expect(missing.headers["content-type"]).not.toMatch(/application\/zip/);
    } finally {
      missingRecord.mockRestore();
    }
  });
});
