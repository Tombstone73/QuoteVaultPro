import crypto from "crypto";

export const PRINT_AGENT_WAKE_EVENT = "queue_changed";
const PRINT_AGENT_WAKE_TOPIC_PREFIX = "printershero:traveler-wake:";
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type PrintAgentRealtimeConfiguration = {
  url: string;
  publishableKey: string;
};

type WakeResult = {
  published: boolean;
  attempts: number;
  reason?: "realtime_not_configured" | "publish_failed";
};

function configuredValue(name: string, env = process.env): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function getPrintAgentRealtimeConfiguration(env = process.env): PrintAgentRealtimeConfiguration | null {
  const url = configuredValue("SUPABASE_URL", env);
  const publishableKey = configuredValue("SUPABASE_PUBLISHABLE_KEY", env);
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return { url: parsed.origin, publishableKey };
  } catch {
    return null;
  }
}

export function getPrintAgentWakeTopic(tokenHash: string): string {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) throw new Error("Invalid Print Agent token identity.");
  return `${PRINT_AGENT_WAKE_TOPIC_PREFIX}${tokenHash}`;
}

export function getPrintAgentWakeTopicFromRawToken(rawToken: string): string {
  return getPrintAgentWakeTopic(crypto.createHash("sha256").update(rawToken).digest("hex"));
}

export async function publishPrintAgentWake(
  tokenHash: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<WakeResult> {
  const env = options.env ?? process.env;
  const realtime = getPrintAgentRealtimeConfiguration(env);
  const serviceRoleKey = configuredValue("SUPABASE_SERVICE_ROLE_KEY", env);
  if (!realtime || !serviceRoleKey) return { published: false, attempts: 0, reason: "realtime_not_configured" };

  const topic = getPrintAgentWakeTopic(tokenHash);
  const endpoint = new URL(`/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${PRINT_AGENT_WAKE_EVENT}`, realtime.url);
  const request = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await request(endpoint, {
        method: "POST",
        headers: { apikey: serviceRoleKey, "content-type": "application/json" },
        // Wake signals intentionally carry no customer, order, job, token, or queue data.
        body: JSON.stringify({ type: PRINT_AGENT_WAKE_EVENT }),
      });
      if (response.ok) return { published: true, attempts: attempt };
      console.warn(`[PRINT AGENT WAKE] Broadcast attempt ${attempt} returned HTTP ${response.status}.`);
    } catch (error) {
      console.warn(`[PRINT AGENT WAKE] Broadcast attempt ${attempt} failed.`, error);
    }
    if (attempt < maxAttempts) await sleep(100);
  }
  return { published: false, attempts: maxAttempts, reason: "publish_failed" };
}
