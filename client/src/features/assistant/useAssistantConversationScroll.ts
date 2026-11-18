import * as React from "react";

const NEAR_BOTTOM_THRESHOLD_PX = 96;

export function isNearConversationBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
}

type AssistantConversationScrollOptions = {
  conversationId: string | null;
  latestMessageId: string | null;
};

/** Keeps a conversation readable without overriding an intentional upward scroll. */
export function useAssistantConversationScroll({
  conversationId,
  latestMessageId,
}: AssistantConversationScrollOptions) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const followLatestRef = React.useRef(true);
  const previousConversationRef = React.useRef(conversationId);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);

  const scrollToLatest = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    // Scrolling a message into view also scrolls the dock's clipping ancestors.
    container.scrollTop = container.scrollHeight;
  }, []);

  const onScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nearBottom = isNearConversationBottom(container);
    followLatestRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  React.useLayoutEffect(() => {
    if (previousConversationRef.current !== conversationId) {
      previousConversationRef.current = conversationId;
      followLatestRef.current = true;
    }
    if (followLatestRef.current) scrollToLatest();
  }, [conversationId, latestMessageId, scrollToLatest]);

  React.useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) scrollToLatest();
    });
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToLatest]);

  return { containerRef, contentRef, onScroll, showJumpToLatest, scrollToLatest };
}
