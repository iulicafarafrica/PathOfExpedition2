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

// ---------- report ----------
console.log(`\n[test] ${passed} trecute, ${failed} esuate`);
if (failed) {
  for (const f of failures) console.log(`  FAIL: ${f.name}: ${f.err}`);
  process.exit(1);
}
