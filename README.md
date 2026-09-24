# 🎧 DJ Sorter

Сортировщик лайкнутых треков Spotify по BPM, тональности и энергии и автоподбор DJ-сета. Жанры не используем. Разметка треков делается через [Jev](https://docs.typesafe.ai) (TypeSafe AI), модель запускается в Cloudflare Workers AI.

## Что умеет (MVP)

- Логин в Spotify через PKCE, без своего сервера для OAuth.
- Все лайкнутые треки.
- **Library**: сортировка по BPM, тональности (Camelot), энергии, mood, слоту в сете, артисту, дате лайка.
- **DJ**: последовательный сет от случайного трека. Учитывает BPM (с half/double time), совместимость по Camelot, mood и кривую энергии. **Renew** собирает новый сет.
- **Generator**: заглушка. Собирает промпт из контекста DJ-сета, саму генерацию подключим позже.

## Откуда данные

| Что | Источник |
|---|---|
| Лайки | Spotify Web API |
| BPM, тональность, energy | [ReccoBeats](https://reccobeats.com) по Spotify ID (audio-features Spotify закрыт для новых приложений) |
| Mood, энергия, слот, вокал | **Jev** (`typesafe/jev` в Workers AI), вопросы задаются в `src/worker.js` → `QUESTIONS` |

Jev не слушает аудио, он судит по названию, артисту и BPM. Там, где Jev не уверен (confidence < 0.5), в списке стоит `?`.

## Структура

```
docs/index.html   — весь фронт (vanilla JS)
src/worker.js       — /api/health, /api/features (прокси ReccoBeats), /api/classify (Jev)
wrangler.jsonc      — конфиг Cloudflare Worker (static assets + AI binding)
```

## Деплой (Cloudflare, из GitHub)

1. Зайди на dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
2. Подключи GitHub и выбери репозиторий `dj-sorter`.
3. Build command оставь пустым, deploy command: `npx wrangler deploy`. Нажми **Deploy**.
4. Получишь адрес `https://dj-sorter.<account>.workers.dev`. Каждый push в `main` деплоится автоматически.

## Spotify

1. На developer.spotify.com/dashboard → **Create app** выбери Web API.
2. В **Redirect URIs** добавь адрес из шага 4 со слэшем в конце: `https://dj-sorter.<account>.workers.dev/`.
3. Скопируй **Client ID** и вставь его на сайте в ⚙️ Настройки.
4. Пока приложение в Development mode, войти могут только пользователи, добавленные в **User Management**.

## Локально

```bash
npm i
npx wrangler dev   # http://localhost:8787 (Workers AI вызывается удалённо, нужен логин wrangler)
```

Для Spotify redirect локально используй `http://127.0.0.1:8787/`: Spotify не принимает `localhost`.

Если открыть `docs/index.html` без Worker, работают Spotify и ReccoBeats напрямую, а Jev выключается.

## Настройка Jev

Варианты mood, слоты и шкалу энергии правь в `src/worker.js` → `QUESTIONS`. После изменения нажми на сайте **Re-classify (Jev)**. Цена: платятся только входные токены, библиотека в 1000 треков стоит около цента.

## База (Supabase)

Две таблицы: `tracks` хранит спарсенные треки с параметрами (общие для всех), `users` хранит пользователей и их лайки. Схема лежит в `db/schema.sql`.

Доступ:
- `tracks` публичный ключ может только **читать**;
- `users` публичному ключу не видна вообще;
- **писать** в обе таблицы может только Edge Function `sync` (`supabase/functions/sync`). Она проверяет Spotify-токен пользователя через `/v1/me` и пишет service-ключом. Пользователь может записать только свою строку в `users`.

Настройка:
1. На supabase.com создай проект, регион Frankfurt.
2. Открой **SQL Editor**, вставь `db/schema.sql` целиком и нажми **Run**.
3. **Edge Functions** → **Deploy a new function** → **Via Editor**. Имя `sync`, код возьми из `supabase/functions/sync/index.ts` → **Deploy**.
4. В настройках функции `sync` выключи **Verify JWT** (enforce JWT verification): доступ проверяется по Spotify-токену.
5. В **Project Settings → API Keys** скопируй Project URL и publishable key в `docs/index.html` → `SB_URL`, `SB_KEY`. Слаг функции (последний кусок её URL) впиши в `SB_FN`.

Без ключей приложение работает как раньше, только на localStorage.

## AI-описание трека (Edge Function `describe`)

Берёт 30-секундное превью трека из Deezer (по ISRC, иначе поиском), отдаёт его Gemini: модель слушает аудио и возвращает JSON с описанием, инструментами, вокалом, mood, энергией, слотом и заметками по сведению. Результат пишется в `tracks.ai`.

1. В SQL Editor выполни `alter table tracks add column if not exists ai jsonb;` (строка уже есть в конце `db/schema.sql`).
2. В **Edge Functions → Secrets** добавь `GEMINI_API_KEY`. Опционально `GEMINI_MODEL`, по умолчанию функция пробует gemini-3.8-flash → 3-flash → 2.5-flash.
3. Задеплой `supabase/functions/describe/index.ts` через редактор и выключи Verify JWT.
4. Впиши слаг функции в `docs/index.html` → `SB_DESCRIBE_FN`.
5. На сайте нажми кнопку «🔬 AI-описание: 10 треков».
