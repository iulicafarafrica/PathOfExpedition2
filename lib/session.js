"use strict";
// Starea "sesiunii" de farming: numaram doar itemele NOI aparute intre doua
// scanuri (aceeasi idee ca alerta sonora), ca totalul sa nu se dubleze cat timp
// itemele stau pe ecran. Functii pure -> testate in test/run.js.

const HISTORY_MAX = 10;

function keyOf(row) {
  return String((row && (row.matchedName || row.name)) || "").trim().toLowerCase();
}

// Cate aparitii are fiecare nume in scanul curent (pentru stack-uri duplicate).
function countsOf(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyOf(r);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function fresh(now) {
  return {
    startedAt: now || Date.now(),
    totalDivine: 0,
    count: 0,
    best: null,
    seen: {},
    history: [],
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Normalizeaza starea citita de pe disc: date corupte/vechi nu trebuie sa
// blocheze UI-ul sau sa produca rate absurde.
function sanitize(raw, now) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = {
    startedAt: num(s.startedAt) || (now || Date.now()),
    totalDivine: num(s.totalDivine),
    count: Math.floor(num(s.count)),
    best: null,
    seen: {},
    history: [],
  };
  if (s.best && typeof s.best === "object" && num(s.best.value) > 0) {
    out.best = { name: String(s.best.name || ""), value: num(s.best.value) };
  }
  if (s.seen && typeof s.seen === "object") {
    for (const [k, v] of Object.entries(s.seen)) {
      const c = Math.min(999, Math.floor(num(v)));
      if (k && c > 0) out.seen[k] = c;
    }
  }
  const hist = Array.isArray(s.history) ? s.history : [];
  out.history = hist
    .filter((h) => h && num(h.count) > 0)
    .slice(0, HISTORY_MAX)
    .map((h) => ({
      startedAt: num(h.startedAt),
      endedAt: num(h.endedAt),
      totalDivine: num(h.totalDivine),
      count: Math.floor(num(h.count)),
      best: h.best && typeof h.best === "object" && num(h.best.value) > 0
        ? { name: String(h.best.name || ""), value: num(h.best.value) }
        : null,
    }));
  return out;
}

// Adauga randurile scanului curent. O aparitie e "noua" doar daca numarul ei
// depaseste numarul din scanul anterior -> itemele care raman pe ecran nu se
// numara de doua ori.
function addRows(state, rows, now) {
  const s = state || fresh(now);
  const at = now || Date.now();
  const prev = s.seen || {};
  const seen = {};
  const used = {};
  let added = 0;
  let total = s.totalDivine || 0;
  let count = s.count || 0;
  let best = s.best || null;

  for (const r of rows || []) {
    const k = keyOf(r);
    if (!k) continue;
    used[k] = (used[k] || 0) + 1;
    seen[k] = used[k];
    if (used[k] <= (prev[k] || 0)) continue;   // deja numarat in scanul anterior
    added++;
    count++;
    const val = num(r.totalDivine);
    if (val > 0) {
      total += val;
      if (!best || val > best.value) {
        best = { name: r.displayName || r.matchedName || r.name || "", value: val };
      }
    }
  }
  return {
    state: { ...s, startedAt: s.startedAt || at, totalDivine: total, count, best, seen },
    added,
  };
}

function summary(state, now) {
  const s = state || fresh(now);
  const at = now || Date.now();
  const durationMs = Math.max(0, at - (s.startedAt || at));
  // sub un minut, "pe ora" ar da cifre absurde (ex. 5 div in 10s = 1800/h)
  const hours = Math.max(durationMs, 60000) / 3600000;
  return {
    startedAt: s.startedAt,
    totalDivine: s.totalDivine || 0,
    count: s.count || 0,
    best: s.best || null,
    durationMs,
    perHour: (s.totalDivine || 0) / hours,
    history: (s.history || []).slice(0, HISTORY_MAX),
  };
}

// Incheie runul curent: il salveaza in istoric (daca are continut) si porneste
// unul nou. Returneaza si sumarul runului incheiat, pentru mesajul din UI.
function reset(state, now) {
  const at = now || Date.now();
  const s = state || fresh(at);
  const run = summary(s, at);
  const hasRun = (s.count || 0) > 0 || (s.totalDivine || 0) > 0;
  const history = hasRun
    ? [{ startedAt: run.startedAt, endedAt: at, totalDivine: run.totalDivine, count: run.count, best: run.best }, ...(s.history || [])].slice(0, HISTORY_MAX)
    : (s.history || []).slice(0, HISTORY_MAX);
  return { state: { ...fresh(at), history }, run };
}

module.exports = { HISTORY_MAX, keyOf, countsOf, addRows, summary, reset, sanitize, fresh };
