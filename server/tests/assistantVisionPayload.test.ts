import { describe, expect, test } from "@jest/globals";
import { buildAssistantVisionMessages } from "../services/ai/providers/assistantVisionPayload";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("assistant vision provider payload", () => {
  test("Responses sends current and recent real image bytes as user input_image parts", () => {
    const messages = buildAssistantVisionMessages({
      surface: "responses",
      history: [
        { role: "user", content: "Earlier photo", images: [{ mimeType: "image/png", dataUrl: png }] },
        { role: "assistant", content: "Earlier answer" },
      ],
      currentText: "What changed?", currentImages: [{ mimeType: "image/png", dataUrl: png }],
    });
    expect(messages).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Earlier photo" }, { type: "input_image", image_url: png, detail: "low" }] },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: [{ type: "input_text", text: "What changed?" }, { type: "input_image", image_url: png, detail: "low" }] },
    ]);
  });

  test("Chat Completions uses supported image_url parts and preserves text-only turns", () => {
    const messages = buildAssistantVisionMessages({
      surface: "chat", history: [{ role: "assistant", content: "Hello" }],
      currentText: "Describe this", currentImages: [{ mimeType: "image/png", dataUrl: png }],
    });
    expect(messages[0]).toEqual({ role: "assistant", content: "Hello" });
    expect(messages[1]).toEqual({ role: "user", content: [
      { type: "text", text: "Describe this" },
      { type: "image_url", image_url: { url: png, detail: "low" } },
    ] });
    expect(buildAssistantVisionMessages({ surface: "responses", currentText: "Text only" }))
      .toEqual([{ role: "user", content: "Text only" }]);
  });
});
