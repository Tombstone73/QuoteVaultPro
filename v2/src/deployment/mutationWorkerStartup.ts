/**
 * A deployment server can be healthy before it is permitted to claim durable
 * work or contact a provider. Production deployments therefore require an
 * explicit release after cutover verification; absence and malformed values
 * both preserve controlled-start mode.
 */
export type V2MutationWorkerStartup = Readonly<{
  enabled: boolean;
  reason: "released" | "release_not_granted" | "invalid_release_value";
}>;

export const resolveV2MutationWorkerStartup = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): V2MutationWorkerStartup => {
  const value = environment.V2_MUTATION_WORKERS_ENABLED?.trim().toLowerCase();
  if (value === "true") return { enabled: true, reason: "released" };
  if (value === undefined || value === "" || value === "false") {
    return { enabled: false, reason: "release_not_granted" };
  }
  return { enabled: false, reason: "invalid_release_value" };
};
