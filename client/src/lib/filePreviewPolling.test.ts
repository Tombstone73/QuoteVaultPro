import { describe, expect, test } from "@jest/globals";

import {
  FILE_PREVIEW_ACTIVE_POLL_MS,
  FILE_PREVIEW_PROCESSING_TIMEOUT_MS,
  FILE_PREVIEW_SLOW_POLL_MS,
  getFilePreviewPollInterval,
  isFilePreviewProcessingTimedOut,
} from "./filePreviewPolling";

describe("file preview polling", () => {
  const now = Date.parse("2026-07-17T12:01:00.000Z");

  test("polls quickly while preview generation is active", () => {
    const startedAt = new Date(now - FILE_PREVIEW_PROCESSING_TIMEOUT_MS + 1).toISOString();
    expect(getFilePreviewPollInterval("processing", startedAt, now)).toBe(FILE_PREVIEW_ACTIVE_POLL_MS);
    expect(isFilePreviewProcessingTimedOut("processing", startedAt, now)).toBe(false);
  });

  test("keeps polling more slowly after the user-facing processing timeout", () => {
    const startedAt = new Date(now - FILE_PREVIEW_PROCESSING_TIMEOUT_MS).toISOString();
    expect(getFilePreviewPollInterval("processing", startedAt, now)).toBe(FILE_PREVIEW_SLOW_POLL_MS);
    expect(isFilePreviewProcessingTimedOut("processing", startedAt, now)).toBe(true);
  });

  test("stops polling at ready or failed terminal states", () => {
    expect(getFilePreviewPollInterval("ready", null, now)).toBe(false);
    expect(getFilePreviewPollInterval("failed", null, now)).toBe(false);
  });
});
