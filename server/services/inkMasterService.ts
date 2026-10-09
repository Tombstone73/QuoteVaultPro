import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { inkMasterPrinters, inkMasterSavedSpecs, organizations } from "@shared/schema";
import { inkQuantitiesSchema, type InkMasterPrinterInput, type InkMasterSpecInput } from "@shared/inkMaster";

export class InkMasterError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const initialPrinters: InkMasterPrinterInput[] = [
  { name: "Default Printer", containerSizeLiters: 1, containerPriceCents: null, restockTargetLiters: 4 },
  { name: "Digitech Flatbed", containerSizeLiters: 1, containerPriceCents: 13000, restockTargetLiters: 4 },
  { name: "Canon M5W", containerSizeLiters: 1, containerPriceCents: 18000, restockTargetLiters: 2 },
];

function printerDto(row: typeof inkMasterPrinters.$inferSelect) {
  return {
    ...row,
    containerSizeLiters: Number(row.containerSizeLiters),
    restockTargetLiters: Number(row.restockTargetLiters),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function specDto(row: typeof inkMasterSavedSpecs.$inferSelect) {
  return {
    ...row,
    usageMlPerSheetSide: inkQuantitiesSchema.parse(row.usageMlPerSheetSide),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listInkMasterPrinters(organizationId: string) {
  // The first staff visit initializes editable defaults. Conflict handling
  // makes concurrent first visits idempotent without overwriting edits.
  const existing = await db.select({ id: inkMasterPrinters.id }).from(inkMasterPrinters)
    .where(eq(inkMasterPrinters.organizationId, organizationId)).limit(1);
  if (existing.length === 0) {
    await db.insert(inkMasterPrinters).values(initialPrinters.map((printer) => ({
      organizationId,
      name: printer.name,
      containerSizeLiters: String(printer.containerSizeLiters),
      containerPriceCents: printer.containerPriceCents,
      restockTargetLiters: String(printer.restockTargetLiters),
    }))).onConflictDoNothing();
  }
  const rows = await db.select().from(inkMasterPrinters)
    .where(eq(inkMasterPrinters.organizationId, organizationId))
    .orderBy(asc(inkMasterPrinters.createdAt), asc(inkMasterPrinters.name));
  return rows.map(printerDto);
}

export async function createInkMasterPrinter(organizationId: string, input: InkMasterPrinterInput) {
  const [row] = await db.insert(inkMasterPrinters).values({
    organizationId,
    name: input.name,
    containerSizeLiters: String(input.containerSizeLiters),
    containerPriceCents: input.containerPriceCents,
    restockTargetLiters: String(input.restockTargetLiters),
  }).returning();
  return printerDto(row);
}

export async function updateInkMasterPrinter(organizationId: string, id: string, patch: Partial<InkMasterPrinterInput>) {
  const [row] = await db.update(inkMasterPrinters).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.containerSizeLiters !== undefined ? { containerSizeLiters: String(patch.containerSizeLiters) } : {}),
    ...(patch.containerPriceCents !== undefined ? { containerPriceCents: patch.containerPriceCents } : {}),
    ...(patch.restockTargetLiters !== undefined ? { restockTargetLiters: String(patch.restockTargetLiters) } : {}),
    updatedAt: new Date(),
  }).where(and(eq(inkMasterPrinters.organizationId, organizationId), eq(inkMasterPrinters.id, id))).returning();
  if (!row) throw new InkMasterError("Printer not found", 404);
  return printerDto(row);
}

export async function setInkMasterPrinterActive(organizationId: string, id: string, active: boolean) {
  return db.transaction(async (tx) => {
    // Serialize changes to active-printer count inside one organization.
    await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, organizationId)).for("update");
    const [printer] = await tx.select().from(inkMasterPrinters)
      .where(and(eq(inkMasterPrinters.organizationId, organizationId), eq(inkMasterPrinters.id, id))).limit(1);
    if (!printer) throw new InkMasterError("Printer not found", 404);
    if (printer.isActive === active) return printerDto(printer);
    if (!active) {
      const activePrinters = await tx.select({ id: inkMasterPrinters.id }).from(inkMasterPrinters)
        .where(and(eq(inkMasterPrinters.organizationId, organizationId), eq(inkMasterPrinters.isActive, true)));
      if (activePrinters.length <= 1) throw new InkMasterError("The last active printer cannot be deleted", 409);
    }
    const [row] = await tx.update(inkMasterPrinters).set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(inkMasterPrinters.organizationId, organizationId), eq(inkMasterPrinters.id, id))).returning();
    return printerDto(row);
  });
}

export async function listInkMasterSpecs(organizationId: string) {
  const rows = await db.select().from(inkMasterSavedSpecs)
    .where(eq(inkMasterSavedSpecs.organizationId, organizationId))
    .orderBy(asc(inkMasterSavedSpecs.name));
  return rows.map(specDto);
}

async function requireActivePrinter(organizationId: string, printerId: string) {
  const [printer] = await db.select({ id: inkMasterPrinters.id }).from(inkMasterPrinters)
    .where(and(
      eq(inkMasterPrinters.organizationId, organizationId),
      eq(inkMasterPrinters.id, printerId),
      eq(inkMasterPrinters.isActive, true),
    )).limit(1);
  if (!printer) throw new InkMasterError("Select an active printer in this organization", 409);
}

export async function createInkMasterSpec(organizationId: string, input: InkMasterSpecInput) {
  await requireActivePrinter(organizationId, input.printerId);
  const [row] = await db.insert(inkMasterSavedSpecs).values({ organizationId, ...input }).returning();
  return specDto(row);
}

export async function updateInkMasterSpec(organizationId: string, id: string, patch: Partial<InkMasterSpecInput>) {
  if (patch.printerId) await requireActivePrinter(organizationId, patch.printerId);
  const [row] = await db.update(inkMasterSavedSpecs).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(inkMasterSavedSpecs.organizationId, organizationId), eq(inkMasterSavedSpecs.id, id))).returning();
  if (!row) throw new InkMasterError("Saved spec not found", 404);
  return specDto(row);
}

export async function deleteInkMasterSpec(organizationId: string, id: string) {
  const [row] = await db.delete(inkMasterSavedSpecs)
    .where(and(eq(inkMasterSavedSpecs.organizationId, organizationId), eq(inkMasterSavedSpecs.id, id)))
    .returning({ id: inkMasterSavedSpecs.id });
  if (!row) throw new InkMasterError("Saved spec not found", 404);
  return { deleted: true };
}
