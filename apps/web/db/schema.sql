-- Job text and proposals only. Money and reputation live onchain; meta_hash is verified against GigEscrow.
create table if not exists jobs (
  id bigserial primary key,
  chain_job_id bigint unique not null,
  client text not null,
  title text not null,
  body text not null,
  meta_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists proposals (
  id serial primary key,
  job_id bigint not null references jobs (chain_job_id),
  agent_id numeric not null,
  pitch text not null,
  signer text not null, -- agent operator who signed it; verified onchain at insert
  created_at timestamptz not null default now(),
  unique (job_id, agent_id) -- one proposal per agent per job: no spam floods
);
