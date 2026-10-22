// Nume de iteme in alte limbi: OCR-ul citeste numele localizat, iar preturile vin
// de la poe.ninja pe nume englezesti. Sursa e lista oficiala de trade (data/static),
// care are ID-uri identice in toate limbile => potrivire exacta, fara ghicit.
// Aici stau doar functiile pure (normalizare + construirea hartii), ca sa poata fi
// testate fara Electron; datele sunt scrise de tools/build-names.js.

// Limba jocului -> codul de fisier. "en" nu are nevoie de fisier.
const GAME_LANGS = ["en", "de", "fr", "es", "pt", "ru", "ja", "ko", "th"];
// subdomeniul oficial al site-ului de trade pentru fiecare limba
const TRADE_HOSTS = {
  en: "www", de: "de", fr: "fr", es: "es",
  pt: "br", ru: "ru", ja: "jp", ko: "kr", th: "th",
};
// valorile posibile din configul jocului (poe2_production_Config.ini, [LANGUAGE])
const CLIENT_LANG_NAMES = {
  english: "en", german: "de", french: "fr", spanish: "es", portuguese: "pt",
  russian: "ru", japanese: "ja", korean: "ko", thai: "th",
};
// Citeste limba clientului din configul jocului ("language=fr" / "language=German").
function parseClientLang(text) {
  const m = String(text || "").match(/^[ \t]*language[ \t]*=[ \t]*([A-Za-z-]+)[ \t]*$/m);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v.slice(0, 2) === "pt") return "pt";   // pt-br / pt-pt
  if (GAME_LANGS.includes(v)) return v;
  const code = CLIENT_LANG_NAMES[v];
  return code && GAME_LANGS.includes(code) ? code : null;
}

// Numele afisat de Windows OCR difera de cel din API prin spatii/diacritice.
// normalize("NFKD") + eliminarea semnelor => "Chaossphäre" == "chaossphare",
// iar literele non-latine (chirilice, CJK, thai) ramin intacte.
// Apostroful dispare lipit, ca sa semene cu matchKey din main.js.
function normU(s) {
  return String(s == null ? "" : s)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`\u00b4]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// en / loc = [{ id, entries: [{ id, text }] }] (exact formatul din
// https://<host>/api/trade2/data/static). ID-ul e comun intre limbi, deci perechea
// e sigura; textele identice (nume netraduse) nu se pun in harta.
function buildLookup(enGroups, locGroups) {
  const enById = new Map();
  for (const g of enGroups || []) {
    for (const e of g.entries || []) {
      if (e && e.id && e.text) enById.set(g.id + "/" + e.id, e.text);
    }
  }
  const map = {};
  const rev = {};   // nume englezesc -> nume localizat (pt afisarea in limba UI)
  const missing = [];
  const conflicts = [];
  for (const g of locGroups || []) {
    for (const e of g.entries || []) {
      if (!e || !e.id || !e.text) continue;
      const key = g.id + "/" + e.id;
      const en = enById.get(key);
      if (!en) { missing.push(key); continue; }
      const k = normU(e.text);
      if (!k || k === normU(en)) continue;
      if (map[k] && map[k] !== en) { conflicts.push(e.text); continue; }
      map[k] = en;
      if (!rev[en]) rev[en] = e.text;
    }
  }
  return { map, rev, missing, conflicts };
}

// Potrivirea textului OCR cu harta localizata: exact, apoi prefix (randul poate avea
// sufix precum "(Stufe 19)" sau un stack citit aiurea), apoi aproximativ (OCR pierde
// diacritice/litere: "Umwandlungsphare" vs "Umwandlungssphare").
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen ? 1 - levenshtein(a, b) / maxLen : 1;
}
const RESOLVE_FUZZY_MIN = 0.88;
// cheile hartii sunt recalculate la fiecare cautare (Object.keys) - le memoram
// o data per harta (WeakMap -> se elibereaza singura cand harta dispare)
const dictKeysCache = new WeakMap();
function dictKeys(dict) {
  let ks = dictKeysCache.get(dict);
  if (!ks) { ks = Object.keys(dict); dictKeysCache.set(dict, ks); }
  return ks;
}
function resolveLocalized(dict, name) {
  const n = normU(name);
  if (!n || !dict) return null;
  if (dict[n]) return dict[n];
  let best = null;
  for (const k of dictKeys(dict)) {
    if (k.length >= 6 && n.startsWith(k + " ") && (!best || k.length > best.length)) best = k;
  }
  if (best) return dict[best];
  let bestKey = null, bestScore = RESOLVE_FUZZY_MIN;
  for (const k of dictKeys(dict)) {
    if (Math.abs(k.length - n.length) > 2) continue;
    const s = similarity(n, k);
    if (s > bestScore) { bestScore = s; bestKey = k; }
  }
  return bestKey ? dict[bestKey] : null;
}

// Cate linii OCR exista exact in harta unei limbi. Folosit la detectarea limbii
// jocului cand "auto" nu poate deduce limba din UI (ex. UI engleza, joc german).
function countLocalized(dict, lines) {
  let n = 0;
  for (const l of lines || []) {
    const t = typeof l === "string" ? l : (l && l.text) || "";
    if (dict[normU(t)]) n++;
  }
  return n;
}

module.exports = { GAME_LANGS, TRADE_HOSTS, parseClientLang, normU, buildLookup, resolveLocalized, countLocalized, levenshtein, similarity };
