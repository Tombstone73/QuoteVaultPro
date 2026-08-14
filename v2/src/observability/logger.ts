import type { V2LogContext } from "./operationContext.js";

export type V2LogLevel = "debug" | "info" | "warn" | "error";

export interface V2Logger {
  log(level: V2LogLevel, event: string, context?: V2LogContext): void;
}

/** Emits a deliberately small, secret-free structured event shape. */
export const createConsoleLogger = (): V2Logger => ({
  log(level, event, context = {}) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...context }));
  },
});
