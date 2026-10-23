import { describe, expect, test } from "@jest/globals";
import sharp from "sharp";
import { AssistantImageError, assertAssistantImageOwnership, normalizeAssistantImageSource } from "../services/assistantImageValidation";

describe("assistant image validation", () => {
  test("uses detected content, not a forged file extension", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const result = await normalizeAssistantImageSource({ fileName: "photo.jpg", buffer: bytes });
    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.equals(bytes)).toBe(true);
  });
  test("rejects text masquerading as an image and oversized content", async () => {
    await expect(normalizeAssistantImageSource({ fileName: "photo.png", buffer: Buffer.from("not an image") }))
      .rejects.toMatchObject({ statusCode: 415 });
    await expect(normalizeAssistantImageSource({ fileName: "photo.png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }))
      .rejects.toMatchObject({ statusCode: 413 });
  });
});


test("attachment authorization rejects other tenants, conversations, users, and removed images", () => {
  const scope = { organizationId: "tenant_a", conversationId: "conversation_a", userId: "staff_a" };
  const row = { id: "image_a", orgId: "tenant_a", conversationId: "conversation_a", uploadedByUserId: "staff_a", removedAt: null };
  expect(assertAssistantImageOwnership(scope, [row.id], [row])).toEqual([row]);
  for (const change of [
    { orgId: "tenant_b" }, { conversationId: "conversation_b" },
    { uploadedByUserId: "staff_b" }, { removedAt: new Date() },
  ]) {
    expect(() => assertAssistantImageOwnership(scope, [row.id], [{ ...row, ...change }])).toThrow("unavailable");
  }
  expect(() => assertAssistantImageOwnership(scope, [row.id, row.id], [row])).toThrow("four different");
  expect(() => assertAssistantImageOwnership(scope, ["missing"], [row])).toThrow("unavailable");
});
