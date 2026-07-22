import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAssistantConversationScroll } from "./useAssistantConversationScroll";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = { conversationId: string | null; assistantId: string | null; pendingId?: string | null; completionKey?: string };

function Harness({ conversationId, assistantId, pendingId = null, completionKey = "" }: Props) {
  const scroll = useAssistantConversationScroll({
    conversationId,
    latestMessageId: assistantId,
    latestAssistantMessageId: assistantId,
    pendingUserMessageId: pendingId,
    completionKey,
  });
  return <div>
    <div ref={scroll.containerRef} onScroll={scroll.onScroll} data-testid="conversation" />
    <article ref={scroll.latestUserRef} data-testid="user" />
    <article ref={scroll.latestAssistantRef} data-testid="assistant" />
    {scroll.showJumpToLatest ? <button type="button" onClick={() => scroll.scrollToLatest("assistant", true)}>Jump to latest</button> : null}
  </div>;
}

function render(props: Props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness {...props} />));
  return { container, root, rerender: (next: Props) => act(() => root.render(<Harness {...next} />)) };
}

describe("assistant conversation scroll", () => {
  let scrollIntoView: jest.Mock;

  beforeEach(() => {
    scrollIntoView = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 1; }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("opens a switched conversation at its latest message and follows a completed assistant response", () => {
    const view = render({ conversationId: "conversation-1", assistantId: "assistant-1" });
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start", behavior: "smooth" }));
    view.rerender({ conversationId: "conversation-2", assistantId: "assistant-2" });
    expect(scrollIntoView).toHaveBeenCalled();
    act(() => view.root.unmount());
  });

  test("does not force a user who has scrolled upward and offers jump to latest", () => {
    const view = render({ conversationId: "conversation-1", assistantId: "assistant-1" });
    const conversation = view.container.querySelector('[data-testid="conversation"]') as HTMLDivElement;
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    scrollIntoView.mockClear();
    act(() => conversation.dispatchEvent(new Event("scroll", { bubbles: true })));
    view.rerender({ conversationId: "conversation-1", assistantId: "assistant-2" });
    expect(scrollIntoView).not.toHaveBeenCalled();
    const jump = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Jump to latest") as HTMLButtonElement;
    expect(jump).toBeTruthy();
    act(() => jump.click());
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    act(() => view.root.unmount());
  });

  test("uses instant scrolling when reduced motion is preferred", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    const view = render({ conversationId: "conversation-1", assistantId: "assistant-1" });
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    act(() => view.root.unmount());
  });
});
