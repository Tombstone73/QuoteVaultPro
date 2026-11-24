ALTER TABLE shipment_items ADD COLUMN stock_material_id varchar;
ALTER TABLE pickup_handoff_items ADD COLUMN stock_material_id varchar;
CREATE INDEX shipment_items_org_stock_idx ON shipment_items (organization_id, stock_material_id)
  WHERE stock_material_id IS NOT NULL;
