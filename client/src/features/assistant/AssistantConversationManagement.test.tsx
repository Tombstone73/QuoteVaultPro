import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AssistantConversationSidebar, sanitizeAssistantConversationTitle } from "./AssistantConversationManagement";

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button type="button" role="menuitem" onClick={onSelect}>{children}</button>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement> }) => <button type="button" onClick={onClick}>{children}</button>,
}));

const conversation = (id: string, title: string, status: "active" | "archived" = "active") => ({
  id,
  title,
  status,
  lastMessagePreview: "A previous message",
  lastActivityAt: "2026-07-21T12:00:00.000Z",
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
});

function render(props: Partial<React.ComponentProps<typeof AssistantConversationSidebar>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const defaults = {
    conversations: [conversation("conversation-1", "Original title")],
    archivedConversations: [conversation("conversation-2", "Archived chat", "archived")],
    activeConversationId: "conversation-1",
    onCreate: jest.fn(),
    onSelect: jest.fn(),
    onRename: jest.fn(async () => undefined),
    onArchive: jest.fn(async () => undefined),
    onRestore: jest.fn(async () => undefined),
  };
  act(() => root.render(<AssistantConversationSidebar {...defaults} {...props} />));
  return { container, root, ...defaults, ...props };
}

describe("assistant conversation management", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => document.body.replaceChildren());

  it("sanitizes a bounded title before submitting it", () => {
    expect(sanitizeAssistantConversationTitle("  <July>\u0000  production\nqueue  ")).toBe("July production queue");
    expect(sanitizeAssistantConversationTitle("x".repeat(300))).toHaveLength(240);
  });

  it("exposes an accessible three-dot menu and archives only after confirmation", async () => {
    const onArchive = jest.fn(async () => undefined);
    const view = render({ onArchive });
    const menu = view.container.querySelector('[aria-label="Conversation options for Original title"]') as HTMLButtonElement;
    expect(menu).toBeTruthy();
    await act(async () => menu.click());
    const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.includes("Delete conversation")) as HTMLElement;
    expect(deleteItem).toBeTruthy();
    await act(async () => deleteItem.click());
    expect(onArchive).not.toHaveBeenCalled();
    const confirm = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Archive conversation") as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(onArchive).toHaveBeenCalledWith("conversation-1");
    act(() => view.root.unmount());
  });

  it("submits a sanitized replacement title through the metadata callback", async () => {
    const onRename = jest.fn(async () => undefined);
    const view = render({ onRename });
    const renameItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.includes("Rename")) as HTMLElement;
    await act(async () => renameItem.click());
    const input = view.container.querySelector('input[aria-label="Conversation title"]') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, " <Today>\u0000 queue ");
    await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
    const save = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Save") as HTMLButtonElement;
    await act(async () => save.click());
    expect(onRename).toHaveBeenCalledWith("conversation-1", "Today queue");
    act(() => view.root.unmount());
  });

  it("opens archived conversations and delegates restore", async () => {
    const onRestore = jest.fn(async () => undefined);
    const view = render({ onRestore });
    const archivedToggle = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Archived conversations") as HTMLButtonElement;
    await act(async () => archivedToggle.click());
    const restoreMenu = view.container.querySelector('[aria-label="Conversation options for Archived chat"]') as HTMLButtonElement;
    await act(async () => restoreMenu.click());
    const restoreItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.includes("Restore")) as HTMLElement;
    await act(async () => restoreItem.click());
    expect(onRestore).toHaveBeenCalledWith("conversation-2");
    act(() => view.root.unmount());
  });

  it("keeps the conversation rail independently scrollable and hidden before wide desktop layouts", () => {
    const view = render();
    const rail = view.container.querySelector('[aria-label="Assistant conversations"]') as HTMLElement;
    const list = view.container.querySelector('[data-testid="assistant-conversation-list"]') as HTMLElement;
    expect(rail.className).toContain("min-h-0");
    expect(rail.className).toContain("xl:flex");
    expect(list.className).toContain("min-h-0");
    expect(list.className).toContain("flex-1");
    expect(list.className).toContain("overflow-y-auto");
    act(() => view.root.unmount());
  });
});
