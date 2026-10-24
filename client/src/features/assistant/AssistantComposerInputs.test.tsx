import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";

const load = jest.fn<() => Promise<Blob>>();
jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path, resolveCanonicalApiRequestUrl: (path: string) => path }));
jest.mock("@/lib/queryClient", () => ({ apiFetchBlob: load }));
import { AssistantComposerInputs, AssistantImagePreviews } from "./AssistantComposerInputs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("saved conversation images load through authenticated blob access and release previews", async () => {
  load.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const create = jest.fn(() => "blob:assistant-image");
  const revoke = jest.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<AssistantImagePreviews conversationId="conversation_1" attachments={[{ id: "image_1", fileName: "proof.png", mimeType: "image/png", sizeBytes: 5 }]} />));
  expect(load).toHaveBeenCalledWith("/api/assistant/conversations/conversation_1/images/image_1", { method: "GET" });
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:assistant-image");
  await act(async () => root.unmount());
  expect(revoke).toHaveBeenCalledWith("blob:assistant-image");
});


test("pending conversation creation disables image selection without clearing the typed draft", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const addImages = jest.fn(() => null);
  await act(async () => root.render(<AssistantComposerInputs value="Keep this draft" onChange={() => undefined}
    disabled onAddImages={addImages} />));
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Attach images"]')?.disabled).toBe(true);
  expect(addImages).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
