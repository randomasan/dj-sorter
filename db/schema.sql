-- DJ Sorter — Supabase schema (вставить целиком в SQL Editor → Run; можно запускать повторно)

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
  jev              jsonb,
  updated_at       timestamptz default now()
);

create table if not exists users (
  spotify_id   text primary key,
  display_name text,
  liked_ids    text[],
  created_at   timestamptz default now(),
  last_seen    timestamptz default now()
);

-- Доступ:
--   tracks: публичный ключ может только ЧИТАТЬ (это общий кэш параметров треков)
--   users:  публичный ключ не видит вообще
--   запись в обе таблицы — только Edge Function `sync` (service role), после проверки Spotify-токена
alter table tracks enable row level security;
alter table users  enable row level security;

drop policy if exists open_all    on tracks;
drop policy if exists open_all    on users;
drop policy if exists public_read on tracks;
create policy public_read on tracks for select using (true);

revoke all on tracks, users from anon, authenticated;
grant select on tracks to anon, authenticated;

-- Жанры/стили выпилены. Если таблица создана старой версией схемы — колонки можно удалить
-- (ПОСЛЕ передеплоя функции sync новой версией):
-- alter table tracks drop column if exists genres, drop column if exists styles;
