import type { AiConversationMessage } from "./AiProviderAdapter";

export type ProviderImage = { mimeType: string; dataUrl: string };
type Surface = "responses" | "chat";
type InputMessage = { role: "user" | "assistant"; content: string | Array<Record<string, unknown>> };

/** Provider bytes are constructed only on the server from authorized canonical files.
 * The browser supplies attachment IDs, never URLs or base64 to a turn request. */
export function buildAssistantVisionMessages(input: {
  surface: Surface;
  history?: readonly AiConversationMessage[];
  currentText: string;
  currentImages?: readonly ProviderImage[];
}): InputMessage[] {
  const content = (text: string, images: readonly ProviderImage[] = []) => {
    if (!images.length) return text;
    if (input.surface === "responses") return [
      { type: "input_text", text },
      ...images.map(image => ({ type: "input_image", image_url: image.dataUrl, detail: "low" })),
    ];
    return [
      { type: "text", text },
      ...images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl, detail: "low" } })),
    ];
  };
  return [
    ...(input.history ?? []).map(message => ({
      role: message.role,
      content: message.role === "user" ? content(message.content, message.images) : message.content,
    })),
    { role: "user" as const, content: content(input.currentText, input.currentImages) },
  ];
}
