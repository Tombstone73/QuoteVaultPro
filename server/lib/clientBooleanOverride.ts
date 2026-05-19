export function getClientBooleanOverride(body: unknown, fieldName: string): boolean | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, fieldName)) return null;
  return typeof record[fieldName] === "boolean" ? record[fieldName] : null;
}
