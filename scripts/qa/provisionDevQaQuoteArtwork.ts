import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Pool } from "pg";
import { assertDevQaQuoteArtworkProvisioningEnvironment } from "../../server/lib/devQaQuoteArtworkProvisioningGuard.js";
import { ArtworkApplicationService } from "../../v2/src/modules/artwork/artworkApplication.js";
import { QuoteArtworkApplicationService } from "../../v2/src/modules/artwork/quoteArtworkApplication.js";
import type { OperationContext } from "../../v2/src/application/operation.js";
import type { Capability } from "../../v2/src/authorization/capabilities.js";
import { brandedId } from "../../v2/src/modules/shared/commercialValues.js";
import { PostgresArtworkTransactionRunner } from "../../v2/infrastructure/artwork/postgresArtworkTransaction.js";
import { PostgresQuoteArtworkTransactionRunner } from "../../v2/infrastructure/artwork/postgresQuoteArtworkTransaction.js";
import { ArtworkUploadService } from "../../v2/infrastructure/artwork/artworkUploadService.js";
import { QuoteArtworkUploadService } from "../../v2/infrastructure/artwork/quoteArtworkUploadService.js";
import { SupabaseArtworkBinaryStorage } from "../../v2/infrastructure/artwork/artworkBinaryStorage.js";

const INTENT = "PROVISION_DEV_QA_QUOTE_ARTWORK";
const QA_PO = "QA - Artwork Lineage Fixture";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Mode = "discover" | "quote-initial" | "quote-front-replacement" | "order-front-replacement";
type Args = Readonly<{ mode: Mode; organizationId: string; quoteId: string; lineAId?: string; lineBId?: string; orderId?: string; orderLineId?: string }>;
type QuoteRow = Readonly<{ id: string; organization_id: string; display_number: string; purchase_order_number: string | null; customer_display_name: string | null; revision: string; delivery_state: string; acceptance_state: string; lifecycle_state: string }>;
type LineRow = Readonly<{ id: string; description: string; position: number }>;

const fixtureNames = {
  lineAFront: "QA_ART_LINE_A_FRONT.pdf",
  lineABack: "QA_ART_LINE_A_BACK.pdf",
  lineBFront: "QA_ART_LINE_B_FRONT.pdf",
  lineAFrontReplacement: "QA_ART_LINE_A_FRONT_REPLACEMENT.pdf",
  orderLineAReplacement: "QA_ART_ORDER_LINE_A_REPLACEMENT.pdf",
} as const;

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
};
const requireUuid = (name: string, value: string | undefined): string => {
  if (!value || !uuid.test(value)) throw new Error(`${name} must be an explicit UUID.`);
  return value;
};
const parse = (): Args => {
  if (arg("qa-opt-in") !== INTENT) throw new Error("Explicit DEV QA fixture opt-in is required.");
  const mode = arg("mode") ?? "discover";
  if (!(["discover", "quote-initial", "quote-front-replacement", "order-front-replacement"] as const).includes(mode as Mode)) throw new Error("mode is invalid.");
  return {
    mode: mode as Mode,
    organizationId: requireUuid("organization-id", arg("organization-id")),
    quoteId: requireUuid("quote-id", arg("quote-id")),
    ...(mode !== "discover" ? { lineAId: requireUuid("line-a-id", arg("line-a-id")) } : {}),
    ...(mode === "quote-initial" ? { lineBId: requireUuid("line-b-id", arg("line-b-id")) } : {}),
    ...(mode === "order-front-replacement" ? { orderId: requireUuid("order-id", arg("order-id")), orderLineId: requireUuid("order-line-id", arg("order-line-id")) } : {}),
  };
};
const safe = (value: unknown) => console.log(JSON.stringify(value));
const context = (organizationId: string, requestId: string): OperationContext => ({
  organizationId,
  operationId: `dev-qa-quote-artwork:${requestId}`,
  businessRequest: { id: requestId, payloadFingerprint: "derived-by-canonical-artwork-operation" },
  principal: { kind: "service", organizationId, clientId: "dev-qa-quote-artwork-provisioner", capabilities: ["quote.view", "quote.edit", "artwork.view", "artwork.adopt", "artwork.assign"] satisfies readonly Capability[] },
});
const pdf = async (label: string): Promise<Buffer> => {
  const document = await PDFDocument.create();
  const page = document.addPage([360, 180]);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText("QA ONLY", { x: 28, y: 120, size: 38, font, color: rgb(0.75, 0, 0) });
  page.drawText(label, { x: 28, y: 70, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("PrintersHero DEV fixture — disposable", { x: 28, y: 38, size: 10, font: await document.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await document.save());
};
const safeAssignment = (value: { assignment: { id: string; quoteLineId?: string; orderLineId?: string; artworkFileId: string; side?: string }; artworkFile: { id: string; displayFilename: string } }) => ({ assignmentId: value.assignment.id, artworkFileId: value.artworkFile.id, quoteLineId: value.assignment.quoteLineId, orderLineId: value.assignment.orderLineId, side: value.assignment.side ?? null, filename: value.artworkFile.displayFilename });

async function main(): Promise<void> {
  const args = parse();
  assertDevQaQuoteArtworkProvisioningEnvironment();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, application_name: "dev-qa-quote-artwork-provisioner" });
  try {
    const quote = (await pool.query<QuoteRow>(`SELECT d.id,d.organization_id,d.display_number,d.purchase_order_number,COALESCE(c.display_name,c.company_name) AS customer_display_name,d.revision::text,q.delivery_state,q.acceptance_state,q.lifecycle_state
      FROM v2_sales_documents d JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
      JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
      WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='quote'`, [args.organizationId, args.quoteId])).rows[0];
    if (!quote || quote.organization_id !== args.organizationId || quote.purchase_order_number !== QA_PO || !quote.customer_display_name?.startsWith("DEV QA -")) throw new Error("Target Quote is not the explicitly labelled DEV QA fixture.");
    const lines = (await pool.query<LineRow>("SELECT id,description,position FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position,id", [args.organizationId, args.quoteId])).rows;
    safe({ ok: true, quote: { id: quote.id, number: quote.display_number, revision: quote.revision }, candidateLines: lines.map((line) => ({ id: line.id, description: line.description, position: line.position })) });
    if (args.mode === "discover") return;
    const lineIds = new Set(lines.map((line) => line.id));
    if (!lineIds.has(args.lineAId!)) throw new Error("line-a-id does not belong to the supplied QA Quote.");
    if (args.lineBId && (!lineIds.has(args.lineBId) || args.lineBId === args.lineAId)) throw new Error("line-b-id must be a distinct line on the supplied QA Quote.");
    if (args.mode !== "order-front-replacement" && (quote.delivery_state !== "not_sent" || quote.acceptance_state !== "not_accepted" || quote.lifecycle_state !== "open")) throw new Error("Quote artwork fixture changes are allowed only before the Quote lifecycle advances.");

    const quoteService = new QuoteArtworkApplicationService(new PostgresQuoteArtworkTransactionRunner(pool));
    const orderService = new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
    const storage = new SupabaseArtworkBinaryStorage();
    const quoteUpload = new QuoteArtworkUploadService(quoteService, storage);
    const orderUpload = new ArtworkUploadService(orderService, storage);
    let revision = quote.revision;
    const ensureQuote = async (lineId: string, side: "front" | "back", filename: string, label: string, permitExisting: readonly string[]): Promise<unknown> => {
      const existing = await quoteService.list(context(args.organizationId, `read-${randomUUID()}`), brandedId<"QuoteId">(args.quoteId));
      if (!existing.ok) throw new Error("Canonical Quote artwork read was denied.");
      const slot = existing.value.filter((item) => item.assignment.quoteLineId === lineId && item.assignment.purpose === "customer_supplied" && item.assignment.side === side);
      const matching = slot.find((item) => item.file.displayFilename === filename);
      if (matching) return safeAssignment({ assignment: matching.assignment, artworkFile: matching.file });
      if (slot.some((item) => !permitExisting.includes(item.file.displayFilename))) throw new Error(`Quote artwork slot ${side} contains an unexpected non-QA file; refusing to replace it.`);
      if (slot.length > 0 && !slot.every((item) => permitExisting.includes(item.file.displayFilename))) throw new Error("Quote artwork slot cannot be safely replaced.");
      const requestId = `dev-qa-quote-artwork:${args.quoteId}:${lineId}:${filename}`;
      const uploaded = await quoteUpload.upload(context(args.organizationId, requestId), { businessRequestId: requestId, expectedRevision: revision, quoteId: args.quoteId, quoteLineId: lineId, purpose: "customer_supplied", side, filename, contentType: "application/pdf", bytes: await pdf(label) });
      if (!uploaded.ok) throw new Error(`Canonical Quote artwork adoption failed: ${uploaded.error.code}.`);
      revision = uploaded.value.quoteRevision;
      return safeAssignment(uploaded.value);
    };

    if (args.mode === "quote-initial") {
      // Every canonical Quote-art mutation advances the header revision, so
      // fixture slots deliberately run serially with the revision returned by
      // the prior canonical operation. A concurrent batch would be stale.
      const assignments = [
        await ensureQuote(args.lineAId!, "front", fixtureNames.lineAFront, "LINE A — FRONT", []),
        await ensureQuote(args.lineAId!, "back", fixtureNames.lineABack, "LINE A — BACK", []),
        await ensureQuote(args.lineBId!, "front", fixtureNames.lineBFront, "LINE B — FRONT", []),
      ];
      safe({ ok: true, mode: args.mode, quoteId: args.quoteId, lineAId: args.lineAId, lineBId: args.lineBId, assignments });
      return;
    }
    if (args.mode === "quote-front-replacement") {
      const assignment = await ensureQuote(args.lineAId!, "front", fixtureNames.lineAFrontReplacement, "LINE A — FRONT REPLACEMENT", [fixtureNames.lineAFront, fixtureNames.lineAFrontReplacement]);
      safe({ ok: true, mode: args.mode, quoteId: args.quoteId, lineAId: args.lineAId, assignment });
      return;
    }

    const order = (await pool.query<{ id: string; purchase_order_number: string | null }>(`SELECT d.id,d.purchase_order_number FROM v2_sales_quote_conversions c JOIN v2_sales_documents d ON d.organization_id=c.organization_id AND d.id=c.order_document_id
      WHERE c.organization_id=$1 AND c.quote_document_id=$2 AND c.order_document_id=$3`, [args.organizationId, args.quoteId, args.orderId])).rows[0];
    const orderLine = (await pool.query<{ id: string }>("SELECT id FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id=$3", [args.organizationId, args.orderId, args.orderLineId])).rows[0];
    if (!order || order.purchase_order_number !== QA_PO || !orderLine) throw new Error("Target Order/line is not the converted DEV QA fixture.");
    const requestId = `dev-qa-order-artwork:${args.orderId}:${args.orderLineId}:${fixtureNames.orderLineAReplacement}`;
    const upload = await orderUpload.upload(context(args.organizationId, requestId), { businessRequestId: requestId, orderId: args.orderId!, orderLineId: args.orderLineId!, purpose: "customer_supplied", side: "front", filename: fixtureNames.orderLineAReplacement, contentType: "application/pdf", bytes: await pdf("ORDER LINE A — REPLACEMENT") });
    if (!upload.ok) throw new Error(`Canonical Order artwork adoption failed: ${upload.error.code}.`);
    safe({ ok: true, mode: args.mode, quoteId: args.quoteId, orderId: args.orderId, orderLineId: args.orderLineId, assignment: safeAssignment(upload.value) });
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  safe({ ok: false, error: error instanceof Error ? error.message : "DEV QA Quote Artwork provisioning failed." });
  process.exitCode = 1;
});
