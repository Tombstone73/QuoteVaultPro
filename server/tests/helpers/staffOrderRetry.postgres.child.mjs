import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { register } from "node:module";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

assert.ok(process.env.STAFF_ORDER_RETRY_FIXTURE && process.send, "Start from the disposable parent suite");
const url = new URL(process.env.TEST_DATABASE_URL);
const root = realpathSync("node_modules/.cache/inbound-pg-validation/data").replaceAll("\\", "/");
const marker = JSON.parse(readFileSync("node_modules/.cache/inbound-pg-validation/owner.json", "utf8"));
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/printershero_inbound_test");
assert.deepEqual(marker, { directory: root, port: Number(url.port), database: url.pathname.slice(1) });
const verification = new Pool({ connectionString: url.href });
try {
  const { rows } = await verification.query(`select current_database() as name, host(inet_server_addr()) as host,
    current_setting('data_directory') as directory, to_regclass('public.staff_order_create_requests')::text as receipt`);
  assert.equal(rows[0].directory.replaceAll("\\", "/"), root);
  assert.equal(rows[0].host, url.hostname);
  assert.equal(rows[0].name, url.pathname.slice(1));
  assert.equal(rows[0].receipt, "staff_order_create_requests");
} finally {
  await verification.end();
}

process.env.DATABASE_URL = url.href;
const localDriver = new URL("./localPostgresDriver.mjs", import.meta.url).href;
const loader = `
  export function resolve(specifier, context, next) {
    if (specifier === "@neondatabase/serverless") return { url: ${JSON.stringify(localDriver)}, shortCircuit: true };
    if (specifier === "drizzle-orm/neon-serverless") return next("drizzle-orm/node-postgres", context);
    return next(specifier, context);
  }
`;
register("data:text/javascript," + encodeURIComponent(loader), import.meta.url);
const { pool } = await import("../../db.ts");
try {
  const { org, actor, input, key } = JSON.parse(process.env.STAFF_ORDER_RETRY_FIXTURE);
  const { registerOrderRoutes } = await import("../../routes/orders.routes.ts");
  const app = express();
  app.use(express.json());
  const fixture = (req, _res, next) => {
    req.organizationId = org;
    req.user = { id: actor };
    req.orgRole = "admin";
    next();
  };
  await registerOrderRoutes(app, { isAuthenticated: fixture, tenantContext: fixture, isAdmin: fixture, isAdminOrOwner: fixture });
  const start = new Promise(resolve => process.once("message", resolve));
  process.send({ kind: "ready" });
  await start;
  const response = await request(app).post("/api/orders").set("Idempotency-Key", key).send(input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const orderId = response.body.data.order.id;
  assert.ok(orderId);
  await new Promise((resolve, reject) => process.send({ kind: "result", orderId }, error => {
    if (error) reject(error);
    else resolve();
  }));
} finally {
  await pool.end();
  process.disconnect();
}
