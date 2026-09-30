import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const relative = file => path.relative(root, file).replaceAll('\\', '/');
export const isSuiteFilename = file => /\.(test|spec|pure)\.[cm]?[jt]sx?$/.test(file);
export function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
const cache = new Map();
const reviewedChildEntrypoints = {
  'v2/tests/persistence/m0PostgresRunner.test.ts': ['v2/scripts/runM0PostgresRehearsal.ts'],
  'v2/tests/importBoundary.test.ts': ['v2/scripts/check-import-boundaries.mjs'],
};
export function inspect(file) {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const calls = [];
  function visit(node) {
    const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : null;
    const onlyTypes = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly) && !node.importClause.name;
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && !onlyTypes) || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      calls.push(node.expression.getText(source));
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const resolved = [];
  const unresolved = [];
  for (const specifier of imports) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@shared/')) continue;
    const base = specifier.startsWith('@shared/') ? path.join(root, 'shared', specifier.slice(8)) : path.resolve(path.dirname(file), specifier);
    const stem = base.replace(/\.[cm]?js$/, '');
    const match = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mjs`, `${stem}.js`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (match) resolved.push(match); else unresolved.push(specifier);
  }
  const effects = source.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node) && !ts.isFunctionDeclaration(node) && !ts.isClassDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)).map(node => node.getText(source));
  const result = { imports, resolved, unresolved, calls, effects, text };
  cache.set(file, result);
  return result;
}
export function closure(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const imported of inspect(file).resolved) if (/\.[cm]?[jt]sx?$/.test(imported)) closure(imported, seen);
  return seen;
}
export function inventory(directory = path.join(root, 'v2/tests')) {
  return filesUnder(directory).map(file => {
    if (!/\.[cm]?[jt]sx?$/.test(file)) return { path: relative(file), style: 'asset', transitive: [] };
    const own = inspect(file);
    const seen = closure(file);
    for (const child of reviewedChildEntrypoints[relative(file)] ?? []) closure(path.join(root, child), seen);
    const graph = [...seen];
    const risks = graph.flatMap(imported => {
      const info = inspect(imported);
      const indicators = info.effects.filter(effect => /dotenv|new Pool\(|new Client\(|\.listen\(|process\.env|fetch\(|connect\(|setInterval\(|setTimeout\(/.test(effect));
      const external = info.imports.filter(specifier => /^(dotenv|pg|@neondatabase|node:(net|http|https)|supertest)/.test(specifier));
      return indicators.length || external.length || /(?:^|\/)server\/db\./.test(relative(imported)) ? [{ path: relative(imported), external, effects: indicators.map(effect => effect.slice(0, 600)) }] : [];
    });
    return { path: relative(file), style: own.imports.includes('node:test') ? 'node-test' : own.calls.some(call => /^(describe|it|test)(\.|$)/.test(call)) ? 'jest' : 'tsx', imports: own.imports, transitive: graph.map(relative), unresolved: graph.flatMap(imported => inspect(imported).unresolved.map(specifier => `${relative(imported)}: ${specifier}`)), risks };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = inventory();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = Object.values(pkg.scripts).join('\n');
  console.log(JSON.stringify({ counts: { files: entries.length, pure: entries.filter(entry => entry.path.endsWith('.pure.ts')).length, jestStyle: entries.filter(entry => entry.style === 'jest').length, tsxStyle: entries.filter(entry => entry.style === 'tsx').length, assets: entries.filter(entry => entry.style === 'asset').length, explicitScriptReferences: entries.filter(entry => commands.includes(entry.path)).length, rootJestPattern: entries.filter(entry => /\.(test|spec)\.ts$/.test(entry.path)).length }, entries }, null, 2));
}
