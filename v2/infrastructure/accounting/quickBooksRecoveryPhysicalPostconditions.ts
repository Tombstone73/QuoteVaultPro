import type { TransactionalClient } from "../persistence/types.js";

/** Read-only catalog evidence for the protected provider-request snapshot. */
export async function assertQuickBooksRecoveryPhysicalPostconditions(client: TransactionalClient): Promise<void> {
  const providerShape = `CHECK (((length(btrim((request_id)::text)) > 0) AND (length(btrim((entity_id)::text)) > 0)
    AND ((entity_kind)::text = ANY ((ARRAY['customer'::character varying, 'invoice'::character varying])::text[]))
    AND ((realm_id)::text ~ '^[0-9]{1,64}$'::text)
    AND ((environment)::text = ANY ((ARRAY['sandbox'::character varying, 'production'::character varying])::text[]))
    AND isfinite(created_at) AND ((provider_attempt_started_at IS NULL) OR isfinite(provider_attempt_started_at))
    AND (((confirmed_provider_id IS NULL) AND (confirmed_at IS NULL)) OR ((confirmed_provider_id IS NOT NULL)
      AND ((confirmed_provider_id)::text ~ '^[0-9]{1,64}$'::text) AND (confirmed_at IS NOT NULL)
      AND isfinite(confirmed_at) AND (provider_attempt_started_at IS NOT NULL) AND (confirmed_at >= provider_attempt_started_at)))
    AND v2_quickbooks_provider_request_intent_valid(intent_json, request_id, organization_id, entity_kind, entity_id, realm_id, environment)))`;
  const result = await client.query<{ ready: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='v2_quickbooks_payment_references' AND column_name='recovery_context'
      AND data_type='jsonb' AND is_nullable='YES')
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='v2_quickbooks_payment_references' AND column_name='provider_attempt_started_at'
      AND data_type='timestamp with time zone' AND is_nullable='YES')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.v2_quickbooks_payment_references')
      AND conname='v2_quickbooks_payment_recovery_context_chk' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.v2_quickbooks_payment_references')
      AND tgname='v2_quickbooks_payment_recovery_context_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND tgtype=31 AND tgfoid=to_regprocedure('public.v2_quickbooks_payment_recovery_context_guard()'))
    AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.v2_quickbooks_payment_recovery_context_valid(jsonb,character varying,character varying,character varying)')
      AND provolatile='i')
    AND NOT EXISTS(SELECT 1 FROM (VALUES
      ('request_id','character varying','NO',50),('organization_id','character varying','NO',NULL),
      ('entity_kind','character varying','NO',24),('entity_id','character varying','NO',NULL),
      ('realm_id','character varying','NO',64),('environment','character varying','NO',10),
      ('intent_json','jsonb','NO',NULL),('provider_attempt_started_at','timestamp with time zone','YES',NULL),
      ('confirmed_provider_id','character varying','YES',64),('confirmed_at','timestamp with time zone','YES',NULL),
      ('created_at','timestamp with time zone','NO',NULL)) AS expected(name,type,nullable,width)
      WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns actual WHERE actual.table_schema='public'
        AND actual.table_name='v2_quickbooks_provider_requests' AND actual.column_name=expected.name
        AND actual.data_type=expected.type AND actual.is_nullable=expected.nullable
        AND actual.character_maximum_length IS NOT DISTINCT FROM expected.width))
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.v2_quickbooks_provider_requests')
      AND conname='v2_quickbooks_provider_requests_shape_chk' AND contype='c' AND convalidated
      AND pg_get_constraintdef(oid)=$1::text)
    AND EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.conrelid=to_regclass('public.v2_quickbooks_provider_requests') AND c.contype='p'
        AND cardinality(c.conkey)=1 AND a.attname='request_id')
    AND EXISTS(SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_attribute target ON target.attrelid=c.confrelid AND target.attnum=c.confkey[1]
      WHERE c.conrelid=to_regclass('public.v2_quickbooks_provider_requests') AND c.contype='f' AND c.convalidated
        AND c.confrelid=to_regclass('public.organizations') AND cardinality(c.conkey)=1
        AND cardinality(c.confkey)=1 AND a.attname='organization_id' AND target.attname='id')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.v2_quickbooks_provider_requests')
      AND tgname='v2_quickbooks_provider_requests_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND tgtype=31 AND tgfoid=to_regprocedure('public.v2_quickbooks_provider_request_guard()'))
    AND EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=to_regclass('public.v2_quickbooks_provider_requests') AND a.attname='created_at'
        AND pg_get_expr(d.adbin,d.adrelid)='now()')
    AND EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('public.v2_quickbooks_provider_requests')
      AND i.indexrelid=to_regclass('public.v2_quickbooks_provider_requests_entity_idx') AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=6 AND i.indnkeyatts=6
      AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS keys(number,position)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=keys.number ORDER BY keys.position)
        =ARRAY['organization_id','entity_kind','entity_id','realm_id','environment','created_at']::text[])
    AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.v2_quickbooks_provider_request_intent_valid(jsonb,character varying,character varying,character varying,character varying,character varying,character varying)')
      AND provolatile='i') AS ready`, [providerShape.replace(/\n\s*/g, " ")]);
  if (result.rows[0]?.ready !== true) throw new Error("Protected QuickBooks Payment recovery schema is unavailable.");
}
