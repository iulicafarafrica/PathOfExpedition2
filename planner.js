const fs = require("fs");
const path = require("path");

// Rune Planner: datele de runesmithing (exportate din joc / ExileDB / poe2ref)
// + logica de reverse-lookup (ce rețete poti face cu runele date).
// Modul PUR (fara Electron): testabil direct cu `node planner.js`.

let RECIPES = null;
let RUNES = null;
let RUNE_BY_KEY = null;

function loadData() {
  if (RECIPES) return;
  RECIPES = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "recipes.json"), "utf8"));
  RUNES = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "runes.json"), "utf8"));
  RUNE_BY_KEY = {};
  for (const r of RUNES) RUNE_BY_KEY[normRune(r.name)] = r;
}

// normalizare nume de runa: lowercase, fara apostroafe/punct, spatiu unic,
// si fara sufixul optional "rune" (input "Moon" == "Moon Rune").
function normRune(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\brunes?\b\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// multiset (nume normalizat -> numar)
function multiset(arr) {
  const m = new Map();
  for (const x of arr) {
    const k = normRune(x);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function msHasAll(hay, need) {
  for (const [k, v] of need) if ((hay.get(k) || 0) < v) return false;
  return true;
}
function msEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if ((b.get(k) || 0) !== v) return false;
  return true;
}
function msDiff(a, b) {
  // elemente din a care nu se acopera in b (a minus b)
  const out = [];
  for (const [k, v] of a) {
    const extra = v - (b.get(k) || 0);
    for (let i = 0; i < extra; i++) out.push(k);
  }
  return out;
}

// ---- info per runa ----
function runeInfo(name) {
  loadData();
  return RUNE_BY_KEY[normRune(name)] || null;
}
function listRunes() {
  loadData();
  return RUNES.slice();
}
function listRecipes() {
  loadData();
  return RECIPES.map((r) => ({
    reward: r.reward,
    qty: r.qty || 1,
    category: r.category,
    slots: r.slots,
    runes: r.runes.slice(),
    random: !!r.random,
    value: r.value != null ? r.value : null,
    valueCur: r.valueCur || null,
    unlock: r.unlock || null,
    danger: recipeDanger(r),
  }));
}
function recipeDanger(recipe) {
  let sum = 0, max = 0;
  for (const rn of recipe.runes) {
    const info = runeInfo(rn);
    const d = info ? info.danger : 3;
    sum += d;
    if (d > max) max = d;
  }
  return { sum, max, avg: recipe.runes.length ? sum / recipe.runes.length : 0 };
}
// runele care merita propagate (heuristicile noastre) dintr-o lista
function propagateAdvice(runes) {
  const good = [], bad = [];
  for (const rn of new Set(runes.map(normRune))) {
    const info = runeInfo(rn);
    if (!info) continue;
    if (info.propagate === "good") good.push(info.name);
    else if (info.propagate === "bad") bad.push(info.name);
  }
  return { good, bad };
}

// ---- reverse lookup ----
// runesPresent: numele runelor detectate/vazute in panou.
// opts.priceOf(name) -> pret in Divine (optional; pentru ranking dupa valoare).
// intoarce { exact: [recipe], contains: [recipe] } fiecare imbogatit cu _score/_danger.
function matchRecipes(runesPresent, opts = {}) {
  loadData();
  const need = multiset(runesPresent);
  const priceOf = typeof opts.priceOf === "function" ? opts.priceOf : null;
  const exact = [];
  const contains = [];
  for (const rec of RECIPES) {
    const recMs = multiset(rec.runes);
    if (msEqual(recMs, need)) {
      exact.push(decorate(rec, priceOf, 0));
    } else if (need.size > 0 && msHasAll(recMs, need)) {
      contains.push(decorate(rec, priceOf, recMs.size - need.size));
    }
  }
  exact.sort((a, b) => (b.value - a.value) || a.danger.sum - b.danger.sum);
  contains.sort((a, b) => (b.value - a.value) || a.danger.extra - b.danger.extra || a.danger.sum - b.danger.sum);
  return { exact, contains };
}

function decorate(rec, priceOf, extra) {
  const danger = recipeDanger(rec);
  const unit = priceOf ? priceOf(rec.reward, rec) : null; // pret unitar in Divine (sau null)
  const value = unit != null ? unit * (rec.qty || 1) : 0;
  // cost = suma preturilor runelor de intrare (doar daca TOATE sunt pretuite)
  let cost = null;
  if (priceOf) {
    const parts = rec.runes.map((rn) => priceOf(rn));
    if (parts.every((v) => v != null)) cost = parts.reduce((a, b) => a + b, 0);
  }
  const net = unit != null && cost != null ? value - cost : null;
  return {
    reward: rec.reward,
    qty: rec.qty || 1,
    category: rec.category,
    slots: rec.slots,
    runes: rec.runes.slice(),
    icon: rec.icon,
    unlock: rec.unlock,
    random: !!rec.random,
    value,                 // valoare totala estimata (Divine); 0 daca necunoscut
    unitValue: unit,       // pret unitar (Divine) sau null
    priced: unit != null,
    cost,                  // suma preturilor runelor de intrare (Divine) sau null
    costKnown: cost != null,
    net,                   // value - cost (Divine) sau null
    src: rec.value != null ? { value: rec.value, cur: rec.valueCur } : null,  // valoare statica poe2db
    danger: { sum: danger.sum, max: danger.max, avg: Math.round(danger.avg * 10) / 10, extra },
  };
}

// ---- chase-uri: jackpot-uri + boons permanente ----
function listChase() {
  loadData();
  return RECIPES.filter(
    (r) =>
      /^Mirror of Kalandra$/i.test(r.reward) ||
      (/^Divine Orb$/i.test(r.reward) && (r.qty || 1) >= 10) ||
      /boon$/i.test(r.reward)
  ).map((r) => ({
    reward: r.reward,
    qty: r.qty || 1,
    runes: r.runes.slice(),
    kind: /boon$/i.test(r.reward) ? "boon" : "jackpot",
  }));
}

module.exports = { loadData, listRunes, runeInfo, matchRecipes, propagateAdvice, recipeDanger, normRune, listChase, listRecipes };
