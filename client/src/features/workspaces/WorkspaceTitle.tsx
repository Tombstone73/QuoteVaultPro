import { createContext, useContext, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export const WorkspaceTitleContext = createContext<((id: string, title: string) => void) | null>(null);

/** Publish only a display label; editor values stay in the canonical editor. */
export function useWorkspaceTitle(title: string | undefined) {
  const owner = useWorkspace();
  const update = useContext(WorkspaceTitleContext);
  useEffect(() => {
    if (owner && update && title) update(owner.id, title);
  }, [owner?.id, update, title]);
}
