import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { customers, productVariants, products, users } from "../../shared/schema";
import { createQuote } from "../../server/storage";

const ORG_ID = "org_titan_001";
const OWNER_EMAIL = "qa.quote.validation+20260312@titanos.dev";

async function main() {
  const [labelArg] = process.argv.slice(2);
  const label = labelArg?.trim() || `Workflow validation ${new Date().toISOString()}`;

  const [user] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
  if (!user) throw new Error(`Owner user not found for ${OWNER_EMAIL}`);

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.organizationId, ORG_ID))
    .limit(1);
  if (!customer) throw new Error(`No customer found in ${ORG_ID}`);

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.organizationId, ORG_ID))
    .limit(1);
  if (!product) throw new Error(`No product found in ${ORG_ID}`);

  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .limit(1);

  const lineItemBase = {
    productId: product.id,
    productName: product.name,
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? null,
    productType: product.productTypeId ? String(product.productTypeId) : "wide_roll",
    width: 24,
    height: 36,
    quantity: 1,
    selectedOptions: [],
    linePrice: 10,
    priceBreakdown: {
      basePrice: 10,
      optionsPrice: 0,
      total: 10,
      formula: "validation_fixture",
    },
    pbv2TreeVersionId: null,
    pbv2SnapshotJson: {},
    pricedAt: new Date(),
    taxAmount: 0,
    isTaxableSnapshot: true,
  };

  const quote = await createQuote(ORG_ID, {
    userId: user.id,
    customerId: customer.id,
    contactId: null,
    customerName: customer.companyName,
    source: "internal",
    status: "draft",
    label,
    subtotal: 30,
    taxAmount: 0,
    taxableSubtotal: 30,
    totalPrice: 30,
    lineItems: [
      {
        ...lineItemBase,
        productName: `${product.name} A`,
        displayOrder: 0,
        requiresDesign: true,
        requiresPrepress: true,
      },
      {
        ...lineItemBase,
        productName: `${product.name} B`,
        displayOrder: 1,
        requiresDesign: false,
        requiresPrepress: true,
      },
      {
        ...lineItemBase,
        productName: `${product.name} C`,
        displayOrder: 2,
        requiresDesign: false,
        requiresPrepress: false,
      },
    ],
  } as any);

  console.log(JSON.stringify({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    customerId: customer.id,
    productId: product.id,
    variantId: variant?.id ?? null,
    lineItems: quote.lineItems.map((item: any) => ({
      id: item.id,
      productName: item.productName,
      requiresDesign: item.requiresDesign,
      requiresPrepress: item.requiresPrepress,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});