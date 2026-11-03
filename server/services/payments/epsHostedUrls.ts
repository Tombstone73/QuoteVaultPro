/** URL fields confirmed by EPS support, 2026-10-29. Destinations are never
 * payment evidence or callback credentials. */
export type EpsHostedUrls = { successUrl?: string; failureUrl?: string; responseUrl?: string };

function httpsUrl(value: string | undefined): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    if (value.length > 2000 || url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.toString();
  } catch {
    throw new Error("EPS hosted destinations must be HTTPS URLs without credentials or fragments.");
  }
}

export function epsHostedUrlFields(urls: EpsHostedUrls): Record<string, string> {
  const destinations = [
    ["successurl", httpsUrl(urls.successUrl)],
    ["failureurl", httpsUrl(urls.failureUrl)],
    ["responseurl", httpsUrl(urls.responseUrl)],
  ] as const;
  const fields: Record<string, string> = {};
  for (const [key, value] of destinations) if (value !== undefined) fields[key] = value;
  return fields;
}

/** No defaults or environment changes. Existing hosted/manual-confirmation
 * behavior continues until destinations are deliberately configured. */
export function configuredEpsHostedUrls(env: NodeJS.ProcessEnv = process.env): EpsHostedUrls {
  return { successUrl: env.EPS_HOSTED_SUCCESS_URL, failureUrl: env.EPS_HOSTED_FAILURE_URL, responseUrl: env.EPS_HOSTED_RESPONSE_URL };
}
