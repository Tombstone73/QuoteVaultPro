/**
 * Bug Reports Feature Tests
 *
 * Tests: DTO validation for create bug report schema, severity enum validation,
 * org-admin gate logic, and screenshot size assertion helpers.
 *
 * NOTE: These tests inline the pure functions / Zod schemas to avoid pulling in
 * the DB/schema import chain that triggers the known Jest OOM issue in this project.
 * All functions here mirror their counterparts in server/routes/bugReports.ts.
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";

// ─── Inline: create bug report DTO schema ─────────────────────────────────────
// Must stay in sync with server/routes/bugReports.ts createBugReportSchema.

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;

const createBugReportSchema = z.object({
  title:         z.string().min(3, "Title must be at least 3 characters").max(200),
  description:   z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:      z.enum(SEVERITY_VALUES),
  url:           z.string().min(1).max(2000),
  screenWidth:   z.number().int().positive().optional(),
  screenHeight:  z.number().int().positive().optional(),
  screenshotUrl: z.string().url().max(4000).optional().nullable(),
  metadata:      z.record(z.unknown()).optional(),
});

// ─── Inline: list query schema ────────────────────────────────────────────────

const listBugReportsQuerySchema = z.object({
  status:   z.string().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  cursor:   z.string().optional(),
});

// ─── Inline: org-admin gate logic ─────────────────────────────────────────────

function isOrgAdminOrOwner(orgRole?: string): boolean {
  return orgRole === "owner" || orgRole === "admin";
}

// ─── Inline: screenshot size guard ────────────────────────────────────────────

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

function isScreenshotSizeAllowed(sizeBytes: number): boolean {
  return sizeBytes <= MAX_SCREENSHOT_BYTES;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createBugReportSchema", () => {
  const validPayload = {
    title:       "Button click crashes page",
    description: "When I click the Save button on the quote editor, the page goes blank.",
    severity:    "high" as const,
    url:         "https://app.example.com/quotes/edit/123",
  };

  it("accepts a valid minimal payload", () => {
    const result = createBugReportSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts a full payload with all optional fields", () => {
    const result = createBugReportSchema.safeParse({
      ...validPayload,
      screenWidth:   1920,
      screenHeight:  1080,
      screenshotUrl: "https://cdn.example.com/screenshots/abc.png",
      metadata:      { session: "tok_123" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects title shorter than 3 characters", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, title: "ok" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.title).toBeDefined();
    }
  });

  it("rejects title longer than 200 characters", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, title: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects description shorter than 3 characters", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, description: "ab" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.description).toBeDefined();
    }
  });

  it("rejects description longer than 5000 characters", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, description: "d".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("rejects missing url", () => {
    const { url: _url, ...rest } = validPayload;
    const result = createBugReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("treats screenshotUrl null as valid", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, screenshotUrl: null });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid screenshotUrl (not a URL)", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, screenshotUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

describe("severity enum validation", () => {
  const base = {
    title: "Some title here",
    description: "Some description here",
    url: "https://example.com/page",
  };

  it.each(SEVERITY_VALUES)("accepts severity '%s'", (severity) => {
    const result = createBugReportSchema.safeParse({ ...base, severity });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid severity value", () => {
    const result = createBugReportSchema.safeParse({ ...base, severity: "blocker" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty severity", () => {
    const result = createBugReportSchema.safeParse({ ...base, severity: "" });
    expect(result.success).toBe(false);
  });
});

describe("listBugReportsQuerySchema", () => {
  it("applies default limit of 50 when not provided", () => {
    const result = listBugReportsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it("coerces string limit to number", () => {
    const result = listBugReportsQuerySchema.safeParse({ limit: "20" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it("rejects limit over 200", () => {
    const result = listBugReportsQuerySchema.safeParse({ limit: 201 });
    expect(result.success).toBe(false);
  });

  it("accepts valid severity filter", () => {
    const result = listBugReportsQuerySchema.safeParse({ severity: "critical" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity filter", () => {
    const result = listBugReportsQuerySchema.safeParse({ severity: "urgent" });
    expect(result.success).toBe(false);
  });
});

describe("isOrgAdminOrOwner()", () => {
  it("returns true for 'owner'", () => expect(isOrgAdminOrOwner("owner")).toBe(true));
  it("returns true for 'admin'",  () => expect(isOrgAdminOrOwner("admin")).toBe(true));
  it("returns false for 'manager'", () => expect(isOrgAdminOrOwner("manager")).toBe(false));
  it("returns false for 'member'",  () => expect(isOrgAdminOrOwner("member")).toBe(false));
  it("returns false for undefined",  () => expect(isOrgAdminOrOwner(undefined)).toBe(false));
  it("returns false for empty string", () => expect(isOrgAdminOrOwner("")).toBe(false));
});

describe("isScreenshotSizeAllowed()", () => {
  it("allows exactly 5 MB",         () => expect(isScreenshotSizeAllowed(5 * 1024 * 1024)).toBe(true));
  it("allows under 5 MB",           () => expect(isScreenshotSizeAllowed(1 * 1024 * 1024)).toBe(true));
  it("rejects one byte over 5 MB",  () => expect(isScreenshotSizeAllowed(5 * 1024 * 1024 + 1)).toBe(false));
  it("rejects 10 MB",               () => expect(isScreenshotSizeAllowed(10 * 1024 * 1024)).toBe(false));
});
