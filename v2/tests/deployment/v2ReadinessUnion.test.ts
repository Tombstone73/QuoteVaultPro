import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { assertPreparedQuoteDeliverySchema } from "../../infrastructure/sales/commercialPhysicalPostconditions.js";
import { assertShipmentSenderSchema } from "../../infrastructure/fulfillment/shipmentSenderPhysicalPostconditions.js";
import { assertQuickBooksRecoveryPhysicalPostconditions } from "../../infrastructure/accounting/quickBooksRecoveryPhysicalPostconditions.js";
import { assertQuotePublicationSchema } from "../../infrastructure/sales/quotePublicationPhysicalPostconditions.js";
import { assertProductionExclusiveMembershipSchema } from "../../infrastructure/production/productionExclusiveMembershipPhysicalPostconditions.js";
import { loadV2RuntimeConfig } from "../../src/config/runtimeConfig.js";
import { createV2HttpApp } from "../../src/interfaces/http/app.js";

const gates = [
  { symbol: "assertPreparedQuoteDeliverySchema", module: "../../infrastructure/sales/commercialPhysicalPostconditions.js", run: assertPreparedQuoteDeliverySchema, marker: "prepared_evidence_json", parameters: 0 },
  { symbol: "assertShipmentSenderSchema", module: "../../infrastructure/fulfillment/shipmentSenderPhysicalPostconditions.js", run: assertShipmentSenderSchema, marker: "sender_snapshot", parameters: 2 },
  { symbol: "assertQuickBooksRecoveryPhysicalPostconditions", module: "../../infrastructure/accounting/quickBooksRecoveryPhysicalPostconditions.js", run: assertQuickBooksRecoveryPhysicalPostconditions, marker: "v2_quickbooks_provider_requests", parameters: 1 },
  { symbol: "assertQuotePublicationSchema", module: "../../infrastructure/sales/quotePublicationPhysicalPostconditions.js", run: assertQuotePublicationSchema, marker: "v2_sales_quote_delivery_attempts_checkpoint_success_uidx", parameters: 0 },
  { symbol: "assertProductionExclusiveMembershipSchema", module: "../../infrastructure/production/productionExclusiveMembershipPhysicalPostconditions.js", run: assertProductionExclusiveMembershipSchema, marker: "v2_production_run_allocations_exclusive_active_uidx", parameters: 3 },
] as const;
const filename = new URL("../../src/deployment/server.ts", import.meta.url);
const source = ts.createSourceFile(filename.pathname, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const imports = source.statements.filter(ts.isImportDeclaration);
for (const binding of [...gates, { symbol: "createV2HttpApp", module: "../interfaces/http/app.js" }]) {
  const matches = imports.flatMap(declaration => {
    const names = declaration.importClause?.namedBindings;
    return names && ts.isNamedImports(names)
      ? names.elements.filter(element => element.name.text === binding.symbol).map(element => ({ declaration, element }))
      : [];
  });
  assert.equal(matches.length, 1, `${binding.symbol} must have exactly one deployment import`);
  const { declaration, element } = matches[0];
  assert.ok(ts.isStringLiteral(declaration.moduleSpecifier));
  assert.equal(declaration.moduleSpecifier.text, binding.module);
  assert.equal(declaration.importClause?.isTypeOnly, false);
  assert.equal(element.isTypeOnly, false);
  assert.equal(element.propertyName, undefined, "readiness imports must retain their exact symbols");
}

const declarations = source.statements.filter(ts.isVariableStatement).flatMap(statement =>
  statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "createV2DeploymentApp")
    .map(declaration => ({ statement, declaration })));
assert.equal(declarations.length, 1, "deployment factory location must be unambiguous");
const { statement, declaration } = declarations[0];
assert.ok(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
assert.ok(declaration.initializer && ts.isArrowFunction(declaration.initializer));
assert.ok(ts.isBlock(declaration.initializer.body));
assert.deepEqual(declaration.initializer.parameters.slice(0, 3).map(parameter => parameter.name.getText(source)), ["config", "pool", "logger"]);
const factoryBody = declaration.initializer.body;
const returns = factoryBody.statements.filter(ts.isReturnStatement);
assert.equal(returns.length, 1, "factory must directly return its sole HTTP app");
const appCall = returns[0].expression;
assert.ok(appCall && ts.isCallExpression(appCall));
assert.ok(ts.isIdentifier(appCall.expression) && appCall.expression.text === "createV2HttpApp");
const appCalls: ts.CallExpression[] = [];
const visit = (node: ts.Node): void => {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isBindingElement(node)) {
    assert.ok(!node.name || !gates.some(gate => node.name!.getText(source) === gate.symbol)
      && node.name.getText(source) !== "createV2HttpApp", "factory must not shadow the verified readiness imports");
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createV2HttpApp") appCalls.push(node);
  ts.forEachChild(node, visit);
};
visit(factoryBody);
assert.deepEqual(appCalls, [appCall], "nested or alternate HTTP app calls are ambiguous");
assert.equal(appCall.arguments[0]?.getText(source), "config");
assert.equal(appCall.arguments[1]?.getText(source), "logger");
const callback = appCall.arguments[2];
assert.ok(callback && ts.isArrowFunction(callback), "readiness must be the actual third app argument");
assert.equal(callback.parameters.length, 0);
assert.equal(callback.type, undefined);
assert.ok(callback.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
assert.ok(ts.isBlock(callback.body));
assert.equal(callback.body.statements.length, 1, "readiness cannot contain a connectivity fallback or extra effects");
const guarded = callback.body.statements[0];
assert.ok(ts.isTryStatement(guarded));
assert.equal(guarded.finallyBlock, undefined);
assert.ok(guarded.catchClause);
assert.equal(guarded.catchClause.variableDeclaration, undefined);
assert.equal(guarded.tryBlock.statements.length, gates.length + 1);
for (const [index, gate] of gates.entries()) {
  const step = guarded.tryBlock.statements[index];
  assert.ok(ts.isExpressionStatement(step) && ts.isAwaitExpression(step.expression), `${gate.symbol} must be sequentially awaited`);
  const call = step.expression.expression;
  assert.ok(ts.isCallExpression(call) && ts.isIdentifier(call.expression));
  assert.equal(call.expression.text, gate.symbol, "readiness gate order must match the integrated union");
  assert.equal(call.typeArguments, undefined);
  assert.equal(call.arguments.length, 1);
  assert.ok(ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === "pool");
}
assert.equal(guarded.catchClause.block.statements.length, 1);
for (const [result, ready] of [[guarded.tryBlock.statements[gates.length], true], [guarded.catchClause.block.statements[0], false]] as const) {
  assert.ok(ts.isReturnStatement(result) && result.expression && ts.isObjectLiteralExpression(result.expression));
  assert.equal(result.expression.properties.length, 1);
  const property = result.expression.properties[0];
  assert.ok(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name));
  assert.equal(property.name.text, "ready");
  assert.equal(property.initializer.kind, ready ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword);
}

type Query = Readonly<{ sql: string; parameters: readonly unknown[] }>;
type Pool = Readonly<{ query: (sql: string, parameters?: readonly unknown[]) => Promise<{ rows: unknown[] }> }>;
// Evaluate only the structurally verified source expression, never the deployment module.
const bindCallback = new Function(...gates.map(gate => gate.symbol), "pool", `"use strict"; return (${callback.getText(source)});`) as
  (...bindings: unknown[]) => () => Promise<{ ready: boolean }>;
const expectedQueries: Query[] = [];
for (const gate of gates) {
  const queries: Query[] = [];
  await gate.run({ query: async (sql: string, parameters?: readonly unknown[]) => {
    queries.push({ sql, parameters: parameters ?? [] });
    return { rows: [{ ready: true }] };
  } } as never);
  assert.equal(queries.length, 1, `${gate.symbol} must perform exactly one catalog query`);
  assert.match(queries[0].sql.trimStart(), /^(SELECT|WITH)\b/);
  assert.ok(queries[0].sql.includes(gate.marker), `${gate.symbol} must inspect its owner catalog`);
  assert.equal(queries[0].parameters.length, gate.parameters);
  assert.ok(queries[0].parameters.every(parameter => typeof parameter === "string"));
  expectedQueries.push(queries[0]);
  await assert.rejects(() => gate.run({ query: async () => ({ rows: [{ ready: "true" }] }) } as never),
    `${gate.symbol} must reject a truthy non-boolean catalog result`);
}

const syntheticError = "SyntheticErrorMessage: protected readiness catalog unavailable";
const scenarios: Array<{ name: string; failureAt: number; failure: "false" | "missing" | "throw" | null }> = [
  { name: "all five strict-true catalog responses", failureAt: -1, failure: null },
];
for (const [failureAt, gate] of gates.entries()) {
  for (const failure of ["false", "missing", "throw"] as const) scenarios.push({ name: `${gate.symbol}: ${failure}`, failureAt, failure });
}
assert.equal(scenarios.length, 16);
for (const scenario of scenarios) {
  const ready = scenario.failure === null;
  const prefix = expectedQueries.slice(0, ready ? gates.length : scenario.failureAt + 1);
  for (const entrypoint of ["callback", "route"] as const) {
    const queries: Query[] = [];
    const pool: Pool = { query: async (sql, parameters) => {
      const index = queries.length;
      queries.push({ sql, parameters: parameters ?? [] });
      if (index === scenario.failureAt) {
        if (scenario.failure === "throw") throw new Error(syntheticError);
        return { rows: scenario.failure === "missing" ? [] : [{ ready: false }] };
      }
      return { rows: [{ ready: true }] };
    } };
    const probe = bindCallback(...gates.map(gate => gate.run), pool);
    if (entrypoint === "callback") {
      assert.deepEqual(await probe(), { ready }, scenario.name);
    } else {
      const app = createV2HttpApp(loadV2RuntimeConfig({ NODE_ENV: "test", V2_SERVICE_NAME: "readiness-union" }), { log: () => undefined }, probe);
      const router = (app as unknown as { _router: { stack: Array<{ route?: { path: string; stack: Array<{ handle: (request: unknown, response: unknown) => Promise<void> }> } }> } })._router;
      const routes = router.stack.filter(layer => layer.route?.path === "/ready");
      assert.equal(routes.length, 1, "actual app must expose exactly one readiness route");
      assert.equal(routes[0].route!.stack.length, 1);
      const statuses: number[] = [];
      const bodies: unknown[] = [];
      const response = {
        status(code: number) { statuses.push(code); return this; },
        json(body: unknown) { bodies.push(body); return this; },
      };
      await routes[0].route!.stack[0].handle({}, response);
      assert.deepEqual(statuses, [ready ? 200 : 503], scenario.name);
      assert.deepEqual(bodies, [{ status: ready ? "ready" : "not_ready", checks: { application: ready ? "ok" : "unavailable" } }], scenario.name);
      assert.ok(!JSON.stringify(bodies).includes(syntheticError));
    }
    // Keep SQL/parameter and complete-prefix assertions outside the callback's catch.
    assert.deepEqual(queries, prefix, `${scenario.name}: ${entrypoint} query order, parameters and short-circuit`);
  }
  console.log(`PASS readiness union: ${scenario.name}`);
}
console.log("Readiness union: 16 scenarios passed through both actual-source callback and actual app route; five real-helper strict-boolean controls passed. Synthetic catalog responses only; no physical/native/full-deployment proof.");
