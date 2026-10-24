import type { IncomingMessage } from "node:http";
import Busboy from "busboy";
import { ASSISTANT_IMAGE_MAX_BYTES, AssistantImageError } from "./assistantImageValidation";

/** Parse exactly one image part. Busboy limit events fire when the limit is
 * reached, so leave room for a second part and reject it explicitly. */
export function parseAssistantImageUpload(req: IncomingMessage): Promise<{ fileName: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let fileName = "";
    let fileCount = 0;
    let rejected = false;
    const fail = (error: Error) => {
      if (rejected) return;
      rejected = true;
      reject(error);
    };
    const parser = Busboy({ headers: req.headers, limits: {
      fileSize: ASSISTANT_IMAGE_MAX_BYTES, files: 2, fields: 1, parts: 2,
    } });
    parser.on("file", (field, stream, info) => {
      fileCount += 1;
      if (field !== "image" || fileCount !== 1) {
        stream.resume();
        fail(new AssistantImageError(400, "Upload one image at a time."));
        return;
      }
      fileName = info.filename;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => fail(new AssistantImageError(413, "Choose an image up to 5 MB.")));
    });
    parser.on("field", () => fail(new AssistantImageError(400, "Upload one image at a time.")));
    parser.on("filesLimit", () => fail(new AssistantImageError(400, "Upload one image at a time.")));
    parser.on("fieldsLimit", () => fail(new AssistantImageError(400, "Upload one image at a time.")));
    parser.on("partsLimit", () => fail(new AssistantImageError(400, "Upload one image at a time.")));
    parser.on("error", fail);
    parser.on("close", () => {
      if (!rejected) fileCount === 1
        ? resolve({ fileName, buffer: Buffer.concat(chunks) })
        : reject(new AssistantImageError(400, "Select one image."));
    });
    req.pipe(parser);
  });
}
