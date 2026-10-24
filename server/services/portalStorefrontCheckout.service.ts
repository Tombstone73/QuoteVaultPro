import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Request } from 'express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  companySettings, invoices, orderAttachments, orderLineItems, orders, organizations, products, productTypes, portalStorefrontCartFiles,
  portalStorefrontCarts, type PortalStorefrontCartLine,
} from '@shared/schema';
import { getPbv2FixedDimensions } from '@shared/pbv2/fixedDimensions';
import type { OptionTreeV2 } from '@shared/optionTreeV2';
import { db } from '../db';
import { calculateQuoteOrderTotals, getOrganizationTaxSettings } from '../quoteOrderPricing';
import { canonicalOrderOperations, CanonicalOrderOperationError } from './orders/canonicalOrderOperations';
import { PortalAccessError, getPortalScope, parsePortalFileSubmissionPayload } from './portal.service';
import { decodeSelections, hasStorefrontPricing, loadVisibleProduct, pricePortalStorefrontConfiguration } from './portalStorefront.service';
import { priceLineItem } from './pricing/PricingService';
import { isUnprintedCoroplast } from '@shared/blankCoroplast';
import { recordPortalFollowUpItem } from './portalFollowUps';
import { storageApplicationService } from './storage/StorageApplicationService';
import { canPortalPlaceOrder, isCurrentCartReview } from './portalStorefrontCheckout.policy';

const lineInput = z.object({
  productId: z.string().uuid(),
  treeVersionId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
  widthIn: z.number().positive().max(10000).nullable().optional(),
  heightIn: z.number().positive().max(10000).nullable().optional(),
  selections: z.record(z.union([z.string().max(500), z.number().finite(), z.boolean(), z.array(z.string().max(500)).max(30)])).default({}),
}).strict();

type CartRow = typeof portalStorefrontCarts.$inferSelect;
type AccessScope = ReturnType<typeof getPortalScope> & { accessId: string; canOrder: boolean };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function scopedAccess(req: Request, mutation: boolean): AccessScope {
  const scope = getPortalScope(req);
  const access = (req as Request & { portalAccess?: {
    id: string; userId: string | null; organizationId: string; customerId: string;
    contactId: string | null; status: string; accessRole: string;
  } | null; staffPortalPreview?: unknown }).portalAccess;
  if (!access || access.status !== 'ACTIVE' || access.userId !== scope.userId ||
      access.organizationId !== scope.organizationId || access.customerId !== scope.customerId ||
      access.contactId !== scope.contactId) {
    throw new PortalAccessError(403, 'Active customer portal access is required.');
  }
  const staffPreview = Boolean((req as Request & { staffPortalPreview?: unknown }).staffPortalPreview);
  const canOrder = canPortalPlaceOrder(access.accessRole, staffPreview);
  if (mutation && !canOrder) {
    throw new PortalAccessError(403, 'A Buyer or Company Admin portal account is required to place Orders.');
  }
  return { ...scope, accessId: access.id, canOrder };
}

async function findOpenCart(executor: typeof db | Transaction, scope: AccessScope, lock = false): Promise<CartRow | null> {
  const query = executor.select().from(portalStorefrontCarts).where(and(
    eq(portalStorefrontCarts.organizationId, scope.organizationId),
    eq(portalStorefrontCarts.customerId, scope.customerId),
    eq(portalStorefrontCarts.accessId, scope.accessId),
    eq(portalStorefrontCarts.status, 'open'),
  ));
  const [cart] = lock ? await query.for('update').limit(1) : await query.limit(1);
  return cart ?? null;
}

async function getOrCreateOpenCart(tx: Transaction, scope: AccessScope): Promise<CartRow> {
  // One access owns one cart. The advisory lock closes first-add races.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portal-cart:${scope.organizationId}:${scope.accessId}`}))`);
  const existing = await findOpenCart(tx, scope, true);
  if (existing) return existing;
  const [cart] = await tx.insert(portalStorefrontCarts).values({
    organizationId: scope.organizationId, customerId: scope.customerId, accessId: scope.accessId,
  }).returning();
  if (!cart) throw new Error('Could not create cart.');
  return cart;
}

async function cartDto(executor: typeof db | Transaction, cart: CartRow | null, scope: AccessScope) {
  const productIds = Array.from(new Set((cart?.lines ?? []).map(line => line.productId)));
  const names = productIds.length ? await executor.select({ id: products.id, name: products.name })
    .from(products).where(and(eq(products.organizationId, scope.organizationId), inArray(products.id, productIds))) : [];
  const nameById = new Map(names.map(row => [row.id, row.name]));
  const files = cart ? await executor.select({
    id: portalStorefrontCartFiles.id, lineId: portalStorefrontCartFiles.lineId,
    fileName: portalStorefrontCartFiles.originalFilename, sizeBytes: portalStorefrontCartFiles.sizeBytes,
  }).from(portalStorefrontCartFiles).where(and(
    eq(portalStorefrontCartFiles.organizationId, scope.organizationId),
    eq(portalStorefrontCartFiles.cartId, cart.id), isNull(portalStorefrontCartFiles.removedAt),
  )) : [];
  return {
    id: cart?.id ?? null, version: cart?.version ?? 0, canOrder: scope.canOrder,
    lines: (cart?.lines ?? []).map(line => ({ ...line, productName: nameById.get(line.productId) ?? 'Unavailable Product' })),
    files: files.filter(file => cart?.lines.some(line => line.id === file.lineId)),
  };
}

export async function getPortalStorefrontCart(req: Request) {
  const scope = scopedAccess(req, false);
  return cartDto(db, await findOpenCart(db, scope), scope);
}

async function checkedLine(req: Request, raw: unknown): Promise<PortalStorefrontCartLine> {
  const parsed = lineInput.safeParse(raw);
  if (!parsed.success) throw new PortalAccessError(400, parsed.error.issues[0]?.message || 'Invalid cart line.');
  const product = await loadVisibleProduct(req, parsed.data.productId);
  if (!product || !product.portalOrderable || !hasStorefrontPricing(product)) {
    throw new PortalAccessError(409, 'This Product is not approved for portal ordering. Contact the shop for a Quote.');
  }
  if (product.pbv2ActiveTreeVersionId !== parsed.data.treeVersionId) {
    throw new PortalAccessError(409, 'Product options or pricing changed. Reopen the Product and review its current configuration.');
  }
  const price = await pricePortalStorefrontConfiguration(req, product.id, parsed.data);
  if (!price?.priceAvailable) throw new PortalAccessError(409, 'Choose all required Product options before adding it to the cart.');
  const visibleKeys = new Set(price.options.map((option) => option.key));
  const currentSelections = Object.fromEntries(Object.entries(parsed.data.selections).filter(([key]) => visibleKeys.has(key)));
  return {
    id: randomUUID(), productId: product.id, treeVersionId: parsed.data.treeVersionId,
    quantity: parsed.data.quantity, widthIn: parsed.data.widthIn ?? null,
    heightIn: parsed.data.heightIn ?? null, selections: currentSelections,
  };
}

export async function addPortalStorefrontCartLine(req: Request) {
  const scope = scopedAccess(req, true);
  const line = await checkedLine(req, req.body);
  return db.transaction(async tx => {
    const cart = await getOrCreateOpenCart(tx, scope);
    if (cart.lines.length >= 30) throw new PortalAccessError(409, 'The cart already has 30 items.');
    const [updated] = await tx.update(portalStorefrontCarts).set({
      lines: [...cart.lines, line], version: cart.version + 1, review: null, updatedAt: new Date(),
    }).where(eq(portalStorefrontCarts.id, cart.id)).returning();
    return cartDto(tx, updated!, scope);
  });
}

export async function updatePortalStorefrontCartLine(req: Request, lineId: string) {
  const scope = scopedAccess(req, true);
  const next = await checkedLine(req, req.body);
  return db.transaction(async tx => {
    const cart = await findOpenCart(tx, scope, true);
    if (!cart) throw new PortalAccessError(404, 'Cart not found.');
    const current = cart.lines.find(line => line.id === lineId);
    if (!current) throw new PortalAccessError(404, 'Cart item not found.');
    if (current.productId !== next.productId) throw new PortalAccessError(400, 'Replace this cart item by removing it and adding the new Product.');
    const [updated] = await tx.update(portalStorefrontCarts).set({
      lines: cart.lines.map(line => line.id === lineId ? { ...next, id: lineId } : line),
      version: cart.version + 1, review: null, updatedAt: new Date(),
    }).where(eq(portalStorefrontCarts.id, cart.id)).returning();
    return cartDto(tx, updated!, scope);
  });
}

export async function removePortalStorefrontCartLine(req: Request, lineId: string) {
  const scope = scopedAccess(req, true);
  return db.transaction(async tx => {
    const cart = await findOpenCart(tx, scope, true);
    if (!cart || !cart.lines.some(line => line.id === lineId)) throw new PortalAccessError(404, 'Cart item not found.');
    const now = new Date();
    await tx.update(portalStorefrontCartFiles).set({ removedAt: now }).where(and(
      eq(portalStorefrontCartFiles.organizationId, scope.organizationId), eq(portalStorefrontCartFiles.cartId, cart.id),
      eq(portalStorefrontCartFiles.lineId, lineId), isNull(portalStorefrontCartFiles.removedAt),
    ));
    const [updated] = await tx.update(portalStorefrontCarts).set({
      lines: cart.lines.filter(line => line.id !== lineId), version: cart.version + 1,
      review: null, updatedAt: now,
    }).where(eq(portalStorefrontCarts.id, cart.id)).returning();
    return cartDto(tx, updated!, scope);
  });
}

export async function uploadPortalStorefrontCartFile(req: Request, lineId: string) {
  const scope = scopedAccess(req, true);
  const cart = await findOpenCart(db, scope);
  if (!cart || !cart.lines.some(line => line.id === lineId)) throw new PortalAccessError(404, 'Cart item not found.');
  const submission = parsePortalFileSubmissionPayload(req.body);
  const existing = await db.select({ id: portalStorefrontCartFiles.id }).from(portalStorefrontCartFiles).where(and(
    eq(portalStorefrontCartFiles.organizationId, scope.organizationId), eq(portalStorefrontCartFiles.cartId, cart.id),
    eq(portalStorefrontCartFiles.lineId, lineId), isNull(portalStorefrontCartFiles.removedAt),
  ));
  if (existing.length >= 10) throw new PortalAccessError(409, 'A cart item may have at most 10 staged files.');
  // The customer resource is already supported by every storage adapter. The
  // durable cart link provides finer per-access and per-line authorization.
  const result = await storageApplicationService.finalizeUpload({
    organizationId: scope.organizationId, createdByUserId: scope.userId!,
    resource: { organizationId: scope.organizationId, resourceType: 'customer', resourceId: scope.customerId },
    source: { kind: 'buffer', buffer: submission.buffer, originalFilename: submission.fileName, mimeType: submission.mimeType },
    persistLink: async (tx, stored) => {
      // An upload can outlive a cart mutation. Recheck ownership before linking.
      const [live] = await tx.select().from(portalStorefrontCarts).where(and(
        eq(portalStorefrontCarts.id, cart.id), eq(portalStorefrontCarts.organizationId, scope.organizationId),
        eq(portalStorefrontCarts.accessId, scope.accessId), eq(portalStorefrontCarts.status, 'open'),
      )).for('update').limit(1);
      if (!live?.lines.some((line: PortalStorefrontCartLine) => line.id === lineId)) throw new PortalAccessError(409, 'Cart item changed during upload. Retry from the current cart.');
      const [file] = await tx.insert(portalStorefrontCartFiles).values({
        organizationId: scope.organizationId, cartId: cart.id, lineId, fileRecordId: stored.fileRecord.id,
        originalFilename: stored.storedObject.originalFilename, storedFilename: stored.storedObject.storedFilename,
        mimeType: stored.storedObject.mimeType, sizeBytes: stored.storedObject.sizeBytes,
        checksum: stored.storedObject.checksum, extension: stored.storedObject.extension, note: submission.note,
      }).returning();
      await tx.update(portalStorefrontCarts).set({ version: live.version + 1, review: null, updatedAt: new Date() })
        .where(eq(portalStorefrontCarts.id, cart.id));
      return file!;
    },
  });
  return { id: result.linkedRecord.id, lineId, fileName: submission.fileName, status: 'Staged for staff review' };
}

export async function removePortalStorefrontCartFile(req: Request, fileId: string) {
  const scope = scopedAccess(req, true);
  return db.transaction(async tx => {
    const cart = await findOpenCart(tx, scope, true);
    if (!cart) throw new PortalAccessError(404, 'Cart not found.');
    const [file] = await tx.update(portalStorefrontCartFiles).set({ removedAt: new Date() }).where(and(
      eq(portalStorefrontCartFiles.id, fileId), eq(portalStorefrontCartFiles.organizationId, scope.organizationId),
      eq(portalStorefrontCartFiles.cartId, cart.id), isNull(portalStorefrontCartFiles.removedAt),
    )).returning();
    if (!file) throw new PortalAccessError(404, 'Cart file not found.');
    const [updated] = await tx.update(portalStorefrontCarts).set({ version: cart.version + 1, review: null, updatedAt: new Date() })
      .where(eq(portalStorefrontCarts.id, cart.id)).returning();
    return cartDto(tx, updated!, scope);
  });
}

async function calculateReview(req: Request, cart: CartRow, scope: AccessScope) {
  if (cart.lines.length === 0) throw new PortalAccessError(409, 'Add at least one Product to the cart.');
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, scope.organizationId)).limit(1);
  const [settings] = await db.select().from(companySettings).where(eq(companySettings.organizationId, scope.organizationId)).limit(1);
  const pickup = settings?.physicalAddress;
  if (!organization || !settings || !pickup?.line1 || !pickup.city || !pickup.state || !pickup.postalCode) {
    throw new PortalAccessError(409, 'Pickup location is incomplete in Company Settings. Contact the shop before placing this Order.');
  }
  const currency = String(organization.settings?.currency || 'USD').toUpperCase();
  if (currency !== 'USD') throw new PortalAccessError(409, 'Online ordering is not yet configured for this currency. Contact the shop for a Quote.');
  const files = await db.select().from(portalStorefrontCartFiles).where(and(
    eq(portalStorefrontCartFiles.organizationId, scope.organizationId), eq(portalStorefrontCartFiles.cartId, cart.id),
    isNull(portalStorefrontCartFiles.removedAt),
  ));
  const pricedLines = [];
  for (const line of cart.lines) {
    const product = await loadVisibleProduct(req, line.productId);
    if (!product || !product.portalOrderable || !hasStorefrontPricing(product)) {
      throw new PortalAccessError(409, 'A cart Product is no longer approved for ordering. Remove it or contact the shop.');
    }
    if (product.pbv2ActiveTreeVersionId !== line.treeVersionId) {
      throw new PortalAccessError(409, `${product.name} changed. Reopen and update this cart item before checkout.`);
    }
    const tree = product.treeJson as OptionTreeV2;
    const selected = decodeSelections(tree, line.selections);
    const blankCoroplast = isUnprintedCoroplast(tree, selected);
    if (product.artworkPolicy === 'required' && !blankCoroplast && !files.some(file => file.lineId === line.id)) {
      throw new PortalAccessError(409, `${product.name} requires artwork. Upload a file to this cart item before checkout.`);
    }
    const preview = await pricePortalStorefrontConfiguration(req, line.productId, line);
    if (!preview?.priceAvailable || preview.totalCents === null) throw new PortalAccessError(409, `Complete all required options for ${product.name}.`);
    const fixed = getPbv2FixedDimensions(tree);
    const widthIn = fixed?.widthIn ?? line.widthIn ?? undefined;
    const heightIn = fixed?.heightIn ?? line.heightIn ?? undefined;
    const price = await priceLineItem({ organizationId: scope.organizationId, productId: product.id,
      quantity: line.quantity, widthIn, heightIn, pbv2ExplicitSelections: selected,
      pbv2TreeVersionIdOverride: line.treeVersionId });
    if (price.lineTotalCents !== preview.totalCents) throw new PortalAccessError(409, `Pricing changed for ${product.name}. Review the cart again.`);
    const [productType] = product.productTypeId ? await db.select({ name: productTypes.name, requiresPrepressOverride: productTypes.requiresPrepressOverride })
      .from(productTypes).where(and(eq(productTypes.id, product.productTypeId), eq(productTypes.organizationId, scope.organizationId))).limit(1) : [];
    const requiresPrepress = blankCoroplast ? false : productType?.requiresPrepressOverride ?? organization.prepressDefaultEnabled ?? true;
    pricedLines.push({ line, product, price, widthIn, heightIn, selections: selected,
      blankCoroplast, requiresPrepress, productTypeName: productType?.name ?? 'wide_roll' });
  }
  const totals = await calculateQuoteOrderTotals(pricedLines.map(({ product, price }) => ({
    productId: product.id, linePrice: price.lineTotalCents / 100, isTaxable: product.isTaxable,
  })), getOrganizationTaxSettings(organization), scope.customer,
  { country: pickup.country || 'US', state: pickup.state, city: pickup.city, postalCode: pickup.postalCode },
  { country: pickup.country || 'US', state: pickup.state, city: pickup.city, postalCode: pickup.postalCode });
  const subtotalCents = pricedLines.reduce((sum, row) => sum + row.price.lineTotalCents, 0);
  const taxCents = Math.round(totals.taxAmount * 100);
  const summary = {
    cartVersion: cart.version, currency, fulfillmentMethod: 'pickup' as const,
    pickupLocation: { name: settings.companyName, line1: pickup.line1, line2: pickup.line2 ?? null,
      city: pickup.city, state: pickup.state, postalCode: pickup.postalCode, country: pickup.country || 'US' },
    lines: pricedLines.map(({ line, product, price }) => ({ id: line.id, productId: product.id,
      treeVersionId: line.treeVersionId, productName: product.name, quantity: line.quantity, totalCents: price.lineTotalCents })),
    subtotalCents, taxCents, shippingCents: 0, totalCents: subtotalCents + taxCents,
  };
  return { summary, pricedLines, totals, files };
}

export async function reviewPortalStorefrontCart(req: Request) {
  const scope = scopedAccess(req, true);
  const cart = await findOpenCart(db, scope);
  if (!cart) throw new PortalAccessError(409, 'Cart is empty.');
  const priced = await calculateReview(req, cart, scope);
  return db.transaction(async tx => {
    const locked = await findOpenCart(tx, scope, true);
    if (!locked || locked.id !== cart.id || locked.version !== cart.version) {
      throw new PortalAccessError(409, 'Cart changed while totals were calculated. Review the current cart again.');
    }
    const reviewToken = randomUUID();
    await tx.update(portalStorefrontCarts).set({ review: { token: reviewToken, version: cart.version, summary: priced.summary }, updatedAt: new Date() })
      .where(eq(portalStorefrontCarts.id, cart.id));
    return { ...priced.summary, reviewToken };
  });
}

const submitInput = z.object({ reviewToken: z.string().uuid(), submissionKey: z.string().uuid() }).strict();

export async function submitPortalStorefrontCart(req: Request) {
  const scope = scopedAccess(req, true);
  const parsed = submitInput.safeParse(req.body);
  if (!parsed.success) throw new PortalAccessError(400, 'Review the current cart before placing the Order.');
  const { reviewToken, submissionKey } = parsed.data;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portal-checkout:${scope.organizationId}:${submissionKey}`}))`);
    const [prior] = await tx.select().from(portalStorefrontCarts).where(and(
      eq(portalStorefrontCarts.organizationId, scope.organizationId), eq(portalStorefrontCarts.submissionKey, submissionKey),
    )).limit(1);
    if (prior) {
      if (prior.accessId !== scope.accessId || !prior.orderId) throw new PortalAccessError(409, 'This checkout request is already in use.');
      const [savedOrder] = await tx.select({ orderNumber: orders.orderNumber, displayNumber: orders.displayNumber })
        .from(orders).where(and(eq(orders.id, prior.orderId), eq(orders.organizationId, scope.organizationId))).limit(1);
      if (!savedOrder) throw new Error('Submitted Order could not be read back.');
      const priorFiles = await tx.select({ orderAttachmentId: portalStorefrontCartFiles.orderAttachmentId })
        .from(portalStorefrontCartFiles).where(and(eq(portalStorefrontCartFiles.cartId, prior.id),
          eq(portalStorefrontCartFiles.organizationId, scope.organizationId)));
      return { status: 'placed' as const, orderId: prior.orderId,
        orderNumber: savedOrder?.displayNumber || savedOrder?.orderNumber,
        totalCents: Number((prior.review as { summary?: { totalCents?: number } } | null)?.summary?.totalCents ?? 0),
        currency: 'USD', artworkStatus: priorFiles.some(file => file.orderAttachmentId)
          ? 'Artwork pending staff review' : 'Artwork may be sent later; staff review pending' };
    }
    const cart = await findOpenCart(tx, scope, true);
    if (!cart) throw new PortalAccessError(409, 'Cart changed or was already submitted. Reload the cart.');
    const review = cart.review as { token?: string; version?: number; summary?: unknown } | null;
    if (!review || !isCurrentCartReview({ reviewToken, cartVersion: cart.version,
      savedToken: review?.token, savedVersion: review?.version })) {
      throw new PortalAccessError(409, 'Cart changed after review. Check the current items and totals before placing the Order.');
    }
    const priced = await calculateReview(req, cart, scope);
    if (!isDeepStrictEqual(priced.summary, review.summary)) {
      const nextToken = randomUUID();
      await tx.update(portalStorefrontCarts).set({ review: { token: nextToken, version: cart.version, summary: priced.summary }, updatedAt: new Date() })
        .where(eq(portalStorefrontCarts.id, cart.id));
      return { status: 'changed' as const, review: { ...priced.summary, reviewToken: nextToken } };
    }
    const order = await canonicalOrderOperations.createInTransaction(tx, {
      organizationId: scope.organizationId, actorUserId: scope.userId!,
      auditDescription: `Customer placed portal pickup Order from cart ${cart.id}.`,
      payload: {
        customerId: scope.customerId, contactId: scope.contactId, createdByUserId: scope.userId!, status: 'new',
        shippingMethod: 'pickup', shippingCents: 0, shippingChargeDecision: 'unset',
        productionIntakePolicy: 'deferred', taxRate: priced.totals.taxRate,
        taxAmount: priced.totals.taxAmount, taxableSubtotal: priced.totals.taxableSubtotal,
        lineItems: priced.pricedLines.map(({ line, product, price, widthIn, heightIn, selections, blankCoroplast, requiresPrepress, productTypeName }, index) => ({
          productId: product.id, productType: productTypeName, description: product.name,
          width: widthIn ?? 0, height: heightIn ?? 0, quantity: line.quantity,
          unitPrice: price.lineTotalCents / 100 / line.quantity, totalPrice: price.lineTotalCents / 100,
          selectedOptions: price.pbv2SnapshotJson.selectedOptions ?? [], optionSelectionsJson: selections,
          pbv2TreeVersionId: price.pbv2TreeVersionId, pbv2SnapshotJson: price.pbv2SnapshotJson,
          pricedAt: new Date(), sortOrder: index, taxAmount: priced.totals.lineItemsWithTax[index]?.taxAmount ?? 0,
          isTaxableSnapshot: product.isTaxable, requiresProofApproval: blankCoroplast ? false : product.requiresProofApproval,
          requiresPrepress,
          ...(blankCoroplast ? { productionNotes: 'Unprinted Coroplast: do not print or require artwork. Review any selected cutting and finishing before releasing production.' } : {}),
        })),
      },
    }).catch(error => {
      if (error instanceof CanonicalOrderOperationError && error.code === 'ORDER_IDENTITY_REQUIRED') {
        throw new PortalAccessError(409, error.message);
      }
      throw error;
    });
    const linkedInvoices = await tx.select({ totalCents: invoices.totalCents,
      customerReleasedAt: invoices.customerReleasedAt, lastSentAt: invoices.lastSentAt,
      accountingApprovedAt: invoices.accountingApprovedAt })
      .from(invoices).where(and(eq(invoices.organizationId, scope.organizationId), eq(invoices.orderId, order.id)));
    const linkedInvoice = linkedInvoices[0];
    const persistedOrderTotalCents = Math.round(Number(order.total) * 100);
    if (linkedInvoices.length !== 1 || !linkedInvoice || linkedInvoice.totalCents !== priced.summary.totalCents ||
        persistedOrderTotalCents !== priced.summary.totalCents || linkedInvoice.customerReleasedAt ||
        linkedInvoice.lastSentAt || linkedInvoice.accountingApprovedAt) {
      throw new Error('Order and linked Invoice totals or release state did not match the accepted checkout review.');
    }
    const savedLines = await tx.select({ id: orderLineItems.id, sortOrder: orderLineItems.sortOrder })
      .from(orderLineItems).where(eq(orderLineItems.orderId, order.id));
    const lineIdByCartId = new Map(cart.lines.map((line, index) => [line.id, savedLines.find(saved => saved.sortOrder === index)?.id]));
    if (lineIdByCartId.size !== cart.lines.length || Array.from(lineIdByCartId.values()).some(id => !id)) throw new Error('Order line association failed.');
    for (const file of priced.files) {
      const orderLineItemId = lineIdByCartId.get(file.lineId);
      if (!orderLineItemId) throw new Error('Artwork line association failed.');
      const [attachment] = await tx.insert(orderAttachments).values({
        orderId: order.id, orderLineItemId,
        quoteId: null, fileRecordId: file.fileRecordId, uploadedByUserId: scope.userId,
        uploadedByName: scope.customer.companyName, fileName: file.originalFilename, fileUrl: null,
        fileSize: file.sizeBytes, mimeType: file.mimeType,
        description: 'Customer checkout artwork — awaiting staff review.', originalFilename: file.originalFilename,
        storedFilename: file.storedFilename, relativePath: null, storageProvider: null,
        extension: file.extension, sizeBytes: file.sizeBytes, checksum: file.checksum,
        thumbStatus: 'uploaded', customerVisible: true, portalFileCategory: 'customer_upload',
        portalDisplayName: file.originalFilename, portalDescription: file.note,
        customerUploadReviewStatus: 'pending_review', role: 'reference', side: 'na', isPrimary: false,
      }).returning();
      await tx.update(portalStorefrontCartFiles).set({ orderAttachmentId: attachment!.id })
        .where(eq(portalStorefrontCartFiles.id, file.id));
    }
    await recordPortalFollowUpItem(tx, {
      organizationId: scope.organizationId, eventType: 'ORDER_SUBMITTED', customerId: scope.customerId,
      customerName: scope.customer.companyName, entityType: 'order', entityId: order.id,
      relatedOrderId: order.id, title: `Storefront Order ${order.displayNumber || order.orderNumber} received`,
      description: `${cart.lines.length} configured item(s), ${priced.files.length} artwork file(s) awaiting review. Production deferred.`,
      followUpArea: 'Order Review', actionUrl: `/orders/${order.id}`,
      metadata: { source: 'customer_portal_storefront', cartId: cart.id, deferredProduction: true,
        lineIds: savedLines.map(line => line.id), artworkPendingReviewCount: priced.files.length },
    });
    await tx.update(portalStorefrontCarts).set({ status: 'submitted', submissionKey,
      orderId: order.id, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(portalStorefrontCarts.id, cart.id));
    return { status: 'placed' as const, orderId: order.id,
      orderNumber: order.displayNumber || order.orderNumber, totalCents: priced.summary.totalCents,
      currency: priced.summary.currency, artworkStatus: priced.files.length
        ? 'Artwork pending staff review' : 'Artwork may be sent later; staff review pending' };
  });
}
