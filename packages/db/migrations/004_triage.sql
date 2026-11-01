-- LLM triage of signals (PLAN §4.2 相关度分类). The raw model output is kept
-- for audit; derived columns (relevance, capability_ids) are what queries use.
alter table signal add column triage jsonb;
alter table signal add column triaged_at timestamptz;
create index signal_untriaged_idx on signal (id) where triaged_at is null;

-- Media can point at the original until the capture worker copies it to R2.
create index media_entity_idx on media (entity_id);
