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
import {
  buildFeedbackReferenceNumber,
  formatFeedbackReferenceLabel,
  isFeedbackReferenceNumber,
} from "@shared/feedbackReferenceNumbers";

// ─── Inline: create bug report DTO schema ─────────────────────────────────────
// Must stay in sync with server/routes/bugReports.ts createBugReportSchema.

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const BUG_REPORT_TYPE_VALUES = ["bug", "feature"] as const;

const createBugReportSchema = z.object({
  type:          z.enum(BUG_REPORT_TYPE_VALUES).optional().default("bug"),
  title:         z.string().min(3, "Title must be at least 3 characters").max(200),
  description:   z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:      z.enum(SEVERITY_VALUES),
  url:           z.string().min(1).max(2000),
  screenWidth:   z.number().int().positive().optional(),
  screenHeight:  z.number().int().positive().optional(),
  screenshotUrl: z.string().max(4000).optional().nullable(),
  screenshotUrls: z.array(z.string().max(4000)).max(5).optional(),
  screenshotAttachments: z.array(z.object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().nonnegative(),
    storagePath: z.string().min(1).max(4000),
    displayOrder: z.number().int().min(0),
  })).max(5).optional(),
  metadata:      z.record(z.unknown()).optional(),
});

// ─── Inline: list query schema ────────────────────────────────────────────────

const listBugReportsQuerySchema = z.object({
  status:   z.string().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  type:     z.enum(["bug", "feature", "all"]).default("all"),
  search:   z.string().trim().max(120).optional(),
  sort:     z.enum(["newest", "oldest", "reference_asc", "reference_desc"]).default("newest"),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  cursor:   z.string().optional(),
});

// ─── Inline: org-admin gate logic ─────────────────────────────────────────────

function isOrgAdminOrOwner(orgRole?: string): boolean {
  return orgRole === "owner" || orgRole === "admin";
}

// ─── Inline: screenshot size guard ────────────────────────────────────────────

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_SCREENSHOT_BYTES = 25 * 1024 * 1024; // 25 MB

function isScreenshotSizeAllowed(sizeBytes: number): boolean {
  return sizeBytes <= MAX_SCREENSHOT_BYTES;
}

function isTotalScreenshotSizeAllowed(sizeBytes: number): boolean {
  return sizeBytes <= MAX_TOTAL_SCREENSHOT_BYTES;
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
      type:          "feature",
      screenWidth:   1920,
      screenHeight:  1080,
      screenshotUrl: "https://cdn.example.com/screenshots/abc.png",
      screenshotAttachments: [{
        filename: "abc.png",
        mimeType: "image/png",
        size: 1024,
        storagePath: "org_1/bug-screenshots/temp/abc.png",
        displayOrder: 0,
      }],
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

  it("accepts legacy screenshot paths as well as URLs", () => {
    const result = createBugReportSchema.safeParse({ ...validPayload, screenshotUrl: "local:bug-screenshots/temp/abc.png" });
    expect(result.success).toBe(true);
  });

  it("rejects more than 5 screenshot metadata entries", () => {
    const result = createBugReportSchema.safeParse({
      ...validPayload,
      screenshotAttachments: Array.from({ length: 6 }, (_, index) => ({
        filename: `screen-${index}.png`,
        mimeType: "image/png",
        size: 1000,
        storagePath: `local:bug-screenshots/temp/screen-${index}.png`,
        displayOrder: index,
      })),
    });
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

  it("accepts valid type filter values", () => {
    const bug = listBugReportsQuerySchema.safeParse({ type: "bug" });
    const feature = listBugReportsQuerySchema.safeParse({ type: "feature" });
    const all = listBugReportsQuerySchema.safeParse({ type: "all" });
    expect(bug.success).toBe(true);
    expect(feature.success).toBe(true);
    expect(all.success).toBe(true);
  });

  it("rejects invalid type filter value", () => {
    const result = listBugReportsQuerySchema.safeParse({ type: "other" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid severity filter", () => {
    const result = listBugReportsQuerySchema.safeParse({ severity: "urgent" });
    expect(result.success).toBe(false);
  });

  it("accepts reference search and reference sort", () => {
    const result = listBugReportsQuerySchema.safeParse({ search: "B-0001", sort: "reference_asc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("B-0001");
      expect(result.data.sort).toBe("reference_asc");
    }
  });

  it("rejects invalid sort values", () => {
    const result = listBugReportsQuerySchema.safeParse({ sort: "priority" });
    expect(result.success).toBe(false);
  });
});

describe("feedback reference numbers", () => {
  it("formats separate canonical bug and feature references", () => {
    expect(buildFeedbackReferenceNumber("bug", 1)).toBe("B-0001");
    expect(buildFeedbackReferenceNumber("bug", 42)).toBe("B-0042");
    expect(buildFeedbackReferenceNumber("feature", 1)).toBe("F-0001");
    expect(buildFeedbackReferenceNumber("feature", 17)).toBe("F-0017");
  });

  it("validates and labels permanent references", () => {
    expect(isFeedbackReferenceNumber("B-0001")).toBe(true);
    expect(isFeedbackReferenceNumber("F-0017")).toBe(true);
    expect(isFeedbackReferenceNumber("BUG-1")).toBe(false);
    expect(formatFeedbackReferenceLabel("B-0042", "Design Page Update")).toBe("B-0042 Design Page Update");
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
  it("allows exactly 10 MB",        () => expect(isScreenshotSizeAllowed(10 * 1024 * 1024)).toBe(true));
  it("allows under 10 MB",          () => expect(isScreenshotSizeAllowed(1 * 1024 * 1024)).toBe(true));
  it("rejects one byte over 10 MB", () => expect(isScreenshotSizeAllowed(10 * 1024 * 1024 + 1)).toBe(false));
  it("allows total size exactly 25 MB", () => expect(isTotalScreenshotSizeAllowed(25 * 1024 * 1024)).toBe(true));
  it("rejects total size over 25 MB", () => expect(isTotalScreenshotSizeAllowed(25 * 1024 * 1024 + 1)).toBe(false));
});

// ─── Inline: update status schema ─────────────────────────────────────────────
// Must stay in sync with server/routes/bugReports.ts updateBugReportStatusSchema.

const STATUS_VALUES = ["open", "in_review", "resolved", "closed"] as const;

const updateBugReportStatusSchema = z.object({
  status: z.enum(STATUS_VALUES),
});

describe("updateBugReportStatusSchema", () => {
  it.each(STATUS_VALUES)("accepts status '%s'", (status) => {
    const result = updateBugReportStatusSchema.safeParse({ status });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const result = updateBugReportStatusSchema.safeParse({ status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects when status field is missing", () => {
    const result = updateBugReportStatusSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── Inline: create note schema ───────────────────────────────────────────────
// Must stay in sync with server/routes/bugReports.ts createNoteSchema.

const createNoteSchema = z.object({
  note: z.string().min(1, "Note cannot be empty").max(2000),
});

describe("createNoteSchema", () => {
  it("accepts a valid note", () => {
    const result = createNoteSchema.safeParse({ note: "Confirmed on staging. Will fix in next sprint." });
    expect(result.success).toBe(true);
  });

  it("rejects an empty note", () => {
    const result = createNoteSchema.safeParse({ note: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.note).toBeDefined();
    }
  });

  it("rejects a note exceeding 2000 characters", () => {
    const result = createNoteSchema.safeParse({ note: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("accepts a note of exactly 2000 characters", () => {
    const result = createNoteSchema.safeParse({ note: "a".repeat(2000) });
    expect(result.success).toBe(true);
  });

  it("accepts a single character note", () => {
    const result = createNoteSchema.safeParse({ note: "." });
    expect(result.success).toBe(true);
  });
});
