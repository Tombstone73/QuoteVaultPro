import { describe, expect, test } from "@jest/globals";

import { resolveArtworkPreviewLifecycle } from "../services/proofArtworkPreviewLifecycle";

const now = new Date("2026-07-27T12:00:00.000Z");
const base = {
  hasPreview: false,
  isSupported: true,
  sourceAvailable: true,
  pending: false,
  failed: false,
  error: null,
  updatedAt: now,
  now,
};

describe("proof artwork preview lifecycle", () => {
  test("requires a durable pending state before reporting generation", () => {
    expect(resolveArtworkPreviewLifecycle(base).state).toBe("queued");
    expect(resolveArtworkPreviewLifecycle({ ...base, pending: true }).state).toBe("queued");
    expect(resolveArtworkPreviewLifecycle({ ...base, pending: true, updatedAt: new Date(now.getTime() - 20_000) }).state).toBe("processing");
  });

  test("returns available without retrying when a usable derivative exists", () => {
    const lifecycle = resolveArtworkPreviewLifecycle({ ...base, hasPreview: true, pending: true });
    expect(lifecycle).toMatchObject({ state: "available", retryAllowed: false });
  });

  test("turns abandoned processing into an explicit retryable timeout", () => {
    const lifecycle = resolveArtworkPreviewLifecycle({ ...base, pending: true, updatedAt: new Date(now.getTime() - 5 * 60 * 1000) });
    expect(lifecycle).toMatchObject({ state: "timed_out", retryAllowed: true, failureReason: "preview_generation_timed_out" });
  });

  test("keeps permanent failures and unavailable sources distinct", () => {
    expect(resolveArtworkPreviewLifecycle({ ...base, failed: true, error: "renderer unavailable" })).toMatchObject({ state: "failed", retryAllowed: true });
    expect(resolveArtworkPreviewLifecycle({ ...base, sourceAvailable: false })).toMatchObject({ state: "source_unavailable", retryAllowed: true });
  });
});
