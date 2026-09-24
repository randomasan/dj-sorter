// Supabase Edge Function: describe
// Трек → 30-сек превью Deezer → Gemini (слушает аудио) → структурированное описание (JSON) → tracks.ai
// Секреты: GEMINI_API_KEY (обязательно), GEMINI_MODEL (опционально)
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-spotify-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "content-type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// первая модель, которая ответит не 404, запоминается
const MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-3.8-flash", "gemini-3-flash", "gemini-2.5-flash"].filter(Boolean) as string[];
let MODEL_OK: string | null = null;

const ID = /^[A-Za-z0-9]{10,40}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

const PROMPT = `You are a DJ assistant. Listen to this 30-second preview and describe the MUSIC itself (not metadata).
Be concrete about sound. Do not name genres. Return JSON only.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING", description: "2-3 sentences: sound, groove, arrangement, atmosphere" },
    instruments: { type: "ARRAY", items: { type: "STRING" } },
    vocals: { type: "STRING", description: "none | male | female | mixed | spoken | chopped samples; plus language if clear" },
    mood: { type: "ARRAY", items: { type: "STRING" }, description: "2-4 mood words" },
    energy: { type: "NUMBER", description: "0..1 dancefloor energy" },
    danceability: { type: "NUMBER", description: "0..1" },
    tempo_bpm: { type: "NUMBER", description: "estimated tempo" },
    key: { type: "STRING", description: "estimated key like 'A minor', or 'unclear'" },
    dj_slot: { type: "STRING", enum: ["warmup", "build", "peak", "cooldown", "not for dancefloor"] },
    mix_notes: { type: "STRING", description: "one line: intro/outro feel, how to mix in/out" },
  },
  required: ["description", "instruments", "vocals", "mood", "energy", "danceability", "dj_slot"],
};

const UA = { "user-agent": "Mozilla/5.0 (DJ Sorter; +https://randomasan.github.io/dj-sorter/)", accept: "application/json" };
const clean = (s: string) => String(s ?? "").replace(/\s*[-–(\[].*$/, "").trim();

// Ищем 30-сек превью: Deezer (ISRC → точный поиск → простой поиск) → iTunes. Возвращаем и диагностику.
// deno-lint-ignore no-explicit-any
async function findPreview(t: any) {
  const log: string[] = [];
  const artist = t.artists?.[0] ?? "", title = clean(t.name);
  // deno-lint-ignore no-explicit-any
  const dz = async (url: string, tag: string): Promise<any> => {
    try {
      const r = await fetch(url, { headers: UA });
      const j = await r.json();
      if (j?.error) { log.push(`${tag}: ${j.error.type ?? ""} ${j.error.message ?? ""}`.trim()); return null; }
      const hit = j?.data ? j.data[0] : j;
      if (hit?.preview) return { src: "deezer", id: hit.id, preview: hit.preview, via: tag };
      log.push(`${tag}: ${r.status} ${j?.data ? `${j.data.length} hits` : "no preview"}`);
    } catch (e) { log.push(`${tag}: ${(e as Error).message}`); }
    return null;
  };
  let hit = null;
  if (t.isrc && ISRC.test(t.isrc)) hit = await dz(`https://api.deezer.com/track/isrc:${t.isrc}`, "dz-isrc");
  hit ??= await dz(`https://api.deezer.com/search?limit=1&q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}`, "dz-strict");
  hit ??= await dz(`https://api.deezer.com/search?limit=1&q=${encodeURIComponent(`${artist} ${title}`)}`, "dz-loose");
  if (!hit) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=1&term=${encodeURIComponent(`${artist} ${title}`)}`, { headers: UA });
      const j = await r.json();
      const it = j?.results?.[0];
      if (it?.previewUrl) hit = { src: "itunes", id: it.trackId, preview: it.previewUrl, via: "itunes" };
      else log.push(`itunes: ${r.status} ${j?.resultCount ?? "?"} hits`);
    } catch (e) { log.push(`itunes: ${(e as Error).message}`); }
  }
  return { hit, log };
}

async function gemini(b64: string, mime: string) {
  const models = MODEL_OK ? [MODEL_OK] : MODELS;
  let last = "";
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
      }),
    });
    if (r.status === 404) { last = `model ${m} not found`; continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`gemini ${r.status}: ${j?.error?.message ?? ""}`.slice(0, 200));
    MODEL_OK = m;
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return { model: m, data: JSON.parse(text) };
  }
  throw new Error(last || "no gemini model available");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!GEMINI_KEY) return json({ error: "GEMINI_API_KEY secret is not set" }, 500);
  try {
    // тот же пропуск, что и в sync: живой Spotify-токен
    const tok = req.headers.get("x-spotify-token");
    if (!tok) return json({ error: "missing x-spotify-token" }, 401);
    const me = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tok}` } });
    if (me.status === 429) return json({ error: "spotify rate limit" }, 503);
    if (!me.ok) return json({ error: "spotify auth failed" }, 401);

    const { tracks = [] } = await req.json();
    // deno-lint-ignore no-explicit-any
    const batch = (tracks as any[]).filter((t) => t && ID.test(t.id ?? "")).slice(0, 5);
    const results = [];
    for (const t of batch) {
      try {
        const { hit, log } = await findPreview(t);
        if (!hit) { results.push({ id: t.id, error: `no preview (${log.join(" | ")})` }); continue; }
        const audio = await fetch(hit.preview, { headers: UA });
        if (!audio.ok) { results.push({ id: t.id, error: `preview ${hit.src} ${audio.status}` }); continue; }
        const mime = (audio.headers.get("content-type") ?? "").split(";")[0] || (hit.src === "itunes" ? "audio/mp4" : "audio/mpeg");
        const b64 = encodeBase64(new Uint8Array(await audio.arrayBuffer()));
        const g = await gemini(b64, mime.startsWith("audio/") ? mime : "audio/mpeg");
        const ai = { ...g.data, _model: g.model, _src: hit.src, _src_id: hit.id, _via: hit.via, _at: new Date().toISOString() };
        const { error } = await db.from("tracks").update({ ai }).eq("spotify_id", t.id);
        results.push({ id: t.id, ai, saved: !error, db_error: error?.message });
      } catch (e) {
        results.push({ id: t.id, error: String((e as Error)?.message ?? e) });
      }
    }
    return json({ results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
