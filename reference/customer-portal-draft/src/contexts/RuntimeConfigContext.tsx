import React, { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDataMode, setDataMode as persistDataMode, type DataMode } from "@/lib/runtime-config";

interface RuntimeConfigValue {
  dataMode: DataMode;
  isMockMode: boolean;
  setDataMode: (mode: DataMode) => void;
}

const RuntimeConfigContext = createContext<RuntimeConfigValue | undefined>(undefined);

export function RuntimeConfigProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [dataMode, setLocalMode] = useState<DataMode>(getDataMode);

  const setDataMode = useCallback(
    (mode: DataMode) => {
      persistDataMode(mode);
      setLocalMode(mode);
      // Invalidate all queries so hooks re-fetch with the new source
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  return (
    <RuntimeConfigContext.Provider
      value={{ dataMode, isMockMode: dataMode === "mock_demo", setDataMode }}
    >
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfigValue {
  const ctx = useContext(RuntimeConfigContext);
  if (!ctx) throw new Error("useRuntimeConfig must be used within RuntimeConfigProvider");
  return ctx;
}
