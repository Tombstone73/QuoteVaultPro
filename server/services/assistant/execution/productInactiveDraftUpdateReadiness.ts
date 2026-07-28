export function blockingReadinessFindings(readiness: { status: string; findings: readonly string[] }): string[] {
  return readiness.status === "blocked" ? [...readiness.findings] : [];
}
