import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRuntimeEnvironment, type RuntimeEnvironmentSummary } from "@/hooks/useRuntimeEnvironment";

function getRuntimeBadgeLabel(environment: RuntimeEnvironmentSummary): string {
  if (environment.canMutateSharedDevData) return "LOCAL APP -> DEV CLOUD DB";

  if (
    environment.appRuntime === "local" &&
    environment.apiRuntime === "local" &&
    environment.databaseRuntime === "local"
  ) {
    return "LOCAL APP -> LOCAL DB";
  }

  if (environment.appRuntime === "deployed-dev" || environment.apiRuntime === "deployed-dev") {
    return "DEPLOYED DEV";
  }

  if (
    environment.appRuntime === "production" &&
    environment.apiRuntime === "production" &&
    environment.databaseRuntime === "production-cloud"
  ) {
    return "PRODUCTION";
  }

  return `${environment.appRuntime.toUpperCase()} / ${environment.databaseLabel.toUpperCase()}`;
}

function getRuntimeBadgeTitle(environment: RuntimeEnvironmentSummary): string {
  const migrationText = environment.migrationRunsOnStartup
    ? "Startup migrations enabled"
    : "Startup migrations disabled";

  return [
    `App: ${environment.appRuntime}`,
    `API: ${environment.apiRuntime}`,
    `Database: ${environment.databaseLabel}`,
    migrationText,
    `Backend SHA: ${environment.buildFingerprint.gitSha ?? "unavailable"}`,
    `Build: ${environment.buildFingerprint.buildId ?? "unavailable"}`,
    `Operator: ${environment.buildFingerprint.operatorArchitectureVersion}`,
  ].join(" | ");
}

export function RuntimeEnvironmentBadge() {
  const { data: environment, isError } = useRuntimeEnvironment();

  if (isError) {
    return (
      <Badge
        variant="outline"
        className="border-slate-300 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
        title="Runtime environment could not be loaded"
      >
        ENV UNKNOWN
      </Badge>
    );
  }

  if (!environment) return null;

  const warning = environment.canMutateSharedDevData;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide select-none",
        warning
          ? "border-amber-500 bg-amber-100 text-amber-950 shadow-sm"
          : environment.appRuntime === "production"
            ? "border-emerald-500/50 bg-emerald-50 text-emerald-900"
            : "border-blue-400/60 bg-blue-50 text-blue-900",
      )}
      title={getRuntimeBadgeTitle(environment)}
    >
      {warning ? <AlertTriangle className="h-3 w-3" /> : null}
      {getRuntimeBadgeLabel(environment)}
    </Badge>
  );
}
