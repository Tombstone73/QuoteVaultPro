const DEFAULT_ORDER_CREATION_IDEMPOTENCY_WINDOW_MS = 2 * 60 * 1000;

type IdempotencyEntry<T> = {
  fingerprint: string;
  expiresAt: number;
  promise: Promise<T>;
};

export class OrderCreationIdempotencyStore {
  private entries = new Map<string, IdempotencyEntry<unknown>>();

  constructor(private readonly windowMs = DEFAULT_ORDER_CREATION_IDEMPOTENCY_WINDOW_MS) {}

  async run<T>(
    input: {
      scope: string;
      key: string | null | undefined;
      fingerprint: string;
    },
    operation: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = normalizeIdempotencyKey(input.key);
    if (!key) {
      return { value: await operation(), replayed: false };
    }

    const now = Date.now();
    this.cleanup(now);
    const scopedKey = `${input.scope}:${key}`;
    const existing = this.entries.get(scopedKey);

    if (existing && existing.expiresAt > now) {
      if (existing.fingerprint !== input.fingerprint) {
        throw Object.assign(new Error("Idempotency key was reused with a different order creation payload."), {
          statusCode: 409,
          code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        });
      }

      return { value: (await existing.promise) as T, replayed: true };
    }

    const promise = Promise.resolve().then(operation);
    this.entries.set(scopedKey, {
      fingerprint: input.fingerprint,
      expiresAt: now + this.windowMs,
      promise,
    });

    try {
      return { value: await promise, replayed: false };
    } catch (error) {
      this.entries.delete(scopedKey);
      throw error;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private cleanup(now: number): void {
    this.entries.forEach((entry, key) => {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    });
  }
}

export const orderCreationIdempotencyStore = new OrderCreationIdempotencyStore();

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 255);
}

export function extractOrderCreationIdempotencyKey(req: {
  body?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): string | null {
  return normalizeIdempotencyKey(
    req.body?.idempotencyKey ??
      req.headers?.["idempotency-key"] ??
      req.headers?.["x-idempotency-key"],
  );
}

export function buildOrderCreationFingerprint(input: unknown): string {
  return stableStringify(stripIdempotencyKeys(input));
}

function stripIdempotencyKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdempotencyKeys);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "idempotencyKey") continue;
    output[key] = stripIdempotencyKeys(child);
  }
  return output;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
