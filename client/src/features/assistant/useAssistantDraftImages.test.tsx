import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";
jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path, resolveCanonicalApiRequestUrl: (path: string) => path }));
import { useAssistantDraftImages } from "./useAssistantDraftImages";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("clearing a saved image revokes its preview without uploading another copy", async () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "local_image") });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:local-image") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  let upload = 0;
  class FakeXHR {
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 201;
    responseText = "";
    withCredentials = false;
    open() {}
    send() {
      upload += 1;
      this.responseText = JSON.stringify({ data: { id: "image_" + upload, fileName: "proof.png", mimeType: "image/png", sizeBytes: 3 } });
      queueMicrotask(() => this.onload?.());
    }
    abort() { this.onabort?.(); }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeXHR });
  let images!: ReturnType<typeof useAssistantDraftImages>;
  function Harness() { images = useAssistantDraftImages(async () => "conversation_1"); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => { images.add([new File(["png"], "proof.png", { type: "image/png" })]); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(images.images[0]).toMatchObject({ state: "ready", attachment: { id: "image_1" } });
  await act(async () => images.clear());
  expect(images.images).toHaveLength(0);
  expect(upload).toBe(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-image");
  await act(async () => root.unmount());
});
