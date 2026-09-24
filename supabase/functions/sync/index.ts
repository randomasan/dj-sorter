// Supabase Edge Function: sync
// Единственная точка записи в БД. Проверяет Spotify-токен пользователя (через /v1/me)
// и пишет service-ключом: треки → tracks, лайки → users (только в строку самого пользователя).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-spotify-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "content-type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const ID = /^[A-Za-z0-9]{10,40}$/;
const strArr = (a: unknown, max = 20) =>
  Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, max).map((x) => (x as string).slice(0, 200)) : null;
const num = (x: unknown, lo: number, hi: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanTrack(t: any) {
  if (!t || typeof t.spotify_id !== "string" || !ID.test(t.spotify_id)) return null;
  return {
    spotify_id: t.spotify_id,
    name: typeof t.name === "string" ? t.name.slice(0, 300) : null,
    artists: strArr(t.artists),
    artist_ids: strArr(t.artist_ids),
    bpm: num(t.bpm, 30, 300),
    musical_key: num(t.musical_key, 0, 11),
    mode: num(t.mode, 0, 1),
    energy: num(t.energy, 0, 1),
    features_checked: t.features_checked === true,
    jev: t.jev && typeof t.jev === "object" && JSON.stringify(t.jev).length < 2000 ? t.jev : null,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // 1) кто это? — спрашиваем у Spotify
    const tok = req.headers.get("x-spotify-token");
    if (!tok) return json({ error: "missing x-spotify-token" }, 401);
    const me = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tok}` } });
    if (me.status === 429) return json({ error: "spotify rate limit" }, 503);
    if (!me.ok) return json({ error: "spotify auth failed" }, 401);
    const user = await me.json();

    const body = await req.json();
    const out: Record<string, unknown> = { user: user.id, display_name: user.display_name ?? user.id };

    // 2) треки (общий кэш)
    if (Array.isArray(body.tracks)) {
      const rows = body.tracks.slice(0, 1000).map(cleanTrack).filter(Boolean);
      if (rows.length) {
        const { error } = await db.from("tracks").upsert(rows, { onConflict: "spotify_id" });
        if (error) throw error;
      }
      out.saved = rows.length;
    }

    // 3) пользователь — только его собственная строка
    if (Array.isArray(body.liked_ids)) {
      const liked = body.liked_ids.filter((x: unknown) => typeof x === "string" && ID.test(x)).slice(0, 20000);
      const { error } = await db.from("users").upsert(
        { spotify_id: user.id, display_name: user.display_name ?? user.id, liked_ids: liked, last_seen: new Date().toISOString() },
        { onConflict: "spotify_id" },
      );
      if (error) throw error;
      out.liked = liked.length;
    }
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
