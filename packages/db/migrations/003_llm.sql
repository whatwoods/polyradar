-- Every LLM call, keyed by model + input hash (PLAN §7.1): a cache, a cost
-- ledger and an audit trail. Changing the model or prompt re-runs the call.
create table llm_call (
  id                bigserial primary key,
  purpose           text not null,
  model             text not null,
  input_hash        text not null,
  output            jsonb,
  error             text,
  prompt_tokens     int,
  completion_tokens int,
  ms                int,
  created_at        timestamptz not null default now(),
  unique (model, input_hash)
);
create index llm_call_created_idx on llm_call (created_at desc);
