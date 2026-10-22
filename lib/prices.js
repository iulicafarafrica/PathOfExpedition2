// Potrivirea numelor OCR cu preturile din poe.ninja - functii pure.
// Extrase din main.js ca sa poata fi testate fara Electron (vezi test/run.js).
// Contextul (harta de preturi + traducerile) vine din main, deci functiile
// nu ating retea si nu depind de starea globala a aplicatiei.

"use strict";

const { matchKey, digitFold, isUncutGem, keySimilarity } = require("./text");

// prag-uri pentru matching
const PREFIX_MIN_LENGTH = 10;
const FUZZY_MIN_LENGTH = 6;
const FUZZY_THRESHOLD = 0.84;
const HIGH_CONFIDENCE_THRESHOLD = 0.92;

// cel mai bun candidat fuzzy: doar chei cu lungime in [len-3, len+3], scor edit-distance
function bestFuzzyMatch(name, keysByLength) {
  let bestKey = null;
  let bestScore = FUZZY_THRESHOLD; // trebuie sa depaseasca strict pragul
  for (let len = Math.max(0, name.length - 3); len <= name.length + 3; len++) {
    const bucket = (keysByLength || {})[len];
    if (!bucket) continue;
    for (const k of bucket) {
      const s = keySimilarity(name, k);
      if (s > bestScore) { bestScore = s; bestKey = k; }
    }
  }
  return bestKey ? { key: bestKey, score: bestScore } : null;
}

// exact -> digit-fold exact -> prefix (>=10) -> fuzzy (>=6, bucket +-3, 0.84)
// NU folosim "contains": altfel "mind rune" s-ar potrivi gresit cu "perfect mind rune".
//
// ctx = {
//   map:         { "<cheie normalizata>": { name, price, category, ... } },
//   keys:        [ "<cheie>", ... ]        (optional; se foloseste Object.keys(map) daca lipseste)
//   keysByLength:{ "<lungime>": [ "<cheie>", ... ] },
//   toEnglish:   (name) => name            (optional; traducere nume localizat -> englezesc)
// }
function lookupPrice(name, ctx) {
  const c = ctx || {};
  const map = c.map || {};
  const keys = c.keys || Object.keys(map);
  const toEnglish = typeof c.toEnglish === "function" ? c.toEnglish : (n) => n;

  // nume englezesc deja cunoscut: nu-l trecem prin harta localizata (o potrivire
  // aproximativa acolo ar putea traduce gresit un nume englezesc)
  const enKey = matchKey(name);
  if (enKey && map[enKey]) return { ...map[enKey], matchedKey: enKey, exact: true };

  const key = matchKey(toEnglish(name));
  if (!key) return null;
  const hit = (k, exact) => ({ ...map[k], matchedKey: k, exact });

  // 1. exact
  if (map[key]) return hit(key, true);
  // 2. gem fara nivel citit / fara potrivire exacta -> necunoscut (nu ghicim nivelul)
  if (isUncutGem(key)) return null;
  // 3. digit-folded exact
  if (/\d/.test(key)) {
    const folded = digitFold(key);
    if (folded !== key && map[folded]) return hit(folded, true);
  }
  // 4. prefix (doar nume lungi; extrage cheia cea mai scurta care incepe cu numele)
  if (key.length >= PREFIX_MIN_LENGTH) {
    let bestKey = null;
    for (const k of keys) {
      if (k.startsWith(key) && (bestKey === null || k.length < bestKey.length)) bestKey = k;
    }
    if (bestKey !== null) return hit(bestKey, true);
  }
  // 5. fuzzy (edit-distance, bucket de lungime)
  if (key.length >= FUZZY_MIN_LENGTH) {
    const f = bestFuzzyMatch(key, c.keysByLength);
    if (f) return hit(f.key, f.score >= HIGH_CONFIDENCE_THRESHOLD);
  }
  return null;
}

module.exports = {
  lookupPrice,
  bestFuzzyMatch,
  PREFIX_MIN_LENGTH,
  FUZZY_MIN_LENGTH,
  FUZZY_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
};
