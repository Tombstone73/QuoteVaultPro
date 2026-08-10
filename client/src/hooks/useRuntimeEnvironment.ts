import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";

export type RuntimeKind = "local" | "deployed-dev" | "production" | "unknown";
export type DatabaseRuntimeKind = "local" | "dev-cloud" | "production-cloud" | "unknown";
export type RuntimeBuildFingerprint = { gitSha: string | null; buildId: string | null; environment: string | null; operatorArchitectureVersion: string };

export type RuntimeEnvironmentSummary = {
  appRuntime: RuntimeKind;
  apiRuntime: RuntimeKind;
  databaseRuntime: DatabaseRuntimeKind;
  databaseLabel: string;
  canMutateSharedDevData: boolean;
  migrationRunsOnStartup: boolean;
  warningMessage: string | null;
  buildFingerprint: RuntimeBuildFingerprint;
};

type RuntimeEnvironmentResponse =
  | { success: true; data: RuntimeEnvironmentSummary }
  | { success: false; message: string };

export function useRuntimeEnvironment() {
  return useQuery<RuntimeEnvironmentSummary>({
    queryKey: ["/api/system/environment"],
    queryFn: async () => {
      const response = await apiFetch("/api/system/environment");
      if (!response.ok) {
        throw new Error("Unable to load runtime environment");
      }

      const json = (await response.json()) as RuntimeEnvironmentResponse;
      if (!json.success) {
        throw new Error(json.message || "Unable to load runtime environment");
      }

      return json.data;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
