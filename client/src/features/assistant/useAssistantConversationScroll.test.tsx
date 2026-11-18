import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { useAssistantConversationScroll } from "./useAssistantConversationScroll";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof useAssistantConversationScroll>[0];

function Harness(props: Props) {
  const scroll = useAssistantConversationScroll(props);
  return <div ref={scroll.containerRef} onScroll={scroll.onScroll} data-testid="conversation">
    <div ref={scroll.contentRef} data-testid="conversation-content"><article>{props.latestMessageId}</article></div>
    {scroll.showJumpToLatest ? <button type="button" onClick={scroll.scrollToLatest}>Jump to latest</button> : null}
  </div>;
}

describe("assistant conversation scroll", () => {
  const first = { conversationId: "chat-1", latestMessageId: "message-1" };
  const originalResizeObserver = globalThis.ResizeObserver;
  let host: HTMLDivElement;
  let root: Root;
  let resize: () => void;
  const observe = jest.fn();
  const disconnect = jest.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    observe.mockClear();
    disconnect.mockClear();
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(1);
    host.remove();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function render(props: Props = first) {
    act(() => root.render(<Harness {...props} />));
  }

  function scrollport() {
    const element = host.querySelector<HTMLDivElement>('[data-testid="conversation"]')!;
    const size = { scrollHeight: 1_000, clientHeight: 200 };
    let top = 800;
    Object.defineProperties(element, {
      scrollHeight: { get: () => size.scrollHeight },
      clientHeight: { get: () => size.clientHeight },
      scrollTop: {
        get: () => top,
        set: (value: number) => { top = Math.min(value, size.scrollHeight - size.clientHeight); },
      },
    });
    const scroll = (value: number) => act(() => {
      element.scrollTop = value;
      element.dispatchEvent(new Event("scroll"));
    });
    return { element, size, scroll };
  }

  test("follows an appended message within the scrollport only when already near the bottom", () => {
    render();
    const { element, size, scroll } = scrollport();
    const ancestorScroll = jest.fn();
    Object.defineProperty(element.querySelector("article"), "scrollIntoView", { value: ancestorScroll });
    scroll(740);
    size.scrollHeight = 1_500;
    render({ ...first, latestMessageId: "message-2" });

    expect(element.scrollTop).toBe(1_300);
    expect(ancestorScroll).not.toHaveBeenCalled();
  });

  test("preserves older messages through appends and growth until Jump to latest is clicked", () => {
    render();
    const { element, size, scroll } = scrollport();
    scroll(100);
    size.scrollHeight = 1_500;
    render({ ...first, latestMessageId: "message-2" });
    act(() => resize());
    expect(element.scrollTop).toBe(100);

    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(element.scrollTop).toBe(1_300);
    expect(host.querySelector("button")).toBeNull();
  });

  test("starts a switched conversation at the latest message even after history loads asynchronously", () => {
    render();
    const { element, size, scroll } = scrollport();
    scroll(100);
    render({ conversationId: "chat-2", latestMessageId: null });
    size.scrollHeight = 1_700;
    render({ conversationId: "chat-2", latestMessageId: "message-2" });

    expect(element.scrollTop).toBe(1_500);
    expect(host.querySelector("button")).toBeNull();
  });

  test("keeps following when the existing response grows or the viewport shrinks", () => {
    render();
    const { element, size } = scrollport();
    expect(observe.mock.calls.map(([target]) => target)).toEqual([element, element.firstElementChild]);

    size.scrollHeight = 2_000;
    act(() => resize());
    expect(element.scrollTop).toBe(1_800);
    size.clientHeight = 100;
    act(() => resize());
    expect(element.scrollTop).toBe(1_900);
  });
});
