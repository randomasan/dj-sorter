# 🎧 DJ Sorter

Сортировщик лайкнутых треков Spotify и автоподбор DJ-сета. Разметка треков делается через [Jev](https://docs.typesafe.ai) (TypeSafe AI), модель запускается в Cloudflare Workers AI.

## Что умеет (MVP)

- Логин в Spotify через PKCE, без своего сервера для OAuth.
- Все лайкнутые треки.
- **Library**: сортировка по жанру, тональности (Camelot), BPM, энергии, mood, слоту в сете, стилю артиста, артисту, дате лайка.
- **DJ**: последовательный сет от случайного трека. Учитывает BPM (с half/double time), совместимость по Camelot, жанр и mood, по желанию ведёт кривую энергии. **Renew** собирает новый сет.
- **Generator**: заглушка. Собирает промпт из контекста DJ-сета, саму генерацию подключим позже.

## Откуда данные

| Что | Источник |
|---|---|
| Лайки, жанры артистов | Spotify Web API |
| BPM, тональность, energy | [ReccoBeats](https://reccobeats.com) по Spotify ID (audio-features Spotify закрыт для новых приложений) |
| Жанр-корзина, mood, энергия, слот, вокал | **Jev** (`typesafe/jev` в Workers AI), вопросы задаются в `src/worker.js` → `QUESTIONS` |
| Стили артиста (опционально) | Last.fm top tags |

Jev не слушает аудио, он судит по названию, артисту, жанрам и BPM. Там, где Jev не уверен (confidence < 0.5), в списке стоит `?`.

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

Корзины жанров, mood и шкалу энергии правь в `src/worker.js` → `QUESTIONS`. После изменения нажми на сайте **Re-classify (Jev)**. Цена: платятся только входные токены, библиотека в 1000 треков стоит около цента.

## База (Supabase)

Две таблицы: `tracks` хранит спарсенные треки с параметрами (общие для всех пользователей), `users` хранит пользователей и их лайки. Схема лежит в `db/schema.sql`.

1. На supabase.com создай проект, регион Frankfurt.
2. Открой **SQL Editor**, вставь `db/schema.sql` целиком и нажми **Run**.
3. В **Project Settings → API** скопируй Project URL и publishable (anon) key в `docs/index.html` → `SB_URL`, `SB_KEY`.

Без ключей приложение работает как раньше, только на localStorage.
