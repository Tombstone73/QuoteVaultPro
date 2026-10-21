import * as React from "react";
import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

export const NOTIFICATION_HISTORY_LIMIT = 40;
type Severity = "success" | "info" | "warning" | "error";

export type AppNotification = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  path?: string;
  severity: Severity;
  createdAt: number;
  count: number;
};

type NotificationInput = Omit<Partial<AppNotification>, "id" | "createdAt" | "count">;
type State = { toasts: AppNotification[]; scope: string | null; announcement: { id: number; text: string; error: boolean } | null };
type StoredNotification = Pick<AppNotification, "id" | "severity" | "createdAt" | "count" | "path"> & { title?: string; description?: string };

let state: State = { toasts: [], scope: null, announcement: null };
const listeners = new Set<() => void>();
let nextId = 0;
const storageKey = (scope: string) => `printershero:notifications:${scope}`;
const textOf = (node: React.ReactNode): string => typeof node === "string" || typeof node === "number" ? String(node) : "";
const severityOf = (input: NotificationInput): Severity => {
  if (input.severity) return input.severity;
  if (input.variant === "destructive") return "error";
  const title = textOf(input.title);
  if (/error|failed|unable|could not|cannot|not saved/i.test(title)) return "error";
  if (/warning|pending|blocked|requires/i.test(title)) return "warning";
  if (/success|saved|created|updated|recorded|sent|complete|approved|downloaded|copied|logged in/i.test(title)) return "success";
  return "info";
};

function persist() {
  if (!state.scope || typeof sessionStorage === "undefined") return;
  try {
    const stored: StoredNotification[] = state.toasts.map(({ id, title, description, severity, createdAt, count, path }) => ({
      id, title: textOf(title), description: textOf(description), severity, createdAt, count, path,
    }));
    sessionStorage.setItem(storageKey(state.scope), JSON.stringify(stored));
  } catch { /* Browsers may deny storage; in-memory history still works. */ }
}

function publish(next: State) {
  state = next;
  persist();
  listeners.forEach((listener) => listener());
}

export function setNotificationScope(scope: string) {
  if (state.scope === scope) return;
  // An identity change must never expose the preceding user's or tenant's feedback.
  if (state.scope) {
    try { sessionStorage.removeItem(storageKey(state.scope)); } catch { /* Storage may be unavailable. */ }
  }
  let restored: AppNotification[] = [];
  try {
    const raw = sessionStorage.getItem(storageKey(scope));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) restored = parsed.filter((item): item is StoredNotification =>
        typeof item?.id === "string" && typeof item?.createdAt === "number" &&
        ["success", "info", "warning", "error"].includes(item?.severity) &&
        typeof item?.count === "number" &&
        (item?.title === undefined || typeof item.title === "string") &&
        (item?.description === undefined || typeof item.description === "string")
      ).slice(0, NOTIFICATION_HISTORY_LIMIT);
    }
  } catch { /* Ignore malformed or unavailable session storage. */ }
  publish({ toasts: restored, scope, announcement: null });
}

export function clearNotificationSession() {
  if (state.scope) {
    try { sessionStorage.removeItem(storageKey(state.scope)); } catch { /* Storage may be unavailable. */ }
  }
  state = { toasts: [], scope: null, announcement: null };
  listeners.forEach((listener) => listener());
}

export function addNotification(input: NotificationInput) {
  const id = `notification-${Date.now()}-${++nextId}`;
  const severity = severityOf(input);
  const createdAt = Date.now();
  const path = input.path ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined);
  const duplicate = input.action ? undefined : state.toasts.find((item) =>
    !item.action && item.severity === severity && textOf(item.title) === textOf(input.title) &&
    textOf(item.description) === textOf(input.description)
  );
  const notification: AppNotification = duplicate
    ? { ...duplicate, ...input, path, severity, createdAt, count: duplicate.count + 1 }
    : { ...input, id, path, severity, createdAt, count: 1 };
  publish({
    ...state,
    toasts: [notification, ...state.toasts.filter((item) => item.id !== duplicate?.id)].slice(0, NOTIFICATION_HISTORY_LIMIT),
    announcement: { id: nextId, text: [textOf(input.title), textOf(input.description)].filter(Boolean).join(". "), error: severity === "error" },
  });
  return duplicate?.id ?? id;
}

export function updateNotification(id: string, input: NotificationInput) {
  const existing = state.toasts.find((item) => item.id === id);
  if (!existing) return;
  const next = { ...existing, ...input, severity: input.severity ?? (input.title || input.variant ? severityOf(input) : existing.severity), createdAt: Date.now() };
  publish({
    ...state,
    toasts: [next, ...state.toasts.filter((item) => item.id !== id)],
    announcement: { id: ++nextId, text: [textOf(next.title), textOf(next.description)].filter(Boolean).join(". "), error: next.severity === "error" },
  });
}

export function dismissNotification(id?: string) {
  publish({ ...state, toasts: id ? state.toasts.filter((item) => item.id !== id) : [] });
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getNotificationSnapshot() { return state; }

export function toast(input: NotificationInput) {
  const id = addNotification(input);
  return {
    id,
    dismiss: () => dismissNotification(id),
    update: (props: NotificationInput) => updateNotification(id, props),
  };
}

export function useToast() {
  const snapshot = React.useSyncExternalStore(subscribe, getNotificationSnapshot, getNotificationSnapshot);
  return { ...snapshot, toast, dismiss: dismissNotification, clearHistory: () => dismissNotification() };
}
