import * as React from "react";
import { Archive, ArchiveRestore, ListChecks, MessageSquarePlus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
const ASSISTANT_CONVERSATION_SIDEBAR_COLLAPSED_KEY = "titan.assistant.conversations.collapsed";

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
  onArchiveSelected: (conversationIds: string[]) => Promise<unknown> | unknown;
  onRestore?: ConversationAction;
  onArchiveComplete?: (conversationIds: string[]) => void;
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
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: {
  conversation: AssistantConversationSummary;
  active: boolean;
  archived?: boolean;
  pending?: boolean;
  onSelect: (conversationId: string) => void;
  onRename?: ConversationRename;
  onArchive?: ConversationAction;
  onRestore?: ConversationAction;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (conversationId: string) => void;
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
    <div className={cn("group flex items-center rounded hover:bg-muted", active && !selectionMode && "bg-muted font-medium", selected && "bg-primary/10")}>
      {selectionMode ? <Checkbox
        checked={selected}
        onCheckedChange={() => onToggleSelection?.(conversation.id)}
        aria-label={`Select ${assistantConversationLabel(conversation.title)}`}
        className="ml-2"
      /> : null}
      <button
        type="button"
        onClick={() => selectionMode ? onToggleSelection?.(conversation.id) : onSelect(conversation.id)}
        className="min-w-0 flex-1 rounded px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-current={active ? "page" : undefined}
        aria-pressed={selectionMode ? selected : undefined}
      >
        <span className="line-clamp-2">{assistantConversationLabel(conversation.title)}</span>
      </button>
      {!selectionMode ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="mr-1 h-7 w-7 shrink-0" disabled={pending || saving} aria-label={`Conversation options for ${assistantConversationLabel(conversation.title)}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!archived ? <DropdownMenuItem onSelect={() => setRenameOpen(true)}><Pencil /> Rename</DropdownMenuItem> : null}
          {archived && onRestore ? <DropdownMenuItem onSelect={() => void restore()}><ArchiveRestore /> Restore</DropdownMenuItem> : null}
          {!archived ? <DropdownMenuItem onSelect={() => setArchiveOpen(true)}><Archive /> Archive conversation</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu> : null}
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
  onArchiveSelected,
  onRestore,
  onArchiveComplete,
}: AssistantConversationSidebarProps) {
  const [showArchived, setShowArchived] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => typeof window !== "undefined" && window.localStorage.getItem(ASSISTANT_CONVERSATION_SIDEBAR_COLLAPSED_KEY) === "true");
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = React.useState<Set<string>>(() => new Set());
  const [bulkArchiving, setBulkArchiving] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const activeIds = new Set(conversations.map((conversation) => conversation.id));
    setSelectedConversationIds((current) => new Set([...current].filter((conversationId) => activeIds.has(conversationId))));
  }, [conversations]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(ASSISTANT_CONVERSATION_SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // This preference is optional and must not affect conversation access.
      }
      return next;
    });
  };

  const toggleSelection = (conversationId: string) => {
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedConversationIds(new Set());
    setBulkError(null);
  };

  const archive = async (conversationId: string) => {
    await onArchive(conversationId);
    onArchiveComplete?.([conversationId]);
  };

  const archiveSelected = async () => {
    const conversationIds = [...selectedConversationIds];
    if (!conversationIds.length || bulkArchiving) return;
    setBulkError(null);
    setBulkArchiving(true);
    try {
      await onArchiveSelected(conversationIds);
      onArchiveComplete?.(conversationIds);
      cancelSelection();
    } catch (error) {
      setBulkError(error instanceof Error && error.message ? error.message : "Could not archive the selected conversations. Please refresh and try again.");
    } finally {
      setBulkArchiving(false);
    }
  };

  return <aside className={cn("hidden min-h-0 shrink-0 flex-col border-r bg-muted/20 p-2 xl:flex", collapsed ? "w-12" : "w-56")} aria-label="Assistant conversations">
    <div className={cn("mb-2 flex shrink-0 items-center", collapsed ? "justify-center" : "justify-between gap-1")}>
      {!collapsed ? <span className="px-1 text-xs font-medium text-muted-foreground">Chats</span> : null}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={toggleCollapsed} aria-label={collapsed ? "Expand conversations" : "Collapse conversations"} title={collapsed ? "Expand conversations" : "Collapse conversations"}>
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
    </div>
    <Button type="button" variant={collapsed ? "ghost" : "outline"} size={collapsed ? "icon" : "default"} className={cn("mb-2 shrink-0", collapsed ? "h-8 w-8" : "w-full justify-start gap-2")} onClick={onCreate} disabled={creating} aria-label="New chat" title="New chat">
      <MessageSquarePlus className="h-4 w-4" />{!collapsed ? " New chat" : null}
    </Button>
    {!collapsed ? <>
    <div className="mb-2 flex items-center justify-between gap-1">
      {selectionMode ? <span className="px-1 text-xs text-muted-foreground">{selectedConversationIds.size} selected</span> : <span className="px-1 text-xs text-muted-foreground">Recent</span>}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => selectionMode ? cancelSelection() : setSelectionMode(true)} aria-label={selectionMode ? "Cancel conversation selection" : "Select conversations"} title={selectionMode ? "Cancel selection" : "Select conversations"}>
        <ListChecks className="h-4 w-4" />
      </Button>
    </div>
    {selectionMode ? <div className="mb-2 flex items-center gap-1 border-b pb-2">
      <Button type="button" variant="outline" size="sm" className="h-7 flex-1 px-2 text-xs" onClick={cancelSelection} disabled={bulkArchiving}>Cancel</Button>
      <Button type="button" size="sm" className="h-7 flex-1 gap-1 px-2 text-xs" onClick={() => void archiveSelected()} disabled={!selectedConversationIds.size || bulkArchiving}>
        <Archive className="h-3.5 w-3.5" /> Archive ({selectedConversationIds.size})
      </Button>
    </div> : null}
    {bulkError ? <p role="status" className="mb-2 px-1 text-xs text-destructive">{bulkError}</p> : null}
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="assistant-conversation-list">
      {conversations.map((conversation) => <ConversationRow
        key={conversation.id}
        conversation={conversation}
        active={activeConversationId === conversation.id}
        pending={updatingConversationId === conversation.id}
        onSelect={onSelect}
        onRename={onRename}
        onArchive={archive}
        selectionMode={selectionMode}
        selected={selectedConversationIds.has(conversation.id)}
        onToggleSelection={toggleSelection}
      />)}
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
    </div>
    </> : null}
  </aside>;
}
