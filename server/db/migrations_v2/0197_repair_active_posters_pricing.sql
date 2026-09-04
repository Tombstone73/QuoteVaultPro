-- Repair the production Posters active revision identified by the live pricing
-- trace.  The legacy tree charges a $1/sqft rule at the Laminate node (which
-- applies to NONE), offsets NONE by -$0.50, and carries an unintended $5
-- minimum.  Preserve the original revision and create one corrected ACTIVE
-- replacement instead of mutating historical pricing provenance.
DO $$
DECLARE
  target record;
  node_key text;
  node jsonb;
  repaired_tree jsonb;
  repaired_choices jsonb;
  replacement_tree_id varchar;
BEGIN
  SELECT
    p.id AS product_id,
    p.organization_id,
    p.name AS product_name,
    p.pbv2_active_tree_version_id AS tree_version_id,
    tv.schema_version,
    tv.tree_json
  INTO target
  FROM products p
  INNER JOIN pbv2_tree_versions tv
    ON tv.id = p.pbv2_active_tree_version_id
    AND tv.organization_id = p.organization_id
    AND tv.product_id = p.id
  WHERE p.id = '03254469-3eb3-4e7c-972e-41088f4f46ab'
    AND p.is_active = true
    AND jsonb_typeof(tv.tree_json -> 'nodes') = 'object'
    AND coalesce(tv.tree_json #>> '{meta,pricingV2,base,perSqftCents}', '') = '150'
    AND coalesce(tv.tree_json #>> '{meta,pricingV2,base,minimumChargeCents}', '') = '500'
  FOR UPDATE OF p, tv;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  repaired_tree := jsonb_set(
    target.tree_json,
    '{meta,pricingV2,base,minimumChargeCents}',
    '0'::jsonb,
    true
  );

  FOR node_key, node IN
    SELECT key, value FROM jsonb_each(target.tree_json -> 'nodes')
  LOOP
    IF coalesce(node #>> '{input,type}', '') <> 'select'
      OR lower(btrim(coalesce(node ->> 'label', ''))) NOT IN ('laminate', 'lamination')
      OR jsonb_typeof(node -> 'choices') <> 'array'
      OR coalesce(jsonb_array_length(node -> 'pricingImpact'), 0) <> 1
      OR coalesce(node #>> '{pricingImpact,0,mode}', '') <> 'addPerSqft'
      OR coalesce(node #>> '{pricingImpact,0,amountCents}', '') <> '100'
    THEN
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
      CASE
        WHEN lower(btrim(coalesce(choice ->> 'label', choice ->> 'value', ''))) IN ('none', 'no', 'no lamination', 'not required', 'no finish')
          THEN choice - 'pricingImpact'
        WHEN lower(btrim(coalesce(choice ->> 'label', choice ->> 'value', ''))) IN ('gloss', 'glossy', 'matte')
          THEN jsonb_set(
            choice,
            '{pricingImpact}',
            jsonb_build_array(jsonb_build_object(
              'mode', 'addPerUnit',
              'centsPerUnit', 100,
              'unit', 'perSqft',
              'label', 'Laminate surcharge'
            )),
            true
          )
        ELSE choice
      END
      ORDER BY ordinal
    )
    INTO repaired_choices
    FROM jsonb_array_elements(node -> 'choices') WITH ORDINALITY AS choices(choice, ordinal);

    repaired_tree := jsonb_set(
      jsonb_set(repaired_tree, ARRAY['nodes', node_key, 'pricingImpact'], '[]'::jsonb, true),
      ARRAY['nodes', node_key, 'choices'],
      repaired_choices,
      true
    );
  END LOOP;

  -- Do not create a replacement unless the exact live Laminate node was found.
  IF repaired_tree = jsonb_set(
    target.tree_json,
    '{meta,pricingV2,base,minimumChargeCents}',
    '0'::jsonb,
    true
  ) THEN
    RETURN;
  END IF;

  replacement_tree_id := gen_random_uuid()::text;
  repaired_tree := jsonb_set(repaired_tree, '{schemaVersion}', '2'::jsonb, true);
  repaired_tree := jsonb_set(repaired_tree, '{status}', '"ACTIVE"'::jsonb, true);

  UPDATE pbv2_tree_versions
  SET status = 'DEPRECATED', updated_at = now(), updated_by_user_id = NULL
  WHERE id = target.tree_version_id
    AND organization_id = target.organization_id;

  INSERT INTO pbv2_tree_versions (
    id, organization_id, product_id, status, schema_version, tree_json,
    published_at, created_by_user_id, updated_by_user_id, created_at, updated_at
  ) VALUES (
    replacement_tree_id, target.organization_id, target.product_id, 'ACTIVE',
    2, repaired_tree, now(), NULL, NULL, now(), now()
  );

  UPDATE products
  SET pbv2_active_tree_version_id = replacement_tree_id,
      option_tree_json = repaired_tree,
      updated_at = now()
  WHERE id = target.product_id
    AND organization_id = target.organization_id
    AND pbv2_active_tree_version_id = target.tree_version_id;

  INSERT INTO audit_logs (
    id, organization_id, user_id, user_name, action_type, entity_type,
    entity_id, entity_name, description, old_values, new_values, created_at
  ) VALUES (
    gen_random_uuid()::text, target.organization_id, NULL, 'system migration',
    'product_pricing_configuration_repaired', 'product', target.product_id,
    target.product_name,
    'Repaired the live Posters revision: NONE is $0, Glossy/Matte add $1.00/sqft, and the unintended $5 minimum was removed.',
    jsonb_build_object('activeTreeVersionId', target.tree_version_id, 'minimumChargeCents', 500, 'laminateNodeImpactCentsPerSqft', 100, 'noneChoiceImpactCents', -50),
    jsonb_build_object('activeTreeVersionId', replacement_tree_id, 'minimumChargeCents', 0, 'noneImpactCents', 0, 'glossyMatteImpactCentsPerSqft', 100),
    now()
  );
END $$;
