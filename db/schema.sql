-- DJ Sorter — Supabase schema (вставить целиком в SQL Editor → Run)

create table if not exists tracks (
  spotify_id       text primary key,
  name             text,
  artists          text[],
  artist_ids       text[],
  bpm              int,
  musical_key      int,          -- 0..11 (C..B), как в Spotify
  mode             int,          -- 1 major, 0 minor
  energy           real,         -- 0..1 (ReccoBeats)
  features_checked boolean default false,  -- ReccoBeats уже спрашивали (даже если не нашёл)
  genres           text[],       -- null = ещё не тянули, {} = жанров нет
  styles           text[],
  jev              jsonb,
  updated_at       timestamptz default now()
);

create table if not exists users (
  spotify_id   text primary key,
  display_name text,
  liked_ids    text[],           -- лайки пользователя (порядок = как в Spotify)
  created_at   timestamptz default now(),
  last_seen    timestamptz default now()
);

-- MVP: открытый доступ для публичного ключа (фронт статический, своей авторизации нет)
alter table tracks enable row level security;
alter table users  enable row level security;
drop policy if exists open_all on tracks;
drop policy if exists open_all on users;
create policy open_all on tracks for all using (true) with check (true);
create policy open_all on users  for all using (true) with check (true);
grant select, insert, update on tracks, users to anon;
