-- Optional tenant-local bridge foundation. Cloud storage remains authoritative.
create type local_bridge_agent_status as enum ('pending', 'active', 'disabled', 'revoked');
create type local_file_destination_type as enum ('customer_art_folder', 'onyx_hot_folder_future');
create type local_file_copy_job_status as enum ('pending', 'claimed', 'succeeded', 'failed', 'canceled');

create table local_bridge_agents (
  id varchar primary key default gen_random_uuid()::text,
  organization_id varchar not null references organizations(id) on delete cascade,
  name varchar(255) not null,
  status local_bridge_agent_status not null default 'pending',
  token_hash varchar(128) not null,
  machine_label varchar(255), agent_version varchar(64), last_seen_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revoked_at timestamptz
);
create unique index local_bridge_agents_token_hash_uidx on local_bridge_agents(token_hash);
create index local_bridge_agents_org_idx on local_bridge_agents(organization_id);

create table local_file_destinations (
  id varchar primary key default gen_random_uuid()::text,
  organization_id varchar not null references organizations(id) on delete cascade,
  customer_id varchar references customers(id) on delete cascade,
  destination_type local_file_destination_type not null default 'customer_art_folder',
  local_path text not null, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index local_file_destinations_org_customer_idx on local_file_destinations(organization_id, customer_id);

create table local_file_copy_jobs (
  id varchar primary key default gen_random_uuid()::text,
  organization_id varchar not null references organizations(id) on delete cascade,
  destination_id varchar not null references local_file_destinations(id) on delete cascade,
  source_file_id varchar not null references line_item_files(id) on delete restrict,
  order_id varchar references orders(id) on delete set null,
  order_line_item_id varchar references order_line_items(id) on delete set null,
  customer_id varchar references customers(id) on delete set null,
  status local_file_copy_job_status not null default 'pending', attempts integer not null default 0,
  last_error text, claimed_by_agent_id varchar references local_bridge_agents(id) on delete set null,
  claimed_at timestamptz, completed_at timestamptz, next_attempt_at timestamptz,
  output_filename varchar(512) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index local_file_copy_jobs_claim_idx on local_file_copy_jobs(organization_id, status, next_attempt_at, created_at);
