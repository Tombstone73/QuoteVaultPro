import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { knowledgeFrontmatterSchema, type KnowledgeFrontmatter } from "@shared/aiKnowledgeContracts";

const FRONTMATTER_DELIMITER = "---";
const DISALLOWED_CONTENT = /<\s*\/?(?:script|iframe|object|embed|style)\b|javascript\s*:/i;
const SECRET_MATERIAL = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|(?:aws_secret_access_key|database_url|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{20,}/i;

export interface ParsedKnowledgeDocument {
  metadata: KnowledgeFrontmatter;
  content: string;
  contentHash: string;
  sourcePath: string;
}

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  headingPath: string | null;
  content: string;
  contentHash: string;
  tokenEstimate: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) throw new Error("arrays must use [item, item] syntax");
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map(parseScalar).filter(Boolean);
}

/** A deliberately narrow frontmatter parser. Repository-managed knowledge
 * accepts only simple scalars/inline string arrays so a YAML feature cannot
 * become an executable configuration channel. */
export function parseKnowledgeDocument(raw: string, sourcePath: string): ParsedKnowledgeDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) throw new Error(`${sourcePath}: missing frontmatter`);
  const end = normalized.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1);
  if (end < 0) throw new Error(`${sourcePath}: frontmatter is not closed`);

  const frontmatterLines = normalized.slice(FRONTMATTER_DELIMITER.length + 1, end).split("\n");
  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterLines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`${sourcePath}: unsupported frontmatter line: ${line}`);
    const [, key, value] = match;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) throw new Error(`${sourcePath}: duplicate frontmatter key ${key}`);
    frontmatter[key] = value.trim().startsWith("[") ? parseArray(value) : parseScalar(value);
  }

  const parsed = knowledgeFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) throw new Error(`${sourcePath}: invalid knowledge metadata: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  const content = normalized.slice(end + FRONTMATTER_DELIMITER.length + 2).trim();
  if (!content) throw new Error(`${sourcePath}: content is empty`);
  if (DISALLOWED_CONTENT.test(content) || SECRET_MATERIAL.test(content) || content.includes("\0")) {
    throw new Error(`${sourcePath}: content contains disallowed executable or secret material`);
  }

  return { metadata: parsed.data, content, contentHash: hash(content), sourcePath: sourcePath.replace(/\\/g, "/") };
}

export async function discoverKnowledgeDocuments(rootDir: string): Promise<ParsedKnowledgeDocument[]> {
  const canonicalRoot = path.resolve(rootDir);
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  const documents: ParsedKnowledgeDocument[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      documents.push(...await discoverKnowledgeDocuments(path.join(canonicalRoot, entry.name)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absolutePath = path.join(canonicalRoot, entry.name);
    const parsed = parseKnowledgeDocument(await readFile(absolutePath, "utf8"), path.relative(process.cwd(), absolutePath));
    documents.push(parsed);
  }
  const duplicate = documents.find((doc, index) => documents.findIndex((candidate) => candidate.metadata.slug === doc.metadata.slug && candidate.metadata.version === doc.metadata.version) !== index);
  if (duplicate) throw new Error(`duplicate knowledge slug/version: ${duplicate.metadata.slug}@${duplicate.metadata.version}`);
  return documents;
}

/** Chunks are stable across machines and bounded before persistence/retrieval. */
export function chunkKnowledgeDocument(document: ParsedKnowledgeDocument, maxChars = 1800): KnowledgeChunkDraft[] {
  const sections: Array<{ headingPath: string | null; content: string }> = [];
  let headingPath: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) sections.push({ headingPath: headingPath.length ? headingPath.join(" > ") : null, content });
    buffer = [];
  };
  for (const line of document.content.split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const depth = heading[1].length;
      headingPath = [...headingPath.slice(0, depth - 1), heading[2]];
      continue;
    }
    buffer.push(line);
  }
  flush();

  const result: KnowledgeChunkDraft[] = [];
  for (const section of sections) {
    const words = section.content.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length > maxChars) {
        result.push({ chunkIndex: result.length, headingPath: section.headingPath, content: current, contentHash: hash(current), tokenEstimate: Math.ceil(current.length / 4) });
        current = word;
      } else current = next;
    }
    if (current) result.push({ chunkIndex: result.length, headingPath: section.headingPath, content: current, contentHash: hash(current), tokenEstimate: Math.ceil(current.length / 4) });
  }
  return result;
}
