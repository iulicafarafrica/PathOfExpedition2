// Parser robust pentru rânduri OCR din panoul Runeshape, portat după
// PoeAncientsPriceHelper/OcrScanner.cs (MultiplierPattern, StripLeadingNoise, name gates).
// Manole OCR-misread-uri: "1x" -> "IX"/"lx"/"ix", glife de rună (junk tokens), etc.

// Normalizeaza un nume pentru matching: lowercase, doar litere+cifre, spații single.
function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    // \p{L} = orice literă (inclusiv chirilic/accentuat), \p{N} = cifre
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extracteaza multiplicatorul (stack size). Returneaza {qty, explicit}.
// Cazuri: "3x Name", "3xName", "Name x3", si "1x" misread ca "IX"/"lx".
function extractMultiplier(s) {
  const raw = (s || "").trim();
  // leading "Nx" cu cifre reale (2x, 3x, 14x), nu urmat de alta cifra
  // (X/x/х/×: OCR da des "X" mare pentru marcajul de stack)
  let m = raw.match(/(?<![\p{L}\p{N}])(\d{1,3})\s*[xXх×](?!\d)/u);
  if (m) return { qty: Math.min(parseInt(m[1], 10), 999), explicit: true, rest: raw.slice(m.index + m[0].length) };
  // trailing "xN" / "XN" / "хN" / "×N"
  m = raw.match(/\s+[xXх×]\s*([0-9]{1,3})$/u);
  if (m) return { qty: Math.min(parseInt(m[1], 10), 999), explicit: true, rest: raw.slice(0, m.index) };
  // cazul "1" misread ca litera (I, l, i, O, 0): un token scurt la inceput, optional urmat de x/X
  m = raw.match(/^\s*[1IiLlOo0]{1,2}\s*[xXх×]?\s+(\S.*)$/u);
  if (m) return { qty: 1, explicit: true, rest: m[1] };
  return { qty: 1, explicit: false, rest: raw };
}

// Strimuta zgomotul de la inceput: tokeni scurti (1-2 chari) si junk cu cifre.
function stripLeadingNoise(norm) {
  let s = norm;
  // tokeni de 1-2 chari la inceput (ex: "e", "l8")
  s = s.replace(/^(?:[^\s]{1,2}\s+)+/, "");
  s = s.replace(/^\s+/g, "");
  return s;
}

// Gate: un rand valid trebuie sa aiba minim 4 chari si un cuvant de minim 4 chari.
function nameGateReject(name) {
  if (name.length < 4) return "short";
  const words = name.split(" ");
  const hasWord4 = words.some((w) => w.length >= 4);
  if (!hasWord4) return "noword";
  // respinge titlul panoului ("Runeshape Combinations" si variantele misread de OCR)
  if (/runeshape|runes hape|combination|combinat/.test(name)) return "title";
  return null;
}

// Parseaza un rand OCR -> {qty, name, raw, explicit} sau null (dacă nu e un rand de item).
function parseRow(rawLine) {
  if (!rawLine || !rawLine.trim()) return null;
  let s = rawLine.trim();
  // Strimuta trailing stack count: "(3)" sau "x1" (forma bare de pe panoul de rune)
  s = s.replace(/\s*[(\[{]\s*[\p{L}\p{N}]{1,3}\s*[)\]}]\s*$/u, "").trim();
  s = s.replace(/\s+[xх×]\s*[\dlioOSB]{1,3}\s*$/iu, "").trim();

  const mult = extractMultiplier(s);
  const nameNorm = normalizeName(stripLeadingNoise(normalizeName(mult.rest)));

  const reject = nameGateReject(nameNorm);
  if (reject) return null;
  return { qty: mult.qty, name: nameNorm, raw: rawLine.trim(), explicit: mult.explicit };
}

function parseLines(lines) {
  // accepta strings sau obiecte {text, y}
  const withY = lines
    .map((l) => (typeof l === "string" ? { text: l, y: 0 } : l))
    .filter((l) => l.text && l.text.trim());
  const topY = withY.length ? Math.min(...withY.map((l) => l.y || 0)) : 0;
  const TITLE_BAND = 45; // px - banda titlului in partea de sus

  const out = [];
  for (const l of withY) {
    const r = parseRow(l.text);
    if (!r) continue;
    // respinge titlul: prima linie (peste banda) fara multiplicator explicit
    if (!r.explicit && Math.abs((l.y || 0) - topY) < TITLE_BAND) continue;
    out.push(r);
  }
  return out;
}

// ---- TEST ----
if (require.main === module) {
  const lines = [
    { text: "Ruweshape", y: 31 },
    { text: "IX Greater Chaos Orb", y: 94 },
    { text: "IX Greater Exalted Orb", y: 157 },
    { text: "3x Regal Orb", y: 220 },
    { text: "2x Exalted Orb", y: 283 },
    { text: "lx Uncut Spirit Gem (Level 19)", y: 346 },
  ];
  console.log("=== TEST parseLines (cu Y) ===");
  const rows = parseLines(lines);
  rows.forEach((r) => console.log(`  ${r.qty}x ${r.name} (explicit=${r.explicit}, raw="${r.raw}")`));
  console.log("Total randuri:", rows.length);
}

module.exports = { parseLines, parseRow, normalizeName, extractMultiplier };
