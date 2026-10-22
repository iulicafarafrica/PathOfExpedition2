// Teste de regresie, FARA dependinte (node:assert). Ruleaza: npm test
// Acopera logica pura din rows.js + planner.js (parsing OCR + runesmithing).
const assert = require("node:assert");
const rows = require("../rows");
const planner = require("../planner");

let passed = 0, failed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push({ name, err: (e && e.message) ? e.message : String(e) }); }
}

// ---------- rows.js ----------
t("rows.normalizeName: lowercase + spatiu unic", () => {
  assert.strictEqual(rows.normalizeName("  Greater   Chaos Orb "), "greater chaos orb");
});
t("rows.extractMultiplier: leading Nx", () => {
  const m = rows.extractMultiplier("3x Regal Orb");
  assert.strictEqual(m.qty, 3);
  assert.strictEqual(m.explicit, true);
});
t("rows.extractMultiplier: trailing xN", () => {
  const m = rows.extractMultiplier("Name x3");
  assert.strictEqual(m.qty, 3);
  assert.strictEqual(m.explicit, true);
});
t("rows.extractMultiplier: '1' misread (IX)", () => {
  const m = rows.extractMultiplier("IX Greater Chaos Orb");
  assert.strictEqual(m.qty, 1);
  assert.strictEqual(m.explicit, true);
});
t("rows.extractMultiplier: fara multiplicator", () => {
  assert.strictEqual(rows.extractMultiplier("Greater Chaos Orb").explicit, false);
});
t("rows.parseRow: rand de item", () => {
  const r = rows.parseRow("3x Regal Orb");
  assert.strictEqual(r.qty, 3);
  assert.strictEqual(r.name, "regal orb");
});
t("rows.parseRow: titlul panoului e respins", () => {
  assert.strictEqual(rows.parseRow("Runeshape Combinations"), null);
});
t("rows.parseRow: prea scurt e respins", () => {
  assert.strictEqual(rows.parseRow("ab"), null);
});
t("rows.parseRow: gol e respins", () => {
  assert.strictEqual(rows.parseRow(""), null);
});
t("rows.parseLines: pastreaza randurile de itemi", () => {
  const p = rows.parseLines([{ text: "Runeshape", y: 31 }, { text: "3x Regal Orb", y: 220 }]);
  assert.ok(p.some((r) => r.name === "regal orb"));
});

// ---------- planner.js ----------
t("planner.listRunes: lista nu e goala", () => {
  const r = planner.listRunes();
  assert.ok(Array.isArray(r) && r.length > 0);
});
t("planner.listRecipes: lista nu e goala", () => {
  const r = planner.listRecipes();
  assert.ok(Array.isArray(r) && r.length > 0);
});
t("planner.normRune: scoate sufixul 'rune'", () => {
  assert.strictEqual(planner.normRune("Moon"), "moon");
  assert.strictEqual(planner.normRune("Moon Rune"), "moon");
});
t("planner.matchRecipes: match exact (runele unei retele)", () => {
  const rec = planner.listRecipes().find((r) => r.runes.length >= 2);
  assert.ok(rec, "exista o reteta cu >=2 rune");
  const { exact } = planner.matchRecipes(rec.runes);
  assert.ok(exact.some((r) => r.reward === rec.reward), "reteta apare in 'exact'");
});
t("planner.matchRecipes: subset -> contains", () => {
  const rec = planner.listRecipes().find((r) => r.runes.length >= 3);
  assert.ok(rec, "exista o reteta cu >=3 rune");
  const { contains } = planner.matchRecipes(rec.runes.slice(0, 2));
  assert.ok(contains.some((r) => r.reward === rec.reward), "reteta apare in 'contains'");
});
t("planner.runeInfo: runa cunoscuta", () => {
  const r = planner.listRunes()[0];
  const info = planner.runeInfo(r.name);
  assert.ok(info && info.name);
});
t("planner.propagateAdvice: intoarce array-uri", () => {
  const pa = planner.propagateAdvice(planner.listRecipes()[0].runes);
  assert.ok(Array.isArray(pa.good) && Array.isArray(pa.bad));
});

// ---------- names (nume localizate) ----------
const names = require("../names");
t("names.normU: diacritice + apostrof", () => {
  assert.equal(names.normU("Chaossphäre"), "chaossphare");
  assert.equal(names.normU("Alchemist's Boon"), "alchemists boon");
  assert.equal(names.normU("  Uncut  Skill Gem (Level 15) "), "uncut skill gem level 15");
});
t("names.normU: pastreaza alfabetele non-latine", () => {
  assert.equal(names.normU("Сфера хаоса"), "сфера хаоса");
  const ko = names.normU("카오스 오브");
  assert.ok(ko.length > 0 && !/[a-z]/.test(ko), "coreeana nu se goleste");
});
t("names.parseClientLang: limba din configul jocului", () => {
  assert.equal(names.parseClientLang("[LANGUAGE]\nchat_language=en\nlanguage=fr\n"), "fr");
  assert.equal(names.parseClientLang("[LANGUAGE]\r\nlanguage = de \r\n"), "de");
  assert.equal(names.parseClientLang("language=English"), "en");
  assert.equal(names.parseClientLang("language=German"), "de");
  assert.equal(names.parseClientLang("language=Portuguese"), "pt");
  assert.equal(names.parseClientLang("language=pt-br"), "pt");
  assert.equal(names.parseClientLang("language=Klingon"), null);
  assert.equal(names.parseClientLang("chat_language=en"), null);
  assert.equal(names.parseClientLang(""), null);
});
t("names.buildLookup: perechi pe id, nu pe ordine", () => {
  const en = [{ id: "Runes", entries: [{ id: "a", text: "Glacial Rune" }, { id: "b", text: "Vision Rune" }] }];
  const de = [{ id: "Runes", entries: [{ id: "b", text: "Visionsrune" }, { id: "a", text: "Gletscherrune" }] }];
  const { map, missing, conflicts } = names.buildLookup(en, de);
  assert.equal(map["gletscherrune"], "Glacial Rune");
  assert.equal(map["visionsrune"], "Vision Rune");
  assert.equal(missing.length, 0);
  assert.equal(conflicts.length, 0);
});
t("names.buildLookup: inversul englez -> localizat (pt UI)", () => {
  const en = [{ id: "Runes", entries: [{ id: "a", text: "Glacial Rune" }, { id: "b", text: "Vision Rune" }] }];
  const de = [{ id: "Runes", entries: [{ id: "a", text: "Gletscherrune" }, { id: "b", text: "Visionsrune" }] }];
  const { rev } = names.buildLookup(en, de);
  assert.equal(rev["Glacial Rune"], "Gletscherrune");
  assert.equal(rev["Vision Rune"], "Visionsrune");
  assert.equal(rev["Unknown"], undefined);
});
t("names.buildLookup: numele netraduse nu intra in harta", () => {
  const en = [{ id: "Currency", entries: [{ id: "v", text: "Verisium" }] }];
  const de = [{ id: "Currency", entries: [{ id: "v", text: "Verisium" }] }];
  assert.deepEqual(names.buildLookup(en, de).map, {});
});
t("names.buildLookup: id lipsa e raportat", () => {
  const en = [{ id: "Currency", entries: [{ id: "x", text: "Chaos Orb" }] }];
  const de = [{ id: "Currency", entries: [{ id: "y", text: "Chaossphäre" }] }];
  const r = names.buildLookup(en, de);
  assert.equal(r.missing.length, 1);
  assert.deepEqual(r.map, {});
});
t("names: hartile generate arata bine", () => {
  const dir = require("node:path").join(__dirname, "..", "data", "names");
  const fs = require("node:fs");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("rev-"));
  assert.ok(files.length >= 8, "toate limbile au fisier");
  for (const f of files) {
    const map = JSON.parse(fs.readFileSync(require("node:path").join(dir, f), "utf8"));
    const keys = Object.keys(map);
    assert.ok(keys.length > 600, f + ": prea putine intrari (" + keys.length + ")");
    for (const k of keys) {
      assert.equal(names.normU(k), k, f + ": cheie nenormalizata: " + k);
      assert.ok(map[k] && typeof map[k] === "string", f + ": valoare goala pentru " + k);
    }
  }
  const de = JSON.parse(fs.readFileSync(require("node:path").join(dir, "de.json"), "utf8"));
  assert.equal(de[names.normU("Gletscherrune")], "Glacial Rune");
  assert.equal(de[names.normU("Chaossphäre")], "Chaos Orb");
  // fiecare limba are si inversul (englez -> localizat), pt afisarea in UI
  const revFiles = fs.readdirSync(dir).filter((f) => f.startsWith("rev-") && f.endsWith(".json"));
  assert.equal(revFiles.length, files.length, "fiecare limba are rev-<lang>.json");
  const revDe = JSON.parse(fs.readFileSync(require("node:path").join(dir, "rev-de.json"), "utf8"));
  assert.equal(revDe["Glacial Rune"], "Gletscherrune");
  assert.equal(revDe["Chaos Orb"], "Chaossphäre");
});

t("names.resolveLocalized: text OCR german (inclusiv erori)", () => {
  const de = JSON.parse(require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "data", "names", "de.json"), "utf8"));
  const r = (s) => names.resolveLocalized(de, s);
  assert.equal(r("Größere Umwandlungssphäre"), "Greater Orb of Transmutation");
  assert.equal(r("Größere Umwandlungsphäre"), "Greater Orb of Transmutation", "OCR pierde un s");
  assert.equal(r("Ungeschnittene Fertigkeitengemme (Stufe 19)"), "Uncut Skill Gem (Level 19)");
  assert.equal(r("Ungeschnittene Fertigkeitengemme"), "Uncut Skill Gems", "forma de plural");
  assert.equal(r("Schutzrune"), "Ward Rune");
  assert.equal(r("Geistrune"), "Mind Rune");
  assert.equal(r("Runenform-Kombinationen"), null, "titlul nu e item");
});
t("rows: titlurile localizate sunt respinse, itemele nu", () => {
  const titles = ["Runenform-Kombinationen", "Combinaisons de runes", "Combinaciones de runas",
    "Combinações de Runas", "Комбинации рун", "ルーンの組み合わせ", "룬 조합", "การผสมรูน"];
  for (const s of titles) assert.ok(rows.PANEL_ANCHOR.test(s), "anchor: " + s);
  for (const s of ["Schutzrune", "Geistrune", "Greater Chaos Orb", "Сфера хаоса"])
    assert.ok(!rows.PANEL_ANCHOR.test(s), "nu e titlu: " + s);
  assert.equal(rows.parseRow("Runenform-Kombinationen"), null);
});

t("rows.panelDetected: titlu SAU 2 randuri cu cantitate", () => {
  // titlu corect (orice limba) -> panou
  assert.equal(rows.panelDetected(["Runenform-Kombinationen", "3x Größere Umwandlungssphäre"]), true);
  assert.equal(rows.panelDetected(["Runeshape Combinations"]), true);
  // titlu ilizibil (fara pachet OCR german), dar randurile se pot citi -> tot panou
  assert.equal(rows.panelDetected([
    "Rumenform-éhtbihationem",
    "3x Größere Umwandlungssphäre",
    "1x Schutzrune",
  ]), true);
  // market / alt ecran: nume fara cantitate si fara titlu -> nu e panoul
  assert.equal(rows.panelDetected(["Chaos Orb", "Divine Orb", "Exalted Orb"]), false);
  assert.equal(rows.panelDetected([]), false);
});

t("rows.parseLines: fara titlu OCR, primul rand de item ramane", () => {
  const out = rows.parseLines([
    { text: "Größere Umwandlungssphäre", y: 108 },
    { text: "nx Ungeschnittene Fertigkeitengemme (Stufe 19)", y: 171 },
    { text: "IX Schutzrune", y: 234 },
  ]);
  assert.equal(out.length, 3, "niciun rand de item pierdut");
  assert.equal(out[0].name, "größere umwandlungssphäre");
});

t("names.countLocalized: detecteaza limba dupa randurile OCR", () => {
  const dir = require("node:path").join(__dirname, "..", "data", "names");
  const de = JSON.parse(require("node:fs").readFileSync(require("node:path").join(dir, "de.json"), "utf8"));
  const ja = JSON.parse(require("node:fs").readFileSync(require("node:path").join(dir, "ja.json"), "utf8"));
  const deLines = ["Größere Umwandlungssphäre", "Schutzrune", "Geistrune", "Runenform-Kombinationen"];
  assert.equal(names.countLocalized(de, deLines), 3);
  assert.equal(names.countLocalized(ja, deLines), 0);
  assert.equal(names.countLocalized(de, ["Chaos Orb", "Divine Orb"]), 0);
});

// ---------- locales (traduceri UI) ----------
global.window = {};
require("../renderer/locales.js");
const locales = global.window.I18N_LOCALES;
t("locales: toate limbile au exact aceleasi chei ca en", () => {
  const base = Object.keys(locales.en).sort();
  assert.ok(base.length > 100, "en are suficiente chei");
  for (const lang of Object.keys(locales)) {
    assert.deepEqual(Object.keys(locales[lang]).sort(), base, lang + ": chei diferite de en");
    for (const k of base) {
      const v = locales[lang][k];
      assert.ok(typeof v === "string" && v.trim(), lang + "." + k + ": traducere goala");
    }
  }
});
t("locales: placeholder-ele coincid cu en", () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
  for (const lang of Object.keys(locales)) {
    for (const k of Object.keys(locales.en)) {
      assert.equal(ph(locales[lang][k]), ph(locales.en[k]), lang + "." + k + ": placeholder diferit");
    }
  }
});
t("locales: fiecare limba are nume nativ", () => {
  const names = Object.keys(locales).map((k) => locales[k]["lang.name"]);
  assert.equal(new Set(names).size, names.length, "numele nu se repeta");
  for (const k of Object.keys(locales)) {
    assert.ok(locales[k]["lang.name"].trim().length >= 2, k + ": fara nume");
  }
});

// ---------- ghid (continut editorial) ----------
require("../renderer/guide.js");
const guide = global.window.GUIDE;
t("guide: toate limbile au acelasi numar de sectiuni ca en", () => {
  const base = guide.en.sections.length;
  assert.ok(base >= 5, "en are suficiente sectiuni");
  for (const lang of Object.keys(locales)) {
    assert.ok(guide[lang], lang + ": lipseste ghidul");
    assert.equal(guide[lang].sections.length, base, lang + ": numar de sectiuni diferit");
  }
});
t("guide: fiecare sectiune are titlu si corp, plus credit", () => {
  for (const lang of Object.keys(locales)) {
    for (const s of guide[lang].sections) {
      assert.ok(s.h && s.h.trim(), lang + ": titlu gol");
      assert.ok(s.b && (s.b.indexOf("<p>") === 0 || s.b.indexOf("<ul>") === 0), lang + ": corp lipsa");
    }
    assert.ok(guide[lang].title && guide[lang].sub, lang + ": titlu/subtitlu lipsa");
    assert.ok(guide[lang].credit && guide[lang].link, lang + ": credit/link lipsa");
  }
});

// ---------- main proces: functii pure extrase in lib/ (audit E1) ----------
const libText = require("../lib/text");
const libPrices = require("../lib/prices");
const libUpdate = require("../lib/update");
const libCapture = require("../lib/capture");
const libNet = require("../lib/net");

t("text.normName: lowercase + spatii unice", () => {
  assert.strictEqual(libText.normName("  Greater   Chaos Orb "), "greater chaos orb");
  assert.strictEqual(libText.normName("Jeweller's Orb"), "jeweller s orb");
});
t("text.matchKey: posesivele se lipesc", () => {
  assert.strictEqual(libText.matchKey("Jeweller's Orb"), "jewellers orb");
  assert.strictEqual(libText.matchKey("Greater Chaos Orb"), "greater chaos orb");
});
t("text.digitFold: cifre confundate cu litere", () => {
  assert.strictEqual(libText.digitFold("0l5"), "ols");
  assert.strictEqual(libText.digitFold("1"), "l");
  assert.strictEqual(libText.digitFold("8"), "b");
  assert.strictEqual(libText.digitFold("abc"), "abc");
});
t("text.isUncutGem: gemurile necizelate sunt excluse", () => {
  assert.ok(libText.isUncutGem("uncut skill gem"));
  assert.ok(libText.isUncutGem("uncut spirit gem"));
  assert.ok(libText.isUncutGem("uncut support gem"));
  assert.ok(!libText.isUncutGem("chaos orb"));
});
t("text.levenshtein: edit-distance", () => {
  assert.strictEqual(libText.levenshtein("chaos", "chao"), 1);
  assert.strictEqual(libText.levenshtein("chaos", "chaos"), 0);
  assert.strictEqual(libText.levenshtein("", "abc"), 3);
});
t("text.keySimilarity: scor 0..1", () => {
  assert.strictEqual(libText.keySimilarity("chaos", "chaos"), 1);
  assert.ok(libText.keySimilarity("chaos", "chao") >= 0.8);
  assert.ok(libText.keySimilarity("chaos", "divine") < 0.5);
});
t("text.nameSlug: slug pentru URL poe.ninja", () => {
  assert.strictEqual(libText.nameSlug("Jeweller's Orb"), "jewellers-orb");
  assert.strictEqual(libText.nameSlug("Greater Chaos Orb"), "greater-chaos-orb");
  assert.strictEqual(libText.nameSlug("  "), "");
});

// harta de preturi mica, pentru testele de matching
const testMap = {
  "chaos orb": { name: "Chaos Orb", price: 0.05, category: "Currency" },
  "greater chaos orb": { name: "Greater Chaos Orb", price: 1.2, category: "Currency" },
  "regal orb": { name: "Regal Orb", price: 0.3, category: "Currency" },
  "awakened PoE support": { name: "Awakened PoE Support", price: 2, category: "Currency" },
  "uncut skill gem": { name: "Uncut Skill Gem", price: 5, category: "UncutGems" },
};
const testKeys = Object.keys(testMap);
const testBuckets = {};
for (const k of testKeys) (testBuckets[k.length] = testBuckets[k.length] || []).push(k);
const testCtx = { map: testMap, keys: testKeys, keysByLength: testBuckets };

t("prices.lookupPrice: potrivire exacta", () => {
  const r = libPrices.lookupPrice("Chaos Orb", testCtx);
  assert.ok(r);
  assert.strictEqual(r.matchedKey, "chaos orb");
  assert.strictEqual(r.exact, true);
});
t("prices.lookupPrice: nume lung devine prefix (cheia cea mai scurta)", () => {
  const r = libPrices.lookupPrice("Greater Chaos", testCtx);
  assert.ok(r);
  assert.strictEqual(r.matchedKey, "greater chaos orb");
});
t("prices.lookupPrice: gem necizelat fara nivel -> fara pret", () => {
  assert.strictEqual(libPrices.lookupPrice("Uncut Skill Gem 20", testCtx), null);
});
t("prices.lookupPrice: fuzzy (OCR gresit) gaseste matchul", () => {
  const r = libPrices.lookupPrice("Regal Orbt", testCtx);
  assert.ok(r, "ar fi trebuit potrivire fuzzy");
  assert.strictEqual(r.matchedKey, "regal orb");
});
t("prices.lookupPrice: nu potriveste ceva fara legatura", () => {
  assert.strictEqual(libPrices.lookupPrice("Divine Orb", testCtx), null);
});
t("prices.lookupPrice: toEnglish este folosit pentru nume localizate", () => {
  const ctx = { ...testCtx, toEnglish: () => "chaos orb" };
  const r = libPrices.lookupPrice("Chaoskugel", ctx);
  assert.ok(r);
  assert.strictEqual(r.matchedKey, "chaos orb");
});
t("prices.bestFuzzyMatch: doar chei din bucket-uri", () => {
  const f = libPrices.bestFuzzyMatch("regal orbt", testBuckets);
  assert.ok(f);
  assert.strictEqual(f.key, "regal orb");
  assert.ok(f.score > libPrices.FUZZY_THRESHOLD);
});

t("update.pickAsset: instalat -> Setup, portable -> exe", () => {
  const assets = [
    { name: "Path.of.Expedition.1.1.18.exe" },
    { name: "Path.of.Expedition.Setup.1.1.18.exe" },
  ];
  assert.strictEqual(libUpdate.pickAsset(assets, true).name, "Path.of.Expedition.1.1.18.exe");
  assert.strictEqual(libUpdate.pickAsset(assets, false).name, "Path.of.Expedition.Setup.1.1.18.exe");
});
t("update.verifyAsset: accepta assetul cu sha256 corect", () => {
  const buf = Buffer.from("hello");
  const sha = libUpdate.sha256Hex(buf);
  const asset = { url: "https://github.com/x/y/releases/download/v1/a.exe", size: buf.length, sha256: sha };
  const v = libUpdate.verifyAsset(asset, buf);
  assert.strictEqual(v.sha256, sha);
});
t("update.verifyAsset: refuza sha256 lipsa (audit S2)", () => {
  const buf = Buffer.from("hello");
  const asset = { url: "https://github.com/x/y/releases/download/v1/a.exe", size: buf.length, sha256: null };
  assert.throws(() => libUpdate.verifyAsset(asset, buf), /sha256/);
});
t("update.verifyAsset: refuza dimensiune lipsa", () => {
  const buf = Buffer.from("hello");
  const asset = { url: "https://github.com/x/y/releases/download/v1/a.exe", size: null, sha256: libUpdate.sha256Hex(buf) };
  assert.throws(() => libUpdate.verifyAsset(asset, buf), /size/);
});
t("update.verifyAsset: refuza host strain", () => {
  const buf = Buffer.from("hello");
  const asset = { url: "https://evil.example.com/a.exe", size: buf.length, sha256: libUpdate.sha256Hex(buf) };
  assert.throws(() => libUpdate.verifyAsset(asset, buf), /Blocked download host/);
});
t("update.verifyAsset: refuza dimensiune diferita", () => {
  const buf = Buffer.from("hello");
  const asset = { url: "https://github.com/x/y/a.exe", size: buf.length + 1, sha256: libUpdate.sha256Hex(buf) };
  assert.throws(() => libUpdate.verifyAsset(asset, buf), /Size mismatch/);
});
t("update.verifyAsset: refuza sha256 diferit", () => {
  const buf = Buffer.from("hello");
  const asset = { url: "https://github.com/x/y/a.exe", size: buf.length, sha256: "0".repeat(64) };
  assert.throws(() => libUpdate.verifyAsset(asset, buf), /SHA-256 mismatch/);
});

t("capture.computeCropRect: coordonate DIP -> pixeli thumbnail", () => {
  const r = libCapture.computeCropRect({ x: 100, y: 50, width: 600, height: 400 }, { x: 0, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 });
  assert.strictEqual(r.px, 100);
  assert.strictEqual(r.py, 50);
  assert.strictEqual(r.pw, 600);
  assert.strictEqual(r.ph, 400);
});
t("capture.computeCropRect: scala 2x (display HiDPI)", () => {
  const r = libCapture.computeCropRect({ x: 100, y: 50, width: 600, height: 400 }, { x: 0, y: 0, width: 1920, height: 1080 }, { width: 3840, height: 2160 });
  assert.strictEqual(r.px, 200);
  assert.strictEqual(r.py, 100);
  assert.strictEqual(r.pw, 1200);
  assert.strictEqual(r.ph, 800);
});
t("capture.computeCropRect: display secundar (offset negativ)", () => {
  const r = libCapture.computeCropRect({ x: 1600, y: 100, width: 400, height: 200 }, { x: 1920, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 });
  assert.strictEqual(r.px, -320);
  assert.strictEqual(r.pw, 400);
});
t("capture.intersect: decupajul din afara imaginii", () => {
  const r = libCapture.computeCropRect({ x: 1600, y: 100, width: 400, height: 200 }, { x: 1920, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 });
  const cut = libCapture.intersect(r);
  assert.strictEqual(cut.ix, 0);
  assert.strictEqual(cut.iw, 80);   // doar 1920-1840 px vizibili
  assert.ok(cut.ih > 0);
});

t("net.isExternalAllowed: creditele din Guide sunt permise (audit S3)", () => {
  assert.ok(libNet.isExternalAllowed("https://www.reddit.com/r/pathofexile2builds/comments/1uhtpix/guide_to_expedition_in_055/"));
  assert.ok(libNet.isExternalAllowed("https://reddit.com/r/pathofexile2builds/comments/1uhtpix/guide_to_expedition_in_055"));
  assert.ok(libNet.isExternalAllowed("https://docs.google.com/spreadsheets/d/16YU8mSS7TdLPdmOunVjiPn_NrKVGfcnMkuMQDy8jgZA"));
});
t("net.isExternalAllowed: linkurile din app raman permise", () => {
  assert.ok(libNet.isExternalAllowed("https://buymeacoffee.com/iulian.icb"));
  assert.ok(libNet.isExternalAllowed("https://github.com/iulicafarafrica/PathOfExpedition2/releases"));
  assert.ok(libNet.isExternalAllowed("https://poe.ninja/poe2/economy/forbiddenrites/currency/chaos-orb"));
});
t("net.isExternalAllowed: orice altceput e refuzat", () => {
  assert.ok(!libNet.isExternalAllowed("https://evil.example.com/"));
  assert.ok(!libNet.isExternalAllowed("https://reddit.com/r/other/comments/1uhtpix/x"));
  assert.ok(!libNet.isExternalAllowed("https://docs.google.com/forms/d/abc"));
  assert.ok(!libNet.isExternalAllowed("http://poe.ninja/poe2/economy/a/b/c"));  // fara https
  assert.ok(!libNet.isExternalAllowed("file:///C:/Windows/System32/calc.exe"));
  assert.ok(!libNet.isExternalAllowed("javascript:alert(1)"));
  assert.ok(!libNet.isExternalAllowed(""));
  assert.ok(!libNet.isExternalAllowed(null));
});

// ---------- report ----------
console.log(`\n[test] ${passed} trecute, ${failed} esuate`);
if (failed) {
  for (const f of failures) console.log(`  FAIL: ${f.name}: ${f.err}`);
  process.exit(1);
}
