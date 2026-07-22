import * as React from "react";
import { Archive, ArchiveRestore, MessageSquarePlus, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { assistantConversationLabel } from "./assistantWorkspaceCore";
import type { AssistantConversationSummary } from "./types";

export const ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH = 240;

/** Mirrors the safe title shape expected by the API while keeping the editor readable. */
export function sanitizeAssistantConversationTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH);
}

type ConversationAction = (conversationId: string) => Promise<unknown> | unknown;
type ConversationRename = (conversationId: string, title: string) => Promise<unknown> | unknown;

export type AssistantConversationSidebarProps = {
  conversations: AssistantConversationSummary[];
  archivedConversations?: AssistantConversationSummary[];
  activeConversationId: string | null;
  creating?: boolean;
  updatingConversationId?: string | null;
  archivedLoading?: boolean;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onRename: ConversationRename;
  onArchive: ConversationAction;
  onRestore?: ConversationAction;
  onArchiveComplete?: (conversationId: string) => void;
};

function ConversationRow({
  conversation,
  active,
  archived = false,
  pending = false,
  onSelect,
  onRename,
  onArchive,
  onRestore,
}: {
  conversation: AssistantConversationSummary;
  active: boolean;
  archived?: boolean;
  pending?: boolean;
  onSelect: (conversationId: string) => void;
  onRename?: ConversationRename;
  onArchive?: ConversationAction;
  onRestore?: ConversationAction;
}) {
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [title, setTitle] = React.useState(conversation.title);
  const [saving, setSaving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => setTitle(conversation.title), [conversation.id, conversation.title]);

  const saveRename = async () => {
    const nextTitle = sanitizeAssistantConversationTitle(title);
    if (!nextTitle || nextTitle === conversation.title || !onRename) {
      setRenameOpen(false);
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      await onRename(conversation.id, nextTitle);
      setRenameOpen(false);
    } catch {
      setActionError("Couldn’t rename this conversation. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!onArchive) return;
    setActionError(null);
    setSaving(true);
    try {
      await onArchive(conversation.id);
      setArchiveOpen(false);
    } catch {
      setActionError("Couldn’t archive this conversation. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!onRestore) return;
    setActionError(null);
    setSaving(true);
    try {
      await onRestore(conversation.id);
    } catch {
      setActionError("Couldn’t restore this conversation. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className={cn("group flex items-center rounded hover:bg-muted", active && "bg-muted font-medium")}>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className="min-w-0 flex-1 rounded px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-current={active ? "page" : undefined}
      >
        <span className="line-clamp-2">{assistantConversationLabel(conversation.title)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="mr-1 h-7 w-7 shrink-0" disabled={pending || saving} aria-label={`Conversation options for ${assistantConversationLabel(conversation.title)}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!archived ? <DropdownMenuItem onSelect={() => setRenameOpen(true)}><Pencil /> Rename</DropdownMenuItem> : null}
          {archived && onRestore ? <DropdownMenuItem onSelect={() => void restore()}><ArchiveRestore /> Restore</DropdownMenuItem> : null}
          {!archived ? <DropdownMenuItem onSelect={() => setArchiveOpen(true)}><Archive /> Delete conversation</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {actionError ? <p role="status" className="px-2 pb-1 text-xs text-destructive">{actionError}</p> : null}

    <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Choose a short, clear title for this conversation.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Conversation title" value={title} maxLength={ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setRenameOpen(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void saveRename()} disabled={saving || !sanitizeAssistantConversationTitle(title)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this conversation?</AlertDialogTitle>
          <AlertDialogDescription>It will be removed from your active chat list. Its messages and assistant audit history will be preserved.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmArchive(); }} disabled={saving}>Archive conversation</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

/**
 * Presentation-only conversation controls. The workspace owns active selection
 * and uses the metadata PATCH hook for all actions; no assistant tool is used.
 */
export function AssistantConversationSidebar({
  conversations,
  archivedConversations = [],
  activeConversationId,
  creating = false,
  updatingConversationId = null,
  archivedLoading = false,
  onCreate,
  onSelect,
  onRename,
  onArchive,
  onRestore,
  onArchiveComplete,
}: AssistantConversationSidebarProps) {
  const [showArchived, setShowArchived] = React.useState(false);
  const archive = async (conversationId: string) => {
    await onArchive(conversationId);
    onArchiveComplete?.(conversationId);
  };

  return <aside className="hidden w-40 shrink-0 border-r bg-muted/20 p-2 md:block" aria-label="Assistant conversations">
    <Button type="button" variant="outline" className="mb-2 w-full justify-start gap-2" onClick={onCreate} disabled={creating}>
      <MessageSquarePlus className="h-4 w-4" /> New chat
    </Button>
    <div className="space-y-1 overflow-y-auto">
      {conversations.map((conversation) => <ConversationRow
        key={conversation.id}
        conversation={conversation}
        active={activeConversationId === conversation.id}
        pending={updatingConversationId === conversation.id}
        onSelect={onSelect}
        onRename={onRename}
        onArchive={archive}
      />)}
    </div>
    {onRestore ? <div className="mt-2 border-t pt-2">
      <Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-start px-2 text-xs" onClick={() => setShowArchived((visible) => !visible)} aria-expanded={showArchived}>
        {showArchived ? "Hide archived" : "Archived conversations"}
      </Button>
      {showArchived ? <div className="mt-1 space-y-1" aria-label="Archived conversations">
        {archivedLoading ? <p className="px-2 py-1 text-xs text-muted-foreground">Loading archived chats…</p> : null}
        {!archivedLoading && !archivedConversations.length ? <p className="px-2 py-1 text-xs text-muted-foreground">No archived chats.</p> : null}
        {archivedConversations.map((conversation) => <ConversationRow
          key={conversation.id}
          conversation={conversation}
          active={false}
          archived
          pending={updatingConversationId === conversation.id}
          onSelect={onSelect}
          onRestore={onRestore}
        />)}
      </div> : null}
    </div> : null}
  </aside>;
}
