type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > 100) throw new Error("PBV2 signature input too deep");

  if (value === null) return;
  const t = typeof value;
  if (t === "boolean" || t === "string") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("PBV2 signature input contains non-finite number");
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) assertJsonValue(v, depth + 1);
    return;
  }

  if (value && t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error("PBV2 signature input must be plain JSON objects");
    }
    for (const v of Object.values(value as Record<string, unknown>)) assertJsonValue(v, depth + 1);
    return;
  }

  throw new Error("PBV2 signature input contains non-JSON value");
}

export function canonicalizeJson(value: unknown): string {
  assertJsonValue(value);

  const walk = (v: JsonValue): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      // JSON.stringify handles -0 => 0, and finite numbers
      return JSON.stringify(v);
    }
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;

    const obj = v as Record<string, JsonValue>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${walk(obj[k])}`);
    }
    return `{${parts.join(",")}}`;
  };

  return walk(value);
}

async function sha256Hex(input: string): Promise<string> {
  const globalCrypto: any = (globalThis as any).crypto;
  if (globalCrypto?.subtle && typeof TextEncoder !== "undefined") {
    const data = new TextEncoder().encode(input);
    const digest = await globalCrypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  // Node fallback (and works in Jest even if webcrypto isn't present)
  const cryptoMod: any = await import("node:crypto");
  return cryptoMod.createHash("sha256").update(input).digest("hex");
}

export async function computePbv2InputSignature(args: {
  treeVersionId: string;
  explicitSelections: unknown;
  env: unknown;
}): Promise<string> {
  const payload = {
    treeVersionId: String(args.treeVersionId || ""),
    explicitSelections: args.explicitSelections as unknown,
    env: args.env as unknown,
  };

  // Ensure values are JSON-safe before hashing.
  assertJsonValue(payload);

  const canonical = canonicalizeJson(payload);
  return sha256Hex(canonical);
}

export function pickPbv2EnvExtras(env: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const src = env && typeof env === "object" ? env : {};
  const out: Record<string, unknown> = {};

  // Strip computed keys so that staleness reflects current line item fields.
  const blocked = new Set(["widthIn", "heightIn", "qty", "quantity", "sqft", "perimeterIn"]);
  for (const [k, v] of Object.entries(src)) {
    if (blocked.has(k)) continue;
    // Keep JSON-safe, finite numbers only.
    if (v === null || typeof v === "boolean" || typeof v === "string") out[k] = v;
    else if (isFiniteNumber(v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v as any;
    else if (v && typeof v === "object") out[k] = v as any;
  }

  return out;
}
