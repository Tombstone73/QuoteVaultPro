import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "./WorkspaceContext";

export const WorkspaceOverlayContext = createContext<{ desiredOpen: boolean } | null>(null);
export function useWorkspaceOverlayState(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const workspace = useWorkspace();
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const desiredOpen = props.open ?? localOpen;
  return {
    workspace, desiredOpen,
    open: workspace ? workspace.active && desiredOpen : props.open,
    onOpenChange: (open: boolean) => {
      if (workspace && !workspace.isActive()) return;
      setLocalOpen(open); props.onOpenChange?.(open);
    },
  };
}

/** Detaching a portal's DOM preserves its React form state while Radix releases modal effects. */
export function useParkedWorkspaceContent(children: React.ReactNode) {
  const workspace = useWorkspace(), overlay = useContext(WorkspaceOverlayContext);
  const host = useRef<HTMLDivElement | null>(null);
  if (workspace && !host.current && typeof document !== "undefined") {
    host.current = document.createElement("div"); host.current.style.display = "contents";
  }
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node && host.current) node.appendChild(host.current);
    else host.current?.remove();
  }, []);
  return {
    parked: workspace && overlay?.desiredOpen && host.current ? createPortal(children, host.current) : null,
    content: workspace ? <div style={{ display: "contents" }} ref={attach} /> : children,
  };
}
