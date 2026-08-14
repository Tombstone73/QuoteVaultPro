import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AuthorityPolicy, principalSubject, staffActor, type Principal } from "../authorization/authorityPolicy";
import { PostgresPrincipalContext } from "../authorization/postgresPrincipalContext";
import { V2PocError } from "../shared/errors";

type Operation =
  | "attach_artwork.v2_poc"
  | "promote_artwork.v2_poc"
  | "modified_artwork.v2_poc"
  | "retire_artwork.v2_poc"
  | "create_proof.v2_poc"
  | "send_proof.v2_poc"
  | "proof_response.v2_poc"
  | "finalize_prepress.v2_poc";
export type ArtworkFailurePoint =
  | "after_canonical_write"
  | "after_projection_write"
  | "after_proof_delivery_write"
  | "after_final_art_write"
  | "before_handoff"
  | "before_commit"
  | "during_delivery";
export type ArtworkCommand = {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  requestId: string;
};
export type AttachArtworkCommand = ArtworkCommand & {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  allocationQuantity: number;
  allocationGroupId: string;
  side?: "front" | "back" | "both" | "unknown";
};
export type PromoteArtworkCommand = ArtworkCommand & {
  artworkId: string;
  expectedRevision: number;
};
export type ModifiedArtworkCommand = PromoteArtworkCommand & {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};
export type RetireArtworkCommand = ArtworkCommand & {
  artworkId: string;
  expectedRevision: number;
  reason: string;
};
export type CreateProofCommand = ArtworkCommand & { message?: string };
export type SendProofCommand = ArtworkCommand & {
  proofVersionId: string;
  recipientEmail: string;
};
export type ProofResponseCommand = ArtworkCommand & {
  token: string;
  decision: "approved" | "rejected" | "revision_requested";
  notes?: string;
};

const ddl = `CREATE TABLE IF NOT EXISTS v2_poc_artwork_requests (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,operation varchar(80) NOT NULL,request_id varchar(160) NOT NULL,request_hash varchar(64) NOT NULL,result_json jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(organization_id,actor_user_id,operation,request_id));
CREATE TABLE IF NOT EXISTS v2_poc_line_artwork_state (organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,revision integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,line_item_id));
CREATE TABLE IF NOT EXISTS v2_poc_artwork_retirements (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT,actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,artwork_id));
CREATE TABLE IF NOT EXISTS v2_poc_proof_deliveries (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,status varchar(16) NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,last_error text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(organization_id,proof_version_id));
CREATE TABLE IF NOT EXISTS v2_poc_proof_artwork_assignments (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT,file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,allocation_group_id varchar(128) NOT NULL,allocation_quantity integer NOT NULL,side line_item_artwork_side NOT NULL,UNIQUE(proof_version_id,artwork_id));
CREATE TABLE IF NOT EXISTS v2_poc_prepress_handoffs (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT,file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,production_job_id varchar NOT NULL REFERENCES production_jobs(id) ON DELETE RESTRICT,status varchar(16) NOT NULL DEFAULT 'READY',snapshot_json jsonb NOT NULL,assignments_json jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),returned_at timestamptz,returned_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,UNIQUE(organization_id,line_item_id,status));
CREATE TABLE IF NOT EXISTS v2_poc_operation_attributions (id varchar(96) PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,operation varchar(64) NOT NULL,resource_type varchar(32) NOT NULL,resource_id varchar NOT NULL,principal_kind varchar(16) NOT NULL,principal_id varchar(160) NOT NULL,staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,operation,resource_type,resource_id));
ALTER TABLE v2_poc_prepress_handoffs ADD COLUMN IF NOT EXISTS assignments_json jsonb NOT NULL DEFAULT '[]'::jsonb;`;
const required = <T>(v: T | undefined | null, m: string): T => {
  if (v == null) throw new V2PocError("NOT_FOUND", m);
  return v;
};
const fail = (v: ArtworkFailurePoint | undefined, p: ArtworkFailurePoint) => {
  if (v === p)
    throw new V2PocError(
      "INJECTED_FAILURE",
      `Injected PostgreSQL failure at ${p}.`,
    );
};
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as Record<string, unknown>)
          .sort()
          .map(
            (k) =>
              `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
          )
          .join(",")}}`
      : JSON.stringify(v);
const digest = (op: Operation, v: unknown) =>
  createHash("sha256").update(canonical({ op, v })).digest("hex");
const tokenHash = (v: string) => createHash("sha256").update(v).digest("hex");

class Auth {
  async check(c: PoolClient, a: string, o: string) {
    const r = await c.query(
      `select uo.role from user_organizations uo join organizations x on x.id=uo.organization_id where uo.user_id=$1 and uo.organization_id=$2 and x.delete_state='active' and x.is_archived=false`,
      [a, o],
    );
    if (!["owner", "admin", "manager"].includes(r.rows[0]?.role))
      throw new V2PocError(
        "FORBIDDEN",
        "Actor lacks the organization-scoped artwork capability.",
      );
  }
}
class Requests {
  async claim(
    c: PoolClient,
    a: string,
    op: Operation,
    x: ArtworkCommand,
    h: string,
  ) {
    if (!x.requestId.trim())
      throw new V2PocError("VALIDATION", "A request ID is required.");
    const r = await c.query(
      `insert into v2_poc_artwork_requests(id,organization_id,actor_user_id,operation,request_id,request_hash)values($1,$2,$3,$4,$5,$6)on conflict(organization_id,actor_user_id,operation,request_id)do nothing returning id`,
      [
        `v2poc-art-request-${randomUUID()}`,
        x.organizationId,
        a,
        op,
        x.requestId,
        h,
      ],
    );
    if (r.rowCount) return null;
    const e = required(
      (
        await c.query(
          `select request_hash,result_json from v2_poc_artwork_requests where organization_id=$1 and actor_user_id=$2 and operation=$3 and request_id=$4`,
          [x.organizationId, a, op, x.requestId],
        )
      ).rows[0],
      "Idempotency request disappeared.",
    ) as any;
    if (e.request_hash !== h)
      throw new V2PocError(
        "IDEMPOTENCY_CONFLICT",
        "Request ID was already used with different content.",
      );
    return required(e.result_json, "Idempotency request is incomplete.");
  }
  async done(
    c: PoolClient,
    a: string,
    op: Operation,
    x: ArtworkCommand,
    h: string,
    r: unknown,
  ) {
    await c.query(
      `update v2_poc_artwork_requests set result_json=$1,completed_at=now() where organization_id=$2 and actor_user_id=$3 and operation=$4 and request_id=$5 and request_hash=$6`,
      [
        JSON.stringify(
          r && typeof r === "object"
            ? Object.fromEntries(
                Object.entries(r as Record<string, unknown>).filter(
                  ([key]) => key !== "responseToken",
                ),
              )
            : r,
        ),
        x.organizationId,
        a,
        op,
        x.requestId,
        h,
      ],
    );
  }
}
class Artwork {
  async lockLine(c: PoolClient, x: ArtworkCommand) {
    const r = await c.query(
      `select l.id,l.quantity::int as quantity from order_line_items l join orders o on o.id=l.order_id where l.id=$1 and l.order_id=$2 and o.organization_id=$3 for update`,
      [x.lineItemId, x.orderId, x.organizationId],
    );
    return required(
      r.rows[0] as { id: string; quantity: number } | undefined,
      "Order line not found in this organization.",
    );
  }
  async state(c: PoolClient, x: ArtworkCommand) {
    await c.query(
      `insert into v2_poc_line_artwork_state(organization_id,line_item_id)values($1,$2)on conflict do nothing`,
      [x.organizationId, x.lineItemId],
    );
    return (
      await c.query(
        `select revision from v2_poc_line_artwork_state where organization_id=$1 and line_item_id=$2 for update`,
        [x.organizationId, x.lineItemId],
      )
    ).rows[0] as { revision: number };
  }
  async bump(c: PoolClient, x: ArtworkCommand) {
    await c.query(
      `update v2_poc_line_artwork_state set revision=revision+1,updated_at=now()where organization_id=$1 and line_item_id=$2`,
      [x.organizationId, x.lineItemId],
    );
  }
  async get(c: PoolClient, x: ArtworkCommand, id: string) {
    const r = await c.query(
      `select id,file_record_id,role,status,side,allocation_quantity,allocation_group_id from line_item_artwork where id=$1 and organization_id=$2 and order_id=$3 and line_item_id=$4`,
      [id, x.organizationId, x.orderId, x.lineItemId],
    );
    return required(
      r.rows[0] as any,
      "Canonical artwork not found in this organization.",
    );
  }
  async allocations(
    c: PoolClient,
    x: ArtworkCommand,
    roles = "customer_source",
  ) {
    const r = await c.query(
      `select id,file_record_id,role,side,allocation_quantity,allocation_group_id from line_item_artwork where organization_id=$1 and order_id=$2 and line_item_id=$3 and status='current' and role=any($4::line_item_artwork_role[]) order by id`,
      [x.organizationId, x.orderId, x.lineItemId, roles.split(",")],
    );
    return r.rows as any[];
  }
  async ready(c: PoolClient, x: ArtworkCommand, roles = "customer_source") {
    const line = await this.lockLine(c, x),
      rows = await this.allocations(c, x, roles),
      groups = new Map<string, number>();
    for (const r of rows) {
      if (
        !r.allocation_group_id ||
        !Number.isInteger(r.allocation_quantity) ||
        r.allocation_quantity <= 0
      )
        return { ready: false, reason: "missing allocation", rows };
      const old = groups.get(r.allocation_group_id);
      if (old !== undefined && old !== Number(r.allocation_quantity))
        return { ready: false, reason: "inconsistent allocation group", rows };
      groups.set(r.allocation_group_id, Number(r.allocation_quantity));
    }
    return {
      ready:
        groups.size > 0 &&
        [...groups.values()].reduce((a, b) => a + b, 0) ===
          Number(line.quantity),
      reason: "",
      rows,
    };
  }
  async assertProposedAllocation(
    c: PoolClient,
    x: ArtworkCommand,
    quantity: number,
    group: string,
  ) {
    const line = await this.lockLine(c, x),
      rows = await this.allocations(c, x);
    const groups = new Map<string, number>();
    for (const row of rows)
      groups.set(row.allocation_group_id, Number(row.allocation_quantity));
    const existing = groups.get(group);
    if (existing !== undefined && existing !== quantity)
      throw new V2PocError(
        "VALIDATION",
        "Artwork members in one allocation group must share quantity.",
      );
    groups.set(group, quantity);
    if ([...groups.values()].reduce((a, b) => a + b, 0) > Number(line.quantity))
      throw new V2PocError(
        "VALIDATION",
        "Artwork allocation exceeds the ordered quantity.",
      );
  }
}
class Projections {
  async attachment(
    c: PoolClient,
    x: ArtworkCommand,
    a: {
      fileRecordId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      quantity: number;
      group: string;
      side: string;
      role?: string;
    },
  ) {
    const id = `v2poc-attachment-${randomUUID()}`;
    await c.query(
      `insert into order_attachments(id,order_id,order_line_item_id,file_record_id,file_name,original_filename,mime_type,file_size,size_bytes,role,side,is_primary,production_quantity,production_group_id)values($1,$2,$3,$4,$5,$5,$6,$7,$7,$8::file_role,$9::file_side,false,$10,$11)`,
      [
        id,
        x.orderId,
        x.lineItemId,
        a.fileRecordId,
        a.filename,
        a.mimeType,
        a.sizeBytes,
        a.role ?? "artwork",
        a.side === "unknown" ? "na" : a.side,
        a.quantity,
        a.group,
      ],
    );
    return id;
  }
  async final(
    c: PoolClient,
    x: ArtworkCommand,
    a: any,
    sessionId: string,
    actor: string,
  ) {
    const id = `v2poc-final-${randomUUID()}`;
    await c.query(
      `insert into line_item_files(id,organization_id,order_id,line_item_id,prepress_session_id,file_record_id,role,status,tag,production_quantity,production_group_id,production_artwork_source_type,storage_path,original_filename,mime_type,size_bytes,created_by_user_id)values($1,$2,$3,$4,$5,$6,'final','active',$7,$8,$9,'v2_poc_canonical_artwork',$10,$11,$12,$13,$14)`,
      [
        id,
        x.organizationId,
        x.orderId,
        x.lineItemId,
        sessionId,
        a.file_record_id,
        a.side,
        Number(a.allocation_quantity),
        a.allocation_group_id,
        `v2poc://${a.file_record_id}`,
        a.original_filename,
        a.mime_type,
        a.size_bytes,
        actor,
      ],
    );
    return id;
  }
}
export class PostgresArtworkProofingPrepressApplication {
  private auth = new Auth();
  private requests = new Requests();
  private artwork = new Artwork();
  private projections = new Projections();
  private readonly authority = new AuthorityPolicy();
  private readonly principalContext = new PostgresPrincipalContext();
  constructor(private pool: Pool) {}
  async installExperimentalSchema() {
    await this.pool.query(ddl);
  }
  private async mutation<T extends ArtworkCommand>(
    actor: string,
    op: Operation,
    x: T,
    work: (c: PoolClient) => Promise<any>,
    f?: ArtworkFailurePoint,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await this.auth.check(c, actor, x.organizationId);
      const h = digest(op, x),
        replay = await this.requests.claim(c, actor, op, x, h);
      if (replay) {
        await c.query("commit");
        return { ...(replay as object), idempotentReplay: true };
      }
      const r = await work(c);
      fail(f, "before_commit");
      await this.requests.done(c, actor, op, x, h, r);
      await c.query("commit");
      return { ...r, idempotentReplay: false };
    } catch (e) {
      try {
        await c.query("rollback");
      } catch {}
      throw e;
    } finally {
      c.release();
    }
  }
  async attachArtwork(
    actor: string,
    x: AttachArtworkCommand,
    f?: ArtworkFailurePoint,
  ) {
    return this.mutation(
      actor,
      "attach_artwork.v2_poc",
      x,
      async (c) => {
        if (
          !x.filename ||
          !x.allocationGroupId ||
          !Number.isInteger(x.allocationQuantity) ||
          x.allocationQuantity <= 0
        )
          throw new V2PocError(
            "VALIDATION",
            "Artwork identity and positive allocation are required.",
          );
        await this.artwork.lockLine(c, x);
        await this.artwork.state(c, x);
        await this.artwork.assertProposedAllocation(
          c,
          x,
          x.allocationQuantity,
          x.allocationGroupId,
        );
        const file = `v2poc-file-${randomUUID()}`,
          art = `v2poc-art-${randomUUID()}`;
        await c.query(
          `insert into file_records(id,organization_id,lifecycle_state,original_filename,mime_type,size_bytes,created_by_user_id)values($1,$2,'stored_hot',$3,$4,$5,$6)`,
          [file, x.organizationId, x.filename, x.mimeType, x.sizeBytes, actor],
        );
        await c.query(
          `insert into line_item_artwork(id,organization_id,order_id,line_item_id,file_record_id,role,status,side,allocation_quantity,allocation_group_id,origin,created_by_user_id)values($1,$2,$3,$4,$5,'customer_source','current',$6::line_item_artwork_side,$7,$8,'customer_upload',$9)`,
          [
            art,
            x.organizationId,
            x.orderId,
            x.lineItemId,
            file,
            x.side ?? "unknown",
            x.allocationQuantity,
            x.allocationGroupId,
            actor,
          ],
        );
        fail(f, "after_canonical_write");
        const attachmentId = await this.projections.attachment(c, x, {
          fileRecordId: file,
          filename: x.filename,
          mimeType: x.mimeType,
          sizeBytes: x.sizeBytes,
          quantity: x.allocationQuantity,
          group: x.allocationGroupId,
          side: x.side ?? "unknown",
        });
        fail(f, "after_projection_write");
        await this.artwork.bump(c, x);
        return {
          artworkId: art,
          fileRecordId: file,
          attachmentId,
          revision: (await this.artwork.state(c, x)).revision,
        };
      },
      f,
    );
  }
  async useForProduction(
    actor: string,
    x: PromoteArtworkCommand,
    f?: ArtworkFailurePoint,
  ) {
    return this.mutation(
      actor,
      "promote_artwork.v2_poc",
      x,
      async (c) => {
        await this.artwork.lockLine(c, x);
        const state = await this.artwork.state(c, x);
        if (state.revision !== x.expectedRevision)
          throw new V2PocError(
            "STALE_WRITE",
            "Artwork state changed; reload before promotion.",
          );
        const source = await this.artwork.get(c, x, x.artworkId);
        if (source.status !== "current" || source.role !== "customer_source")
          throw new V2PocError(
            "VALIDATION",
            "Only current customer artwork can be promoted.",
          );
        await c.query(
          `update line_item_artwork set status='superseded',superseded_at=now(),superseded_by_user_id=$1 where organization_id=$2 and line_item_id=$3 and role in ('production','modified_production') and status='current' and allocation_group_id=$4`,
          [actor, x.organizationId, x.lineItemId, source.allocation_group_id],
        );
        const id = `v2poc-art-${randomUUID()}`;
        await c.query(
          `insert into line_item_artwork(id,organization_id,order_id,line_item_id,file_record_id,role,status,side,allocation_quantity,allocation_group_id,origin,parent_artwork_id,created_by_user_id)values($1,$2,$3,$4,$5,'production','current',$6::line_item_artwork_side,$7,$8,'promoted_existing',$9,$10)`,
          [
            id,
            x.organizationId,
            x.orderId,
            x.lineItemId,
            source.file_record_id,
            source.side,
            source.allocation_quantity,
            source.allocation_group_id,
            source.id,
            actor,
          ],
        );
        fail(f, "after_canonical_write");
        await this.artwork.bump(c, x);
        return {
          artworkId: id,
          fileRecordId: source.file_record_id,
          revision: (await this.artwork.state(c, x)).revision,
        };
      },
      f,
    );
  }
  async createModifiedProductionArtwork(
    actor: string,
    x: ModifiedArtworkCommand,
    f?: ArtworkFailurePoint,
  ) {
    return this.mutation(
      actor,
      "modified_artwork.v2_poc",
      x,
      async (c) => {
        await this.artwork.lockLine(c, x);
        const state = await this.artwork.state(c, x);
        if (state.revision !== x.expectedRevision)
          throw new V2PocError(
            "STALE_WRITE",
            "Artwork state changed; reload before modification.",
          );
        const source = await this.artwork.get(c, x, x.artworkId);
        if (source.status !== "current")
          throw new V2PocError(
            "VALIDATION",
            "Only current artwork can be modified.",
          );
        await c.query(
          `update line_item_artwork set status='superseded',superseded_at=now(),superseded_by_user_id=$1 where organization_id=$2 and line_item_id=$3 and role in ('production','modified_production') and status='current' and allocation_group_id=$4`,
          [actor, x.organizationId, x.lineItemId, source.allocation_group_id],
        );
        const file = `v2poc-file-${randomUUID()}`,
          id = `v2poc-art-${randomUUID()}`;
        await c.query(
          `insert into file_records(id,organization_id,lifecycle_state,original_filename,mime_type,size_bytes,created_by_user_id)values($1,$2,'stored_hot',$3,$4,$5,$6)`,
          [file, x.organizationId, x.filename, x.mimeType, x.sizeBytes, actor],
        );
        await c.query(
          `insert into line_item_artwork(id,organization_id,order_id,line_item_id,file_record_id,role,status,side,allocation_quantity,allocation_group_id,origin,parent_artwork_id,supersedes_artwork_id,created_by_user_id)values($1,$2,$3,$4,$5,'modified_production','current',$6::line_item_artwork_side,$7,$8,'modified_copy',$9,$10,$11)`,
          [
            id,
            x.organizationId,
            x.orderId,
            x.lineItemId,
            file,
            source.side,
            source.allocation_quantity,
            source.allocation_group_id,
            source.id,
            source.id,
            actor,
          ],
        );
        fail(f, "after_canonical_write");
        await this.artwork.bump(c, x);
        return {
          artworkId: id,
          fileRecordId: file,
          parentArtworkId: source.id,
          revision: (await this.artwork.state(c, x)).revision,
        };
      },
      f,
    );
  }
  async retireArtwork(actor: string, x: RetireArtworkCommand) {
    return this.mutation(actor, "retire_artwork.v2_poc", x, async (c) => {
      await this.artwork.lockLine(c, x);
      const state = await this.artwork.state(c, x);
      if (state.revision !== x.expectedRevision)
        throw new V2PocError(
          "STALE_WRITE",
          "Artwork state changed; reload before retirement.",
        );
      const a = await this.artwork.get(c, x, x.artworkId);
      if (a.status !== "current" || !x.reason.trim())
        throw new V2PocError(
          "VALIDATION",
          "Current artwork and a retirement reason are required.",
        );
      await c.query(
        `with recursive descendants as (select id from line_item_artwork where id=$1 union all select child.id from line_item_artwork child join descendants d on child.parent_artwork_id=d.id) update line_item_artwork set status='superseded',superseded_at=now(),superseded_by_user_id=$2 where id in(select id from descendants) and status='current'`,
        [a.id, actor],
      );
      const affected = await c.query(
        `with recursive descendants as (select id,file_record_id from line_item_artwork where id=$1 union all select child.id,child.file_record_id from line_item_artwork child join descendants d on child.parent_artwork_id=d.id) select id,file_record_id from descendants`,
        [a.id],
      );
      const artworkIds = affected.rows.map((row) => row.id),
        fileIds = affected.rows.map((row) => row.file_record_id);
      await c.query(
        `update line_item_files set status='retired' where organization_id=$1 and line_item_id=$2 and file_record_id=any($3::varchar[]) and status='active'`,
        [x.organizationId, x.lineItemId, fileIds],
      );
      const withdrawn = await c.query(
        `update v2_poc_prepress_handoffs set status='RETURNED',returned_at=now(),returned_by_user_id=$1 where organization_id=$2 and line_item_id=$3 and status='READY' and artwork_id=any($4::varchar[]) returning production_job_id`,
        [actor, x.organizationId, x.lineItemId, artworkIds],
      );
      if (withdrawn.rowCount)
        await c.query(
          `update production_jobs set status='cancelled',updated_at=now() where id=any($1::varchar[])`,
          [withdrawn.rows.map((row) => row.production_job_id)],
        );
      await c.query(
        `insert into v2_poc_artwork_retirements(id,organization_id,line_item_id,artwork_id,actor_user_id,reason)values($1,$2,$3,$4,$5,$6)`,
        [
          `v2poc-retirement-${randomUUID()}`,
          x.organizationId,
          x.lineItemId,
          a.id,
          actor,
          x.reason,
        ],
      );
      await this.artwork.bump(c, x);
      return {
        artworkId: a.id,
        revision: (await this.artwork.state(c, x)).revision,
      };
    });
  }
  async createProof(
    actor: string,
    x: CreateProofCommand,
    f?: ArtworkFailurePoint,
  ) {
    return this.mutation(
      actor,
      "create_proof.v2_poc",
      x,
      async (c) => {
        await this.artwork.lockLine(c, x);
        const ready = await this.artwork.ready(c, x);
        if (!ready.ready)
          throw new V2PocError(
            "VALIDATION",
            `Artwork allocation is not ready: ${ready.reason}`,
          );
        await c.query(
          `update line_item_proof_versions set status='superseded',updated_at=now() where organization_id=$1 and line_item_id=$2 and status in ('draft','awaiting_response','rejected','revision_requested')`,
          [x.organizationId, x.lineItemId],
        );
        await c.query(
          `update proof_access_tokens set revoked_at=now() where organization_id=$1 and line_item_id=$2 and revoked_at is null`,
          [x.organizationId, x.lineItemId],
        );
        const source = ready.rows[0],
          file = `v2poc-file-${randomUUID()}`;
        await c.query(
          `insert into file_records(id,organization_id,lifecycle_state,original_filename,mime_type,size_bytes,created_by_user_id) select $1::varchar,$2::varchar,'stored_hot'::file_lifecycle_state,original_filename||'-proof.pdf','application/pdf',$3::integer,$4::varchar from file_records where id=$5::varchar and organization_id=$2::varchar`,
          [file, x.organizationId, 1, actor, source.file_record_id],
        );
        const attachment = await this.projections.attachment(c, x, {
          fileRecordId: file,
          filename: `proof-${source.id}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          quantity: Number(source.allocation_quantity),
          group: source.allocation_group_id,
          side: source.side,
          role: "proof",
        });
        const n = Number(
            (
              await c.query(
                `select coalesce(max(version_number),0)+1 as n from line_item_proof_versions where organization_id=$1 and line_item_id=$2`,
                [x.organizationId, x.lineItemId],
              )
            ).rows[0].n,
          ),
          id = `v2poc-proof-${randomUUID()}`;
        await c.query(
          `insert into line_item_proof_versions(id,organization_id,order_id,line_item_id,proof_file_id,version_number,status,customer_message,created_by_user_id)values($1,$2,$3,$4,$5,$6,'draft',$7,$8)`,
          [
            id,
            x.organizationId,
            x.orderId,
            x.lineItemId,
            attachment,
            n,
            x.message ?? null,
            actor,
          ],
        );
        await c.query(
          `insert into proof_version_line_items(id,organization_id,order_id,proof_version_id,line_item_id,quantity_snapshot)values($1,$2,$3,$4,$5,$6)`,
          [
            `v2poc-proof-member-${randomUUID()}`,
            x.organizationId,
            x.orderId,
            id,
            x.lineItemId,
            (await this.artwork.lockLine(c, x)).quantity,
          ],
        );
        for (const assignment of ready.rows)
          await c.query(
            `insert into v2_poc_proof_artwork_assignments(id,organization_id,proof_version_id,artwork_id,file_record_id,allocation_group_id,allocation_quantity,side)values($1,$2,$3,$4,$5,$6,$7,$8::line_item_artwork_side)`,
            [
              `v2poc-proof-assignment-${randomUUID()}`,
              x.organizationId,
              id,
              assignment.id,
              assignment.file_record_id,
              assignment.allocation_group_id,
              assignment.allocation_quantity,
              assignment.side,
            ],
          );
        fail(f, "after_canonical_write");
        return {
          proofVersionId: id,
          attachmentId: attachment,
          versionNumber: n,
        };
      },
      f,
    );
  }
  async sendProof(actor: string, x: SendProofCommand, f?: ArtworkFailurePoint) {
    return this.mutation(
      actor,
      "send_proof.v2_poc",
      x,
      async (c) => {
        await this.artwork.lockLine(c, x);
        const p = required(
          (
            await c.query(
              `select id,status from line_item_proof_versions where id=$1 and organization_id=$2 and order_id=$3 and line_item_id=$4 for update`,
              [x.proofVersionId, x.organizationId, x.orderId, x.lineItemId],
            )
          ).rows[0] as any,
          "Proof not found in this organization.",
        );
        if (p.status !== "draft")
          throw new V2PocError("VALIDATION", "Only a draft proof can be sent.");
        const raw = `v2poc-proof-token-${randomUUID()}`;
        await c.query(
          `update line_item_proof_versions set status='awaiting_response',sent_to_email=$1,sent_by_user_id=$2,sent_at=now(),updated_at=now()where id=$3`,
          [x.recipientEmail, actor, p.id],
        );
        await c.query(
          `update order_line_items set requires_proof_approval=true,approved_proof_version_id=null where id=$1`,
          [x.lineItemId],
        );
        await c.query(
          `insert into proof_access_tokens(id,organization_id,line_item_id,proof_version_id,token,expires_at,created_by)values($1,$2,$3,$4,$5,now()+interval '7 days','v2_poc')`,
          [
            `v2poc-proof-token-row-${randomUUID()}`,
            x.organizationId,
            x.lineItemId,
            p.id,
            tokenHash(raw),
          ],
        );
        await c.query(
          `insert into v2_poc_proof_deliveries(id,organization_id,proof_version_id)values($1,$2,$3)`,
          [`v2poc-proof-delivery-${randomUUID()}`, x.organizationId, p.id],
        );
        fail(f, "after_proof_delivery_write");
        return {
          proofVersionId: p.id,
          deliveryStatus: "PENDING",
          responseToken: raw,
        };
      },
      f,
    );
  }
  async recordProofResponse(actor: string, x: ProofResponseCommand) {
    return this.mutation(actor, "proof_response.v2_poc", x, async (c) => {
      await this.artwork.lockLine(c, x);
      const t = required(
        (
          await c.query(
            `select t.proof_version_id,p.status from proof_access_tokens t join line_item_proof_versions p on p.id=t.proof_version_id where t.organization_id=$1 and t.line_item_id=$2 and t.token=$3 and t.revoked_at is null and t.expires_at>now() for update`,
            [x.organizationId, x.lineItemId, tokenHash(x.token)],
          )
        ).rows[0] as any,
        "Valid proof token not found in this organization.",
      );
      if (t.status !== "awaiting_response")
        throw new V2PocError(
          "VALIDATION",
          "Proof response is stale or already recorded.",
        );
      await c.query(
        `insert into line_item_proof_approvals(id,organization_id,order_id,line_item_id,proof_version_id,decision,response_notes,responder_user_id,responder_source)values($1,$2,$3,$4,$5,$6::line_item_proof_response_decision,$7,$8,'v2_poc')`,
        [
          `v2poc-proof-approval-${randomUUID()}`,
          x.organizationId,
          x.orderId,
          x.lineItemId,
          t.proof_version_id,
          x.decision,
          x.notes ?? null,
          actor,
        ],
      );
      await c.query(
        `update line_item_proof_versions set status=$1::line_item_proof_version_status,updated_at=now()where id=$2`,
        [x.decision, t.proof_version_id],
      );
      await c.query(
        `update proof_access_tokens set revoked_at=now()where proof_version_id=$1`,
        [t.proof_version_id],
      );
      await c.query(
        `update order_line_items set requires_proof_approval=$1,approved_proof_version_id=$2 where id=$3`,
        [
          x.decision !== "approved",
          x.decision === "approved" ? t.proof_version_id : null,
          x.lineItemId,
        ],
      );
      return { proofVersionId: t.proof_version_id, decision: x.decision };
    });
  }
  /**
   * Canonical portal-aware proof response.  The proof token remains the
   * one-time, line-scoped credential; the typed principal additionally proves
   * the customer and organization scope.  Portal/service identities are kept
   * in V2 attribution instead of being fabricated as staff users.
   */
  async recordProofResponseAs(principal: Principal, x: ProofResponseCommand) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const order = required((await c.query(
        "select customer_id from orders where id=$1 and organization_id=$2 for update",
        [x.orderId, x.organizationId],
      )).rows[0] as { customer_id: string | null } | undefined, "Order not found in this organization.");
      const context = await this.principalContext.resolve(c, principal, x.organizationId);
      this.authority.authorize(context.principal, "proof.respond", {
        organizationId: x.organizationId,
        customerId: order.customer_id,
      });
      await this.artwork.lockLine(c, x);
      const token = required((await c.query(
        `select t.proof_version_id,p.status from proof_access_tokens t join line_item_proof_versions p on p.id=t.proof_version_id where t.organization_id=$1 and t.line_item_id=$2 and t.token=$3 and t.revoked_at is null and t.expires_at>now() for update`,
        [x.organizationId, x.lineItemId, tokenHash(x.token)],
      )).rows[0] as { proof_version_id: string; status: string } | undefined, "Valid proof token not found in this organization.");
      if (token.status !== "awaiting_response") throw new V2PocError("VALIDATION", "Proof response is stale or already recorded.");
      const actor = staffActor(context.principal);
      await c.query(
        `insert into line_item_proof_approvals(id,organization_id,order_id,line_item_id,proof_version_id,decision,response_notes,responder_user_id,responder_source)values($1,$2,$3,$4,$5,$6::line_item_proof_response_decision,$7,$8,'v2_poc')`,
        [`v2poc-proof-approval-${randomUUID()}`, x.organizationId, x.orderId, x.lineItemId, token.proof_version_id, x.decision, x.notes ?? null, actor],
      );
      await c.query("update line_item_proof_versions set status=$1::line_item_proof_version_status,updated_at=now() where id=$2", [x.decision, token.proof_version_id]);
      await c.query("update proof_access_tokens set revoked_at=now() where proof_version_id=$1", [token.proof_version_id]);
      await c.query("update order_line_items set requires_proof_approval=$1,approved_proof_version_id=$2 where id=$3", [x.decision !== "approved", x.decision === "approved" ? token.proof_version_id : null, x.lineItemId]);
      await c.query(
        `insert into v2_poc_operation_attributions(id,organization_id,operation,resource_type,resource_id,principal_kind,principal_id,staff_actor_user_id) values($1,$2,'proof.respond','proof_version',$3,$4,$5,$6) on conflict(organization_id,operation,resource_type,resource_id) do update set principal_kind=excluded.principal_kind,principal_id=excluded.principal_id,staff_actor_user_id=excluded.staff_actor_user_id`,
        [`v2poc-attribution-${randomUUID()}`, x.organizationId, token.proof_version_id, context.principal.kind, principalSubject(context.principal), actor],
      );
      await c.query("commit");
      return { proofVersionId: token.proof_version_id, decision: x.decision };
    } catch (error) {
      try { await c.query("rollback"); } catch {}
      throw error;
    } finally { c.release(); }
  }
  async reconcileProofDelivery(
    actor: string,
    o: string,
    proofId: string,
    f?: ArtworkFailurePoint,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await this.auth.check(c, actor, o);
      const d = required(
        (
          await c.query(
            `select id from v2_poc_proof_deliveries where organization_id=$1 and proof_version_id=$2 and status in('PENDING','FAILED') for update`,
            [o, proofId],
          )
        ).rows[0] as any,
        "Pending proof delivery not found.",
      );
      fail(f, "during_delivery");
      await c.query(
        `update v2_poc_proof_deliveries set status='COMPLETED',attempts=attempts+1,last_error=null,completed_at=now()where id=$1`,
        [d.id],
      );
      await c.query("commit");
      return { proofVersionId: proofId, status: "COMPLETED" };
    } catch (e) {
      try {
        await c.query("rollback");
      } catch {}
      throw e;
    } finally {
      c.release();
    }
  }
  async startPrepress(actor: string, x: ArtworkCommand) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await this.auth.check(c, actor, x.organizationId);
      await this.artwork.lockLine(c, x);
      const line = (
        await c.query(
          `select requires_proof_approval,approved_proof_version_id from order_line_items where id=$1`,
          [x.lineItemId],
        )
      ).rows[0] as {
        requires_proof_approval: boolean;
        approved_proof_version_id: string | null;
      };
      if (line.requires_proof_approval && !line.approved_proof_version_id)
        throw new V2PocError(
          "VALIDATION",
          "Approved proof is required before prepress.",
        );
      const id = `v2poc-prepress-${randomUUID()}`;
      await c.query(
        `insert into prepress_sessions(id,organization_id,order_id,line_item_id,status,started_by_user_id,lock_owner_user_id)values($1,$2,$3,$4,'active',$5,$5)`,
        [id, x.organizationId, x.orderId, x.lineItemId, actor],
      );
      await c.query("commit");
      return { id };
    } catch (e) {
      try {
        await c.query("rollback");
      } catch {}
      throw e;
    } finally {
      c.release();
    }
  }
  async finalizePrepress(
    actor: string,
    x: ArtworkCommand,
    f?: ArtworkFailurePoint,
  ) {
    return this.mutation(
      actor,
      "finalize_prepress.v2_poc",
      x,
      async (c) => {
        await this.artwork.lockLine(c, x);
        const session = required(
          (
            await c.query(
              `select id from prepress_sessions where organization_id=$1 and order_id=$2 and line_item_id=$3 and status='active' and lock_owner_user_id=$4 for update`,
              [x.organizationId, x.orderId, x.lineItemId, actor],
            )
          ).rows[0] as any,
          "Active prepress session not found.",
        );
        const line = (
          await c.query(
            `select requires_proof_approval,approved_proof_version_id from order_line_items where id=$1`,
            [x.lineItemId],
          )
        ).rows[0] as any;
        if (line.requires_proof_approval && !line.approved_proof_version_id)
          throw new V2PocError(
            "VALIDATION",
            "Approved proof is required before prepress finalization.",
          );
        const ready = await this.artwork.ready(
          c,
          x,
          "production,modified_production",
        );
        if (!ready.ready)
          throw new V2PocError(
            "VALIDATION",
            `Production artwork allocation is not ready: ${ready.reason}`,
          );
        const assignments = [] as any[];
        for (const a of ready.rows) {
          const detail = required(
            (
              await c.query(
                `select original_filename,mime_type,size_bytes from file_records where id=$1 and organization_id=$2`,
                [a.file_record_id, x.organizationId],
              )
            ).rows[0] as any,
            "Production file record not found.",
          );
          const finalFileId = await this.projections.final(
            c,
            x,
            { ...a, ...detail },
            session.id,
            actor,
          );
          assignments.push({
            artworkId: a.id,
            fileRecordId: a.file_record_id,
            quantity: Number(a.allocation_quantity),
            group: a.allocation_group_id,
            side: a.side,
            finalFileId,
          });
        }
        fail(f, "after_final_art_write");
        const job = `v2poc-art-job-${randomUUID()}`;
        await c.query(
          `insert into production_jobs(id,organization_id,order_id,line_item_id,station_key,step_key,status)values($1,$2,$3,$4,'flatbed','production','queued')`,
          [job, x.organizationId, x.orderId, x.lineItemId],
        );
        const handoff = `v2poc-handoff-${randomUUID()}`;
        await c.query(
          `insert into v2_poc_prepress_handoffs(id,organization_id,order_id,line_item_id,artwork_id,file_record_id,production_job_id,snapshot_json,assignments_json)values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
          [
            handoff,
            x.organizationId,
            x.orderId,
            x.lineItemId,
            assignments[0].artworkId,
            assignments[0].fileRecordId,
            job,
            JSON.stringify({
              assignmentCount: assignments.length,
            }),
            JSON.stringify(assignments),
          ],
        );
        fail(f, "before_handoff");
        await c.query(
          `update prepress_sessions set status='complete',completed_by_user_id=$1,completed_at=now(),updated_at=now()where id=$2`,
          [actor, session.id],
        );
        return {
          handoffId: handoff,
          productionJobId: job,
          finalFileId: assignments[0].finalFileId,
          assignments,
        };
      },
      f,
    );
  }
  async returnToPrepress(actor: string, x: ArtworkCommand) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await this.auth.check(c, actor, x.organizationId);
      await this.artwork.lockLine(c, x);
      const h = required(
        (
          await c.query(
            `select id,production_job_id from v2_poc_prepress_handoffs where organization_id=$1 and order_id=$2 and line_item_id=$3 and status='READY' for update`,
            [x.organizationId, x.orderId, x.lineItemId],
          )
        ).rows[0] as any,
        "Ready production handoff not found.",
      );
      await c.query(
        `update v2_poc_prepress_handoffs set status='RETURNED',returned_at=now(),returned_by_user_id=$1 where id=$2`,
        [actor, h.id],
      );
      await c.query(
        `update production_jobs set status='cancelled',updated_at=now() where id=$1`,
        [h.production_job_id],
      );
      await c.query(
        `update line_item_files set status='retired' where organization_id=$1 and order_id=$2 and line_item_id=$3 and status='active' and role='final'`,
        [x.organizationId, x.orderId, x.lineItemId],
      );
      const id = `v2poc-prepress-${randomUUID()}`;
      await c.query(
        `insert into prepress_sessions(id,organization_id,order_id,line_item_id,status,started_by_user_id,lock_owner_user_id)values($1,$2,$3,$4,'active',$5,$5)`,
        [id, x.organizationId, x.orderId, x.lineItemId, actor],
      );
      await c.query("commit");
      return { returnedHandoffId: h.id, prepressSessionId: id };
    } catch (e) {
      try {
        await c.query("rollback");
      } catch {}
      throw e;
    } finally {
      c.release();
    }
  }
  async readLine(actor: string, o: string, order: string, line: string) {
    const c = await this.pool.connect();
    try {
      await this.auth.check(c, actor, o);
      const arts = await this.artwork.allocations(
        c,
        {
          organizationId: o,
          orderId: order,
          lineItemId: line,
          requestId: "read",
        },
        "customer_source,production,modified_production",
      );
      const proof = await c.query(
        `select id,status,version_number from line_item_proof_versions where organization_id=$1 and order_id=$2 and line_item_id=$3 order by version_number`,
        [o, order, line],
      );
      const handoff = await c.query(
        `select h.id,h.status,h.artwork_id,h.file_record_id,h.production_job_id,h.snapshot_json,h.assignments_json from v2_poc_prepress_handoffs h where h.organization_id=$1 and h.order_id=$2 and h.line_item_id=$3 and h.status='READY'`,
        [o, order, line],
      );
      return {
        artwork: arts,
        proofs: proof.rows,
        handoff: handoff.rows[0] ?? null,
        customerArtworkReady: (
          await this.artwork.ready(c, {
            organizationId: o,
            orderId: order,
            lineItemId: line,
            requestId: "read",
          })
        ).ready,
      };
    } finally {
      c.release();
    }
  }
  async resolveProductionHandoff(
    actor: string,
    organizationId: string,
    orderId: string,
    lineItemId: string,
  ) {
    const c = await this.pool.connect();
    try {
      await this.auth.check(c, actor, organizationId);
      const row = required(
        (
          await c.query(
            `select id,production_job_id,assignments_json,snapshot_json from v2_poc_prepress_handoffs where organization_id=$1 and order_id=$2 and line_item_id=$3 and status='READY'`,
            [organizationId, orderId, lineItemId],
          )
        ).rows[0] as any,
        "Ready V2 production handoff not found.",
      );
      return {
        handoffId: row.id,
        productionJobId: row.production_job_id,
        assignments: row.assignments_json,
        snapshot: row.snapshot_json,
      };
    } finally {
      c.release();
    }
  }
}
