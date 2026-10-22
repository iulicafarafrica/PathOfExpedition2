// Functii pure de normalizare / potrivire de text (OCR -> nume de item).
// Extrase din main.js ca sa poata fi testate fara Electron (vezi test/run.js).
// Nimic aici nu atinge retea, disc sau ferestre.

"use strict";

// normalizare pentru matching: lowercase, doar litere/cifre/spatii
function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// pentru matching: normalizeaza si posesivele (jeweller s -> jewellers)
function matchKey(s) {
  return normName(s).replace(/\b(\w+) s\b/g, "$1s").replace(/\s+/g, " ").trim();
}

// fallback pentru cifre OCR confundate cu litere (0->o, 1->l, 5->s, 8->b)
function digitFold(s) {
  return s.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s").replace(/8/g, "b");
}

// gemurile necizelate au preturi foarte diferite intre niveluri: fara nivel citit -> fara pret
function isUncutGem(key) {
  return /uncut (skill|spirit|support) gem/.test(key);
}

// distanta Levenshtein (edit-distance)
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

// similaritate 0..1 intre doua chei normalizate (edit-distance, FARA bonus de substring)
function keySimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// slug pentru URL-ul de item pe poe.ninja:
// "Jeweller's Orb" -> "jewellers-orb": apostroful se scoate (NU devine cratima).
function nameSlug(s) {
  return String(s || "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

module.exports = {
  normName,
  matchKey,
  digitFold,
  isUncutGem,
  levenshtein,
  keySimilarity,
  nameSlug,
};
