import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import express, { type NextFunction, type Response } from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { runMigrations } from "../runMigrations";
import { registerProductPlanningRoutes } from "../routes/productPlanning.routes";
import {
  auditLogs,
  bugReports,
  globalVariables,
  organizationAiSettings,
  organizations,
  productPlanningAiAnalyses,
  productPlanningAiSuggestions,
  productPlanningDependencies,
  productPlanningEvents,
  productPlanningImportBatches,
  productPlanningReleases,
  productPlanningWorkItems,
  users,
} from "../../shared/schema";

type AppOptions = {
  orgId: string;
  userId?: string;
  orgRole?: string;
  userRole?: string;
  authenticated?: boolean;
};

const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
}, 90_000);

afterEach(async () => {
  if (cleanupOrgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, [...cleanupOrgIds]));
    cleanupOrgIds.length = 0;
  }
  if (cleanupUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, [...cleanupUserIds]));
    cleanupUserIds.length = 0;
  }
});

function assertInternalUser(req: any, res: Response) {
  if (String(req.user?.role ?? "").toLowerCase() === "customer") {
    res.status(403).json({ success: false, message: "Internal access required." });
    return false;
  }
  return true;
}

function buildApp(options: AppOptions) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (options.authenticated === false) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    req.user = {
      id: options.userId ?? `user_${options.orgId}`,
      claims: { sub: options.userId ?? `user_${options.orgId}` },
      role: options.userRole ?? options.orgRole ?? "admin",
    };
    return next();
  };

  const tenantContext = (req: any, _res: Response, next: NextFunction) => {
    req.organizationId = options.orgId;
    req.orgRole = options.orgRole ?? "admin";
    return next();
  };

  registerProductPlanningRoutes(app, { isAuthenticated, tenantContext, assertInternalUser });
  return app;
}

async function createFixture() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const [org] = await db.insert(organizations).values({
    name: `Product Planning Route ${suffix}`,
    slug: `pp-route-${suffix}`.slice(0, 95),
  }).returning();
  cleanupOrgIds.push(org.id);

  const [user] = await db.insert(users).values({
    email: `pp-route-${suffix}@example.test`,
    firstName: "Product",
    lastName: "Planning",
    role: "admin",
  }).returning();
  cleanupUserIds.push(user.id);

  return { org, user, app: buildApp({ orgId: org.id, userId: user.id }) };
}

async function createWorkItem(
  organizationId: string,
  attrs: Partial<typeof productPlanningWorkItems.$inferInsert> = {},
) {
  const reference = attrs.reference ?? `PP-T-${Math.floor(Math.random() * 100000000)}`;
  const [item] = await db.insert(productPlanningWorkItems).values({
    organizationId,
    reference,
    title: attrs.title ?? `Planning item ${reference}`,
    workItemType: attrs.workItemType ?? "feature",
    planningStatus: attrs.planningStatus ?? "backlog",
    priority: attrs.priority ?? "medium",
    module: attrs.module ?? "Core",
    phase: attrs.phase ?? null,
    sortOrder: attrs.sortOrder ?? null,
    roadmapOrder: attrs.roadmapOrder ?? null,
    releaseTarget: attrs.releaseTarget ?? null,
    releaseId: attrs.releaseId ?? null,
    updatedAt: attrs.updatedAt ?? new Date(),
    ...attrs,
  }).returning();
  return item;
}

async function createRelease(organizationId: string, attrs: Partial<typeof productPlanningReleases.$inferInsert> = {}) {
  const [release] = await db.insert(productPlanningReleases).values({
    organizationId,
    name: attrs.name ?? `Release ${Math.floor(Math.random() * 1000000)}`,
    status: attrs.status ?? "planned",
    targetDate: attrs.targetDate ?? null,
    ...attrs,
  }).returning();
  return release;
}

describe("Product Planning AI readiness route", () => {
  test("reports missing org AI settings without exposing secrets", async () => {
    const { app } = await createFixture();

    const response = await request(app).get("/api/product-planning/ai/readiness");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("missing_org_ai_settings");
    expect(response.body.data.label).toBe("Missing org AI settings");
    expect(response.body.data.feature).toBe("feature_review");
    expect(JSON.stringify(response.body)).not.toContain("sk-");
  });

  test("reports feature_review disabled when org AI settings exist but Product Planning is off", async () => {
    const { org, app } = await createFixture();
    await db.insert(organizationAiSettings).values({
      orgId: org.id,
      mode: "bring_your_own",
      provider: "openai",
      model: "gpt-test",
      isEnabled: true,
      featureReviewEnabled: false,
    });

    const response = await request(app).get("/api/product-planning/ai/readiness");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("feature_review_disabled");
    expect(response.body.data.message).toContain("Feature Review");
  });

  test("reports missing encrypted API key for incomplete bring-your-own Product Planning settings", async () => {
    const { org, app } = await createFixture();
    await db.insert(organizationAiSettings).values({
      orgId: org.id,
      mode: "bring_your_own",
      provider: "openai",
      model: "gpt-test",
      isEnabled: true,
      featureReviewEnabled: true,
    });

    const response = await request(app).get("/api/product-planning/ai/readiness");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("missing_encrypted_api_key");
    expect(response.body.data.hasEncryptedApiKey).toBe(false);
  });

  test("blocks non-dev/non-admin users from AI readiness", async () => {
    const { org, user } = await createFixture();
    const response = await request(buildApp({ orgId: org.id, userId: user.id, orgRole: "staff" }))
      .get("/api/product-planning/ai/readiness");

    expect(response.status).toBe(403);
  });
});

describe("Product Planning detail route", () => {
  test("returns hierarchy, release, source, import, dependencies, blocked-by, and activity", async () => {
    const { org, user, app } = await createFixture();
    const release = await createRelease(org.id, { name: "Detail Release" });
    const [importBatch] = await db.insert(productPlanningImportBatches).values({
      organizationId: org.id,
      filename: "detail-import.csv",
      rowCount: 3,
      importedCount: 2,
      skippedCount: 1,
      status: "completed_with_errors",
      createdByUserId: user.id,
    }).returning();
    const [bugReport] = await db.insert(bugReports).values({
      orgId: org.id,
      referenceNumber: `B-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`,
      createdByUserId: user.id,
      createdByEmail: user.email ?? "detail@example.test",
      title: "Original bug title",
      description: "Original bug description",
      severity: "high",
      url: "https://example.test/detail",
      userAgent: "jest",
      status: "open",
    }).returning();
    const parent = await createWorkItem(org.id, { title: "Parent epic", workItemType: "epic" });
    const blocker = await createWorkItem(org.id, { title: "Blocking dependency", priority: "high" });
    const blockedChild = await createWorkItem(org.id, { title: "Blocked by detail item", priority: "critical" });
    const item = await createWorkItem(org.id, {
      title: "Detailed item",
      parentId: parent.id,
      releaseId: release.id,
      sourceType: "bug_report",
      sourceBugReportId: bugReport.id,
      sourceReference: "CSV-123",
      importedBatchId: importBatch.id,
    });
    const child = await createWorkItem(org.id, { title: "Child item", parentId: item.id, sortOrder: 10 });

    await db.insert(productPlanningDependencies).values([
      {
        organizationId: org.id,
        workItemId: item.id,
        dependsOnWorkItemId: blocker.id,
        dependencyType: "requires",
        createdByUserId: user.id,
      },
      {
        organizationId: org.id,
        workItemId: blockedChild.id,
        dependsOnWorkItemId: item.id,
        dependencyType: "blocks",
        createdByUserId: user.id,
      },
    ]);
    await db.insert(productPlanningEvents).values([
      {
        organizationId: org.id,
        workItemId: item.id,
        eventType: "created",
        message: "Created first",
        createdByUserId: user.id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        organizationId: org.id,
        workItemId: item.id,
        eventType: "updated",
        message: "Updated second",
        createdByUserId: user.id,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const response = await request(app).get(`/api/product-planning/work-items/${item.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: item.id,
      parent: expect.objectContaining({ id: parent.id, reference: parent.reference }),
      release: expect.objectContaining({ id: release.id, name: "Detail Release" }),
      sourceBugReport: expect.objectContaining({ id: bugReport.id, title: "Original bug title" }),
      importBatch: expect.objectContaining({ id: importBatch.id, filename: "detail-import.csv" }),
    }));
    expect(response.body.data.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: child.id, reference: child.reference }),
    ]));
    expect(response.body.data.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workItemId: item.id,
        dependsOnWorkItemId: blocker.id,
        dependsOnWorkItem: expect.objectContaining({ id: blocker.id, reference: blocker.reference }),
      }),
    ]));
    expect(response.body.data.blockedBy).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workItemId: blockedChild.id,
        dependsOnWorkItemId: item.id,
        workItem: expect.objectContaining({ id: blockedChild.id, reference: blockedChild.reference }),
      }),
    ]));
    expect(response.body.data.events.map((event: { message: string }) => event.message)).toEqual(["Updated second", "Created first"]);
  });
});

describe("Product Planning AI suggestion routes", () => {
  test("creates and accepts a suggestion with an event and explicit work item update", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { priority: "medium" });

    const createRes = await request(app)
      .post(`/api/product-planning/work-items/${item.id}/ai-suggestions`)
      .send({
        suggestionType: "priority",
        currentValue: "medium",
        suggestedValue: "high",
        confidence: 82,
        reasoning: "Customer-facing blocker.",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe("pending");

    const acceptRes = await request(app)
      .post(`/api/product-planning/ai-suggestions/${createRes.body.data.id}/accept`)
      .send({});

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.data.suggestion.status).toBe("accepted");
    expect(acceptRes.body.data.workItem.priority).toBe("high");

    const [event] = await db
      .select()
      .from(productPlanningEvents)
      .where(and(eq(productPlanningEvents.organizationId, org.id), eq(productPlanningEvents.workItemId, item.id), eq(productPlanningEvents.eventType, "ai_suggestion_accepted")))
      .limit(1);
    expect(event).toBeTruthy();
  });

  test("rejects a suggestion without changing the work item", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { module: "Quotes" });
    const [suggestion] = await db.insert(productPlanningAiSuggestions).values({
      organizationId: org.id,
      workItemId: item.id,
      suggestionType: "module",
      currentValue: "Quotes",
      suggestedValue: "Invoices",
      confidence: "70",
      reasoning: "Looks billing related.",
    }).returning();

    const rejectRes = await request(app)
      .post(`/api/product-planning/ai-suggestions/${suggestion.id}/reject`)
      .send({});

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe("rejected");

    const [unchanged] = await db
      .select()
      .from(productPlanningWorkItems)
      .where(eq(productPlanningWorkItems.id, item.id))
      .limit(1);
    expect(unchanged.module).toBe("Quotes");
  });

  test("find-duplicates stores duplicate candidate suggestions", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { title: "Customer portal upload fails", module: "Customer Portal", workItemType: "bug" });
    await createWorkItem(org.id, { title: "Customer portal file upload fails", module: "Customer Portal", workItemType: "bug" });

    const response = await request(app)
      .post(`/api/product-planning/work-items/${item.id}/find-duplicates`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionType: "duplicate_candidate", status: "pending" }),
    ]));
  });

  test("import AI review generates cleanup suggestions", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, { title: "Customer portal upload fails", module: "Customer Portal" });

    const response = await request(app)
      .post("/api/product-planning/import/csv/ai-review")
      .send({
        csv: [
          "Title,Priority,Phase,Module",
          "Customer portal upload fails,High,,Customer Portal",
          "Invoice payment issue,High,,",
        ].join("\n"),
        filename: "ai-import.csv",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.suggestions.length).toBeGreaterThan(0);
    expect(response.body.data.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "pending" }),
    ]));
  });

  test("roadmap recommendation generation stores pending suggestions", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, {
      title: "Customer portal release blocker",
      description: "Customer-facing portal workflow affects go live.",
      priority: "high",
      phase: null,
      module: "Customer Portal",
    });

    const response = await request(app)
      .post("/api/product-planning/roadmap/suggest-grouping")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionType: "phase", status: "pending" }),
    ]));
  });

  test("unauthorized and non-dev users are blocked from AI suggestions", async () => {
    const { org } = await createFixture();
    const item = await createWorkItem(org.id);

    const unauthenticated = await request(buildApp({ orgId: org.id, authenticated: false }))
      .post(`/api/product-planning/work-items/${item.id}/ai/analyze`)
      .send({});
    expect(unauthenticated.status).toBe(401);

    const nonDev = await request(buildApp({ orgId: org.id, orgRole: "member", userRole: "member" }))
      .post(`/api/product-planning/work-items/${item.id}/ai/analyze`)
      .send({});
    expect(nonDev.status).toBe(403);
  });

  test("analyze work item generates active planning suggestions", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, {
      title: "Customer portal payment blocker",
      description: null,
      notes: "Blocks go live billing workflow.",
      priority: "medium",
      module: null,
      phase: null,
      releaseTarget: null,
    });

    const response = await request(app)
      .post(`/api/product-planning/work-items/${item.id}/ai/analyze`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.source).toBe("rule_based_fallback");
    expect(response.body.data.fallbackReason).toContain("Live AI unavailable");
    expect(response.body.data.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionType: "priority", status: "pending" }),
      expect.objectContaining({ suggestionType: "implementation_notes", status: "pending" }),
      expect.objectContaining({ suggestionType: "release_recommendation", status: "pending" }),
    ]));
    const [unchanged] = await db.select().from(productPlanningWorkItems).where(eq(productPlanningWorkItems.id, item.id)).limit(1);
    expect(unchanged.priority).toBe("medium");
    expect(unchanged.phase).toBeNull();
  });

  test("analyze backlog returns operational readiness intelligence and stored suggestions", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, { title: "Product Catalog Completion", module: null, phase: null, priority: "critical", description: null, releaseTarget: null });
    await createWorkItem(org.id, { title: "Customer portal login failure", module: "Customer Portal", phase: "go_live", priority: "high", description: "Related duplicate candidate", releaseTarget: null });
    await createWorkItem(org.id, { title: "Inventory purchasing automation", module: "Inventory", phase: null, priority: "high", businessValue: "high", complexity: "small" });
    await createWorkItem(org.id, { title: "Mobile visual search", module: "SaaS", phase: "future", priority: "low", description: "Future SaaS enhancement" });

    const response = await request(app)
      .post("/api/product-planning/ai/analyze-backlog")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.healthScore).toEqual(expect.any(Number));
    expect(response.body.data.nextActions.length).toBeGreaterThan(0);
    expect(response.body.data.executiveSummary).toContain("Product Catalog Completion");
    expect(response.body.data.goLiveBlockers.length).toBeGreaterThan(0);
    expect(response.body.data.topNextActions.length).toBeGreaterThan(0);
    expect(response.body.data.quickWins).toEqual(expect.any(Array));
    expect(response.body.data.futureCandidates.length).toBeGreaterThan(0);
    expect(response.body.data.highestRoiFeatures.length).toBeGreaterThan(0);
    expect(response.body.data.lowestPriorityFeatures.length).toBeGreaterThan(0);
    expect(response.body.data.missingWork).toEqual(expect.any(Array));
    expect(response.body.data.riskAreas).toEqual(expect.any(Array));
    expect(response.body.data.readinessAssessment).toEqual(expect.objectContaining({
      readinessScore: expect.any(Number),
      recommendedNextStep: expect.any(String),
    }));
    expect(response.body.data.goLiveReadiness.blockers.length).toBeGreaterThan(0);
    expect(response.body.data.suggestions.length).toBeGreaterThan(0);
    expect(response.body.data.analysisId).toEqual(expect.any(String));

    const latest = await request(app)
      .get("/api/product-planning/ai/analyses/latest?analysisType=backlog_analysis");
    expect(latest.status).toBe(200);
    expect(latest.body.data).toEqual(expect.objectContaining({
      id: response.body.data.analysisId,
      analysisType: "backlog_analysis",
      source: response.body.data.source,
    }));
    expect(latest.body.data.results.executiveSummary).toContain("Product Catalog Completion");
  });

  test("suggest epics stores advisory epic suggestions", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, { title: "Customer portal login", module: "Customer Portal" });
    await createWorkItem(org.id, { title: "Customer portal upload", module: "Customer Portal" });
    await createWorkItem(org.id, { title: "Customer portal approvals", module: "Customer Portal" });

    const response = await request(app)
      .post("/api/product-planning/ai/suggest-epics")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionType: "parent_epic", status: "pending" }),
    ]));
    expect(response.body.data.epics[0].relatedItems.length).toBeGreaterThan(0);
    expect(response.body.data.epics[0].relatedItems[0]).toEqual(expect.objectContaining({
      reference: expect.any(String),
      reasonIncluded: expect.any(String),
    }));

    const history = await request(app)
      .get("/api/product-planning/ai/analyses?analysisType=epic_suggestions");
    expect(history.status).toBe(200);
    expect(history.body.data[0]).toEqual(expect.objectContaining({
      analysisType: "epic_suggestions",
    }));
  });

  test("creates an epic draft and links curated child items", async () => {
    const { org, app } = await createFixture();
    const first = await createWorkItem(org.id, { title: "Catalog import MVP", workItemType: "feature", reference: `PP-CAT-${Math.floor(Math.random() * 1000000)}` });
    const second = await createWorkItem(org.id, { title: "Catalog validation", workItemType: "task", reference: `PP-CAT-${Math.floor(Math.random() * 1000000)}` });

    const response = await request(app)
      .post("/api/product-planning/ai/epic-drafts")
      .send({
        name: "Product Catalog Completion",
        description: "Complete catalog readiness for go-live.",
        businessValue: "very_high",
        recommendedPhase: "go_live",
        confidence: 92,
        reasoning: "Catalog work blocks operational validation.",
        relatedItemReferences: [first.reference, second.reference],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.epic).toEqual(expect.objectContaining({
      workItemType: "epic",
      title: "Product Catalog Completion",
      phase: "go_live",
      priority: "critical",
    }));
    expect(response.body.data.linkedChildren).toHaveLength(2);

    const children = await db
      .select()
      .from(productPlanningWorkItems)
      .where(and(eq(productPlanningWorkItems.organizationId, org.id), inArray(productPlanningWorkItems.id, [first.id, second.id])));
    expect(children.every((item) => item.parentId === response.body.data.epic.id)).toBe(true);
  });

  test("go-live readiness and backlog health routes return actionable summaries", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, { title: "Go live blocker", phase: "go_live", priority: "critical", workItemType: "bug", description: null });

    const readiness = await request(app)
      .post("/api/product-planning/ai/go-live-readiness")
      .send({});
    const health = await request(app)
      .post("/api/product-planning/ai/backlog-health")
      .send({});

    expect(readiness.status).toBe(201);
    expect(readiness.body.data.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Go live blocker" }),
    ]));
    expect(health.status).toBe(201);
    expect(health.body.data.healthScore).toEqual(expect.any(Number));
    expect(health.body.data.issues).toEqual(expect.any(Array));
  });

  test("import batch analysis reviews imported backlog items", async () => {
    const { org, app } = await createFixture();
    const [batch] = await db.insert(productPlanningImportBatches).values({
      organizationId: org.id,
      filename: "imported-backlog.csv",
      rowCount: 2,
      importedCount: 2,
      status: "completed",
    }).returning();
    await createWorkItem(org.id, { title: "Imported portal login", module: null, phase: null, importedBatchId: batch.id, sourceType: "csv_import" });
    await createWorkItem(org.id, { title: "Imported portal login duplicate", module: "Customer Portal", importedBatchId: batch.id, sourceType: "csv_import" });

    const response = await request(app)
      .post(`/api/product-planning/imports/${batch.id}/analyze`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.counts.totalItems).toBe(2);
    expect(response.body.data.suggestions.length).toBeGreaterThan(0);
  });

  test("roadmap analysis returns recommendations and suggestions", async () => {
    const { org, app } = await createFixture();
    await createWorkItem(org.id, { title: "Future critical portal item", phase: "future", priority: "critical", module: "Customer Portal" });
    await createWorkItem(org.id, { title: "Unassigned go-live blocker", phase: null, priority: "critical", module: "Orders" });

    const response = await request(app)
      .post("/api/product-planning/roadmap/analyze")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data.recommendations.length).toBeGreaterThan(0);
    expect(response.body.data.moveRecommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: expect.any(String), reasoning: expect.any(String) }),
    ]));
    expect(response.body.data.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionType: "phase", status: "pending" }),
    ]));
  });
});

describe("Product Planning admin reset", () => {
  test("blocks non-dev users and requires exact confirmation", async () => {
    const { org, app } = await createFixture();

    const wrongConfirmation = await request(app)
      .post("/api/product-planning/admin/reset")
      .send({ confirmation: "reset" });
    expect(wrongConfirmation.status).toBe(400);
    expect(wrongConfirmation.body.message).toContain("RESET PRODUCT PLANNING");

    const nonDev = await request(buildApp({ orgId: org.id, orgRole: "member", userRole: "member" }))
      .post("/api/product-planning/admin/reset")
      .send({ confirmation: "RESET PRODUCT PLANNING" });
    expect(nonDev.status).toBe(403);
  });

  test("deletes only current tenant Product Planning data, preserves bug reports, and resets reference counter", async () => {
    const { org, user, app } = await createFixture();
    const other = await createFixture();
    const release = await createRelease(org.id, { name: "Operational Readiness" });
    const otherRelease = await createRelease(other.org.id, { name: "Other Org Release" });
    const [batch] = await db.insert(productPlanningImportBatches).values({
      organizationId: org.id,
      filename: "reset-test.csv",
      rowCount: 1,
      importedCount: 1,
      status: "completed",
      createdByUserId: user.id,
    }).returning();
    const item = await createWorkItem(org.id, {
      title: "Reset target item",
      releaseId: release.id,
      importedBatchId: batch.id,
    });
    const dependencyTarget = await createWorkItem(org.id, { title: "Reset dependency target" });
    const otherItem = await createWorkItem(other.org.id, {
      title: "Other org planning item",
      releaseId: otherRelease.id,
    });
    await db.insert(productPlanningDependencies).values({
      organizationId: org.id,
      workItemId: item.id,
      dependsOnWorkItemId: dependencyTarget.id,
      dependencyType: "requires",
      createdByUserId: user.id,
    });
    await db.insert(productPlanningEvents).values({
      organizationId: org.id,
      workItemId: item.id,
      eventType: "created",
      message: "Created for reset test",
      createdByUserId: user.id,
    });
    await db.insert(productPlanningAiSuggestions).values({
      organizationId: org.id,
      workItemId: item.id,
      suggestionType: "priority",
      currentValue: "medium",
      suggestedValue: "critical",
      confidence: "90",
      reasoning: "Reset test suggestion",
    });
    await db.insert(productPlanningAiAnalyses).values({
      organizationId: org.id,
      analysisType: "backlog_analysis",
      source: "rule_based_fallback",
      fallbackReason: "Reset test",
      results: { healthScore: 50 },
      generatedByUserId: user.id,
    });
    await db.insert(globalVariables).values({
      organizationId: org.id,
      name: "product_planning_next_reference",
      value: "42",
      category: "numbering",
      description: "Next Product Planning reference number",
    });
    const [bugReport] = await db.insert(bugReports).values({
      orgId: org.id,
      referenceNumber: `B-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`,
      createdByUserId: user.id,
      createdByEmail: user.email ?? "reset@example.test",
      title: "Bug report must survive reset",
      description: "Do not delete this bug report.",
      severity: "high",
      url: "https://example.test/reset",
      userAgent: "jest",
      status: "open",
    }).returning();

    const response = await request(app)
      .post("/api/product-planning/admin/reset")
      .send({ confirmation: "RESET PRODUCT PLANNING" });

    expect(response.status).toBe(200);
    expect(response.body.data.counts).toEqual(expect.objectContaining({
      productPlanningAiSuggestions: 1,
      productPlanningAiAnalyses: 1,
      productPlanningEvents: 1,
      productPlanningDependencies: 1,
      productPlanningWorkItems: 2,
      productPlanningImportBatches: 1,
      productPlanningReleases: 1,
      productPlanningReferenceCounters: 1,
    }));
    expect(response.body.data.referenceCounterReset).toBe(true);

    const currentOrgItems = await db.select().from(productPlanningWorkItems).where(eq(productPlanningWorkItems.organizationId, org.id));
    const currentOrgBatches = await db.select().from(productPlanningImportBatches).where(eq(productPlanningImportBatches.organizationId, org.id));
    const currentOrgReleases = await db.select().from(productPlanningReleases).where(eq(productPlanningReleases.organizationId, org.id));
    const currentOrgAnalyses = await db.select().from(productPlanningAiAnalyses).where(eq(productPlanningAiAnalyses.organizationId, org.id));
    const currentOrgCounters = await db.select().from(globalVariables).where(and(eq(globalVariables.organizationId, org.id), eq(globalVariables.name, "product_planning_next_reference")));
    const survivingBugReports = await db.select().from(bugReports).where(eq(bugReports.id, bugReport.id));
    const otherOrgItems = await db.select().from(productPlanningWorkItems).where(eq(productPlanningWorkItems.id, otherItem.id));
    const auditRows = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, org.id), eq(auditLogs.actionType, "product_planning_reset")));

    expect(currentOrgItems).toHaveLength(0);
    expect(currentOrgBatches).toHaveLength(0);
    expect(currentOrgReleases).toHaveLength(0);
    expect(currentOrgAnalyses).toHaveLength(0);
    expect(currentOrgCounters).toHaveLength(0);
    expect(survivingBugReports).toHaveLength(1);
    expect(otherOrgItems).toHaveLength(1);
    expect(auditRows.length).toBeGreaterThan(0);

    const createAfterReset = await request(app)
      .post("/api/product-planning/work-items")
      .send({ title: "First item after reset", priority: "high" });
    expect(createAfterReset.status).toBe(201);
    expect(createAfterReset.body.data.reference).toBe("PP-0001");
  });
});

describe("Product Planning dashboard drill-down filters", () => {
  test("filters missing fields, orphaned epics, possible duplicates, and releases", async () => {
    const { org, app } = await createFixture();
    const release = await createRelease(org.id, { name: "Filtered Release" });
    const missingModule = await createWorkItem(org.id, { title: "Missing module", module: null });
    const missingPhase = await createWorkItem(org.id, { title: "Missing phase", phase: null });
    const missingRelease = await createWorkItem(org.id, { title: "Missing release", releaseId: null, releaseTarget: null });
    const assignedRelease = await createWorkItem(org.id, { title: "Assigned release", releaseId: release.id });
    const orphanedEpic = await createWorkItem(org.id, { title: "Orphaned epic", workItemType: "epic" });
    await createWorkItem(org.id, { title: "Duplicate title", module: "Catalog" });
    await createWorkItem(org.id, { title: "Duplicate title", module: "Catalog" });

    const missingModuleResponse = await request(app).get("/api/product-planning/work-items?missingModule=true");
    expect(missingModuleResponse.status).toBe(200);
    expect(missingModuleResponse.body.data.map((item: { id: string }) => item.id)).toContain(missingModule.id);

    const missingPhaseResponse = await request(app).get("/api/product-planning/work-items?missingPhase=true");
    expect(missingPhaseResponse.body.data.map((item: { id: string }) => item.id)).toContain(missingPhase.id);

    const missingReleaseResponse = await request(app).get("/api/product-planning/work-items?missingRelease=true");
    expect(missingReleaseResponse.body.data.map((item: { id: string }) => item.id)).toContain(missingRelease.id);
    expect(missingReleaseResponse.body.data.map((item: { id: string }) => item.id)).not.toContain(assignedRelease.id);

    const orphanedEpicResponse = await request(app).get("/api/product-planning/work-items?orphanedEpic=true");
    expect(orphanedEpicResponse.body.data.map((item: { id: string }) => item.id)).toContain(orphanedEpic.id);

    const releaseResponse = await request(app).get(`/api/product-planning/work-items?releaseId=${release.id}`);
    expect(releaseResponse.body.data.map((item: { id: string }) => item.id)).toEqual([assignedRelease.id]);

    const duplicateResponse = await request(app).get("/api/product-planning/work-items?possibleDuplicates=true");
    expect(duplicateResponse.body.data).toHaveLength(2);
  });
});

describe("Product Planning bug report bulk push", () => {
  test("pushes selected eligible bug reports and preserves original reports", async () => {
    const { org, user, app } = await createFixture();
    const referenceSeed = Math.floor(Math.random() * 900000) + 100000;
    const bugValues = [1, 2].map((index) => ({
      orgId: org.id,
      referenceNumber: `B-${referenceSeed + index}`,
      createdByUserId: user.id,
      createdByEmail: user.email ?? "bulk@example.test",
      title: `Bulk bug ${index}`,
      description: `Bulk bug ${index} description`,
      severity: index === 1 ? "high" as const : "critical" as const,
      url: `https://example.test/bug-${index}`,
      userAgent: "jest",
      status: "open",
    }));
    const inserted = await db.insert(bugReports).values(bugValues).returning();

    const response = await request(app)
      .post("/api/bug-reports/push-to-product-planning/bulk")
      .send({ mode: "selected", ids: inserted.map((bugReport) => bugReport.id) });

    expect(response.status).toBe(201);
    expect(response.body.data.created).toHaveLength(2);

    const planningItems = await db
      .select()
      .from(productPlanningWorkItems)
      .where(and(eq(productPlanningWorkItems.organizationId, org.id), inArray(productPlanningWorkItems.sourceBugReportId, inserted.map((bugReport) => bugReport.id))));
    const survivingBugReports = await db
      .select()
      .from(bugReports)
      .where(inArray(bugReports.id, inserted.map((bugReport) => bugReport.id)));

    expect(planningItems).toHaveLength(2);
    expect(planningItems.every((item) => item.sourceType === "bug_report")).toBe(true);
    expect(survivingBugReports).toHaveLength(2);
  });
});

describe("Product Planning movement routes", () => {
  test("move-status updates planningStatus and writes an event", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { planningStatus: "backlog" });

    const response = await request(app)
      .post(`/api/product-planning/work-items/${item.id}/move-status`)
      .send({ planningStatus: "testing", sortOrder: 30 });

    expect(response.status).toBe(200);
    expect(response.body.data.planningStatus).toBe("testing");
    expect(response.body.data.sortOrder).toBe(30);

    const [event] = await db
      .select()
      .from(productPlanningEvents)
      .where(and(eq(productPlanningEvents.organizationId, org.id), eq(productPlanningEvents.workItemId, item.id), eq(productPlanningEvents.eventType, "status_changed")))
      .limit(1);
    expect(event).toBeTruthy();
  });

  test("move-phase updates phase and writes an event", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { phase: null });

    const response = await request(app)
      .post(`/api/product-planning/work-items/${item.id}/move-phase`)
      .send({ phase: "v1_5", roadmapOrder: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.phase).toBe("v1_5");
    expect(response.body.data.roadmapOrder).toBe(20);

    const [event] = await db
      .select()
      .from(productPlanningEvents)
      .where(and(eq(productPlanningEvents.organizationId, org.id), eq(productPlanningEvents.workItemId, item.id), eq(productPlanningEvents.eventType, "phase_changed")))
      .limit(1);
    expect(event).toBeTruthy();
  });

  test("reorder updates sortOrder and roadmapOrder", async () => {
    const { org, app } = await createFixture();
    const first = await createWorkItem(org.id, { sortOrder: 10, roadmapOrder: 10 });
    const second = await createWorkItem(org.id, { sortOrder: 20, roadmapOrder: 20 });

    const response = await request(app)
      .post("/api/product-planning/work-items/reorder")
      .send({
        items: [
          { id: first.id, sortOrder: 20, roadmapOrder: 40, planningStatus: "ready", phase: "go_live" },
          { id: second.id, sortOrder: 10, roadmapOrder: 30, planningStatus: "ready", phase: "go_live" },
        ],
      });

    expect(response.status).toBe(200);
    const rows = await db
      .select()
      .from(productPlanningWorkItems)
      .where(and(eq(productPlanningWorkItems.organizationId, org.id), inArray(productPlanningWorkItems.id, [first.id, second.id])));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first.id)?.sortOrder).toBe(20);
    expect(byId.get(first.id)?.roadmapOrder).toBe(40);
    expect(byId.get(second.id)?.sortOrder).toBe(10);
    expect(byId.get(second.id)?.roadmapOrder).toBe(30);
  });

  test("invalid item IDs fail safely", async () => {
    const { app } = await createFixture();

    const moveStatus = await request(app)
      .post("/api/product-planning/work-items/missing-id/move-status")
      .send({ planningStatus: "testing" });
    expect(moveStatus.status).toBe(404);

    const reorder = await request(app)
      .post("/api/product-planning/work-items/reorder")
      .send({ items: [{ id: "missing-id", sortOrder: 10 }] });
    expect(reorder.status).toBe(404);
    expect(reorder.body.success).toBe(false);
  });

  test("unauthorized and non-dev users are blocked", async () => {
    const { org } = await createFixture();
    const item = await createWorkItem(org.id);

    const unauthenticated = await request(buildApp({ orgId: org.id, authenticated: false }))
      .post(`/api/product-planning/work-items/${item.id}/move-status`)
      .send({ planningStatus: "testing" });
    expect(unauthenticated.status).toBe(401);

    const nonDev = await request(buildApp({ orgId: org.id, orgRole: "member", userRole: "member" }))
      .post(`/api/product-planning/work-items/${item.id}/move-status`)
      .send({ planningStatus: "testing" });
    expect(nonDev.status).toBe(403);
  });
});

describe("Product Planning release routes", () => {
  test("creates a release, assigns a work item, and reports release progress", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id, { releaseTarget: null });

    const createReleaseRes = await request(app)
      .post("/api/product-planning/releases")
      .send({ name: "Version Test", targetDate: "2026-07-01" });

    expect(createReleaseRes.status).toBe(201);
    const releaseId = createReleaseRes.body.data.id;

    const assignRes = await request(app)
      .patch(`/api/product-planning/work-items/${item.id}`)
      .send({ releaseId, releaseTarget: "Version Test" });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.data.releaseId).toBe(releaseId);
    expect(assignRes.body.data.releaseTarget).toBe("Version Test");

    const dashboard = await request(app).get("/api/product-planning/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.releaseProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: releaseId, totalCount: 1, openCount: 1, releasedCount: 0 }),
    ]));
  });

  test("invalid release assignment fails safely", async () => {
    const { org, app } = await createFixture();
    const item = await createWorkItem(org.id);

    const response = await request(app)
      .patch(`/api/product-planning/work-items/${item.id}`)
      .send({ releaseId: "missing-release" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test("unauthorized and non-dev users are blocked", async () => {
    const { org } = await createFixture();

    const unauthenticated = await request(buildApp({ orgId: org.id, authenticated: false }))
      .post("/api/product-planning/releases")
      .send({ name: "Blocked Release" });
    expect(unauthenticated.status).toBe(401);

    const nonDev = await request(buildApp({ orgId: org.id, orgRole: "member", userRole: "member" }))
      .post("/api/product-planning/releases")
      .send({ name: "Blocked Release" });
    expect(nonDev.status).toBe(403);
  });
});

describe("Product Planning dependency routes", () => {
  test("creates and removes a dependency", async () => {
    const { org, app } = await createFixture();
    const workItem = await createWorkItem(org.id);
    const blocker = await createWorkItem(org.id, { title: "Blocking item" });

    const createRes = await request(app)
      .post(`/api/product-planning/work-items/${workItem.id}/dependencies`)
      .send({ dependsOnWorkItemId: blocker.id, dependencyType: "requires" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.dependsOnWorkItemId).toBe(blocker.id);

    const listRes = await request(app).get(`/api/product-planning/work-items/${workItem.id}/dependencies`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].dependsOnWorkItem.reference).toBe(blocker.reference);

    const deleteRes = await request(app)
      .delete(`/api/product-planning/work-items/${workItem.id}/dependencies/${createRes.body.data.id}`);
    expect(deleteRes.status).toBe(200);

    const rows = await db
      .select()
      .from(productPlanningDependencies)
      .where(and(eq(productPlanningDependencies.organizationId, org.id), eq(productPlanningDependencies.workItemId, workItem.id)));
    expect(rows).toHaveLength(0);
  });

  test("prevents self, duplicate, and circular dependencies", async () => {
    const { org, app } = await createFixture();
    const first = await createWorkItem(org.id);
    const second = await createWorkItem(org.id);

    const self = await request(app)
      .post(`/api/product-planning/work-items/${first.id}/dependencies`)
      .send({ dependsOnWorkItemId: first.id, dependencyType: "requires" });
    expect(self.status).toBe(400);

    const created = await request(app)
      .post(`/api/product-planning/work-items/${first.id}/dependencies`)
      .send({ dependsOnWorkItemId: second.id, dependencyType: "requires" });
    expect(created.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/product-planning/work-items/${first.id}/dependencies`)
      .send({ dependsOnWorkItemId: second.id, dependencyType: "requires" });
    expect(duplicate.status).toBe(409);

    const circular = await request(app)
      .post(`/api/product-planning/work-items/${second.id}/dependencies`)
      .send({ dependsOnWorkItemId: first.id, dependencyType: "requires" });
    expect(circular.status).toBe(400);
  });

  test("dashboard unresolved dependency count reflects open dependencies", async () => {
    const { org, app } = await createFixture();
    const workItem = await createWorkItem(org.id, { priority: "high" });
    const blocker = await createWorkItem(org.id, { planningStatus: "in_progress" });

    await request(app)
      .post(`/api/product-planning/work-items/${workItem.id}/dependencies`)
      .send({ dependsOnWorkItemId: blocker.id, dependencyType: "requires" })
      .expect(201);

    const dashboard = await request(app).get("/api/product-planning/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.unresolvedDependencyCount).toBe(1);
    expect(dashboard.body.data.itemsWithUnresolvedDependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workItem.id }),
    ]));
  });

  test("unauthorized and non-dev users are blocked", async () => {
    const { org } = await createFixture();
    const workItem = await createWorkItem(org.id);
    const blocker = await createWorkItem(org.id);

    const unauthenticated = await request(buildApp({ orgId: org.id, authenticated: false }))
      .post(`/api/product-planning/work-items/${workItem.id}/dependencies`)
      .send({ dependsOnWorkItemId: blocker.id });
    expect(unauthenticated.status).toBe(401);

    const nonDev = await request(buildApp({ orgId: org.id, orgRole: "member", userRole: "member" }))
      .post(`/api/product-planning/work-items/${workItem.id}/dependencies`)
      .send({ dependsOnWorkItemId: blocker.id });
    expect(nonDev.status).toBe(403);
  });
});

describe("Product Planning dashboard aggregates", () => {
  test("reports bug counts, stalled validation, dependencies, module workload, and release progress", async () => {
    const { org, app } = await createFixture();
    const release = await createRelease(org.id, { name: "Dashboard Release" });
    const staleDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const criticalBug = await createWorkItem(org.id, { title: "Critical bug", workItemType: "bug", priority: "critical", module: "Bugs" });
    await createWorkItem(org.id, { title: "High bug", workItemType: "bug", priority: "high", module: "Bugs" });
    const stalled = await createWorkItem(org.id, {
      title: "Stalled validation",
      planningStatus: "dev_validation",
      module: "Validation",
      updatedAt: staleDate,
    });
    const blocker = await createWorkItem(org.id, { title: "Open blocker", planningStatus: "in_progress", module: "Dependencies" });
    const assignedReleased = await createWorkItem(org.id, { title: "Released item", planningStatus: "released", releaseId: release.id, module: "Release" });
    await createWorkItem(org.id, { title: "Open release item", planningStatus: "ready", releaseId: release.id, module: "Release" });

    await db.insert(productPlanningDependencies).values({
      organizationId: org.id,
      workItemId: criticalBug.id,
      dependsOnWorkItemId: blocker.id,
      dependencyType: "requires",
    });

    const dashboard = await request(app).get("/api/product-planning/dashboard");

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.criticalOpenBugCount).toBe(1);
    expect(dashboard.body.data.highOpenBugCount).toBe(1);
    expect(dashboard.body.data.openBugCount).toBe(2);
    expect(dashboard.body.data.itemsStalledInValidation).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stalled.id }),
    ]));
    expect(dashboard.body.data.unresolvedDependencyCount).toBe(1);
    expect(dashboard.body.data.byModuleWorkload).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "Bugs", count: 2 }),
      expect.objectContaining({ key: "Release", count: 2 }),
    ]));
    expect(dashboard.body.data.releaseProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: release.id, totalCount: 2, releasedCount: 1, openCount: 1 }),
    ]));
    expect(assignedReleased.id).toBeTruthy();
  });
});
