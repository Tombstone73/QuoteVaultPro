import * as React from "react";
import { Bot, Expand, Maximize2, MessageSquarePlus, Minus, PanelBottom, PanelLeft, PanelRight, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAssistantConversation, useAssistantConversations, useCreateAssistantConversation, useSendAssistantTurn } from "@/hooks/useAssistantApi";
import { useAssistantWorkspace } from "./AssistantWorkspaceProvider";
import type { AssistantPresentation } from "./types";

export function AssistantLauncher() {
  const { capabilities, capabilityError, capabilityLoading, toggle } = useAssistantWorkspace();
  const enabled = capabilities?.enabled && capabilities.conversationsEnabled;
  const reason = capabilityError || capabilities?.unavailableReason || "The assistant is not enabled for this organization.";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      onClick={toggle}
      disabled={capabilityLoading || !enabled}
      aria-label={enabled ? "Open PrintersHero assistant" : "PrintersHero assistant unavailable"}
      title={enabled ? "Open assistant (Ctrl/Cmd+J)" : reason}
    >
      <Bot className="h-4 w-4" />
      <span className="sr-only">{enabled ? "Open assistant" : reason}</span>
    </Button>
  );
}

function PresentationControls() {
  const { presentation, priorPresentation, setPresentation, minimize } = useAssistantWorkspace();
  const choices: Array<{ value: Exclude<AssistantPresentation, "minimized">; label: string; icon: React.ElementType }> = [
    { value: "floating", label: "Float", icon: Expand },
    { value: "dock_left", label: "Dock left", icon: PanelLeft },
    { value: "dock_right", label: "Dock right", icon: PanelRight },
    { value: "dock_bottom", label: "Dock bottom", icon: PanelBottom },
    { value: "fullscreen", label: "Full screen", icon: Maximize2 },
  ];
  const current = presentation === "minimized" ? priorPresentation : presentation;
  return (
    <div className="flex items-center gap-0.5">
      <div className="hidden rounded-md border bg-muted/30 p-0.5 sm:flex">
        {choices.map(({ value, label, icon: Icon }) => (
          <Button key={value} type="button" size="icon" variant={current === value ? "secondary" : "ghost"} className="h-7 w-7" title={label} aria-label={label} onClick={() => setPresentation(value)}>
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Minimize assistant" aria-label="Minimize assistant" onClick={minimize}>
        <Minus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ConversationContent() {
  const { capabilities, context, refreshContext, activeConversationId, setActiveConversationId, draft, setDraft } = useAssistantWorkspace();
  const enabled = Boolean(capabilities?.enabled && capabilities.conversationsEnabled);
  const conversations = useAssistantConversations(enabled);
  const createConversation = useCreateAssistantConversation();
  const detail = useAssistantConversation(activeConversationId, enabled);
  const sendTurn = useSendAssistantTurn();

  React.useEffect(() => {
    if (!activeConversationId && conversations.data?.[0]) setActiveConversationId(conversations.data[0].id);
  }, [activeConversationId, conversations.data]);

  const createNew = async () => {
    const conversation = await createConversation.mutateAsync();
    setActiveConversationId(conversation.id);
    setDraft("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sendTurn.isPending) return;
    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await createConversation.mutateAsync();
      conversationId = conversation.id;
      setActiveConversationId(conversationId);
    }
    await sendTurn.mutateAsync({ conversationId, message, context });
    setDraft("");
  };

  if (!enabled) {
    return <WorkspaceNotice title="Assistant unavailable" description={capabilities?.unavailableReason || "The assistant is not enabled for this organization."} />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-40 shrink-0 border-r bg-muted/20 p-2 md:block">
        <Button type="button" variant="outline" className="mb-2 w-full justify-start gap-2" onClick={() => void createNew()} disabled={createConversation.isPending}>
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
        <div className="space-y-1 overflow-y-auto">
          {conversations.isLoading ? <p className="px-2 py-3 text-xs text-muted-foreground">Loading chats…</p> : null}
          {conversations.data?.map((conversation) => (
            <button key={conversation.id} type="button" onClick={() => setActiveConversationId(conversation.id)} className={cn("w-full rounded px-2 py-2 text-left text-xs hover:bg-muted", activeConversationId === conversation.id && "bg-muted font-medium")}>
              <span className="line-clamp-2">{conversation.title || "New conversation"}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <span className="truncate">Context: {context.pageTitle}{context.entityType ? ` · ${context.entityType}${context.entityId ? ` ${context.entityId}` : ""}` : ""}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={refreshContext} title="Refresh page context">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {detail.isLoading ? <p className="text-sm text-muted-foreground">Loading conversation…</p> : null}
          {!detail.data?.messages?.length && !detail.isLoading ? (
            <div className="mx-auto mt-8 max-w-sm text-center">
              <Bot className="mx-auto mb-3 h-8 w-8 text-primary" />
              <h3 className="text-sm font-medium">PrintersHero assistant</h3>
              <p className="mt-1 text-sm text-muted-foreground">The workspace is connected. Business-data tools are not enabled yet.</p>
            </div>
          ) : detail.data?.messages?.map((message) => (
            <div key={message.id} className={cn("max-w-[88%] rounded-lg px-3 py-2 text-sm", message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>{message.content}</div>
          ))}
          {sendTurn.isError ? <p role="status" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">Your message was not sent. You can try again.</p> : null}
        </div>
        <form className="border-t p-3" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="assistant-message">Message the assistant</label>
          <div className="flex gap-2">
            <Input id="assistant-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this workspace…" maxLength={8_000} disabled={sendTurn.isPending} />
            <Button type="submit" size="icon" disabled={!draft.trim() || sendTurn.isPending} aria-label="Send message"><Send className="h-4 w-4" /></Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Business-data tools and write actions are not enabled.</p>
        </form>
      </section>
    </div>
  );
}

function WorkspaceNotice({ title, description }: { title: string; description: string }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"><Bot className="h-8 w-8 text-muted-foreground" /><h3 className="text-sm font-medium">{title}</h3><p className="max-w-sm text-sm text-muted-foreground">{description}</p></div>;
}

function WorkspacePanel({ className }: { className?: string }) {
  return <section className={cn("flex min-h-0 flex-col overflow-hidden border bg-background shadow-xl", className)} aria-label="PrintersHero assistant workspace">
    <header className="flex h-11 shrink-0 items-center justify-between border-b px-3"><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> Assistant</div><PresentationControls /></header>
    <ConversationContent />
  </section>;
}

export function AssistantDock({ side }: { side: "left" | "right" | "bottom" }) {
  const { layout, setDockSize, persistLayout } = useAssistantWorkspace();
  const horizontal = side === "bottom";
  const resizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = horizontal ? event.clientY : event.clientX;
    const initial = layout.dockSize;
    const move = (moveEvent: PointerEvent) => {
      const delta = (horizontal ? moveEvent.clientY : moveEvent.clientX) - start;
      setDockSize(initial + (side === "right" || side === "bottom" ? -delta : delta));
    };
    const finish = () => { persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };
  return <div className={cn("relative flex shrink-0", horizontal ? "h-[var(--assistant-dock-size)] w-full flex-col" : "h-full w-[var(--assistant-dock-size)]")} style={{ ["--assistant-dock-size" as string]: `${layout.dockSize}px` }}>
    <div onPointerDown={resizeStart} className={cn("z-10 shrink-0 touch-none bg-border hover:bg-primary/50", horizontal ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize", side === "left" && "order-last", side === "bottom" && "order-first")} aria-label="Resize assistant workspace" role="separator" />
    <WorkspacePanel className="min-h-0 flex-1 border-0 shadow-none" />
  </div>;
}

export function AssistantOverlay() {
  const { capabilities, capabilityLoading, presentation, layout, setFloatingBounds, persistLayout, isMobile } = useAssistantWorkspace();
  const enabled = capabilities?.enabled && capabilities.conversationsEnabled;
  const [dragging, setDragging] = React.useState(false);
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const handleResize = () => setFloatingBounds(layout.floatingBounds);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [layout.floatingBounds, setFloatingBounds]);
  if (capabilityLoading || !enabled || presentation === "minimized" || ["dock_left", "dock_right", "dock_bottom"].includes(presentation)) return null;
  if (presentation === "fullscreen" || isMobile) return <div className="fixed inset-0 z-[70] bg-background"><WorkspacePanel className="h-full border-0 shadow-none" /></div>;
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const pointerOrigin = { x: event.clientX, y: event.clientY };
    const boundsOrigin = { ...layout.floatingBounds };
    setDragging(true);
    const move = (moveEvent: PointerEvent) => setFloatingBounds({
      ...boundsOrigin,
      x: boundsOrigin.x + moveEvent.clientX - pointerOrigin.x,
      y: boundsOrigin.y + moveEvent.clientY - pointerOrigin.y,
    });
    const finish = () => { setDragging(false); persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };
  return <section ref={panelRef} className={cn("fixed z-[70] flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl", dragging && "select-none")} style={{ left: layout.floatingBounds.x, top: layout.floatingBounds.y, width: layout.floatingBounds.width, height: layout.floatingBounds.height }} aria-label="PrintersHero assistant workspace">
    <div className="flex h-11 shrink-0 cursor-move items-center justify-between border-b px-3" onPointerDown={startDrag}><div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> Assistant</div><PresentationControls /></div>
    <ConversationContent />
    <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(event) => { event.stopPropagation(); const pointerOrigin = { x: event.clientX, y: event.clientY }; const boundsOrigin = { ...layout.floatingBounds }; const move = (moveEvent: PointerEvent) => setFloatingBounds({ ...boundsOrigin, width: boundsOrigin.width + moveEvent.clientX - pointerOrigin.x, height: boundsOrigin.height + moveEvent.clientY - pointerOrigin.y }); const finish = () => { persistLayout(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true }); }} />
  </section>;
}
