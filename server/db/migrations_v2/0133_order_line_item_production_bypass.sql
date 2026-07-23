-- Explicit, auditable bypass for non-produced order line items.
alter table order_line_items
  add column production_bypassed boolean not null default false,
  add column production_bypass_reason text,
  add column production_bypassed_by_user_id varchar references users(id) on delete set null,
  add column production_bypassed_at timestamptz;

create index order_line_items_production_bypassed_idx on order_line_items(production_bypassed);
