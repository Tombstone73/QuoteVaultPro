/**
 * Returns true only for the exact, provenance-only text shape written by the
 * former inbound conversion path. Anything containing staff or ambiguous text
 * deliberately remains visible instead of being hidden or rewritten.
 */
export function isClearlyGeneratedInboundProvenance(value: string | null | undefined): boolean {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length >= 3
    && lines[0] === "Created from inbound reviewed draft."
    && /^Inbound record:\s+\S+$/i.test(lines[1])
    && /^Source:\s+.+$/i.test(lines[2])
    && lines.slice(3).every((line) => /^Reference:\s+.+$/i.test(line));
}
