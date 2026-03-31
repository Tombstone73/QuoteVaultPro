import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { FlaskConical } from "lucide-react";

export function DemoBanner() {
  const { isMockMode } = useRuntimeConfig();

  if (!isMockMode) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
      <FlaskConical className="h-4 w-4" />
      <span>Demo Mode — Showing sample data</span>
    </div>
  );
}
