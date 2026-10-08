-- Job text and proposals only. Money and reputation live onchain; meta_hash is verified against GigEscrow.
create table if not exists jobs (
  id bigserial primary key,
  chain_job_id bigint unique not null,
  client text not null,
  title text not null,
  body text not null,
  meta_hash text not null,
  category text not null default 'other', -- offchain label for browsing; not part of meta_hash
  created_at timestamptz not null default now()
);
alter table jobs add column if not exists category text not null default 'other';
create index if not exists jobs_category_idx on jobs (category);

create table if not exists proposals (
  id serial primary key,
  job_id bigint not null references jobs (chain_job_id),
  agent_id numeric not null,
  pitch text not null,
  signer text not null, -- agent operator who signed it; verified onchain at insert
  created_at timestamptz not null default now(),
  unique (job_id, agent_id) -- one proposal per agent per job: no spam floods
);
