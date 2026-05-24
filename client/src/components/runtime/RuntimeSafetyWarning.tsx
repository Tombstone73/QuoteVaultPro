import { AlertTriangle } from "lucide-react";
import { useRuntimeEnvironment } from "@/hooks/useRuntimeEnvironment";

export function RuntimeSafetyWarning() {
  const { data: environment } = useRuntimeEnvironment();

  if (!environment?.canMutateSharedDevData) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 md:px-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Local runtime is connected to the shared DEV cloud database. Changes here affect DEV data.
        </span>
      </div>
    </div>
  );
}
