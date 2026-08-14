import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const dbMock = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
};

jest.unstable_mockModule("../db", () => ({ db: dbMock }));
jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: () => "org_1",
}));

let registerPbv2OptionGroupTemplateRoutes: any;

function chainSelectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
        orderBy: async () => rows,
      }),
    }),
  };
}

function chainInsertRows(rows: unknown[]) {
  return {
    values: () => ({
      returning: async () => rows,
    }),
  };
}

function chainUpdateRows(rows: unknown[]) {
  return {
    set: () => ({
      where: () => ({
        returning: async () => rows,
      }),
    }),
  };
}

function buildApp(canManageTemplates = true) {
  const app = express();
  app.use(express.json());
  registerPbv2OptionGroupTemplateRoutes(app, {
    isAuthenticated: (req: any, _res: any, next: any) => {
      req.user = { id: "user_1" };
      next();
    },
    tenantContext: (req: any, _res: any, next: any) => {
      req.organizationId = "org_1";
      next();
    },
    isAdmin: (_req: any, res: any, next: any) => {
      if (!canManageTemplates) return res.status(403).json({ message: "Access denied." });
      next();
    },
  });
  return app;
}

const orgTemplate = {
  id: "tpl_org",
  organizationId: "org_1",
  isSystemTemplate: false,
  state: "active",
  name: "Org Template",
  slug: "org-template",
  category: "Finishing",
  templateTree: {},
};

const systemTemplate = {
  ...orgTemplate,
  id: "tpl_system",
  organizationId: null,
  isSystemTemplate: true,
  name: "System Template",
  slug: "system-template",
};

const validTemplateTree = {
  schemaVersion: 2,
  templateKind: "pbv2_option_group_template",
  rootGroupId: "group_lamination",
  rootNodeIds: ["group_lamination"],
  nodes: {
    group_lamination: { id: "group_lamination", type: "GROUP", label: "Lamination" },
    opt_lamination: {
      id: "opt_lamination",
      type: "OPTION",
      label: "Lamination",
      input: { selectionKey: "lamination", type: "select", choices: [{ value: "none", label: "None" }] },
    },
  },
  edges: [{ id: "edge_lamination", fromNodeId: "group_lamination", toNodeId: "opt_lamination", status: "DISABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } }],
  rules: [],
};

describe("PBV2 option group template routes", () => {
  beforeAll(async () => {
    const mod = await import("../routes/pbv2OptionGroupTemplates.routes");
    registerPbv2OptionGroupTemplateRoutes = mod.registerPbv2OptionGroupTemplateRoutes;
  });

  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.insert.mockReset();
    dbMock.update.mockReset();
  });

  test("lists templates through the normal success envelope", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([systemTemplate, orgTemplate]) as never);

    const res = await request(buildApp()).get("/api/pbv2/option-group-templates?scope=all");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.templates).toHaveLength(2);
  });

  test("returns not found envelope for inaccessible templates", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([]) as never);

    const res = await request(buildApp()).get("/api/pbv2/option-group-templates/missing");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Template not found.");
  });

  test("rejects editing system templates", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([systemTemplate]) as never);

    const res = await request(buildApp())
      .patch("/api/pbv2/option-group-templates/tpl_system")
      .send({ description: "Nope" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("archives organization templates without touching products", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([orgTemplate]) as never);
    dbMock.update.mockReturnValue(chainUpdateRows([{ ...orgTemplate, state: "archived" }]) as never);

    const res = await request(buildApp()).post("/api/pbv2/option-group-templates/tpl_org/archive");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.template.state).toBe("archived");
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  test("creates an organization template from a self-contained group", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([]) as never);
    dbMock.insert.mockReturnValue(chainInsertRows([{ ...orgTemplate, id: "created_template" }]) as never);

    const res = await request(buildApp())
      .post("/api/pbv2/option-group-templates/from-group")
      .send({
        name: "Lamination",
        category: "Finishing",
        groupId: "group_lamination",
        treeJson: {
          schemaVersion: 2,
          nodes: {
            group_lamination: { id: "group_lamination", type: "GROUP", label: "Lamination" },
            opt_lamination: {
              id: "opt_lamination",
              type: "OPTION",
              label: "Lamination",
              input: { selectionKey: "lamination", choices: [{ value: "none", label: "None" }] },
            },
          },
          edges: [{ id: "edge_lamination", fromNodeId: "group_lamination", toNodeId: "opt_lamination", status: "DISABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } }],
          rules: [],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  test("does not let a regular member mutate organization templates", async () => {
    const app = buildApp(false);

    const create = await request(app)
      .post("/api/pbv2/option-group-templates/from-group")
      .send({});
    const edit = await request(app)
      .patch("/api/pbv2/option-group-templates/tpl_org")
      .send({ description: "Nope" });
    const archive = await request(app)
      .post("/api/pbv2/option-group-templates/tpl_org/archive");

    expect(create.status).toBe(403);
    expect(edit.status).toBe(403);
    expect(archive.status).toBe(403);
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  test("clone returns a draft preview and does not persist product changes", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([{ ...orgTemplate, templateTree: validTemplateTree }]) as never);

    const res = await request(buildApp())
      .post("/api/pbv2/option-group-templates/tpl_org/clone")
      .send({
        currentTreeJson: { schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [], rootNodeIds: [] },
        importInstanceId: "route_case",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.importedGroupId).toBe("tpl_route_case_group_lamination");
    expect(res.body.data.treeJson.nodes.tpl_route_case_opt_lamination.type).toBe("INPUT");
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  test("failed clone returns validation errors without persisting", async () => {
    dbMock.select.mockReturnValue(chainSelectRows([{ ...orgTemplate, templateTree: { nodes: {}, edges: [] } }]) as never);

    const res = await request(buildApp())
      .post("/api/pbv2/option-group-templates/tpl_org/clone")
      .send({ currentTreeJson: { schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] } });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
