import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresArtworkProofingPrepressApplication } from "../../src/postgres/postgresArtworkProofingPrepress";
import { V2PocError } from "../../src/shared/errors";

const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 10,
});
const suffix = randomUUID().replaceAll("-", "");
const orgA = `v2poc-app-org-a-${suffix}`,
  orgB = `v2poc-app-org-b-${suffix}`,
  ownerA = `v2poc-app-owner-a-${suffix}`,
  ownerB = `v2poc-app-owner-b-${suffix}`;
let sequence = 0;
const app = () => new PostgresArtworkProofingPrepressApplication(pool);
type Fixture = { orderId: string; lineId: string };
async function fixture(
  org = orgA,
  owner = ownerA,
  quantity = 10,
): Promise<Fixture> {
  const n = ++sequence,
    customer = `v2poc-app-customer-${suffix}-${n}`,
    product = `v2poc-app-product-${suffix}-${n}`,
    orderId = `v2poc-app-order-${suffix}-${n}`,
    lineId = `v2poc-app-line-${suffix}-${n}`;
  await pool.query(
    `insert into customers(id,organization_id,company_name,is_active)values($1,$2,$3,true)`,
    [customer, org, `V2 POC Artwork ${n}`],
  );
  await pool.query(
    `insert into products(id,organization_id,name,description,is_active,is_taxable,measurement_mode,pricing_mode,pricing_profile_key)values($1,$2,$3,'test',true,false,'quantity_only','quantity','qty_only')`,
    [product, org, `V2 POC Artwork Product ${n}`],
  );
  await pool.query(
    `insert into orders(id,organization_id,order_number,display_number,number_core,customer_id,status,state,priority,fulfillment_status,subtotal,tax,tax_rate,tax_amount,taxable_subtotal,total,discount,created_by_user_id)values($1,$2,$3,$4,$5,$6,'new','open','normal','pending','10.00','0.00','0.0000','0.00','10.00','10.00','0.00',$7)`,
    [orderId, org, `7${n}`, `V2APP-${n}`, 70000 + n, customer, owner],
  );
  await pool.query(
    `insert into order_line_items(id,order_id,product_id,product_type,description,quantity,unit_price,total_price,status,option_selections_json,selected_options,priced_at,tax_amount,is_taxable_snapshot,sort_order)values($1,$2,$3,'wide_roll','V2 artwork fixture',$4,'1.00','10.00','new','{}'::jsonb,'[]'::jsonb,now(),'0.00',false,0)`,
    [lineId, orderId, product, quantity],
  );
  return { orderId, lineId };
}
const attach = (
  row: Fixture,
  requestId: string,
  filename: string,
  quantity: number,
  group: string,
  side: "front" | "back" = "front",
) =>
  app().attachArtwork(ownerA, {
    organizationId: orgA,
    orderId: row.orderId,
    lineItemId: row.lineId,
    requestId,
    filename,
    mimeType: "application/pdf",
    sizeBytes: 42,
    allocationQuantity: quantity,
    allocationGroupId: group,
    side,
  });

beforeAll(async () => {
  await app().installExperimentalSchema();
  await pool.query(
    `insert into organizations(id,name,slug,default_tax_rate,tax_enabled)values($1,'V2 Artwork A',$2,'0.0000',false),($3,'V2 Artwork B',$4,'0.0000',false)`,
    [
      orgA,
      `v2app-a-${suffix}`.slice(0, 96),
      orgB,
      `v2app-b-${suffix}`.slice(0, 96),
    ],
  );
  await pool.query(
    `insert into users(id,email,role)values($1,$2,'employee'),($3,$4,'employee')`,
    [
      ownerA,
      `v2app-a-${suffix}@example.test`,
      ownerB,
      `v2app-b-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `insert into user_organizations(user_id,organization_id,role,is_default)values($1,$2,'owner',true),($3,$4,'owner',true)`,
    [ownerA, orgA, ownerB, orgB],
  );
});
afterAll(async () => {
  try {
    for (const query of [
      `delete from v2_poc_artwork_requests where organization_id in ($1,$2)`,
      `delete from v2_poc_proof_deliveries where organization_id in ($1,$2)`,
      `delete from v2_poc_prepress_handoffs where organization_id in ($1,$2)`,
      `delete from v2_poc_artwork_retirements where organization_id in ($1,$2)`,
      `delete from v2_poc_line_artwork_state where organization_id in ($1,$2)`,
      `delete from proof_access_tokens where organization_id in ($1,$2)`,
      `delete from line_item_proof_approvals where organization_id in ($1,$2)`,
      `delete from proof_version_line_items where organization_id in ($1,$2)`,
      `delete from line_item_proof_versions where organization_id in ($1,$2)`,
      `delete from line_item_files where organization_id in ($1,$2)`,
      `delete from production_jobs where organization_id in ($1,$2)`,
      `delete from prepress_sessions where organization_id in ($1,$2)`,
      `delete from order_attachments where order_id in (select id from orders where organization_id in ($1,$2))`,
      `delete from line_item_artwork where organization_id in ($1,$2)`,
      `delete from file_records where organization_id in ($1,$2)`,
      `delete from order_line_items where order_id in (select id from orders where organization_id in ($1,$2))`,
      `delete from orders where organization_id in ($1,$2)`,
      `delete from products where organization_id in ($1,$2)`,
      `delete from customers where organization_id in ($1,$2)`,
      `delete from user_organizations where organization_id in ($1,$2)`,
      `delete from organizations where id in ($1,$2)`,
      `delete from users where id in ($1,$2)`,
    ])
      await pool.query(query, [orgA, orgB]);
  } finally {
    await pool.end();
  }
});

describe("V2 canonical artwork → proofing → prepress → production handoff", () => {
  test("keeps one canonical artwork lifecycle, reuses existing file identity, proves allocations, delivers/retries proof, and atomically hands off", async () => {
    const row = await fixture();
    const a = await attach(row, `attach-a-${suffix}`, "a.pdf", 4, "design-a");
    const b = await attach(row, `attach-b-${suffix}`, "b.pdf", 6, "design-b");
    expect(
      (await app().readLine(ownerA, orgA, row.orderId, row.lineId))
        .customerArtworkReady,
    ).toBe(true);
    const promotedA = await app().useForProduction(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `promote-a-${suffix}`,
      artworkId: a.artworkId,
      expectedRevision: b.revision,
    });
    expect(promotedA.fileRecordId).toBe(a.fileRecordId);
    const promotedB = await app().useForProduction(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `promote-b-${suffix}`,
      artworkId: b.artworkId,
      expectedRevision: promotedA.revision,
    });
    const proof = await app().createProof(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `proof-${suffix}`,
    });
    const sent = await app().sendProof(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `send-${suffix}`,
      proofVersionId: proof.proofVersionId,
      recipientEmail: "customer@example.test",
    });
    expect((await pool.query(`select result_json::text as result from v2_poc_artwork_requests where organization_id=$1 and request_id=$2`, [orgA, `send-${suffix}`])).rows[0].result).not.toContain(sent.responseToken);
    await expect(
      app().reconcileProofDelivery(
        ownerA,
        orgA,
        proof.proofVersionId,
        "during_delivery",
      ),
    ).rejects.toMatchObject({
      code: "INJECTED_FAILURE",
    } satisfies Partial<V2PocError>);
    expect(
      (
        await pool.query(
          `select status,attempts from v2_poc_proof_deliveries where proof_version_id=$1`,
          [proof.proofVersionId],
        )
      ).rows[0],
    ).toMatchObject({ status: "PENDING", attempts: 0 });
    await expect(
      app().startPrepress(ownerA, {
        organizationId: orgA,
        orderId: row.orderId,
        lineItemId: row.lineId,
        requestId: "start-before-approval",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    } satisfies Partial<V2PocError>);
    await new PostgresArtworkProofingPrepressApplication(
      pool,
    ).reconcileProofDelivery(ownerA, orgA, proof.proofVersionId);
    await app().recordProofResponse(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `approve-${suffix}`,
      token: sent.responseToken,
      decision: "approved",
    });
    await app().startPrepress(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `start-${suffix}`,
    });
    await expect(
      app().finalizePrepress(
        ownerA,
        {
          organizationId: orgA,
          orderId: row.orderId,
          lineItemId: row.lineId,
          requestId: `final-fail-${suffix}`,
        },
        "after_final_art_write",
      ),
    ).rejects.toMatchObject({
      code: "INJECTED_FAILURE",
    } satisfies Partial<V2PocError>);
    expect(
      (
        await pool.query(
          `select count(*)::int as count from v2_poc_prepress_handoffs where organization_id=$1 and line_item_id=$2`,
          [orgA, row.lineId],
        )
      ).rows[0].count,
    ).toBe(0);
    const final = await app().finalizePrepress(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `final-${suffix}`,
    });
    const fresh = await new PostgresArtworkProofingPrepressApplication(
      pool,
    ).readLine(ownerA, orgA, row.orderId, row.lineId);
    expect(fresh.handoff).toMatchObject({
      id: final.handoffId,
      status: "READY",
      production_job_id: final.productionJobId,
    });
    const productionInput = await app().resolveProductionHandoff(ownerA, orgA, row.orderId, row.lineId);
    expect(productionInput.assignments).toHaveLength(2);
    expect(productionInput.assignments.map((assignment: any) => assignment.quantity).sort()).toEqual([4, 6]);
    expect(fresh.proofs).toMatchObject([
      { id: proof.proofVersionId, status: "approved" },
    ]);
    expect(fresh.artwork.map((x: any) => x.file_record_id)).toContain(
      a.fileRecordId,
    );
    expect(promotedB.artworkId).toBeTruthy();
    const returned = await app().returnToPrepress(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `return-${suffix}`,
    });
    expect(returned.returnedHandoffId).toBe(final.handoffId);
    expect((await pool.query(`select status from production_jobs where id=$1`, [final.productionJobId])).rows[0].status).toBe("cancelled");
    expect(
      (await app().readLine(ownerA, orgA, row.orderId, row.lineId)).handoff,
    ).toBeNull();
  }, 30_000);
  test("models modified production art as a distinct file with source history and rejects stale concurrent promotion", async () => {
    const row = await fixture();
    const source = await attach(
      row,
      `modified-attach-${suffix}`,
      "source.pdf",
      10,
      "one",
    );
    const [one, two] = await Promise.allSettled([
      app().useForProduction(ownerA, {
        organizationId: orgA,
        orderId: row.orderId,
        lineItemId: row.lineId,
        requestId: `race-one-${suffix}`,
        artworkId: source.artworkId,
        expectedRevision: source.revision,
      }),
      app().useForProduction(ownerA, {
        organizationId: orgA,
        orderId: row.orderId,
        lineItemId: row.lineId,
        requestId: `race-two-${suffix}`,
        artworkId: source.artworkId,
        expectedRevision: source.revision,
      }),
    ]);
    expect([one, two].filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect([one, two].filter((x) => x.status === "rejected")).toHaveLength(1);
    const promoted = (
      one.status === "fulfilled" ? one.value : two.value
    ) as any;
    const modified = await app().createModifiedProductionArtwork(ownerA, {
      organizationId: orgA,
      orderId: row.orderId,
      lineItemId: row.lineId,
      requestId: `modified-${suffix}`,
      artworkId: promoted.artworkId,
      expectedRevision: promoted.revision,
      filename: "modified.pdf",
      mimeType: "application/pdf",
      sizeBytes: 99,
    });
    expect(modified).toMatchObject({ parentArtworkId: promoted.artworkId });
    expect(modified.fileRecordId).not.toBe(source.fileRecordId);
  });
  test("rejects ambiguous allocation and prevents retired artwork from resolving", async () => {
    const row = await fixture();
    const a = await attach(row, `under-a-${suffix}`, "a.pdf", 4, "a");
    await attach(row, `under-b-${suffix}`, "b.pdf", 5, "b");
    await expect(
      app().createProof(ownerA, {
        organizationId: orgA,
        orderId: row.orderId,
        lineItemId: row.lineId,
        requestId: `under-proof-${suffix}`,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    } satisfies Partial<V2PocError>);
    await expect(attach(row, `over-${suffix}`, "over.pdf", 2, "c")).rejects.toMatchObject({ code: "VALIDATION" } satisfies Partial<V2PocError>);
    const single = await fixture();
    const only = await attach(
      single,
      `retire-a-${suffix}`,
      "only.pdf",
      10,
      "only",
    );
    const promoted = await app().useForProduction(ownerA, {
      organizationId: orgA,
      orderId: single.orderId,
      lineItemId: single.lineId,
      requestId: `retire-promote-${suffix}`,
      artworkId: only.artworkId,
      expectedRevision: only.revision,
    });
    await app().retireArtwork(ownerA, {
      organizationId: orgA,
      orderId: single.orderId,
      lineItemId: single.lineId,
      requestId: `retire-${suffix}`,
      artworkId: only.artworkId,
      expectedRevision: promoted.revision,
      reason: "customer replaced artwork",
    });
    const reloaded = await new PostgresArtworkProofingPrepressApplication(
      pool,
    ).readLine(ownerA, orgA, single.orderId, single.lineId);
    expect(reloaded.artwork).toHaveLength(0);
    expect(reloaded.customerArtworkReady).toBe(false);
  });
  test("enforces tenant scope and can read a suitable V1 canonical record without mutation", async () => {
    const foreign = await fixture(orgB, ownerB, 1);
    await expect(
      app().attachArtwork(ownerA, {
        organizationId: orgA,
        orderId: foreign.orderId,
        lineItemId: foreign.lineId,
        requestId: `foreign-${suffix}`,
        filename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        allocationQuantity: 1,
        allocationGroupId: "x",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<V2PocError>);
    const candidate = await pool.query(
      `select la.organization_id,la.order_id,la.line_item_id,uo.user_id from line_item_artwork la join user_organizations uo on uo.organization_id=la.organization_id and uo.role in('owner','admin','manager') where la.organization_id not in($1,$2) order by la.created_at desc limit 1`,
      [orgA, orgB],
    );
    if (candidate.rowCount) {
      const r = candidate.rows[0];
      const read = await app().readLine(
        r.user_id,
        r.organization_id,
        r.order_id,
        r.line_item_id,
      );
      expect(read.artwork.length).toBeGreaterThan(0);
    }
  });
  test("supersedes stale proof versions and atomically withdraws ready production when artwork retires", async () => {
    const row = await fixture();
    const customer = await attach(row, `stale-attach-${suffix}`, "stale.pdf", 10, "one");
    const production = await app().useForProduction(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-promote-${suffix}`, artworkId: customer.artworkId, expectedRevision: customer.revision });
    const first = await app().createProof(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-proof-one-${suffix}` });
    const sent = await app().sendProof(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-send-one-${suffix}`, proofVersionId: first.proofVersionId, recipientEmail: "customer@example.test" });
    const second = await app().createProof(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-proof-two-${suffix}` });
    expect((await pool.query(`select status from line_item_proof_versions where id=$1`, [first.proofVersionId])).rows[0].status).toBe("superseded");
    await expect(app().recordProofResponse(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-response-${suffix}`, token: sent.responseToken, decision: "approved" })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
    const sentSecond = await app().sendProof(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-send-two-${suffix}`, proofVersionId: second.proofVersionId, recipientEmail: "customer@example.test" });
    await app().recordProofResponse(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-response-two-${suffix}`, token: sentSecond.responseToken, decision: "approved" });
    await app().startPrepress(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-start-${suffix}` });
    const handoff = await app().finalizePrepress(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-final-${suffix}` });
    await app().retireArtwork(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, requestId: `stale-retire-${suffix}`, artworkId: customer.artworkId, expectedRevision: production.revision, reason: "withdraw source" });
    await expect(app().resolveProductionHandoff(ownerA, orgA, row.orderId, row.lineId)).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
    expect((await pool.query(`select status from production_jobs where id=$1`, [handoff.productionJobId])).rows[0].status).toBe("cancelled");
  }, 30_000);
});
