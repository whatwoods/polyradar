-- Collector bookkeeping (PLAN §4.1, §7.1 来源健康).

-- Cursor/ETag state owned by the collector; config stays what the YAML says.
alter table source add column state jsonb not null default '{}';
alter table source add column last_run_at timestamptz;
alter table source add column last_error_at timestamptz;
alter table source add column last_item_count int;

-- Items picked up on a source's first run are history, not news: they are
-- kept, but excluded from latency stats and from release events.
alter table raw_item add column backfill boolean not null default false;
create index raw_item_fetched_idx on raw_item (source_id, fetched_at desc);

create index signal_created_idx on signal (created_at desc);
create index signal_entity_idx on signal (entity_id) where entity_id is not null;
