import ts from "typescript";
import path from "node:path";
import { createHash } from "node:crypto";
import { tableOwners, writerAreas, operationTableOwners } from "./architecture-policy.mjs";

export const documentReference = "docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md";
export const fingerprint = (text) => createHash("sha256").update(text).digest("hex");
const normalize = (file) => file.replaceAll("\\", "/").replace(/^v2\//, "");
const compareFiles = (a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
const targetPath = (file, specifier) => specifier.startsWith(".")
  ? path.posix.normalize(path.posix.join("v2", path.posix.dirname(file), specifier))
  : path.posix.normalize(specifier.replace(/^@\//, "client/src/"));
const moduleName = (file) => /^src\/modules\/([^/]+)\//.exec(file)?.[1];
const rawDb = (specifier) => /^(pg|pg-native|drizzle-orm|@neondatabase\/serverless|@electric-sql\/pglite|postgres|kysely|knex|@prisma\/client|typeorm|sequelize|mysql2?|sqlite3|better-sqlite3|node:sqlite)(\/|$)/.test(specifier);
const uiPackage = (specifier) => /^(?:(?:react|react-dom)(?:\/|$)|@radix-ui\/|@tanstack\/react-|@headlessui\/|@mui\/|(?:lucide-react|framer-motion|wouter|antd)$)/.test(specifier);
const parse = (file, source) => ts.createSourceFile(file, source.replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true,
  /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

// These are explicit persistence-free seams, not a blanket *Application exemption.
export const publicApis = {
  "customers/salesContactSelection": ["SalesContactSelectionQuery", "SalesContactSelectionResult", "SalesContactSelectionReadPort"],
  "billing/orderEditSafety": ["OrderEditBillingSafetyAssessment", "OrderEditBillingSafetyRequest", "OrderEditBillingSafetyReason", "OrderEditBillingSafetyPort"],
  "sales/workspaceContracts": ["SalesWorkspace", "SalesWorkspaceLineMapEntry"],
  "sales/workspaceApplication": ["assertSalesWorkspaceMutable", "authorizeSalesWorkspace", "salesWorkspaceFingerprint", "validateSalesWorkspaceId", "validateSalesWorkspaceMutation"],
  "artwork/workspaceArtwork": ["WorkspaceArtworkPromotionInput", "WorkspaceArtworkPromotionResult", "WorkspaceArtworkCleanupSummary", "WorkspaceArtworkMaintenance"],
  "routing/ownerTransitions": ["OwnerRouteScope", "ProductionDestination", "SalesWorkflowRouteRequest", "PreparedPrepressResult", "OwnerTransitions"],
  "prepress/reworkPreparation": ["CreateReworkPreparationRequest", "ReworkPreparation"],
  "billing/shippingCharge": ["ApplyShippingChargeRequest"],
  "production/successorWorkCreation": ["CompletedPrepressWorkCreationInput", "PrepressReworkWorkCreationInput", "ReplacementProductionSource", "ReplacementWorkCreationInput", "ProductionWorkCreation"],
  "sales/orderAutomaticLifecycle": ["OrderAutomaticLifecycle"],
  "sales/orderApplication": ["CreateOrderInput", "OrderOperationResult"],
  "organization/businessProfile": ["DocumentOrganizationIdentity"],
  "products/customerCommercial": ["CustomerScopedPricingPort"],
  "products/productRecipes": ["ProductRecipe", "RecipeComponent"],
  "pricing/operatorPricingExplanation": ["OperatorPricingExplanation", "explainPricingResult"],
  "pricing/formulaDomain": ["FormulaDeclaredInput", "FormulaInputValue", "validateFormulaRevisionInputValues"],
  "pricing/pricingNestingEstimate": ["estimatePricingSheetUsage"],
  "routing/routingLifecycle": ["RoutePrerequisite"],
};
// Infrastructure may compose these named owner operations/providers. This does
// not authorize sibling domain modules to import an application implementation.
export const adapterPublicApis = {
  "routing/ownerTransitions": ["OwnerRouteScope", "ProductionDestination", "SalesWorkflowRouteRequest", "PreparedPrepressResult", "OwnerTransitions"],
  "prepress/reworkPreparation": ["CreateReworkPreparationRequest", "ReworkPreparation"],
  "billing/shippingCharge": ["ApplyShippingChargeRequest"],
  "production/successorWorkCreation": ["CompletedPrepressWorkCreationInput", "PrepressReworkWorkCreationInput", "ReplacementProductionSource", "ReplacementWorkCreationInput", "ProductionWorkCreation"],
  "artwork/artworkApplication": ["ArtworkApplicationService"],
  "artwork/quoteArtworkApplication": ["QuoteArtworkApplicationService"],
  "sales/orderApplication": ["OrderApplicationService"],
  "sales/workflowApplication": ["OrderWorkflowApplicationService"],
  "sales/configurationPresentation": ["salesConfigurationPresentation"],
  "proofing/proofingApplication": ["ProofingApplicationService"],
  "prepress/prepressApplication": ["PrepressApplicationService"],
  "production/productionApplication": ["ProductionApplicationService"],
  "billing/financialReadApplication": ["FinancialReadApplicationService"],
  "billing/paymentApplication": ["BillingPaymentsApplicationService"],
  "inbound/inboundIntakeApplication": ["InboundIntakeApplicationService"],
  "fulfillment/fulfillmentApplication": ["FulfillmentApplicationService"],
  "inventory/inventoryLedger": ["InventoryLedgerApplicationService"],
  "products/productVersionLifecycle": ["ProductVersionLifecycleApplicationService"],
  "products/customerCommercial": ["CustomerCommercialApplicationService", "CustomerCommercialPricingAdapter"],
  "products/productRecipes": ["ProductRecipeApplicationService"],
  "products/productPublication": ["ProductPublicationApplicationService"],
  "products/productRouting": ["ProductRoutingApplicationService"],
  "products/productRoutingCompatibility": ["ProductRoutingCompatibilityApplicationService"],
  "products/pbv2CompatibilityResolution": ["ActivePbv2CompatibilityRecord", "resolveActivePbv2PricingInput"],
  "pricing/v2PricingAdapter": ["V2PricingParityAdapter"],
  "pricing/formulaRuntimeContract": ["formulaRuntimeProbeValues", "formulaRuntimeVariables"],
  "materials/materialRequirementResolver": ["MaterialRequirementMaterial", "Pbv2MaterialRequirementContext", "resolveMaterialRequirements"],
};
export const ownerOperations = {
  "infrastructure/customers/postgresSalesContactSelection.js": ["PostgresSalesContactSelection"],
  "infrastructure/billing/postgresOrderEditSafety.js": ["assessOrderEditBillingInTransaction"],
  "infrastructure/artwork/postgresOrderEditArtwork.js": ["PostgresOrderEditArtwork", "captureOrderEditArtworkFingerprint", "captureOrderEditArtwork", "validateOrderEditArtworkInTransaction", "applyOrderEditArtworkInTransaction", "authorizeOrderEditArtworkReplay"],
  "infrastructure/sales/workspaceArtworkAccess.js": ["advanceSalesWorkspaceArtworkRevision", "lockSalesWorkspaceForArtwork", "readSalesWorkspaceForArtwork", "readSalesWorkspacePromotionLineMap"],
  "infrastructure/artwork/artworkBinaryStorage.js": ["ArtworkBinaryStorage"],
  "infrastructure/artwork/postgresWorkspaceArtwork.js": ["PostgresWorkspaceArtwork", "promoteWorkspaceArtworkInTransaction", "requestWorkspaceArtworkCleanupInTransaction"],
  "infrastructure/artwork/workspaceArtworkUpload.js": ["WorkspaceArtworkUploadService"],
  "infrastructure/products/customerCommercialPricingPort.js": ["createCustomerCommercialPricingPort"],
  "infrastructure/compatibility/workspaceCommercialReads.js": ["createSalesWorkspaceReadPorts"],
  "infrastructure/routing/postgresOwnerTransitions.js": ["PostgresOwnerTransitions"],
  "infrastructure/prepress/postgresReworkPreparation.js": ["PostgresReworkPreparation"],
  // Narrow owner-controlled transaction operations for BD-1, BD-2, and BD-4.
  // These named APIs permit composition, never SQL in a foreign caller.
  "infrastructure/billing/postgresShippingCharge.js": ["applyShippingChargeInTransaction"],
  "infrastructure/production/postgresSuccessorWorkCreation.js": ["PostgresSuccessorWorkCreation"],
  "infrastructure/authorization/postgresProofRecipientAccess.js": ["PostgresProofRecipientAccess"],
  "infrastructure/sales/postgresOrderAutomaticLifecycle.js": ["reconcileOrderInTransaction"],
  "infrastructure/billing/postgresReplacementInvoice.js": ["createOrReadReplacementInvoice", "ReplacementInvoiceProjection"],
  "infrastructure/persistence/types.js": ["TransactionalClient"],
  "infrastructure/persistence/postgresOperationRequests.js": ["PostgresOperationRequestRepository"],
  "infrastructure/persistence/postgresOutbox.js": ["PostgresOutboxRepository"],
  "infrastructure/authorization/postgresPermissionAuthorityRead.js": ["PostgresPermissionAuthorityReader"],
  "infrastructure/authentication/trustedHostPrincipalProvider.js": ["IssuedV2PrincipalProvider", "TrustedHostIdentitySource"],
  "infrastructure/documents/ownerPdfRenderer.js": ["OwnerPdfDocument", "ownerDocumentFilename", "renderOwnerPdf", "TenantBranding"],
  "infrastructure/documents/postgresTenantBranding.js": ["readTenantBranding"],
};

// Only Billing may compose Invoice tax from its own frozen evidence using the
// existing stateless kernel. Shipping/other callers must request Billing work.
export const ownerScopedAdapterApis = {
  billing: {
    "sales/taxComposition": ["composeSalesTax", "CommercialCharge", "FrozenTaxExemption", "TaxReceiptLocation", "TaxResolution", "TenantTaxJurisdiction"],
  },
};

export function extractImports(file, source) {
  const tree = parse(file, source);
  const records = [];
  const legacyImporters = new Map();
  const legacyNamespaces = new Set();
  for (const node of tree.statements) {
    if (ts.isImportDeclaration(node) && /server\/quickbooksService/.test(node.moduleSpecifier.text)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) legacyNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "importQBInvoicesByIds") legacyImporters.set(element.name.text, "importQBInvoicesByIds");
      }
    }
  }
  const namespaceUses = (local) => {
    const used = new Set();
    const walk = (node) => {
      if (ts.isIdentifier(node) && node.text === local && !ts.isNamespaceImport(node.parent)) {
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) used.add(node.parent.name.text);
        else if (ts.isElementAccessExpression(node.parent) && node.parent.expression === node && ts.isStringLiteralLike(node.parent.argumentExpression ?? {})) used.add(node.parent.argumentExpression.text);
        else used.add("<namespace-escape>");
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
    return [...used].sort();
  };
  const add = (node, specifier, symbols) => records.push({ file: normalize(file), specifier,
    symbols: (symbols.length ? [...symbols] : ["<side-effect>"]).sort(), hash: fingerprint(node.getText(tree)) });
  const visit = (node) => {
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && legacyImporters.has(node.expression.text) ||
      ts.isPropertyAccessExpression(node.expression) && legacyNamespaces.has(node.expression.expression.getText(tree)) && node.expression.name.text === "importQBInvoicesByIds")) {
      add(node, "#call:server/quickbooksService/importQBInvoicesByIds", ["importQBInvoicesByIds"]);
    }
    if (ts.isIdentifier(node) && legacyImporters.has(node.text) && !ts.isImportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      add(node, "#reference:server/quickbooksService/importQBInvoicesByIds", ["importQBInvoicesByIds"]);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;
      const symbols = [];
      if (!clause) symbols.push("<side-effect>");
      else {
        if (clause.name) symbols.push("default");
        const bindings = clause.namedBindings ?? clause;
        if (ts.isNamespaceImport(bindings)) symbols.push(...namespaceUses(bindings.name.text));
        else if (ts.isNamespaceExport(bindings)) symbols.push("*");
        else if (bindings.elements) for (const element of bindings.elements) symbols.push((element.propertyName ?? element.name).text);
        else if (ts.isExportDeclaration(node)) symbols.push("*");
      }
      add(node, node.moduleSpecifier.text, symbols);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression?.text ?? "<dynamic>", ["*"]);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      add(node, ts.isStringLiteralLike(node.arguments[0] ?? {}) ? node.arguments[0].text : "<dynamic>", ["*"]);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return records;
}

export function evaluateImports(files) {
  const findings = [];
  for (const { file: filename, source } of [...files].sort(compareFiles)) {
    const file = normalize(filename);
    for (const record of extractImports(file, source)) {
      const { specifier, symbols } = record;
      const target = targetPath(file, specifier);
      const has = (part) => target.includes(part) || specifier.includes(part);
      const fail = (rule, id = "IMPORT") => findings.push({ ...record, rule, id, kind: "import" });
      if (/^#(?:call|reference):/.test(specifier)) fail("indirect V1 financial importer write or escaping reference", "BD-5");
      if (specifier === "<dynamic>" && /^(src|infrastructure|ui)\//.test(file)) fail("unresolved dynamic module target");
      if (has("v2-poc")) fail("production V2 must not import POC or V1 route/service code");
      const safetyApi = file === "scripts/guarded-test-entry.ts" && specifier === "../../server/tests/helpers/safeTestDatabase.js" && symbols.length === 1 && symbols[0] === "requireSafeTestDatabaseUrl";
      if (/(^|\/|@)server\//.test(target) && !safetyApi) fail("V1 bridge requires exact file, specifier and symbols", symbols.includes("importQBInvoicesByIds") ? "BD-5" : "BRIDGE");
      const interfaces = file.startsWith("src/interfaces/");
      const authorization = file.startsWith("src/authorization/");
      const domain = /^(src\/modules\/|src\/application\/|src\/domain\/)/.test(file);
      if (interfaces && (has("/repositories") || has("/infrastructure/persistence") || has("server/db") || rawDb(specifier))) fail("interfaces must not import repositories or raw database clients");
      if (authorization && (has("/repositories") || has("/interfaces") || has("/infrastructure/") || has("server/db") || rawDb(specifier))) fail("authorization must remain persistence and interface free");
      if (domain && (rawDb(specifier) || has("/infrastructure/") || has("/interfaces/") || has("client/") || has("v2/ui/") || uiPackage(specifier))) fail("domain modules must remain database, infrastructure and UI free");
      if (!file.startsWith("tests/") && has("staffAuthorityCompatibility") && file !== "src/authorization/temporaryStaffPrincipalIssuer.ts") fail("temporary Staff compatibility resolver may only be consumed through its PrincipalIssuer");
      if (!file.startsWith("tests/") && (has("temporaryStaffPrincipalIssuer") || has("postgresStaffMembershipRead")) && !["scripts/runM14StaffAuthorityCompatibilityRehearsal.ts", "src/authorization/temporaryStaffPrincipalIssuer.ts", "infrastructure/compatibility/postgresStaffMembershipRead.ts"].includes(file)) fail("M1.4 temporary Staff authority may not be imported by normal V2 runtime code");
      if (file.startsWith("src/repositories/") && has("/interfaces")) fail("repositories must not import interfaces");
      const fromModule = moduleName(file);
      const toModule = /^v2\/src\/modules\/([^/]+)\/(.+)$/.exec(target.replace(/\.[cm]?[jt]sx?$/, ""));
      if (fromModule && toModule && fromModule !== toModule[1]) {
        const api = `${toModule[1]}/${toModule[2]}`;
        if (fromModule === "shared") fail("shared vocabulary must not depend upward on a business module", "SHARED-UPWARD");
        else if (toModule[1] !== "shared" && !(toModule[2] === "contracts" && !symbols.some((symbol) => ["*", "<side-effect>", "<namespace-escape>"].includes(symbol))) && !symbols.every((symbol) => publicApis[api]?.includes(symbol))) {
          fail("cross-module import must use a named public contract", api === "products/productRecipes" && symbols.includes("RecipeUnit") ? "BD-7" : "CONTRACT");
        }
      }
      const fromInfra = /^infrastructure\/([^/]+)\//.exec(file)?.[1];
      const toInfra = /^v2\/infrastructure\/([^/]+)\//.exec(target)?.[1];
      if (fromInfra && toModule && toModule[1] !== "shared" && fromInfra !== toModule[1] &&
        !(toModule[2] === "contracts" && !symbols.some((symbol) => ["*", "<side-effect>", "<namespace-escape>"].includes(symbol))) &&
        !symbols.every((symbol) => [...(publicApis[`${toModule[1]}/${toModule[2]}`] ?? []), ...(adapterPublicApis[`${toModule[1]}/${toModule[2]}`] ?? []), ...(ownerScopedAdapterApis[writerDomain(file)]?.[`${toModule[1]}/${toModule[2]}`] ?? [])].includes(symbol))) {
        fail("adapter cross-module import must use a named public contract", "ADAPTER-CONTRACT");
      }
      if (fromInfra && toInfra && fromInfra !== toInfra && !symbols.every((symbol) => ownerOperations[target.replace(/^v2\//, "")]?.includes(symbol))) fail("cross-infrastructure import must call a named owner operation", "INFRA-CONTRACT");
    }
  }
  return findings;
}

// Ownership follows mutable facts, including Shipping code hosted in Fulfillment.
export function writerDomain(file) {
  file = normalize(file);
  if (writerAreas[file]) return writerAreas[file];
  const area = /^infrastructure\/([^/]+)\//.exec(file)?.[1] ?? moduleName(file);
  return ({ accounting: "integrations", organization: "settings", authentication: "authentication", authorization: "authentication", materials: "inventory" })[area] ?? area ?? "unknown";
}
export function tableOwner(table) {
  return tableOwners[table]?.owner ?? "unknown";
}

// Tokenization keeps quoted identifiers, drops SQL comments/string data, and never
// confuses SELECT ... FOR UPDATE or ON CONFLICT DO UPDATE with a target mutation.
export function sqlWriteTargets(sql) {
  const lexical = /--[^\n]*|\/\*[\s\S]*?\*\/|E'(?:''|\\.|[^'])*'|'(?:''|[^'])*'|\$([a-z_0-9]*)\$[\s\S]*?\$\1\$|"(?:""|[^"])*"|\$\{[^}]*\}|[a-z_][a-z_0-9]*|[.;()]/gi;
  const tokens = [];
  for (let match; (match = lexical.exec(sql));) {
    const token = match[0];
    if (token.startsWith("/*")) {
      // PostgreSQL permits nested block comments. A quote inside an outer
      // comment must not swallow executable SQL after the actual comment end.
      let depth = 1, offset = match.index + 2;
      while (depth && offset < sql.length) {
        if (sql.slice(offset, offset + 2) === "/*") { depth++; offset += 2; }
        else if (sql.slice(offset, offset + 2) === "*/") { depth--; offset += 2; }
        else offset++;
      }
      lexical.lastIndex = offset;
    } else if (!/^(?:--|E?'|\$(?!\{))/i.test(token)) tokens.push(token);
  }
  const identifier = (token) => token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token.toLowerCase();
  const targets = [];
  for (let i = 0; i < tokens.length; i++) {
    const verb = tokens[i].toUpperCase();
    if (!["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE"].includes(verb)) continue;
    if (["MERGE", "TRUNCATE"].includes(verb)) { targets.push({ verb, table: "<unresolved>" }); continue; }
    if (verb === "UPDATE" && ["FOR", "DO", "KEY"].includes(tokens[i - 1]?.toUpperCase())) continue;
    let j = i + 1;
    if (["INTO", "FROM", "ONLY", "TABLE"].includes(tokens[j]?.toUpperCase())) j++;
    if (tokens[j]?.toUpperCase() === "ONLY") j++;
    const schema = tokens[j + 1] === "." ? identifier(tokens[j]) : undefined;
    if (schema) j += 2;
    const token = tokens[j];
    const name = token && /^(?:[a-z_][a-z_0-9]*|"(?:""|[^"])+")$/i.test(token) ? identifier(token) : "<unresolved>";
    const table = schema && schema !== "public" ? `${schema}.${name}` : name;
    targets.push({ verb, table });
  }
  return targets;
}

export function extractSql(file, source) {
  source = source.replaceAll("\r\n", "\n");
  const tree = parse(file, source);
  const records = [];
  const constants = new Map();
  const scopeOf = (node) => {
    while (node.parent && !ts.isBlock(node) && !ts.isSourceFile(node) && !ts.isFunctionLike(node)) node = node.parent;
    return node;
  };
  const binding = (node) => {
    for (let scope = node; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.text)) return undefined;
      if (constants.get(scope)?.has(node.text)) return constants.get(scope).get(node.text);
    }
    return undefined;
  };
  const resolvedLiterals = new Set();
  const cap = (variants) => variants.length > 32 ? [undefined] : [...new Set(variants)];
  const combine = (left, right) => cap(left.flatMap((a) => right.map((b) => a === undefined && b === undefined ? undefined : (a ?? "${dynamic}") + (b ?? "${dynamic}"))));
  const resolve = (node, seen = new Set()) => {
    if (!node) return [undefined];
    resolvedLiterals.add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return resolve(node.expression, seen);
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const value = binding(node);
      if (value) {
        // Const pins a reference, not its properties. Direct query object
        // literals are safe to inspect; referenced objects may be mutated.
        let initial = value;
        while (ts.isParenthesizedExpression(initial) || ts.isAsExpression(initial) || ts.isNonNullExpression(initial)) initial = initial.expression;
        if (ts.isObjectLiteralExpression(initial) || ts.isArrayLiteralExpression(initial)) return [undefined];
        return resolve(value, new Set([...seen, node.text]));
      }
    }
    if (ts.isConditionalExpression(node)) {
      const left = resolve(node.whenTrue, seen), right = resolve(node.whenFalse, seen);
      return cap([...left, ...right]);
    }
    if (ts.isObjectLiteralExpression(node)) {
      const text = node.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(tree) === "text");
      return text ? resolve(text.initializer, seen) : [undefined];
    }
    if (ts.isTemplateExpression(node)) {
      let variants = [node.head.text];
      for (const span of node.templateSpans) variants = combine(combine(variants, resolve(span.expression, seen)), [span.literal.text]);
      return variants;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolve(node.left, seen), right = resolve(node.right, seen);
      return combine(left, right);
    }
    return [undefined];
  };
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const scope = scopeOf(node);
      if (!constants.has(scope)) constants.set(scope, new Map());
      // Mutable bindings cannot be proven constant without data-flow analysis.
      constants.get(scope).set(node.name.text, node.parent.flags & ts.NodeFlags.Const ? node.initializer : undefined);
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["query", "execute"].includes(node.expression.name.text) &&
      (!normalize(file).startsWith("src/modules/") || /(?:client|pool|db|sql|transaction)/i.test(node.expression.expression.getText(tree)))) {
      const arg = node.arguments[0];
      const queryRecords = new Map();
      for (const sql of resolve(arg)) {
        // Pin the entire source for unresolved builders, including helper bodies
        // outside the query function. This is deliberately conservative debt.
        const statement = sql ?? node.getText(tree);
        const targets = sql === undefined || /^\s*(?:DO|CALL|COPY|EXECUTE)\b/i.test(sql) ? [{ verb: "UNRESOLVED", table: "<unresolved>" }] : sqlWriteTargets(sql);
        if (!targets.length && sql?.includes("${dynamic}")) targets.push({ verb: "UNRESOLVED", table: "<unresolved>" });
        if (!targets.length && sql && /^(?:src\/modules|src\/authorization)\//.test(normalize(file)) && /^\s*(?:SELECT|WITH)\b/i.test(sql)) targets.push({ verb: "READ", table: "<domain-db>" });
        const dynamic = sql === undefined || statement.includes("${dynamic}");
        for (const [occurrence, target] of targets.entries()) {
          const hash = fingerprint(dynamic ? `${node.getText(tree)}\n${source}` : statement);
          queryRecords.set(`${target.verb}:${target.table}:${hash}:${occurrence}`, { file: normalize(file), ...target, statement, hash, dynamic });
        }
      }
      records.push(...queryRecords.values());
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  // Also cover SQL literals passed to custom wrappers/tagged templates. A known
  // query argument is counted once, even when its literal lives in a constant.
  const literals = (node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) && !resolvedLiterals.has(node)) {
      for (const statement of resolve(node)) {
        if (statement && /^\s*(?:WITH\b[\s\S]*\b(?:INSERT\s+INTO|UPDATE\b[\s\S]*\bSET|DELETE\s+FROM)|INSERT\s+INTO|UPDATE\b[\s\S]*\bSET|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+(?:TABLE\s+)?\w)/i.test(statement)) {
          for (const target of sqlWriteTargets(statement)) records.push({ file: normalize(file), ...target, statement,
            hash: fingerprint(statement.includes("${dynamic}") ? `${node.getText(tree)}\n${source}` : statement), dynamic: statement.includes("${dynamic}") });
        }
      }
    }
    ts.forEachChild(node, literals);
  };
  literals(tree);
  return records;
}

export function evaluateSql(files) {
  const findings = [];
  for (const { file, source } of [...files].sort(compareFiles)) {
    if (!/^(?:v2\/)?(?:src|infrastructure)\//.test(normalize(file))) continue;
    for (const record of extractSql(file, source)) {
      const scoped = operationTableOwners[normalize(file)]?.[record.table];
      const owner = scoped?.verbs.includes(record.verb) ? scoped.owner : tableOwner(record.table);
      const writer = writerDomain(file);
      let id, rule;
      if (normalize(file).startsWith("src/modules/") || normalize(file).startsWith("src/authorization/")) { id = "SQL-DOMAIN"; rule = "pure domain and authority must not contain SQL mutation"; }
      else if (record.dynamic) { id = "SQL-DYNAMIC"; rule = "dynamic SQL requires exact reviewed baseline; unresolved targets fail closed"; }
      else if (record.table === "materials") { id = "BD-6"; rule = "inventory dual mutable V1 counter"; }
      else if (owner === "deferred") { id = "DEFERRED"; rule = "ownership deferred, not permission for additional writes"; }
      else if (owner === "unknown") { id = "SQL-UNKNOWN"; rule = "table ownership must be declared"; }
      else if (owner !== writer && owner !== "shared-platform") { id = "SQL-FOREIGN"; rule = "foreign owner SQL mutation"; }
      else if (!record.table.startsWith("v2_") && record.table !== "formula_revisions") { id = "LEGACY-COMPATIBILITY"; rule = "legacy home compatibility requires exact existing statement"; }
      if (id) findings.push({ ...record, owner, writer, id, rule, kind: "sql" });
    }
  }
  return findings;
}

export function applyBaseline(findings, baseline) {
  const remaining = [...findings];
  const matched = [];
  const retired = [];
  for (const entry of baseline) {
    const matching = remaining.filter((finding) => finding.kind === entry.kind && finding.file === entry.file && finding.hash === entry.hash &&
      (entry.kind === "import" ? finding.specifier === entry.specifier && JSON.stringify(finding.symbols) === JSON.stringify(entry.symbols) && finding.id === entry.ruleId : finding.table === entry.table && finding.verb === entry.verb));
    const accepted = matching.slice(0, entry.count);
    for (const finding of accepted) remaining.splice(remaining.indexOf(finding), 1);
    if (accepted.length) matched.push({ ...entry, observed: accepted.length });
    if (accepted.length < entry.count) retired.push({ ...entry, observed: accepted.length });
  }
  return { violations: remaining, matched, retired };
}
