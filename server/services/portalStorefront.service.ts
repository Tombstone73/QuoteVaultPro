import { and, eq, exists, ilike, or, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { OptionNodeV2, OptionTreeV2 } from '@shared/optionTreeV2';
import { customerVisibleProducts, pbv2TreeVersions, products } from '@shared/schema';
import { filterPbv2ChoicesForRuntime, getRenderablePbv2QuestionNodeIds, sortPbv2Choices } from '@shared/pbv2OrderEntryRuntime';
import { resolveRuntimeVisibility } from '@shared/optionTreeV2Runtime';
import { getPbv2FixedDimensions } from '@shared/pbv2/fixedDimensions';
import { db } from '../db';
import { priceLineItem } from './pricing/PricingService';
import { getPortalScope, PortalAccessError } from './portal.service';

type StorefrontChoice = { value: string; label: string; description: string | null };
export type StorefrontOption = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  helpText: string | null;
  choices: StorefrontChoice[];
  min: number | null;
  max: number | null;
  step: number | null;
};

type StorefrontProduct = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  thumbnailUrls: string[];
  measurementMode: string;
  pricingProfileConfig: unknown;
  pbv2ActiveTreeVersionId: string | null;
  treeJson: Record<string, unknown>;
};

function safeImageUrl(urls: string[]): string | null {
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    // Product thumbnail uploads are commonly stored as authenticated,
    // same-origin object paths rather than absolute CDN URLs.
    if (raw.startsWith('/objects/') && !raw.includes('..') && !/[?#\\]/.test(raw)) return raw;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.toString();
    } catch { /* Ignore invalid thumbnail metadata. */ }
  }
  return null;
}

function hasEditorPricingOverride(product: Pick<StorefrontProduct, 'pricingProfileConfig'>): boolean {
  const config = product.pricingProfileConfig as { pbv2Override?: { enabled?: boolean } } | null;
  return config?.pbv2Override?.enabled === true;
}

export function mayShowStorefrontProduct(product: {
  isActive: boolean;
  storefrontVisible: boolean;
  pbv2ActiveTreeVersionId: string | null;
  activeTreeStatus: string | null;
  pricingProfileConfig: unknown;
}): boolean {
  return product.isActive === true && product.storefrontVisible === true
    && Boolean(product.pbv2ActiveTreeVersionId) && product.activeTreeStatus === 'ACTIVE'
    && !hasEditorPricingOverride(product);
}

function safeText(value: unknown, max = 400): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function nodeMap(tree: OptionTreeV2): Record<string, OptionNodeV2> {
  if (Array.isArray((tree as any).nodes)) {
    return Object.fromEntries((tree as any).nodes.filter((node: any) => node?.id).map((node: any) => [node.id, node]));
  }
  return tree.nodes ?? {};
}

function selectionKey(node: OptionNodeV2): string {
  return node.input?.selectionKey || node.key || node.id;
}

function optionEntries(tree: OptionTreeV2) {
  const nodes = nodeMap(tree);
  return getRenderablePbv2QuestionNodeIds(tree).map((id, index) => ({
    publicKey: `option_${index + 1}`,
    node: nodes[id],
  })).filter((entry) => Boolean(entry.node));
}

function selectedValue(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
    ? (value as { value: unknown }).value : value;
}

/** Project only display controls. Never serialize PBV2 pricing rules or tree JSON. */
export function projectStorefrontOptions(tree: OptionTreeV2, selections: Record<string, unknown> = {}) {
  const entries = optionEntries(tree);
  const selected = Object.fromEntries(Object.entries(selections).map(([key, value]) => [key, { value: selectedValue(value) }]));
  const runtime = resolveRuntimeVisibility(tree, { schemaVersion: 2, selected });
  const visibleNodeIds = new Set(runtime.visibleNodeIds);
  const visibleChoiceIds = new Set(runtime.visibleChoiceIds);
  const options: StorefrontOption[] = [];
  const effectiveSelections: Record<string, unknown> = {};
  for (const { publicKey, node } of entries) {
    if (!visibleNodeIds.has(node.id) || !node.input) continue;
    const type = String(node.input.type || '').toLowerCase();
    const choices = filterPbv2ChoicesForRuntime(node.id, sortPbv2Choices(node.choices), visibleChoiceIds)
      .map((choice) => ({ value: String(choice.value), label: safeText(choice.label, 120) || String(choice.value), description: safeText(choice.description, 300) }));
    const limits = node.input.constraints?.number;
    options.push({
      key: publicKey,
      label: safeText(node.label, 120) || 'Option',
      type,
      required: node.input.required === true,
      helpText: safeText(node.ui?.helpText || node.description, 400),
      choices,
      min: Number.isFinite(limits?.min) ? limits!.min! : null,
      max: Number.isFinite(limits?.max) ? limits!.max! : null,
      step: Number.isFinite(limits?.step) ? limits!.step! : null,
    });
    const value = runtime.effectiveSelections[selectionKey(node)];
    if (value !== undefined) effectiveSelections[publicKey] = value;
  }
  return { options, effectiveSelections, entries, runtime };
}

function decodeSelections(tree: OptionTreeV2, raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new PortalAccessError(400, 'Invalid product options');
  const incoming = raw as Record<string, unknown>;
  const entries = optionEntries(tree);
  if (Object.keys(incoming).length > entries.length || entries.length > 100) throw new PortalAccessError(400, 'Invalid product options');
  const byPublicKey = new Map(entries.map((entry) => [entry.publicKey, entry.node]));
  const decoded: Record<string, unknown> = {};
  for (const [publicKey, value] of Object.entries(incoming)) {
    const node = byPublicKey.get(publicKey);
    if (!node) throw new PortalAccessError(400, 'Invalid product options');
    // Bound raw data before runtime visibility evaluation. Validate against the
    // input type only after hidden descendants have been discarded.
    if (!(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.length <= 500)
      || (Array.isArray(value) && value.length <= 30 && value.every((item) => typeof item === 'string' && item.length <= 500)))) {
      throw new PortalAccessError(400, 'Invalid product option');
    }
    decoded[selectionKey(node)] = value;
  }
  // A previously visible child may become hidden when a parent choice changes.
  // Drop stale children before the canonical evaluator sees them, then re-run
  // visibility because a dropped child can in turn hide another option.
  for (let pass = 0; pass < entries.length; pass += 1) {
    const projected = projectStorefrontOptions(tree, decoded);
    const visible = new Map(projected.options.map((option) => [option.key, option]));
    let removed = false;
    for (const { publicKey, node } of entries) {
      const key = selectionKey(node);
      if (!(key in decoded)) continue;
      const option = visible.get(publicKey);
      const value = decoded[key];
      const invalidChoice = option && (
        (['select', 'radio'].includes(option.type) && !option.choices.some((choice) => choice.value === value))
        || (option.type === 'multiselect' && (!Array.isArray(value) || !value.every((item) => option.choices.some((choice) => choice.value === item))))
      );
      if (!option || invalidChoice) { delete decoded[key]; removed = true; }
    }
    if (!removed) break;
  }
  for (const { node } of entries) {
    const key = selectionKey(node);
    if (!(key in decoded)) continue;
    const value = decoded[key];
    const type = String(node.input?.type || '').toLowerCase();
    if (['select', 'radio'].includes(type)) {
      if (typeof value !== 'string' || !node.choices?.some((choice) => choice.value === value)) throw new PortalAccessError(400, 'Invalid product option');
    } else if (type === 'multiselect') {
      if (!Array.isArray(value) || value.length > 30 || !value.every((item) => typeof item === 'string' && node.choices?.some((choice) => choice.value === item))) throw new PortalAccessError(400, 'Invalid product option');
    } else if (['boolean', 'checkbox'].includes(type)) {
      if (typeof value !== 'boolean') throw new PortalAccessError(400, 'Invalid product option');
    } else if (type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new PortalAccessError(400, 'Invalid product option');
    } else if (['text', 'textarea'].includes(type)) {
      if (typeof value !== 'string' || value.length > 500) throw new PortalAccessError(400, 'Invalid product option');
    } else {
      throw new PortalAccessError(400, 'Invalid product option');
    }
  }
  return decoded;
}

function card(product: Pick<StorefrontProduct, 'id' | 'name' | 'description' | 'category' | 'thumbnailUrls'>) {
  return { id: product.id, name: product.name, description: product.description.slice(0, 300), category: product.category, imageUrl: safeImageUrl(product.thumbnailUrls) };
}

async function loadVisibleProduct(req: Request, productId: string) {
  const scope = getPortalScope(req);
  if (!scope.userId) throw new PortalAccessError(403, 'Portal customer scope is required');
  const linkedOnly = scope.customer.productVisibilityMode === 'linked-only';
  const [row] = await db.select({
    id: products.id, name: products.name, description: products.description, category: products.category,
    thumbnailUrls: products.thumbnailUrls, measurementMode: products.measurementMode,
    pricingProfileConfig: products.pricingProfileConfig, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
    isActive: products.isActive, storefrontVisible: products.storefrontVisible,
    activeTreeStatus: pbv2TreeVersions.status, treeJson: pbv2TreeVersions.treeJson,
  }).from(products).innerJoin(pbv2TreeVersions, and(
    eq(pbv2TreeVersions.id, products.pbv2ActiveTreeVersionId),
    eq(pbv2TreeVersions.organizationId, scope.organizationId),
    eq(pbv2TreeVersions.productId, products.id),
  )).where(and(
    eq(products.id, productId), eq(products.organizationId, scope.organizationId),
    eq(products.isActive, true), eq(products.storefrontVisible, true), eq(pbv2TreeVersions.status, 'ACTIVE'),
    ...(linkedOnly ? [exists(db.select({ id: customerVisibleProducts.productId }).from(customerVisibleProducts).where(and(
      eq(customerVisibleProducts.customerId, scope.customerId), eq(customerVisibleProducts.productId, products.id),
    )))] : []),
  )).limit(1);
  if (!row || !mayShowStorefrontProduct(row)) return null;
  return row;
}

export async function listPortalStorefrontProducts(req: Request) {
  const scope = getPortalScope(req);
  if (!scope.userId) throw new PortalAccessError(403, 'Portal customer scope is required');
  const search = String(req.query.search || '').trim().slice(0, 80);
  const category = String(req.query.category || '').trim().slice(0, 100);
  const requestedPage = Number(req.query.page ?? 0);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 && requestedPage <= 100000 ? requestedPage : 0;
  const pageSize = 100;
  const linkedOnly = scope.customer.productVisibilityMode === 'linked-only';
  const eligible = and(
    eq(products.organizationId, scope.organizationId), eq(products.isActive, true),
    eq(products.storefrontVisible, true), eq(pbv2TreeVersions.status, 'ACTIVE'),
    sql`coalesce(${products.pricingProfileConfig} #>> '{pbv2Override,enabled}', 'false') <> 'true'`,
    ...(linkedOnly ? [exists(db.select({ id: customerVisibleProducts.productId }).from(customerVisibleProducts).where(and(
      eq(customerVisibleProducts.customerId, scope.customerId), eq(customerVisibleProducts.productId, products.id),
    )))] : []),
  );
  const treeJoin = and(
    eq(pbv2TreeVersions.id, products.pbv2ActiveTreeVersionId),
    eq(pbv2TreeVersions.organizationId, scope.organizationId),
    eq(pbv2TreeVersions.productId, products.id),
  );
  const rows = await db.select({
    id: products.id, name: products.name, description: products.description, category: products.category,
    thumbnailUrls: products.thumbnailUrls, pricingProfileConfig: products.pricingProfileConfig,
    pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId, isActive: products.isActive,
    storefrontVisible: products.storefrontVisible, activeTreeStatus: pbv2TreeVersions.status,
  }).from(products).innerJoin(pbv2TreeVersions, treeJoin).where(and(
    eligible,
    ...(search ? [or(ilike(products.name, `%${search}%`), ilike(products.description, `%${search}%`), ilike(products.category, `%${search}%`))] : []),
    ...(category ? [eq(products.category, category)] : []),
  )).orderBy(products.name, products.id).limit(pageSize + 1).offset(page * pageSize);
  const categoryRows = await db.selectDistinct({ category: products.category })
    .from(products).innerJoin(pbv2TreeVersions, treeJoin).where(eligible).orderBy(products.category);
  return {
    items: rows.slice(0, pageSize).filter(mayShowStorefrontProduct).map(card),
    categories: categoryRows.map((row) => row.category).filter((value): value is string => Boolean(value)),
    hasMore: rows.length > pageSize,
    page,
  };
}

export async function getPortalStorefrontProduct(req: Request, productId: string) {
  const product = await loadVisibleProduct(req, productId);
  if (!product) return null;
  const tree = product.treeJson as OptionTreeV2;
  const fixedDimensions = getPbv2FixedDimensions(tree);
  const projected = projectStorefrontOptions(tree);
  const dimensionsRequired = product.measurementMode !== 'quantity_only' && !fixedDimensions;
  return {
    ...card(product),
    measurementMode: product.measurementMode,
    dimensionsRequired,
    fixedDimensions: fixedDimensions ? { widthIn: fixedDimensions.widthIn, heightIn: fixedDimensions.heightIn } : null,
    defaults: { quantity: 1, widthIn: fixedDimensions?.widthIn ?? null, heightIn: fixedDimensions?.heightIn ?? null, selections: projected.effectiveSelections },
    options: projected.options,
  };
}

export async function previewPortalStorefrontPrice(req: Request, productId: string) {
  const scope = getPortalScope(req);
  const product = await loadVisibleProduct(req, productId);
  if (!product) return null;
  // Staff PBV2 Quote/Order pricing does not currently apply these customer
  // commercial fields. Fail closed instead of displaying a misleading price.
  const customer = scope.customer;
  if (customer.pricingTier && customer.pricingTier !== 'default'
    || Number(customer.defaultDiscountPercent || 0) !== 0
    || Number(customer.defaultMarkupPercent || 0) !== 0
    || Number(customer.defaultMarginPercent || 0) !== 0) {
    throw new PortalAccessError(422, 'Pricing is temporarily unavailable for this customer.');
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const quantity = Number(body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw new PortalAccessError(400, 'Enter a valid quantity.');
  const tree = product.treeJson as OptionTreeV2;
  const fixedDimensions = getPbv2FixedDimensions(tree);
  const needsDimensions = product.measurementMode !== 'quantity_only' && !fixedDimensions;
  const widthIn = fixedDimensions?.widthIn ?? (needsDimensions ? Number(body.widthIn) : undefined);
  const heightIn = fixedDimensions?.heightIn ?? (needsDimensions ? Number(body.heightIn) : undefined);
  if (needsDimensions && (!Number.isFinite(widthIn) || !Number.isFinite(heightIn) || widthIn! <= 0 || heightIn! <= 0 || widthIn! > 10000 || heightIn! > 10000)) {
    throw new PortalAccessError(400, 'Enter valid dimensions.');
  }
  const selections = decodeSelections(tree, body.selections);
  const projected = projectStorefrontOptions(tree, selections);
  const missing = projected.options.filter((option) => {
    if (!option.required) return false;
    const value = projected.effectiveSelections[option.key];
    if (option.type === 'boolean' || option.type === 'checkbox') return value !== true;
    if (option.type === 'multiselect') return !Array.isArray(value) || value.length === 0;
    return value == null || value === '';
  });
  // A parent choice can reveal a required child that the initial detail DTO
  // could not include. Return the updated safe controls before pricing it.
  if (missing.length) return {
    priceAvailable: false,
    unitPriceCents: null,
    totalCents: null,
    options: projected.options,
    effectiveSelections: projected.effectiveSelections,
  };
  try {
    const priced = await priceLineItem({
      organizationId: scope.organizationId, productId: product.id, quantity,
      widthIn, heightIn, pbv2ExplicitSelections: selections,
      pbv2TreeVersionIdOverride: product.pbv2ActiveTreeVersionId ?? undefined,
    });
    if (!Number.isSafeInteger(priced.lineTotalCents) || priced.lineTotalCents < 0) throw new Error('Invalid pricing output');
    return {
      priceAvailable: true,
      unitPriceCents: Math.round(priced.lineTotalCents / quantity),
      totalCents: priced.lineTotalCents,
      options: projected.options,
      effectiveSelections: projected.effectiveSelections,
    };
  } catch {
    throw new PortalAccessError(422, 'Pricing is temporarily unavailable for this configuration.');
  }
}
