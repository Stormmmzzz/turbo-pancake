-- Tempo Chess Improvement: PostgreSQL / Supabase starter schema
-- Apply after enabling Supabase Auth. All user-owned tables use auth.uid() ownership.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  chesscom_username text,
  lichess_username text,
  rapid_rating integer,
  blitz_rating integer,
  bullet_rating integer,
  preferred_time_class text default 'rapid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.linked_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('chesscom', 'lichess')),
  provider_username text not null,
  provider_user_id text,
  auth_type text not null default 'public_read_only',
  last_synced_at timestamptz,
  sync_cursor text,
  sync_status text not null default 'idle',
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'pgn' check (provider in ('chesscom', 'lichess', 'pgn', 'manual')),
  provider_game_id text,
  source_url text,
  white_username text,
  black_username text,
  user_color char(1) not null check (user_color in ('w','b')),
  white_rating integer,
  black_rating integer,
  user_rating integer,
  result text not null check (result in ('win','loss','draw','unknown')),
  pgn text not null,
  start_at timestamptz,
  end_at timestamptz,
  time_class text,
  time_control text,
  eco_code text,
  opening_name text,
  ply_count integer not null default 0,
  import_hash text,
  imported_at timestamptz not null default now(),
  unique (user_id, provider, provider_game_id)
);
create index if not exists games_user_start_idx on public.games(user_id, start_at desc);
create index if not exists games_user_opening_idx on public.games(user_id, opening_name);
create index if not exists games_user_result_idx on public.games(user_id, result);
create unique index if not exists games_user_import_hash_idx on public.games(user_id, import_hash) where import_hash is not null;

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  ply integer not null,
  fullmove_number integer not null,
  color char(1) not null check (color in ('w','b')),
  san text not null,
  uci text,
  from_square char(2),
  to_square char(2),
  fen_before text not null,
  fen_after text not null,
  clock_ms integer,
  comment text,
  unique (game_id, ply)
);
create index if not exists game_moves_game_ply_idx on public.game_moves(game_id, ply);

create table if not exists public.engine_analyses (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  engine_name text not null default 'Stockfish',
  engine_version text,
  engine_build text,
  depth integer not null,
  multipv integer not null default 1,
  analysis_status text not null default 'queued' check (analysis_status in ('queued','running','complete','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  average_centipawn_loss numeric(8,2),
  estimated_accuracy numeric(5,2),
  phase_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists engine_analyses_game_idx on public.engine_analyses(game_id, created_at desc);

create table if not exists public.move_analyses (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.engine_analyses(id) on delete cascade,
  game_move_id uuid not null references public.game_moves(id) on delete cascade,
  eval_before_cp integer,
  eval_after_cp integer,
  eval_delta_cp integer,
  best_move_uci text,
  principal_variation text,
  move_class text check (move_class in ('best','excellent','good','inaccuracy','mistake','blunder','book','forced')),
  phase text check (phase in ('opening','middlegame','endgame')),
  motif text,
  explanation text,
  explanation_model text,
  created_at timestamptz not null default now(),
  unique (analysis_id, game_move_id)
);
create index if not exists move_analyses_class_idx on public.move_analyses(move_class, motif);

create table if not exists public.mistake_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  game_move_id uuid references public.game_moves(id) on delete set null,
  analysis_id uuid references public.engine_analyses(id) on delete set null,
  fen text not null,
  pgn_fragment text,
  played_move_uci text,
  played_move_san text,
  best_move_uci text,
  best_move_san text,
  principal_variation text,
  motif text,
  severity text not null check (severity in ('inaccuracy','mistake','blunder','missed_win')),
  centipawn_loss integer,
  coach_explanation text,
  source text not null default 'game_analysis',
  due_at timestamptz not null default now(),
  interval_days numeric(8,2) not null default 0,
  ease_factor numeric(4,2) not null default 2.50,
  repetitions integer not null default 0,
  last_reviewed_at timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mistake_due_idx on public.mistake_positions(user_id, due_at) where suspended = false;
create index if not exists mistake_theme_idx on public.mistake_positions(user_id, motif, severity);

create table if not exists public.opening_repertoire (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  color char(1) not null check (color in ('w','b')),
  eco_code text,
  opening_name text not null,
  start_fen text not null,
  moves_uci text[] not null default '{}',
  moves_san text[] not null default '{}',
  games_played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  average_opponent_rating integer,
  peer_bracket text,
  due_at timestamptz,
  interval_days numeric(8,2) not null default 0,
  ease_factor numeric(4,2) not null default 2.50,
  repetitions integer not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, color, opening_name, eco_code)
);
create index if not exists opening_repertoire_due_idx on public.opening_repertoire(user_id, due_at);

create table if not exists public.srs_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('mistake_position','opening_line','endgame_pattern','tactical_pattern')),
  item_id uuid not null,
  grade text not null check (grade in ('again','hard','good','easy')),
  response_ms integer,
  was_correct boolean not null,
  previous_interval_days numeric(8,2),
  next_interval_days numeric(8,2),
  previous_due_at timestamptz,
  next_due_at timestamptz,
  reviewed_at timestamptz not null default now()
);
create index if not exists srs_reviews_user_reviewed_idx on public.srs_reviews(user_id, reviewed_at desc);

create table if not exists public.tactical_puzzles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  source text not null check (source in ('mistake_bank','curated','imported')),
  source_mistake_id uuid references public.mistake_positions(id) on delete set null,
  fen text not null,
  side_to_move char(1) not null check (side_to_move in ('w','b')),
  solution_uci text[] not null,
  solution_san text[] not null,
  motifs text[] not null default '{}',
  difficulty integer,
  rating integer,
  created_at timestamptz not null default now()
);
create index if not exists tactical_puzzles_user_idx on public.tactical_puzzles(user_id, created_at desc);

create table if not exists public.daily_study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_date date not null,
  total_minutes integer not null default 15,
  generated_from jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, plan_date)
);
create index if not exists daily_plan_user_date_idx on public.daily_study_plans(user_id, plan_date desc);

create table if not exists public.study_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.daily_study_plans(id) on delete cascade,
  task_type text not null check (task_type in ('mistake_review','opening_recall','tactical_puzzles','endgame_drill','sparring')),
  title text not null,
  description text,
  target_item_ids uuid[] not null default '{}',
  allocated_minutes integer not null,
  sort_order integer not null,
  completed_at timestamptz
);

create table if not exists public.player_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  event_type text not null,
  phase text,
  motif text,
  clock_remaining_ms integer,
  move_think_ms integer,
  centipawn_loss integer,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists telemetry_user_time_idx on public.player_telemetry(user_id, occurred_at desc);
create index if not exists telemetry_user_phase_idx on public.player_telemetry(user_id, phase, motif);

-- Enable Row Level Security on user-owned records. Add matching SELECT/INSERT/UPDATE/DELETE
-- policies in Supabase before deploying; the local MVP does not connect to this database.
alter table public.profiles enable row level security;
alter table public.linked_accounts enable row level security;
alter table public.games enable row level security;
alter table public.game_moves enable row level security;
alter table public.engine_analyses enable row level security;
alter table public.move_analyses enable row level security;
alter table public.mistake_positions enable row level security;
alter table public.opening_repertoire enable row level security;
alter table public.srs_reviews enable row level security;
alter table public.tactical_puzzles enable row level security;
alter table public.daily_study_plans enable row level security;
alter table public.study_plan_tasks enable row level security;
alter table public.player_telemetry enable row level security;
