import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";
import { appendDictation, useAssistantDictation } from "./useAssistantDictation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("dictation appends to typed text only after stop and leaves send explicit", async () => {
  const spoken: string[] = [];
  let aborts = 0;
  let instance!: FakeRecognition;
  class FakeRecognition {
    lang = ""; continuous = false; interimResults = false;
    onstart: (() => void) | null = null;
    onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { aborts += 1; this.onend?.(); }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  let dictation!: ReturnType<typeof useAssistantDictation>;
  function Harness() { dictation = useAssistantDictation(text => spoken.push(text)); return null; }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await act(async () => dictation.start());
  expect(dictation.state).toBe("recording");
  await act(async () => instance.onresult?.({ results: [{ isFinal: true, 0: { transcript: "add two photos" } }] }));
  expect(spoken).toEqual([]);
  await act(async () => dictation.stop());
  expect(appendDictation("Please", spoken[0])).toBe("Please add two photos");
  await act(async () => dictation.start());
  await act(async () => instance.onresult?.({ results: [{ isFinal: true, 0: { transcript: "discard me" } }] }));
  await act(async () => dictation.cancel());
  expect(spoken).toHaveLength(1);
  expect(aborts).toBe(1);
  await act(async () => dictation.start());
  await act(async () => root.unmount());
  expect(aborts).toBe(2);
  expect(spoken).toHaveLength(1);
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
});
