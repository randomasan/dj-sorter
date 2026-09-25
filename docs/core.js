// DJ Sorter core: авторизация Spotify, сеть с учётом rate limit, БД, нормализация, шаги пайплайна.
// Без привязки к DOM — прогресс отдаётся через колбэк onStep(key, patch).
// Общие ключи localStorage с nerd_mode: 'tok', 'lib', 'cache.feat', 'cache.jev', 'me', 'cfg.clientId'.
(function(){
const LS = {
  get:(k,d=null)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}},
  set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}},
  del:(k)=>{try{localStorage.removeItem(k)}catch{}},
};
const CLIENT_ID = LS.get('cfg.clientId') || '38e72ce3403d4c508bbca5a7d1996798';
// Redirect всегда на корень сайта (он зарегистрирован в Spotify), страница-источник запоминается в 'returnTo'
const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
const REDIRECT = BASE;
const SCOPES = 'user-library-read';
const SB_URL = 'https://vnmdnmvogwxqloaxbenk.supabase.co';
const SB_KEY = 'sb_publishable_gMOOPy8pKjgJKaOAc-1uaQ_2MzRIg9Y';
const SB_FN  = 'super-handler';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const chunks = (a,n) => Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,i*n+n));

/* ================= music theory ================= */
const CAM_MAJ = [8,3,10,5,12,7,2,9,4,11,6,1];
const CAM_MIN = [5,12,7,2,9,4,11,6,1,8,3,10];
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function camelot(key, mode){
  if(key==null || key<0 || mode==null) return null;
  return { n: mode ? CAM_MAJ[key] : CAM_MIN[key], l: mode ? 'B' : 'A' };
}
const camStr = c => c ? `${c.n}${c.l}` : '—';
const keyName = t => t.key==null||t.key<0 ? '' : NOTES[t.key] + (t.mode ? '' : 'm');
// 0 perfect · 1 harmonic (±1 / relative) · 2 energy boost (+2) · 3 unknown · 9 clash
function keyDist(a, b){
  if(!a || !b) return 3;
  const d = Math.min((a.n-b.n+12)%12, (b.n-a.n+12)%12);
  if(a.l===b.l){ if(d===0) return 0; if(d===1) return 1; if(d===2) return 2; return 9; }
  return d===0 ? 1 : 9;
}
function bpmDiff(a, b){
  if(!a || !b) return 20;
  return Math.min(Math.abs(a-b), Math.abs(a*2-b), Math.abs(a-b*2));
}


/* ================= spotify PKCE ================= */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function randStr(n=64){ const a=new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0,n); }
async function login(returnTo){
  const verifier = randStr(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  LS.set('pkce.verifier', verifier);
  if(returnTo) LS.set('returnTo', returnTo); else LS.del('returnTo');
  const p = new URLSearchParams({client_id:CLIENT_ID,response_type:'code',redirect_uri:REDIRECT,scope:SCOPES,code_challenge_method:'S256',code_challenge:challenge});
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}
async function tokenReq(body){
  const r = await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const j = await r.json(); if(!r.ok) throw new Error('token: '+(j.error_description||j.error));
  LS.set('tok',{access:j.access_token, refresh:j.refresh_token||LS.get('tok',{}).refresh, exp:Date.now()+(j.expires_in-60)*1000});
}
// возвращает true, если только что обменяли code на токен
async function handleCallback(){
  const p = new URLSearchParams(location.search);
  if(p.get('error')) throw new Error('Spotify: '+p.get('error'));
  if(!p.get('code')) return false;
  await tokenReq({client_id:CLIENT_ID,grant_type:'authorization_code',code:p.get('code'),redirect_uri:REDIRECT,code_verifier:LS.get('pkce.verifier')});
  history.replaceState(null,'',location.pathname);
  const back = LS.get('returnTo'); LS.del('returnTo');
  if(back){ location.replace(BASE + back); }
  return true;
}
async function accessToken(){
  const t = LS.get('tok'); if(!t) return null;
  if(Date.now() < t.exp) return t.access;
  await tokenReq({client_id:CLIENT_ID,grant_type:'refresh_token',refresh_token:t.refresh});
  return LS.get('tok').access;
}
const loggedIn = () => !!LS.get('tok');
function logout(){ ['tok','lib','pkce.verifier','me'].forEach(LS.del); }

/* ================= net ================= */
const NET = { req:0, r429:0, errors:0 };
class RateLimited extends Error { constructor(wait){ super('rate limited'); this.wait=wait; } }
const GATE = { until:0 };
async function sp(url, {maxWait=60000, onWait} = {}){
  let backoff = 2000;
  for(let i=0;i<6;i++){
    const w = GATE.until - Date.now(); if(w>0) await sleep(w);
    NET.req++;
    const r = await fetch(url.startsWith('http')?url:'https://api.spotify.com/v1'+url,{headers:{Authorization:'Bearer '+await accessToken()}});
    if(r.status===429){
      NET.r429++;
      const ra = +r.headers.get('Retry-After');
      const wait = ra ? ra*1000 : backoff; backoff = Math.min(backoff*2, 30000);
      if(wait > maxWait) throw new RateLimited(wait);
      GATE.until = Date.now() + wait; onWait?.(wait);
      continue;
    }
    if(r.status===401){ logout(); throw new Error('Spotify: сессия истекла, войди заново'); }
    if(!r.ok){ NET.errors++; throw new Error(`Spotify ${r.status}`); }
    return r.json();
  }
  throw new RateLimited(backoff);
}

/* ================= normalization ================= */
// Версии/мусор в названиях: вырезаем из title_clean, а тип версии кладём отдельно
const VERSION_RX = [
  [/\b(remix|rmx|rework|re-?edit|bootleg|flip|vip)\b/i, 'remix'],
  [/\bextended\b/i, 'extended'],
  [/\b(radio|single|club|original|short|album)\s+(edit|mix|version)\b|\bedit\b/i, 'edit'],
  [/\blive\b|\bunplugged\b|\bsession\b/i, 'live'],
  [/\bremaster(ed)?\b/i, 'remaster'],
  [/\bmixed\b|\bdj mix\b/i, 'mixed'],
  [/\bacoustic\b/i, 'acoustic'],
  [/\binstrumental\b/i, 'instrumental'],
  [/\bversion\b|\bmix\b/i, 'version'],
];
function parseTitle(raw){
  let title = String(raw||''); const tags=[]; const feat=[];
  // (feat. X) / [ft. X] / feat. X в конце
  title = title.replace(/[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]/gi,(_,a)=>{feat.push(...a.split(/,|&| and /i).map(s=>s.trim()).filter(Boolean)); return '';});
  title = title.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,(_,a)=>{feat.push(...a.split(/,|&| and /i).map(s=>s.trim()).filter(Boolean)); return '';});
  // хвосты " - Radio Edit", " - Remastered 2011", " - Live from …"
  title = title.replace(/\s+[-–—]\s+(.+)$/,(m,tail)=>{ if(VERSION_RX.some(([rx])=>rx.test(tail))||/\b(19|20)\d\d\b/.test(tail)){ tags.push(tail.trim()); return ''; } return m; });
  // скобки с версиями "(Extended Mix)", "[Remastered]", "(aka ...)"
  title = title.replace(/\s*[\(\[]([^\)\]]+)[\)\]]/g,(m,inner)=>{ if(VERSION_RX.some(([rx])=>rx.test(inner))||/^aka\b|\b(19|20)\d\d\b/i.test(inner)){ tags.push(inner.trim()); return ''; } return m; });
  title = title.replace(/\s{2,}/g,' ').trim();
  let version=null; for(const tag of tags){ for(const [rx,v] of VERSION_RX){ if(rx.test(tag)){ version=v; break; } } if(version) break; }
  return {title_clean: title || String(raw||'').trim(), version, version_tag: tags.join('; ')||null, feat};
}
// Транслит: только как дополнительные варианты для поиска, не как «истина»
const CYR2LAT = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const LAT2CYR = [['shch','щ'],['iy','ий'],['yy','ый'],['sch','щ'],['yo','ё'],['yu','ю'],['ya','я'],['zh','ж'],['kh','х'],['ts','ц'],['ch','ч'],['sh','ш'],['a','а'],['b','б'],['c','к'],['d','д'],['e','е'],['f','ф'],['g','г'],['h','х'],['i','и'],['j','й'],['k','к'],['l','л'],['m','м'],['n','н'],['o','о'],['p','п'],['q','к'],['r','р'],['s','с'],['t','т'],['u','у'],['v','в'],['w','в'],['x','кс'],['y','ы'],['z','з']];
const keepCase = (src,out) => src[0]===src[0].toUpperCase() ? out.charAt(0).toUpperCase()+out.slice(1) : out;
function cyr2lat(s){ return s.replace(/[А-яЁё]+/g,w=>keepCase(w,[...w.toLowerCase()].map(c=>CYR2LAT[c]??c).join(''))); }
function lat2cyr(s){ return s.replace(/[A-Za-z]+/g,w=>{ let x=w.toLowerCase(),o=''; while(x){ const p=LAT2CYR.find(([l])=>x.startsWith(l)); if(p){o+=p[1];x=x.slice(p[0].length);} else {o+=x[0];x=x.slice(1);} } return keepCase(w,o); }); }
const deaccent = s => s.normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ø/g,'o').replace(/Ø/g,'O').replace(/æ/g,'ae').replace(/ß/g,'ss');
const hasCyr = s => /[А-яЁё]/.test(s), hasLat = s => /[A-Za-z]/.test(s);
function artistVariants(a, title=''){
  const v = new Set([a]);
  const d = deaccent(a); v.add(d);
  if(hasCyr(a)) v.add(cyr2lat(a));
  // латинское имя + кириллическое название = почти наверняка транслит русскоязычного артиста (Auktyon — «Дорога»)
  else if(hasLat(a) && hasCyr(title)) v.add(lat2cyr(d));
  return [...v];
}
function normalizeTrack(t){
  const p = parseTitle(t.name);
  const prev = t.names || {};
  t.names = {
    orig_title: t.name, orig_artists: t.artists,
    title_clean: p.title_clean, version: p.version, version_tag: p.version_tag, feat: p.feat,
    artist_variants: artistVariants(t.artists[0]||'', t.name),
    aliases: prev.aliases || [], // {src, artist, title} — как трек называется в других сервисах (пишет describe)
    v: 1,
  };
  return t.names;
}

/* ================= DB ================= */
async function sb(path){
  NET.req++;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`,{headers:{apikey:SB_KEY}});
  if(!r.ok){ NET.errors++; throw new Error(`DB ${r.status}`); }
  return r.json();
}
async function sbSync(payload){
  NET.req++;
  const r = await fetch(`${SB_URL}/functions/v1/${SB_FN}`,{method:'POST',
    headers:{apikey:SB_KEY,'content-type':'application/json','x-spotify-token':await accessToken()},
    body:JSON.stringify(payload)});
  const j = await r.json().catch(()=>({}));
  if(!r.ok){ NET.errors++; throw new Error(`sync ${r.status}: ${j.error||''}`); }
  return j;
}
const toRow = t => ({
  spotify_id:t.id, name:t.name, artists:t.artists, artist_ids:t.artistIds,
  bpm:t.bpm??null, musical_key:t.key??null, mode:t.mode??null, energy:t.energyAudio??null,
  features_checked:!!t.featChecked, jev:t.jev??null, isrc:t.isrc??null, names:t.names??null,
  updated_at:new Date().toISOString(),
});

/* ================= pipeline ================= */
// onStep(key, {status:'run'|'done'|'err'|'skip', done, total, note})
async function run(onStep, {refetch=false}={}){
  const S = (k,p) => onStep(k,p);
  let tracks = LS.get('lib'); let fresh = false;
  // 1. лайки
  if(!tracks || refetch || !tracks.every(t=>'isrc' in t)){
    const head = await sp('/me/tracks?limit=1');
    const total = head.total;
    S('likes',{status:'run',done:0,total});
    const out=[]; let url='/me/tracks?limit=50';
    while(url){
      const j = await sp(url, {onWait:w=>S('likes',{note:`Spotify просит подождать ${Math.ceil(w/1000)}с`})});
      for(const it of j.items){ const t=it.track; if(!t||!t.id) continue;
        out.push({id:t.id,name:t.name,artists:t.artists.map(a=>a.name),artistIds:t.artists.map(a=>a.id),added:it.added_at,isrc:t.external_ids?.isrc||null,dur:t.duration_ms||null}); }
      S('likes',{done:out.length,total,note:''});
      url = j.next;
    }
    tracks = out; LS.set('lib',tracks); fresh = true;
  }
  S('likes',{status:'done',done:tracks.length,total:tracks.length});

  // 2. база
  const feat = LS.get('cache.feat',{}), jev = LS.get('cache.jev',{});
  S('db',{status:'run',done:0,total:tracks.length});
  try{
    const byId = Object.fromEntries(tracks.map(t=>[t.id,t])); let seen=0, hits=0;
    for(const ids of chunks(tracks.map(t=>t.id),100)){
      const rows = await sb(`tracks?select=*&spotify_id=in.(${ids.join(',')})`);
      for(const r of rows){ const t=byId[r.spotify_id]; if(!t) continue; hits++;
        if(r.features_checked) feat[r.spotify_id] = r.bpm!=null ? {bpm:r.bpm,key:r.musical_key,mode:r.mode,energyAudio:r.energy} : null;
        if(r.jev && !jev[r.spotify_id]) jev[r.spotify_id]=r.jev;
        if(r.ai) t.ai=r.ai;
        if(r.names?.aliases?.length) t.names={...(t.names||{}),aliases:r.names.aliases}; }
      seen+=ids.length; S('db',{done:seen,note:`уже знаем ${hits}`});
    }
    LS.set('cache.feat',feat); LS.set('cache.jev',jev);
    tracks.forEach(t=>{ if(jev[t.id]) t.jev=jev[t.id]; });
    S('db',{status:'done',note:`уже знаем ${hits} из ${tracks.length}`});
  }catch(e){ S('db',{status:'err',note:e.message}); }

  // 3. нормализация
  S('norm',{status:'run',done:0,total:tracks.length});
  tracks.forEach(normalizeTrack);
  S('norm',{status:'done',done:tracks.length,note:`ISRC у ${tracks.filter(t=>t.isrc).length}`});

  // 4. BPM / тональность (ReccoBeats)
  const todo = tracks.filter(t=>!(t.id in feat)).map(t=>t.id);
  S('feat',{status:'run',done:tracks.length-todo.length,total:tracks.length});
  let fails=0;
  for(let i=0;i<todo.length;i+=40){
    const ids = todo.slice(i,i+40);
    try{
      NET.req++;
      const r = await fetch('https://api.reccobeats.com/v1/audio-features?ids='+ids.join(','));
      if(r.status===429){ await sleep(5000); i-=40; continue; }
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      for(const f of (j.content||[])){ const sid=(f.href||'').split('/track/')[1]?.split('?')[0];
        if(sid) feat[sid]={bpm:f.tempo?Math.round(f.tempo):null,key:f.key??null,mode:f.mode??null,energyAudio:f.energy??null}; }
      ids.forEach(id=>{ if(!(id in feat)) feat[id]=null; });
    }catch(e){ NET.errors++; if(++fails>=3) break; }
    S('feat',{done:Math.min(tracks.length, tracks.length-todo.length+i+40)});
  }
  LS.set('cache.feat',feat);
  tracks.forEach(t=>{ Object.assign(t, feat[t.id]||{}); t.featChecked = t.id in feat; });
  S('feat',{status:fails>=3?'err':'done',done:tracks.length,note:`BPM у ${tracks.filter(t=>t.bpm).length}`});

  // 5. сохранение (если ничего нового не узнали — не гоняем всю библиотеку в базу повторно)
  LS.set('lib',tracks);
  if(!fresh && !todo.length && LS.get('me')){ S('save',{status:'skip',done:0,total:0,note:'без изменений'}); return tracks; }
  S('save',{status:'run',done:0,total:tracks.length});
  try{
    let saved=0;
    for(const part of chunks(tracks.map(toRow),500)){ saved += (await sbSync({tracks:part})).saved||0; S('save',{done:saved}); }
    const j = await sbSync({liked_ids:tracks.map(t=>t.id)}); LS.set('me',{id:j.user,name:j.display_name});
    S('save',{status:'done',done:tracks.length});
  }catch(e){ S('save',{status:'err',note:e.message}); }
  return tracks;
}

window.DJ = { LS, NET, login, logout, handleCallback, accessToken, loggedIn, run,
  camelot, camStr, keyName, normalizeTrack, BASE };
})();
