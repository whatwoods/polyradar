-- Entities from seeds/ (human-curated) vs. created by triage. Only curated
-- names go into LLM prompts, so new auto entities don't change every prompt
-- and invalidate the llm_call cache. `pnpm seed` sets it.
alter table entity add column curated boolean not null default false;
