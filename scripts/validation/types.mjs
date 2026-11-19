import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expandLanes, laneNames, lanes } from './lanes.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const inputs = args.filter((arg) => !arg.startsWith('--'));
const json = args.includes('--json');
const listFiles = args.includes('--list-files');
if (!inputs.length || args.some((arg) => arg.startsWith('--') && !['--json', '--list-files'].includes(arg))) {
  console.error(`Usage: npm run validate:types -- <${laneNames.join('|')}|all|file.ts[x]> [...] [--json] [--list-files]`);
  process.exit(2);
}

const normalize = (value) => value.replaceAll('\\', '/');
const relative = (file) => normalize(path.relative(root, file));
const selected = expandLanes(inputs);
const sources = selected.flatMap((input) => {
  if (Object.hasOwn(lanes, input)) return [...lanes[input].sources, ...lanes[input].tests];
  if (/\.(?:[cm]?ts|tsx)$/.test(input)) return [input];
  throw new Error(`Unknown lane or TypeScript input: ${input}`);
});
const roots = [...new Set(sources.map((file) => path.resolve(root, file)))];
for (const file of roots) {
  const name = relative(file);
  if (path.isAbsolute(name) || name.startsWith('../') || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`TypeScript input must be an existing repository file: ${file}`);
  }
}

const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic(diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  },
});
const ambient = config.fileNames.filter((file) => file.endsWith('.d.ts'));
const options = {
  ...config.options,
  incremental: false,
  // Test globals and Passport's Express Request augmentation normally reachable
  // from the application bootstrap. Neither changes compiler strictness.
  types: [...new Set([...(config.options.types ?? []), 'jest', 'passport'])],
};
const program = ts.createProgram([...new Set([...roots, ...ambient])], options);
const baseline = JSON.parse(readFileSync(new URL('./typescript-baseline.json', import.meta.url), 'utf8'));
const identity = ({ file, column, code, category, message, source }) =>
  JSON.stringify([file, column, code, category, message, source]);
const available = new Map();
for (const item of baseline.diagnostics) {
  const key = identity(item);
  available.set(key, (available.get(key) ?? 0) + 1);
}

const projectPath = normalize(root);
const displayMessage = (message) => ts.flattenDiagnosticMessageText(message, '\n')
  .replaceAll(projectPath, '').replaceAll(root, '');
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => {
  const { file, start, code, category, messageText } = diagnostic;
  const position = file && start !== undefined ? file.getLineAndCharacterOfPosition(start) : null;
  const item = {
    file: file ? relative(file.fileName) : null,
    line: position ? position.line + 1 : null,
    column: position ? position.character + 1 : null,
    code,
    category: ts.DiagnosticCategory[category],
    message: displayMessage(messageText),
    source: position ? file.text.slice(file.getLineStarts()[position.line]).split(/\r?\n/, 1)[0] : null,
  };
  const key = identity(item);
  const count = available.get(key) ?? 0;
  if (count) available.set(key, count - 1);
  return { ...item, status: count ? 'baseline' : 'unmatched' };
});

const files = program.getSourceFiles().map((file) => relative(file.fileName)).sort();
const known = diagnostics.filter((item) => item.status === 'baseline').length;
const summary = {
  typescript: ts.version,
  roots: roots.map(relative),
  ambient: ambient.map(relative),
  sourceFiles: files.length,
  baseline: known,
  unmatched: diagnostics.length - known,
};
if (json) {
  console.log(JSON.stringify({ ...summary, diagnostics, ...(listFiles ? { files } : {}) }, null, 2));
} else {
  if (listFiles) console.log(files.join('\n'));
  for (const item of diagnostics) {
    const location = item.file ? `${item.file}:${item.line}:${item.column} ` : '';
    console.log(`[${item.status}] ${location}${item.category.toLowerCase()} TS${item.code}: ${item.message}`);
  }
  console.log(`TypeScript ${ts.version} checked ${roots.length} roots / ${files.length} files. ${known} baseline, ${summary.unmatched} unmatched diagnostics.`);
}
// A baseline marks known diagnostics. It never turns a TypeScript error into success.
process.exitCode = diagnostics.some((item) => item.category === 'Error') ? 1 : 0;
