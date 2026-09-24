// DJ Sorter — Cloudflare Worker
// /api/health    — ping (фронт проверяет, есть ли бэкенд)
// /api/features  — прокси к ReccoBeats (BPM/key/energy по Spotify ID), снимает CORS
// /api/classify  — разметка треков через Jev (Workers AI, typesafe/jev)
// всё остальное — статика из ./public

const JEV_MODEL = 'typesafe/jev';

// Вопросы к Jev. Меняешь здесь — меняется разметка (кэш на фронте сбросить кнопкой Re-classify).
export const QUESTIONS = {
  mood: {
    type: 'choice',
    instructions: 'What is the dominant mood of this track?',
    criteria: {
      dark: 'Dark, tense, hypnotic',
      euphoric: 'Euphoric, uplifting, hands-in-the-air',
      groovy: 'Groovy, funky, bouncy',
      melancholic: 'Melancholic, emotional, bittersweet',
      chill: 'Chill, relaxed, laid-back',
    },
  },
  energy: {
    type: 'score',
    instructions: 'How much dancefloor energy does this track have?',
    criteria: ['Ambient / no beat', 'Low, warm-up', 'Medium, steady groove', 'High, driving', 'Peak-time banger'],
  },
  slot: {
    type: 'choice',
    instructions: 'Where in a DJ set would this track fit best?',
    criteria: {
      warmup: 'Opening / warm-up',
      build: 'Building energy',
      peak: 'Peak time',
      cooldown: 'Closing / cool-down',
    },
  },
  vocal: { type: 'noul', instructions: 'This track has prominent lead vocals.' },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function classifyOne(env, t) {
  try {
    const r = await env.AI.run(JEV_MODEL, { state: t.text, questions: QUESTIONS });
    const a = r.answers || r.result?.answers || {};
    return {
      id: t.id,
      mood: a.mood?.choice ?? null, mc: a.mood?.confidence ?? null,
      energy: a.energy?.score ?? null, // 0..4
      slot: a.slot?.choice ?? null,
      vocal: a.vocal?.noul ?? null,
    };
  } catch (e) {
    return { id: t.id, error: String(e.message || e) };
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/health') return json({ ok: true, jev: !!env.AI });

    if (url.pathname === '/api/features') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 40);
      if (!ids.length) return json({ content: [] });
      const r = await fetch('https://api.reccobeats.com/v1/audio-features?ids=' + ids.join(','), {
        headers: { accept: 'application/json' },
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/api/classify' && req.method === 'POST') {
      if (!env.AI) return json({ error: 'AI binding missing' }, 500);
      const { tracks = [] } = await req.json();
      const batch = tracks.slice(0, 25).filter(t => t && t.id && t.text).map(t => ({ id: t.id, text: String(t.text).slice(0, 600) }));
      const results = await pool(batch, 5, t => classifyOne(env, t));
      return json({ results });
    }

    return env.ASSETS.fetch(req);
  },
};
