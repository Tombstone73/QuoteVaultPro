import type { TransactionalClient } from "../persistence/types.js";

// Exact protected catalog output, including whitespace inside SQL literals.
// Unknown PostgreSQL deparse variants deliberately fail closed.
const senderShape = "((sender_snapshot IS NULL) OR COALESCE(((jsonb_typeof(sender_snapshot) = 'object'::text) AND ((sender_snapshot ->> 'version'::text) = '1'::text) AND (jsonb_typeof((sender_snapshot -> 'blindShipping'::text)) = 'boolean'::text) AND (jsonb_typeof((sender_snapshot -> 'intents'::text)) = 'array'::text) AND ((sender_snapshot ->> 'source'::text) = ANY (ARRAY['customer'::text, 'custom'::text, 'organization'::text])) AND (((sender_snapshot ->> 'blindShipping'::text))::boolean = ((sender_snapshot ->> 'source'::text) <> 'organization'::text)) AND ((NOT ((sender_snapshot ->> 'blindShipping'::text))::boolean) OR (jsonb_typeof((sender_snapshot -> 'sender'::text)) = 'object'::text))), false))";
const immutableBody = `
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Shipment recovery evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; `;

/** Shipping's narrow read-only deployment gate, not a full recovery schema audit. */
export async function assertShipmentSenderSchema(client: TransactionalClient): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM pg_class table_shape
    JOIN pg_namespace table_namespace ON table_namespace.oid=table_shape.relnamespace
    JOIN pg_attribute column_shape ON column_shape.attrelid=table_shape.oid
    WHERE table_namespace.nspname='public'
      AND table_shape.relname='v2_fulfillment_shipment_prepared_revisions'
      AND table_shape.relkind='r' AND table_shape.relpersistence='p'
      AND column_shape.attname='sender_snapshot' AND NOT column_shape.attisdropped
      AND column_shape.atttypid='pg_catalog.jsonb'::regtype
      AND NOT column_shape.attnotnull AND NOT column_shape.atthasdef
      AND column_shape.attgenerated='' AND column_shape.attidentity=''
      AND EXISTS (
        SELECT 1 FROM pg_constraint shape WHERE shape.conrelid=table_shape.oid
          AND shape.conname='v2_shipment_sender_snapshot_shape_chk' AND shape.contype='c'
          AND shape.convalidated AND NOT shape.connoinherit
          AND NOT shape.condeferrable AND NOT shape.condeferred
          AND shape.conkey=ARRAY[column_shape.attnum]::smallint[]
          AND pg_get_expr(shape.conbin,shape.conrelid,false)=$1
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger guard
        JOIN pg_proc function_shape ON function_shape.oid=guard.tgfoid
        JOIN pg_namespace function_namespace ON function_namespace.oid=function_shape.pronamespace
        JOIN pg_language language_shape ON language_shape.oid=function_shape.prolang
        WHERE guard.tgrelid=table_shape.oid
          AND guard.tgname='v2_fulfillment_shipment_prepared_revisions_immutable_trigger'
          AND NOT guard.tgisinternal AND guard.tgenabled IN ('O','A')
          AND guard.tgtype=27 AND guard.tgattr=''::int2vector
          AND guard.tgnargs=0 AND guard.tgqual IS NULL AND guard.tgconstraint=0
          AND NOT guard.tgdeferrable AND NOT guard.tginitdeferred
          AND function_namespace.nspname='public'
          AND function_shape.proname='v2_fulfillment_shipment_recovery_immutable_validate'
          AND function_shape.prorettype='pg_catalog.trigger'::regtype
          AND function_shape.pronargs=0 AND function_shape.prokind='f'
          AND NOT function_shape.prosecdef AND function_shape.proconfig IS NULL
          AND language_shape.lanname='plpgsql' AND function_shape.prosrc=$2
      )
  ) AS ready`, [senderShape, immutableBody]);
  if (result.rows[0]?.ready !== true) throw new Error("Shipment sender schema is unavailable.");
}
