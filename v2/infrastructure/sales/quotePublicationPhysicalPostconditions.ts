import type { TransactionalClient } from "../persistence/types.js";

/** Required before creating a provider-free attempt; never install schema at runtime. */
export async function assertQuoteSuppressionSchema(client: TransactionalClient): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='v2_sales_quote_delivery_attempts' AND column_name='suppression_context' AND data_type='jsonb')
    AND (SELECT count(*)=3 FROM pg_constraint WHERE conrelid=to_regclass('public.v2_sales_quote_delivery_attempts')
      AND conname IN ('v2_quote_suppression_context_chk','v2_sales_quote_delivery_attempts_state_chk','v2_sales_quote_delivery_attempts_completion_chk')
      AND contype='c' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.v2_sales_quote_delivery_attempts')
      AND tgname='v2_quote_delivery_mode_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal
      AND tgfoid=to_regprocedure('public.v2_quote_delivery_mode_guard()') AND tgtype=19)
    AND EXISTS(SELECT 1 FROM pg_index i WHERE indexrelid=to_regclass('public.v2_quote_delivery_publication_uidx')
      AND indrelid=to_regclass('public.v2_sales_quote_delivery_attempts')
      AND indisunique AND indisvalid AND indisready AND indimmediate
      AND indnkeyatts=3 AND indnatts=3 AND indexprs IS NULL
      AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY key(attnum,position)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum ORDER BY key.position)
        = ARRAY['organization_id','quote_document_id','quote_checkpoint_id']::text[]
      AND pg_get_expr(i.indpred,i.indrelid) = '((delivery_state)::text = ANY ((ARRAY[''succeeded''::character varying, ''suppressed''::character varying])::text[]))') AS ready`);
  if (result.rows[0]?.ready !== true) throw new Error("Quote suppression schema is unavailable. No email was attempted.");
}

/** Read-only PG16+ gate; migrations, never startup, own the index replacement. */
export async function assertQuotePublicationSchema(client: TransactionalClient): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`SELECT
    to_regclass('public.v2_sales_quote_delivery_attempts_one_success_uidx') IS NULL
    AND EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_class ix ON ix.oid = i.indexrelid
      JOIN pg_namespace ns ON ns.oid = ix.relnamespace
      JOIN pg_am am ON am.oid = ix.relam
      WHERE i.indrelid = to_regclass('public.v2_sales_quote_delivery_attempts')
        AND ns.nspname = 'public'
        AND ix.relname = 'v2_sales_quote_delivery_attempts_checkpoint_success_uidx'
        AND ix.relkind = 'i' AND am.amname = 'btree'
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
        AND NOT i.indnullsnotdistinct
        AND i.indnkeyatts = 3 AND i.indnatts = 3 AND i.indexprs IS NULL
        AND NOT EXISTS (SELECT 1 FROM unnest(i.indoption) option WHERE option <> 0)
        AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY key(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
          ORDER BY key.position) = ARRAY['organization_id','quote_document_id','quote_checkpoint_id']::text[]
        AND pg_get_expr(i.indpred, i.indrelid) = '((delivery_state)::text = ''succeeded''::text)'
    ) AS ready`);
  if (result.rows[0]?.ready !== true) throw new Error("Quote publication checkpoint success schema is unavailable.");
}
