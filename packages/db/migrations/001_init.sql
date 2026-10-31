-- Polyradar core schema. Mirrors PLAN.md §8.2; constraints from §8.3.
create extension if not exists vector;
create extension if not exists pg_trgm;

-- array_to_string is only STABLE; generated columns need IMMUTABLE.
create function immutable_join(text[]) returns text
  language sql immutable parallel safe
  as $$ select array_to_string($1, ' ') $$;

-- Sources and raw intake ----------------------------------------------------

create table source (
  id              serial primary key,
  slug            text not null unique,
  kind            text not null check (kind in (
                    'github_repo','gharchive','npm','arxiv','hf_papers','hf_models',
                    'hn','bluesky','reddit','discourse','rss','page_diff','x')),
  config          jsonb not null default '{}',
  tier            text not null check (tier in ('T0','T1','T2')),
  interval_sec    int not null,
  enabled         boolean not null default true,
  last_success_at timestamptz,
  last_error      text,
  lag_p90_sec     int
);

create table raw_item (
  id           bigserial primary key,
  source_id    int not null references source(id),
  external_id  text not null,
  url          text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  content_hash text not null,
  payload      jsonb not null,
  unique (source_id, external_id)
);

-- Entities -----------------------------------------------------------------

create table entity (
  id               serial primary key,
  slug             text not null unique,
  type             text not null check (type in (
                     'library','engine','tool','model','paper','demo','game','technique','service','dataset')),
  name             text not null,
  aliases          text[] not null default '{}',
  summary_en       text,
  summary_zh       text,
  status           text not null default 'candidate' check (status in (
                     'candidate','active','watch','archived','superseded')),
  maturity         text,
  web_readiness    text,
  evidence_level   text check (evidence_level in ('E0','E1','E2','E3')),
  importance       real not null default 0,
  first_seen_at    timestamptz not null default now(),
  last_activity_at timestamptz,
  embedding        vector(1024),
  search_tsv       tsvector generated always as (
                     setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
                     setweight(to_tsvector('simple', immutable_join(aliases)), 'A') ||
                     setweight(to_tsvector('english', coalesce(summary_en,'')), 'B')
                   ) stored,
  -- Chinese has no word boundaries for tsvector; trigram ILIKE covers it.
  search_text      text generated always as (
                     lower(name || ' ' || immutable_join(aliases) || ' ' ||
                           coalesce(summary_zh,'') || ' ' || coalesce(summary_en,''))
                   ) stored
);
create index entity_search_idx on entity using gin (search_tsv);
create index entity_search_trgm_idx on entity using gin (search_text gin_trgm_ops);

create table entity_key (
  entity_id int not null references entity(id) on delete cascade,
  key_type  text not null check (key_type in ('github','npm','pypi','arxiv','hf','doi','url')),
  key       text not null,
  primary key (key_type, key)
);
create index entity_key_entity_idx on entity_key (entity_id);

-- Signals and events -------------------------------------------------------

create table event (
  id               bigserial primary key,
  entity_id        int references entity(id) on delete cascade,
  type             text not null check (type in (
                     'new_entity','release','breaking_change','paper_with_code','demo_published',
                     'trend_spike','fact_changed','status_changed','benchmark_result')),
  occurred_at      timestamptz not null,
  detected_at      timestamptz not null default now(),
  published_at     timestamptz,
  importance       real not null default 0,
  -- §3.6: two independent axes. Radar and whats_new rank by decision_value;
  -- Showcase ranks by showcase_value. Breaking core ApiChanges bypass scoring.
  decision_value   real,
  showcase_value   real,
  title            text not null,
  title_zh         text,
  summary_en       text,
  summary_zh       text,
  source_url       text,
  payload          jsonb not null default '{}',
  signal_count     int not null default 0,
  source_diversity int not null default 0,
  cluster_key      text unique
);
create index event_occurred_idx on event (occurred_at desc);

create table signal (
  id             bigserial primary key,
  raw_item_id    bigint not null unique references raw_item(id),
  kind           text not null check (kind in (
                   'release','paper','post','repo_created','star_spike','model_upload','page_change')),
  title          text not null,
  text           text,
  lang           text,
  urls           text[] not null default '{}',
  canonical_keys text[] not null default '{}',
  relevance      real,
  capability_ids int[] not null default '{}',
  embedding      vector(1024),
  entity_id      int references entity(id),
  event_id       bigint references event(id),
  created_at     timestamptz not null default now()
);

-- Facts and evidence -------------------------------------------------------

create table attribute (
  key            text primary key,
  value_type     text not null check (value_type in ('string','number','boolean','string[]','enum','url','bytes')),
  allowed_values jsonb,
  deterministic  boolean not null default false,
  description    text not null
);

create table evidence (
  id              bigserial primary key,
  url             text not null,
  quote           text,
  quote_hash      text,
  snapshot_r2_key text,
  captured_at     timestamptz not null default now()
);

create table fact (
  id            bigserial primary key,
  entity_id     int not null references entity(id) on delete cascade,
  attribute_key text not null references attribute(key),
  value         jsonb not null,
  valid_from    timestamptz not null,
  valid_to      timestamptz,
  method        text not null check (method in ('api','deterministic','llm_extract','human')),
  confidence    real not null default 1,
  evidence_id   bigint references evidence(id),
  verified_at   timestamptz,
  superseded_by bigint references fact(id),
  check (valid_to is null or valid_to > valid_from),
  check (method <> 'llm_extract' or evidence_id is not null)
);
-- §8.3: one open value per (entity, attribute)
create unique index fact_open_uniq on fact (entity_id, attribute_key) where valid_to is null;

create table insight (
  id              bigserial primary key,
  entity_ids      int[] not null,
  claim_en        text not null,
  claim_zh        text,
  context         text,
  author          text,
  evidence_id     bigint references evidence(id),
  reported_effect text,
  evidence_level  text not null default 'E0' check (evidence_level in ('E0','E1','E2','E3')),
  created_at      timestamptz not null default now()
);

-- Releases and API changes -------------------------------------------------

create table release (
  id             bigserial primary key,
  entity_id      int not null references entity(id) on delete cascade,
  version        text not null,
  semver         jsonb,
  released_at    timestamptz,
  notes_md       text,
  source_url     text,
  is_breaking    boolean not null default false,
  is_prerelease  boolean not null default false,
  unique (entity_id, version)
);

-- Per-version symbol snapshot produced by the .d.ts extractor.
create table api_symbol (
  package    text not null,
  version    text not null,
  symbol     text not null,
  kind       text not null,
  signature  text not null,
  deprecated text,
  primary key (package, version, symbol)
);

-- Ordered list of versions we have snapshotted per package.
create table api_version (
  package     text not null,
  version     text not null,
  seq         int not null,
  label       text not null,
  released_at timestamptz,
  primary key (package, version),
  unique (package, seq)
);

create table api_change (
  id           bigserial primary key,
  package      text not null,
  symbol       text not null,
  kind         text not null check (kind in (
                 'added','removed','renamed','signature_changed','deprecated','behavior_changed')),
  from_version text,
  to_version   text not null,
  before_sig   text,
  after_sig    text,
  migration_md text,
  method       text not null check (method in ('dts_diff','notes_llm','human')),
  evidence_id  bigint references evidence(id),
  confidence   real not null default 1,
  unique (package, symbol, kind, to_version)
);
create index api_change_symbol_idx on api_change (package, symbol);

-- Graph --------------------------------------------------------------------

create table relation (
  id          bigserial primary key,
  src_id      int not null references entity(id) on delete cascade,
  dst_id      int not null references entity(id) on delete cascade,
  type        text not null check (type in (
                'implements','alternative_to','depends_on','built_with','supersedes','paper_of',
                'code_of','weights_of','fork_of','integrates_with','made_by')),
  evidence_id bigint references evidence(id),
  confidence  real not null default 1,
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  unique (src_id, dst_id, type)
);

create table capability (
  id        serial primary key,
  slug      text not null unique,
  parent_id int references capability(id),
  name_en   text not null,
  name_zh   text not null
);

create table entity_capability (
  entity_id     int not null references entity(id) on delete cascade,
  capability_id int not null references capability(id),
  role          text not null default 'provides' check (role in ('provides','uses')),
  evidence_id   bigint references evidence(id),
  primary key (entity_id, capability_id, role)
);

-- Media and demos ----------------------------------------------------------

create table media (
  id           bigserial primary key,
  entity_id    int not null references entity(id) on delete cascade,
  kind         text not null check (kind in ('image','video','gif','glb')),
  origin       text not null check (origin in ('ours','official','third_party')),
  original_url text,
  r2_key       text,
  width        int,
  height       int,
  attribution  text,
  captured_at  timestamptz not null default now()
);

create table demo (
  id              bigserial primary key,
  entity_id       int not null references entity(id) on delete cascade,
  url             text not null unique,
  requires        text[] not null default '{}',
  status          text not null default 'unchecked',
  last_checked_at timestamptz
);

create table demo_check (
  id                  bigserial primary key,
  demo_id             bigint not null references demo(id) on delete cascade,
  checked_at          timestamptz not null default now(),
  renderer            text not null check (renderer in ('swiftshader','gpu')),
  loaded              boolean not null,
  console_errors      int not null default 0,
  first_frame_ms      int,
  fps_p50             real,
  screenshot_media_id bigint references media(id),
  fingerprint         jsonb not null default '{}'
);

-- Operations ---------------------------------------------------------------

create table query_log (
  id            bigserial primary key,
  channel       text not null check (channel in ('web','rest','mcp')),
  query         text not null,
  filters       jsonb not null default '{}',
  result_count  int not null,
  top_entity_id int references entity(id),
  client        text,
  created_at    timestamptz not null default now()
);

create table review_task (
  id          bigserial primary key,
  entity_id   int references entity(id) on delete cascade,
  reason      text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open','accepted','rejected')),
  assignee    text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
