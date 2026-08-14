export class V2ConfigurationError extends Error {
  readonly name = "V2ConfigurationError";
}

export type V2RuntimeConfig = Readonly<{
  environment: "development" | "test" | "production";
  serviceName: string;
  port: number;
  /** V2-only runtime URL. It is never read from V1 or test variable names. */
  databaseUrl?: string;
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
    port: parsePort(optionalValue(environment, "V2_PORT")),
    databaseUrl: optionalValue(environment, "V2_DATABASE_URL"),
  };
};

/** Explicit use site for later DB-backed readiness; no legacy/test fallback exists. */
export const requireV2RuntimeDatabaseUrl = (config: V2RuntimeConfig): string => {
  if (!config.databaseUrl) {
    throw new V2ConfigurationError("V2_DATABASE_URL is required for database-backed V2 runtime work.");
  }
  return config.databaseUrl;
};
