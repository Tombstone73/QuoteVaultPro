import * as React from "react";

const NEAR_BOTTOM_THRESHOLD_PX = 96;

export function isNearConversationBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type ScrollTarget = "bottom" | "user" | "assistant";

type AssistantConversationScrollOptions = {
  conversationId: string | null;
  latestMessageId: string | null;
  latestAssistantMessageId: string | null;
  pendingUserMessageId: string | null;
  completionKey: string;
};

/** Keeps a conversation readable without overriding an intentional upward scroll. */
export function useAssistantConversationScroll({
  conversationId,
  latestMessageId,
  latestAssistantMessageId,
  pendingUserMessageId,
  completionKey,
}: AssistantConversationScrollOptions) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const latestUserRef = React.useRef<HTMLElement>(null);
  const latestAssistantRef = React.useRef<HTMLElement>(null);
  const followLatestRef = React.useRef(true);
  const frameRef = React.useRef<number | null>(null);
  const previousConversationRef = React.useRef<string | null>(null);
  const previousAssistantMessageRef = React.useRef<string | null>(null);
  const previousCompletionRef = React.useRef<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);

  const cancelScheduledScroll = React.useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const scrollToLatest = React.useCallback((target: ScrollTarget = "bottom", force = false) => {
    const container = containerRef.current;
    if (!container) return;
    if (!force && !followLatestRef.current) {
      setShowJumpToLatest(true);
      return;
    }
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    cancelScheduledScroll();
    frameRef.current = window.requestAnimationFrame(() => {
      const anchor = target === "user" ? latestUserRef.current : target === "assistant" ? latestAssistantRef.current : null;
      if (anchor) {
        anchor.scrollIntoView({ block: target === "user" ? "end" : "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
      frameRef.current = null;
    });
  }, [cancelScheduledScroll]);

  const onScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nearBottom = isNearConversationBottom(container);
    followLatestRef.current = nearBottom;
    if (nearBottom) setShowJumpToLatest(false);
  }, []);

  React.useEffect(() => {
    if (previousConversationRef.current === conversationId) return;
    previousConversationRef.current = conversationId;
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    if (conversationId) scrollToLatest("bottom", true);
  }, [conversationId, scrollToLatest]);

  React.useEffect(() => {
    if (!pendingUserMessageId) return;
    scrollToLatest("user", true);
  }, [pendingUserMessageId, scrollToLatest]);

  React.useEffect(() => {
    if (!latestAssistantMessageId || previousAssistantMessageRef.current === latestAssistantMessageId) return;
    previousAssistantMessageRef.current = latestAssistantMessageId;
    scrollToLatest("assistant");
  }, [latestAssistantMessageId, scrollToLatest]);

  React.useEffect(() => {
    if (!completionKey || previousCompletionRef.current === completionKey) return;
    previousCompletionRef.current = completionKey;
    if (latestMessageId) scrollToLatest("assistant");
  }, [completionKey, latestMessageId, scrollToLatest]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) scrollToLatest("bottom");
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToLatest]);

  React.useEffect(() => () => cancelScheduledScroll(), [cancelScheduledScroll]);

  return { containerRef, latestUserRef, latestAssistantRef, onScroll, showJumpToLatest, scrollToLatest };
}
