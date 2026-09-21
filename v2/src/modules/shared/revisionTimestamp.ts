import { V2ApplicationError } from "../../errors/applicationError.js";

/**
 * Canonicalizes an optimistic-concurrency timestamp token before it is
 * compared. ISO strings can legally express the same millisecond precision
 * with different fractional-second widths (for example, `.22Z` and `.220Z`).
 */
export const canonicalRevisionTimestamp = (value: string, revision: string): string => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new V2ApplicationError("VALIDATION_ERROR", `The ${revision} revision timestamp is invalid.`);
  return new Date(milliseconds).toISOString();
};
