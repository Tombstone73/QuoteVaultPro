-- Repair the one known legacy Posters configuration shape where a $1/sqft
-- Laminate rule was persisted on the select node.  Node-level select pricing
-- applies to every selected value, including the NONE default.  This migration
-- is intentionally narrow: it touches only an active product named Posters
-- whose Laminate select has a NONE default and exactly one legacy $1/sqft node
-- impact.  It creates a replacement ACTIVE PBV2 version rather than mutating
-- historical configuration in place.
DO $$
DECLARE
  target record;
  node_key text;
  node jsonb;
  default_value text;
  repaired_choices jsonb;
  repaired_tree jsonb;
  replacement_tree_id varchar;
  changed boolean;
BEGIN
  FOR target IN
    SELECT
      p.id AS product_id,
      p.organization_id,
      p.name AS product_name,
      p.pbv2_active_tree_version_id,
      tv.id AS tree_version_id,
      tv.schema_version,
      tv.tree_json
    FROM products p
    INNER JOIN pbv2_tree_versions tv
      ON tv.id = p.pbv2_active_tree_version_id
      AND tv.organization_id = p.organization_id
      AND tv.product_id = p.id
      AND tv.status = 'ACTIVE'
    WHERE (
      lower(btrim(p.name)) = 'posters'
      OR lower(btrim(coalesce(p.shop_name, ''))) = 'posters'
    )
      AND jsonb_typeof(tv.tree_json -> 'nodes') = 'object'
  LOOP
    repaired_tree := target.tree_json;
    changed := false;

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

      default_value := node #>> '{input,defaultValue}';
      IF default_value IS NULL OR lower(btrim(default_value)) NOT IN ('none', 'no', 'no_lamination', 'not_required', 'no_finish') THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(node -> 'choices') AS candidate(choice)
        WHERE lower(btrim(coalesce(candidate.choice ->> 'value', ''))) = lower(btrim(default_value))
          AND lower(btrim(coalesce(candidate.choice ->> 'label', candidate.choice ->> 'value', ''))) IN ('none', 'no', 'no lamination', 'not required', 'no finish')
      ) THEN
        CONTINUE;
      END IF;

      SELECT jsonb_agg(
        CASE
          WHEN lower(btrim(coalesce(choice ->> 'value', ''))) = lower(btrim(default_value))
            THEN choice - 'pricingImpact'
          ELSE jsonb_set(
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
      changed := true;
    END LOOP;

    IF changed THEN
      replacement_tree_id := gen_random_uuid()::text;
      repaired_tree := jsonb_set(repaired_tree, '{schemaVersion}', '2'::jsonb, true);
      repaired_tree := jsonb_set(repaired_tree, '{status}', '"ACTIVE"'::jsonb, true);

      UPDATE pbv2_tree_versions
      SET status = 'DEPRECATED', updated_at = now(), updated_by_user_id = NULL
      WHERE id = target.tree_version_id
        AND organization_id = target.organization_id
        AND status = 'ACTIVE';

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
        'Repaired legacy Laminate node pricing so NONE is $0 and paid laminate choices add $1.00/sqft.',
        jsonb_build_object('activeTreeVersionId', target.tree_version_id, 'nodeLevelLaminateImpactCentsPerSqft', 100),
        jsonb_build_object('activeTreeVersionId', replacement_tree_id, 'noneImpactCents', 0, 'laminateImpactCentsPerSqft', 100),
        now()
      );
    END IF;
  END LOOP;
END $$;
