// Scriptul aplicatiei pentru runeoverlay.html (extras din HTML ca sa putem
// folosi o CSP fara 'unsafe-inline').
const rowsEl = document.getElementById("rows");
const hintEl = document.getElementById("hint");
const legendEl = document.getElementById("legend");
let byName = new Map();
let byKey = new Map();   // cheie = rune sortate -> lista de retete posibile
let chase = new Set();
let chaseList = [];      // { name, set:Set(norm), total } pt progresul "3/9"
const nn = (s) => String(s).toLowerCase().replace(/\s+rune$/, "");
const T = (k, v) => I18N.t(k, v);
let running = false;
let lastPaint = "";
let lastFrame = "";

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function short(n) { return String(n).replace(/\s*Rune$/i, ""); }
function key(names) { return names.slice().sort().join("|"); }
function showHint(msg) {
  hintEl.hidden = false;
  hintEl.textContent = msg;
}
// nimic pe ecran: fara randuri, fara legenda, fara hint (ca la overlay-ul de preturi)
function clearAll() {
  if (lastPaint) { rowsEl.innerHTML = ""; lastPaint = ""; }
  legendEl.hidden = true;
  hintEl.hidden = true;
  lastFrame = "";
}

function rowHtml(det, y) {
  let sum = 0, max = 0;
  const good = [], bad = [];
  for (const d of det) {
    const info = byName.get(d.name);
    const dg = info && Number.isFinite(info.danger) ? info.danger : 3;
    sum += dg; if (dg > max) max = dg;
    if (info && info.propagate === "good") good.push(info);
    else if (info && info.propagate === "bad") bad.push(info);
  }
  // n/m = suma din maximul acestui rand (nr. rune x 5) - ca sa se vada scala
  const dgr = `<span class="dgr d${Math.max(1, Math.min(6, max))}" title="${esc(T("runeovl.dangerTitle", { sum, max }))}">${esc(T("runeovl.danger", { sum, max: det.length * 5 }))}</span>`;

  const list = byKey.get(key(det.map((d) => d.name))) || [];
  let rw;
  if (list.length === 1) {
    const r = list[0];
    const star = chase.has(r.reward.toLowerCase()) ? ` <span class="jk" title="${esc(T("runeovl.jackpotTitle"))}">\u2605</span>` : "";
    rw = `<b class="rw">${r.qty > 1 ? r.qty + "\u00d7 " : ""}${esc(r.reward)}${star}</b>`;
  } else if (list.length > 1) {
    rw = `<b class="rw multi">${esc(T("planner.possibleResults", { n: list.length }))}</b>`;
  } else {
    rw = `<b class="rw unk">${esc(T("planner.unknownCombo"))}</b>`;
  }

  // progres catre un jackpot/boon: cate rune din setul necesar sunt in acest rand
  let chaseLine = "";
  if (chaseList.length) {
    const detSet = new Set(det.map((d) => nn(d.name)));
    let best = null;
    for (const c of chaseList) {
      let cnt = 0;
      for (const n of detSet) if (c.set.has(n)) cnt++;
      if (cnt > 0 && (!best || cnt > best.cnt)) best = { name: c.name, cnt, total: c.total };
    }
    if (best && best.cnt < best.total) {
      chaseLine = `<span class="sub ch">\u2192 ${esc(best.name)} ${best.cnt}/${best.total}</span>`;
    }
  }

  let sub;
  if (good.length) {
    const g = good.map((x) => short(x.name) + (x.tier ? " (" + x.tier + ")" : "")).join(", ");
    sub = `<span class="sub sp">${esc(T("runeovl.spread", { runes: g }))}</span>`;
  } else if (bad.length) {
    sub = `<span class="sub av">${esc(T("runeovl.dontSpread", { runes: bad.map((x) => short(x.name)).join(", ") }))}</span>`;
  } else {
    sub = `<span class="sub muted">${esc(T("runeovl.noSpread"))}</span>`;
  }
  return `<div class="r" style="top:${y}px">${dgr}<span class="txt">${rw}${sub}${chaseLine}</span></div>`;
}

async function tick() {
  if (running || document.hidden) return;
  running = true;
  try {
    // un singur round-trip in main: foreground (jocul e in fata?) + captura rapida GDI
    const f = await window.api.runeFrame();
    if (!f || !f.ok) { clearAll(); showHint((f && f.error) || T("runeovl.unavailable")); return; }
    // ca la overlay-ul de preturi (care cere ancorul OCR "Runeshape Combinations"):
    // desenam doar cand jocul e fereastra activa - altfel potrivirea iconitelor
    // poate "recunoaste" rune pe desktop/wallpaper/alte aplicatii.
    if (!f.isGame) { clearAll(); return; }
    hintEl.hidden = true;
    // cadru identic cu cel anterior -> nu re-facem template-matching-ul
    if (f.dataUrl === lastFrame) return;
    lastFrame = f.dataUrl;
    const rows = await RuneReader.detectRows(f.dataUrl, f.scale);
    // doar randuri cu incredere mare (panoul Runeshape deschis); pamantul/obiectele
    // raman sub prag si nu mai apar ca randuri de rune.
    const good = rows.filter((r) => r.ok);
    // fara randuri reale nu se deseneaza NIMIC (nici legenda, nici hint)
    legendEl.hidden = good.length === 0;
    if (!good.length) {
      if (lastPaint) { rowsEl.innerHTML = ""; lastPaint = ""; }
      return;
    }
    const k = f.scale > 0 ? f.scale : 1;
    const html = good.map((r) => rowHtml(r.det, Math.max(0, Math.round(r.cy / k) - 17))).join("");
    if (html !== lastPaint) { rowsEl.innerHTML = html; lastPaint = html; }
  } catch (e) {
    // nu spamam; revine la urmatorul tick
  } finally { running = false; }
}

// bucla adaptiva: cat timp se vad randuri, reverificam des (~250ms) ca overlay-ul sa
// dispara imediat cand se inchide panoul; cand nu e nimic afisat, rarim (~900ms).
async function loop() {
  await tick();
  setTimeout(loop, lastPaint ? 250 : 900);
}

(async () => {
  try { await I18N.init(); I18N.apply(document); } catch {}
  try {
    const d = await window.api.plannerData();
    if (d && d.ok) {
      byName = new Map(d.runes.map((r) => [r.name, r]));
      byKey = new Map();
      for (const rec of d.recipes || []) {
        const k = key(rec.runes);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(rec);
      }
      chase = new Set((d.chase || []).map((c) => c.reward.toLowerCase()));
      for (const c of d.chase || []) {
        const set = new Set((c.runes || []).map(nn));
        if (set.size) chaseList.push({ name: c.reward, set, total: set.size });
      }
      await RuneReader.init(d.runes);
    }
  } catch {}
  // legenda de orientare ramane ascunsa pana la primul rand detectat (vezi tick)
  loop();
})();

// fontul ales in Options: citim la pornire + primim live prin "app-font"
I18N.live(() => { I18N.apply(document); if (lastPaint) { rowsEl.innerHTML = lastPaint = ""; } lastFrame = ""; });
window.api.getConfig().then((c) => FontUI.apply((c && c.font) || FontUI.DEFAULT)).catch(() => {});
window.api.onFont((f) => FontUI.apply(f));
