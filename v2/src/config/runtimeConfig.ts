export class V2ConfigurationError extends Error {
  readonly name = "V2ConfigurationError";
}

export type V2RuntimeConfig = Readonly<{
  environment: "development" | "test" | "production";
  serviceName: string;
  port: number;
  /** Canonical deployment runtime URL; disposable tests still use TEST_DATABASE_URL only. */
  databaseUrl?: string;
  /** Immutable build identifier, when the deployment platform provides one. */
  releaseVersion?: string;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

const allowedEnvironments = new Set(["development", "test", "production"]);

const optionalValue = (environment: Environment, name: string): string | undefined => {
  const value = environment[name]?.trim();
  return value ? value : undefined;
};

const parsePort = (value: string | undefined): number => {
  if (!value) return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new V2ConfigurationError("V2_PORT must be an integer between 1 and 65535.");
  }
  return port;
};

export const loadV2RuntimeConfig = (environment: Environment = process.env): V2RuntimeConfig => {
  const requestedEnvironment = optionalValue(environment, "NODE_ENV") ?? "development";
  if (!allowedEnvironments.has(requestedEnvironment)) {
    throw new V2ConfigurationError("NODE_ENV must be development, test, or production.");
  }

  return {
    environment: requestedEnvironment as V2RuntimeConfig["environment"],
    serviceName: optionalValue(environment, "V2_SERVICE_NAME") ?? "printershero-v2",
    // Railway assigns PORT. V2_PORT remains useful for an intentional local
    // override, but must never make a Railway process listen on the wrong port.
    port: parsePort(optionalValue(environment, "PORT") ?? optionalValue(environment, "V2_PORT")),
    databaseUrl: optionalValue(environment, "DATABASE_URL"),
    releaseVersion:
      optionalValue(environment, "V2_RELEASE_VERSION") ??
      optionalValue(environment, "RAILWAY_GIT_COMMIT_SHA") ??
      optionalValue(environment, "GIT_COMMIT_SHA"),
  };
};

/** Explicit use site for later DB-backed readiness; no legacy/test fallback exists. */
export const requireV2RuntimeDatabaseUrl = (config: V2RuntimeConfig): string => {
  if (!config.databaseUrl) {
    throw new V2ConfigurationError("DATABASE_URL is required for database-backed V2 runtime work.");
  }
  return config.databaseUrl;
};

export type V2DeploymentTarget = "development" | "production";

const approvedRailwayDeploymentTargets: ReadonlyArray<Readonly<{
  target: V2DeploymentTarget;
  projectName: string;
  environmentName: string;
}>> = [
  {
    target: "development",
    projectName: "PrintersHero-DEV",
    environmentName: "Development",
  },
  {
    target: "production",
    projectName: "PrintersHero-PRODUCTION",
    environmentName: "production",
  },
];

/**
 * Deployment-only guard for the approved V1-to-V2 cutover environments.
 * `DATABASE_URL` remains an opaque secret-bearing connection string: this
 * guard validates its syntax only. The exact Railway project/environment pair
 * is the deployment target authority, so a URL alone can never move DEV into
 * production or vice versa.
 */
export const requireV2DeploymentTarget = (
  environment: Environment = process.env,
): V2DeploymentTarget => {
  const projectName = optionalValue(environment, "RAILWAY_PROJECT_NAME");
  const environmentName = optionalValue(environment, "RAILWAY_ENVIRONMENT_NAME");
  const target = approvedRailwayDeploymentTargets.find((candidate) =>
    candidate.projectName === projectName && candidate.environmentName === environmentName,
  );

  if (!target) {
    throw new V2ConfigurationError(
      "V2 cutover deployment requires an approved Railway project/environment identity.",
    );
  }

  return target.target;
};

export const requireV2DeploymentDatabaseUrl = (
  environment: Environment = process.env,
): string => {
  const config = loadV2RuntimeConfig(environment);
  if (config.environment !== "production") {
    throw new V2ConfigurationError("V2 cutover deployment requires NODE_ENV=production.");
  }
  requireV2DeploymentTarget(environment);
  const databaseUrl = requireV2RuntimeDatabaseUrl(config);
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new V2ConfigurationError("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new V2ConfigurationError("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  return databaseUrl;
};
