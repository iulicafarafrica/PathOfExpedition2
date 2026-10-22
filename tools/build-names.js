// Genereaza numele localizate ale itemelor (rulat manual, nu la build):
//   node tools/build-names.js
// Sursa: https://<host>/api/trade2/data/static - aceeasi lista in toate limbile,
// cu ID-uri comune, deci perechile localizat -> englez sunt exacte.
// Rezultat: data/names/<lang>.json = { "<nume localizat normalizat>": "<nume englezesc>" }
const fs = require("node:fs");
const path = require("node:path");
const { GAME_LANGS, TRADE_HOSTS, buildLookup, normU } = require("../names");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const OUT = path.join(__dirname, "..", "data", "names");

async function fetchStatic(lang) {
  const url = `https://${TRADE_HOSTS[lang]}.pathofexile.com/api/trade2/data/static`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`${lang}: HTTP ${r.status}`);
  const j = await r.json();
  return j.result || [];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const en = await fetchStatic("en");
  const known = [
    ["Chaos Orb", "de", "Chaossphäre"], ["Chaos Orb", "ru", "Сфера хаоса"],
    ["Chaos Orb", "ja", "カオスオーブ"], ["Chaos Orb", "ko", "카오스 오브"],
    ["Glacial Rune", "de", "Gletscherrune"],
  ];
  for (const lang of GAME_LANGS) {
    if (lang === "en") continue;
    let loc;
    try { loc = await fetchStatic(lang); } catch (e) { console.log(`${lang}: SKIP (${e.message})`); continue; }
    const { map, rev, missing, conflicts } = buildLookup(en, loc);
    const file = path.join(OUT, lang + ".json");
    fs.writeFileSync(file, JSON.stringify(map), "utf8");
    // inversul (englez -> localizat), pt afisarea numelor in limba UI aleasa
    const revFile = path.join(OUT, "rev-" + lang + ".json");
    fs.writeFileSync(revFile, JSON.stringify(rev), "utf8");
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`${lang}: ${Object.keys(map).length} intrari, ${Object.keys(rev).length} inverse, ${missing.length} id-uri lipsa, ${conflicts.length} conflicte (${kb} KB)`);
    // verificari pe nume cunoscute, ca sa prindem imediat o mapa rupta
    for (const [enName, l, locName] of known) {
      if (l !== lang) continue;
      const got = map[normU(locName)];
      console.log(`   check "${locName}" -> ${got || "(lipseste)"} ${got === enName ? "OK" : "!! asteptat " + enName}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
