CREATE UNIQUE INDEX materials_org_normalized_sku_uidx
  ON public.materials (organization_id, lower(trim(sku)));
