import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { aiAssistantApi, type AiPendingCommand } from "./api";

const key = (scope: string, organizationId: string, part: string, conversationId?: string) =>
  ["v2", scope, organizationId, "assistant", part, conversationId] as const;
const messageError = (error: unknown) => {
  const value = error as { message?: string };
  return value?.message ?? "The AI Assistant could not complete that request.";
};
const entityPath = (toolName: string, id: string): string | undefined => {
  if (toolName === "customer.search") return `/customers/${encodeURIComponent(id)}`;
  if (toolName === "product.search") return `/products/${encodeURIComponent(id)}`;
  if (toolName === "quote.search") return `/quotes/${encodeURIComponent(id)}`;
  if (toolName === "order.search") return `/orders/${encodeURIComponent(id)}`;
  return undefined;
};
const ToolResultCard = ({ toolName, content }: Readonly<{ toolName?: string; content: string }>) => {
  let value: { items?: readonly { id?: string; label?: string; status?: string; detail?: string }[] } = {};
  try { value = JSON.parse(content) as typeof value; } catch { return <article className="v2-ai-tool-result"><small>{toolName ?? "Tool"}</small><p>Completed safely. Open the relevant workspace for details.</p></article>; }
  return <article className="v2-ai-tool-result"><small>{toolName ?? "Tool"}</small>{value.items?.length ? <ul>{value.items.map((item, index) => { const href = item.id && toolName ? entityPath(toolName, item.id) : undefined; return <li key={item.id ?? index}><div><strong>{item.label ?? "Result"}</strong>{item.detail && <small>{item.detail}</small>}{item.status && <small>Status: {item.status}</small>}</div>{href && <a href={href}>Open</a>}</li>; })}</ul> : <p>No matching records were found.</p>}</article>;
};

/** The staff workspace is deliberately thin: it renders durable conversation
 * evidence, lets a provider request only registered tools, and presents the
 * server-owned GO/CANCEL boundary. It never carries provider credentials or
 * a client-side tool implementation. */
export const AiAssistantWorkspace = ({ organizationId, sessionScope, canUse, csrfReady }: Readonly<{ organizationId: string; sessionScope: string; canUse: boolean; csrfReady: boolean }>) => {
  const client = useQueryClient();
  const [conversationId, setConversationId] = useState("");
  const [draft, setDraft] = useState("");
  const conversations = useQuery({ queryKey: key(sessionScope, organizationId, "conversations"), queryFn: () => aiAssistantApi.list(organizationId), enabled: Boolean(sessionScope && organizationId && canUse) });
  useEffect(() => { if (!conversationId && conversations.data?.[0]) setConversationId(conversations.data[0].id); }, [conversationId, conversations.data]);
  const messages = useQuery({ queryKey: key(sessionScope, organizationId, "messages", conversationId), queryFn: () => aiAssistantApi.messages(organizationId, conversationId), enabled: Boolean(sessionScope && organizationId && canUse && conversationId) });
  const pending = useQuery({ queryKey: key(sessionScope, organizationId, "pending", conversationId), queryFn: () => aiAssistantApi.pending(organizationId, conversationId), enabled: Boolean(sessionScope && organizationId && canUse && conversationId) });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: key(sessionScope, organizationId, "conversations") }), client.invalidateQueries({ queryKey: key(sessionScope, organizationId, "messages", conversationId) }), client.invalidateQueries({ queryKey: key(sessionScope, organizationId, "pending", conversationId) })]); };
  const create = useMutation({ mutationFn: () => aiAssistantApi.create(organizationId), onSuccess: async (created) => { setConversationId(created.id); await refresh(); } });
  const turn = useMutation({ mutationFn: () => aiAssistantApi.turn(organizationId, conversationId, draft), onSuccess: async () => { setDraft(""); await refresh(); } });
  const confirm = useMutation({ mutationFn: () => aiAssistantApi.confirm(organizationId, conversationId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => aiAssistantApi.cancel(organizationId, conversationId), onSuccess: refresh });
  const activePending: AiPendingCommand | null | undefined = pending.data;
  if (!canUse) return <section className="v2-workspace"><h1>AI Assistant</h1><p>You do not have permission to use the AI Assistant.</p></section>;
  return <section className="v2-workspace v2-ai-workspace">
    <header className="v2-workspace-header"><div><small>Operational workspace</small><h1>AI Assistant</h1><p>Ask about customers, products, quotes, and orders. The assistant has no direct database or provider access.</p></div><button type="button" className="v2-primary-button" disabled={!csrfReady || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "New conversation"}</button></header>
    {(conversations.error || messages.error || pending.error || turn.error || create.error || confirm.error || cancel.error) && <p className="v2-product-version-message">{messageError(conversations.error ?? messages.error ?? pending.error ?? turn.error ?? create.error ?? confirm.error ?? cancel.error)}</p>}
    <div className="v2-sales-split">
      <aside className="v2-sales-list" aria-label="AI conversations"><h2>Conversations</h2>{conversations.isLoading ? <p>Loading…</p> : conversations.data?.length ? conversations.data.map((conversation) => <button type="button" key={conversation.id} className={conversation.id === conversationId ? "is-selected" : ""} onClick={() => setConversationId(conversation.id)}><strong>{conversation.title ?? "New conversation"}</strong><small>{new Date(conversation.updatedAt).toLocaleString()}</small></button>) : <p>No conversations yet.</p>}</aside>
      <div className="v2-sales-detail">
        {!conversationId ? <p>Start a new conversation to use the assistant.</p> : <>
          <div className="v2-ai-transcript" aria-live="polite">{messages.isLoading ? <p>Loading conversation…</p> : messages.data?.map((message) => message.role === "tool" ? <ToolResultCard key={message.id} toolName={message.toolName} content={message.content} /> : <article className={`v2-ai-message is-${message.role}`} key={message.id}><small>{message.role === "assistant" ? "Assistant" : "You"}</small><p>{message.content}</p></article>)}</div>
          {activePending?.state === "pending_confirmation" && <section className="v2-ai-proposal"><small>Proposed action · {activePending.commandName}</small><p>{activePending.proposal}</p><p>Replying GO executes this exact, time-limited proposal under your current permissions.</p><button type="button" className="v2-primary-button" disabled={!csrfReady || confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "Executing…" : "GO"}</button><button type="button" disabled={!csrfReady || cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelling…" : "Cancel"}</button></section>}
          <form className="v2-product-form" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && !turn.isPending) turn.mutate(); }}><label>Message<textarea value={draft} maxLength={4000} placeholder="For example: Find orders waiting for fulfillment." disabled={!csrfReady || turn.isPending} onChange={(event) => setDraft(event.target.value)} /></label><button type="submit" className="v2-primary-button" disabled={!csrfReady || turn.isPending || !draft.trim()}>{turn.isPending ? "Working…" : "Send"}</button><small>AI output is advisory until a server-owned proposal is explicitly confirmed with GO.</small></form>
        </>}
      </div>
    </div>
  </section>;
};
