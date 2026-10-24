import { describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { parseAssistantImageUpload } from "../services/assistantImageMultipart";

function app() {
  const server = express();
  server.post("/image", async (req, res) => {
    try {
      const image = await parseAssistantImageUpload(req);
      res.json({ fileName: image.fileName, bytes: image.buffer.toString("utf8") });
    } catch (error) {
      res.status(error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 500)
        .json({ message: error instanceof Error ? error.message : "Upload failed" });
    }
  });
  return server;
}

describe("assistant single-image multipart parser", () => {
  test("accepts the browser's single image field", async () => {
    const response = await request(app()).post("/image")
      .attach("image", Buffer.from("one-image"), "neutral.png").expect(200);
    expect(response.body).toEqual({ fileName: "neutral.png", bytes: "one-image" });
  });

  test("rejects extra images and fields", async () => {
    const multiple = await request(app()).post("/image")
      .attach("image", Buffer.from("first"), "first.png")
      .attach("image", Buffer.from("second"), "second.png").expect(400);
    expect(multiple.body.message).toBe("Upload one image at a time.");
    const field = await request(app()).post("/image")
      .field("extra", "value")
      .attach("image", Buffer.from("first"), "first.png").expect(400);
    expect(field.body.message).toBe("Upload one image at a time.");
  });

  test("requires the image field", async () => {
    const response = await request(app()).post("/image")
      .attach("other", Buffer.from("first"), "first.png").expect(400);
    expect(response.body.message).toBe("Upload one image at a time.");
  });
});
