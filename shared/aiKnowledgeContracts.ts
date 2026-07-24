import { z } from "zod";

export const knowledgeDocumentStatusValues = ["draft", "active", "deprecated", "inactive"] as const;
export const knowledgeAudienceValues = ["staff", "owner_admin", "customer_safe"] as const;
export const knowledgeFeedbackTypeValues = ["helpful", "not_helpful", "outdated", "incorrect"] as const;

/** Metadata accepted from repository-managed Markdown frontmatter. It is
 * intentionally declarative: no HTML, SQL, URLs with executable schemes, or
 * arbitrary JSON configuration is accepted here. */
export const knowledgeFrontmatterSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  title: z.string().min(1).max(240),
  category: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(80),
  version: z.string().min(1).max(80),
  status: z.enum(knowledgeDocumentStatusValues).default("active"),
  audience: z.enum(knowledgeAudienceValues).default("staff"),
  summary: z.string().max(2000).optional(),
  permission_tags: z.array(z.string().min(1).max(120)).max(50).default([]),
  route_patterns: z.array(z.string().min(1).max(240)).max(50).default([]),
  entity_types: z.array(z.string().min(1).max(120)).max(50).default([]),
  feature_tags: z.array(z.string().min(1).max(120)).max(50).default([]),
  effective_from: z.string().datetime({ offset: true }).optional(),
}).strict();

export type KnowledgeFrontmatter = z.infer<typeof knowledgeFrontmatterSchema>;

export const knowledgeSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(1000),
  organizationId: z.string().min(1),
  category: z.string().max(80).optional(),
  route: z.string().max(240).optional(),
  entityType: z.string().max(120).optional(),
  featureTag: z.string().max(120).optional(),
  permissionTags: z.array(z.string().max(120)).max(50).optional(),
  limit: z.number().int().min(1).max(12).default(6),
});

export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>;

export interface KnowledgeSearchResult {
  documentId: string;
  title: string;
  category: string;
  excerpt: string;
  sourceType: string;
  sourcePath: string | null;
  sourceVersion: string;
  status: (typeof knowledgeDocumentStatusValues)[number];
  tenantScope: "global" | "organization";
  score: number;
  deprecatedWarning: boolean;
}
