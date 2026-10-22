// Scriptul aplicatiei pentru index.html (extras din HTML ca sa putem
// folosi o CSP fara 'unsafe-inline').
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const leagueEl = document.getElementById("league");
const pricesTimeEl = document.getElementById("pricesTime");
const ovlBtn = document.getElementById("ovl");
const sndBtn = document.getElementById("snd");
const nmBtn = document.getElementById("nm");
const minvalEl = document.getElementById("minval");
let overlayOn = false;
let soundOn = false;
let namesOn = true;   // numele itemului in overlay (false = ascuns)
let minDiv = 0;      // prag de afisare (in Divine); 0 = arata tot
let curRows = [];
// prag pt "market mover": variatie pe 7 zile peste care marcăm itemul ca pump
const PUMP_PCT = 15;
const T = (k, v) => I18N.t(k, v);
const stateOf = (on) => T(on ? "common.on" : "common.off");
function setOvlBtn(on) { overlayOn = on; ovlBtn.textContent = T("prices.overlay", { state: stateOf(on) }); ovlBtn.classList.toggle("on", on); }
function setSndBtn(on) { soundOn = on; sndBtn.textContent = T("opt.alert", { state: stateOf(on) }); sndBtn.classList.toggle("on", on); }
function setNmBtn(on) { namesOn = on; nmBtn.textContent = T("opt.names", { state: stateOf(on) }); nmBtn.classList.toggle("on", on); }

// chime scurt (doua tonuri) prin Web Audio - fara fisiere de sunet
let audioCtx = null;
function ping() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const s = t0 + i * 0.13;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.28, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(s); o.stop(s + 0.32);
    });
  } catch {}
}

let lastPricesAt = null, lastPricesStale = false;
function setPricesTime(ts, stale) {
  lastPricesAt = ts || null;
  lastPricesStale = !!stale;
  const suffix = stale ? T("footer.cachedOffline") : "";
  const pad = (n) => String(n).padStart(2, "0");
  if (!ts) { pricesTimeEl.textContent = T("footer.pricesUpdated", { when: T("footer.never") + suffix }); return; }
  const d = new Date(ts);
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  pricesTimeEl.textContent = T("footer.pricesUpdated", { when: `${date} ${time}${suffix}` });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// mini-grafic 7 zile din sparkline.data (aceeasi logica precum in overlay)
function sparkSvg(data, trend) {
  if (!Array.isArray(data) || data.length < 2) return "";
  const w = 46, h = 14, p = 1.5;
  const min = Math.min(...data), max = Math.max(...data);
  const span = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = p + (i / (data.length - 1)) * (w - 2 * p);
    const y = p + (1 - (v - min) / span) * (h - 2 * p);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const col = trend === "down" ? "#8a2a2a" : trend === "up" ? "#2f6b34" : "#8a7a55";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

function render(rows, error, panelMissing, errorKey) {
  curRows = error ? [] : rows;
  // errorKey = cheie de traducere (mesajul vine din main proces, deja localizat in UI)
  const msg = errorKey ? T(errorKey) : error;
  if (msg) { listEl.innerHTML = `<div class="err">${esc(msg)}</div>`; return; }
  // cu overlay pornit, lista dispare complet din fereastra - totul se afiseaza doar in overlay
  if (overlayOn) { listEl.innerHTML = `<div class="empty">${esc(T("list.overlayOn"))}</div>`; return; }
  // nu suntem pe panoul Runeshaping (ex. suntem in market) -> mesaj clar, nu lista goala
  if (panelMissing) { listEl.innerHTML = `<div class="empty">${esc(T("list.panelMissing"))}</div>`; return; }
  // prag de valoare: ascundem itemele sub minDiv (in Divine)
  const shown = rows.filter((r) => (r.totalDivine || 0) >= minDiv);
  if (!shown.length) {
    listEl.innerHTML = `<div class="empty">` + esc(rows.length ? T("list.noneAbove") : T("list.noItems")) + `</div>`;
    return;
  }
  listEl.innerHTML = shown.map((r, i) => {
    const ico = r.icon ? `<img class="ico" src="${esc(r.icon)}" alt="">` : "";
    const name = esc(r.displayName || r.matchedName || r.name);
    const tier = r.tier ? ` ${r.tier}` : "";
    const clickable = r.matchedName ? " clickable" : "";
    const spark = `<span class="spark">${sparkSvg(r.trendData, r.trend)}</span>`;
    let trend = '<span class="trend"></span>';
    if (r.trend === "up" || r.trend === "down") {
      const arrow = r.trend === "up" ? "▲" : "▼";
      const pct = Number.isFinite(r.trendPct) ? " " + Math.abs(r.trendPct).toFixed(1) + "%" : "";
      const pump = Number.isFinite(r.trendPct) && r.trendPct >= PUMP_PCT ? " pump" : "";
      trend = `<span class="trend ${r.trend}${pump}">${arrow}${pct}</span>`;
    }
    const price = r.display ? esc(r.display.text) : "?";
    return `<div class="row${tier}${clickable}" data-i="${i}">${ico}<span class="name">${name}</span>${spark}${trend}<span class="qty">${esc(r.qty)}x</span><span class="price">${price}</span></div>`;
  }).join("");
  // click pe un rand cu preț -> pagina itemului pe poe.ninja (volum, istoric)
  listEl.querySelectorAll(".row.clickable").forEach((el) => {
    el.addEventListener("click", () => {
      const r = shown[+el.dataset.i];
      if (r && r.matchedName) window.api.openItem({ league: leagueEl.value, category: r.category, name: r.matchedName });
    });
  });
}

leagueEl.onchange = async () => {
  statusEl.textContent = T("status.switchingLeague");
  await window.api.setLeague(leagueEl.value);
  statusEl.textContent = T("status.league", { league: leagueEl.value });
  const cfg = await window.api.getConfig();
  setPricesTime(cfg.pricesAt, cfg.pricesStale);
  const r = await window.api.scanNow();
  render(r.rows, r.error, r.panelMissing, r.errorKey);
};

let hasRegion = false;
let guideEnabled = false;
async function boot() {
  const cfg = await window.api.getConfig();
  const leagues = cfg.availableLeagues || [];
  // Guide tab: ascuns daca e dezactivat in main (flag GUIDE_ENABLED)
  guideEnabled = !!cfg.guideEnabled;
  const guideBtn = document.getElementById("tabBtnGuide");
  if (guideBtn) guideBtn.style.display = guideEnabled ? "" : "none";
  if (!guideEnabled && document.getElementById("tab-guide")) {
    document.getElementById("tab-guide").hidden = true;
  }
  leagueEl.innerHTML = leagues.map(l => `<option value="${l}">${l}</option>`).join("");
  leagueEl.value = cfg.league || leagues[0] || "";
  setPricesTime(cfg.pricesAt, cfg.pricesStale);
  setOvlBtn(!!cfg.overlay);
  setSndBtn(!!cfg.soundAlert);
  setNmBtn(!cfg.hideNames);
  minDiv = cfg.minDivine || 0;
  minvalEl.value = String(minDiv);
  fontSel.value = cfg.font || FontUI.DEFAULT;
  gameLangSel.value = cfg.gameLang || "auto";
  langAuto = !!cfg.langAuto;
  langSel.value = langAuto ? "auto" : (cfg.lang || I18N.lang);
  FontUI.apply(fontSel.value);   // font salvat (aplicat si pe overlay-uri la pornire)
  document.getElementById("ver").textContent = "v" + (cfg.version || "?");
  hasRegion = !!cfg.region;
  statusEl.textContent = T(hasRegion ? "status.regionSet" : "status.chooseRegion");
  checkUpdateNow(true); // fire-and-forget, silent
}
// re-verificam update la 30 min (un build pornit de mult timp prinde noul release)
setInterval(() => checkUpdateNow(true), 30 * 60 * 1000);

document.getElementById("sel").onclick = async () => {
  statusEl.textContent = T("status.dragPriceRegion");
  await window.api.selectRegion();
  statusEl.textContent = T("status.regionSaved");
};
ovlBtn.onclick = async () => {
  const r = await window.api.toggleOverlay(!overlayOn);
  if (r.ok) {
    setOvlBtn(r.on);
    render(curRows, null);   // cu overlay ON ascundem preturile din fereastra principala
    statusEl.textContent = T(r.on ? "status.overlayOn" : "status.overlayOff");
  } else {
    statusEl.textContent = T("status.overlayFailed", { error: r.error || "failed" });
  }
};
sndBtn.onclick = async () => {
  const r = await window.api.setSoundAlert(!soundOn);
  if (r.ok) {
    setSndBtn(r.on);
    statusEl.textContent = T(r.on ? "status.alertOn" : "status.alertOff");
  }
};
nmBtn.onclick = async () => {
  const r = await window.api.setHideNames(namesOn);   // namesOn=true -> ascunde numele
  if (r && r.ok) {
    setNmBtn(!r.hideNames);
    statusEl.textContent = T(r.hideNames ? "status.namesHidden" : "status.namesShown");
  }
};
minvalEl.onchange = async () => {
  const r = await window.api.setMinValue(parseFloat(minvalEl.value) || 0);
  if (r && r.ok) minDiv = r.minDivine || 0;
  render(curRows, null);   // aplica pragul imediat, fara re-scan
  statusEl.textContent = minDiv > 0 ? T("status.hidingBelow", { n: minDiv }) : T("status.showingAll");
};

// ---------- Options (meniu dropdown: limba + font + actiuni utilitare) ----------
const optBtn = document.getElementById("optBtn");
const optMenu = document.getElementById("optMenu");
const fontSel = document.getElementById("fontSel");
const langSel = document.getElementById("langSel");
const gameLangSel = document.getElementById("gameLangSel");
let langAuto = false;   // UI urmeaza limba clientului de joc
// numele limbilor in limba lor (nu se traduc)
const GAME_LANG_NAMES = { en: "English", de: "Deutsch", fr: "Français", es: "Español", pt: "Português (BR)", ru: "Русский", ja: "日本語", ko: "한국어", th: "ไทย" };
fontSel.innerHTML = FontUI.TOKENS.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");
langSel.innerHTML = `<option value="auto">${esc(T("opt.langAuto"))}</option>` +
  I18N.list().map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
gameLangSel.innerHTML = `<option value="auto">${esc(T("opt.gameLangAuto"))}</option>` +
  Object.keys(GAME_LANG_NAMES).map((c) => `<option value="${c}">${esc(GAME_LANG_NAMES[c])}</option>`).join("");
gameLangSel.onchange = async () => {
  const r = await window.api.setGameLang(gameLangSel.value);
  if (r && r.ok) {
    gameLangSel.value = r.gameLang;
    const label = r.gameLang === "auto" ? T("opt.gameLangAuto") : (GAME_LANG_NAMES[r.active] || r.active);
    statusEl.textContent = r.ocr === false ? T("status.ocrLangMissing", { lang: label }) : T("status.gameLang", { lang: label });
  }
};
function closeOpt() { optMenu.hidden = true; }
optBtn.onclick = (e) => { e.stopPropagation(); optMenu.hidden = !optMenu.hidden; };
optMenu.onclick = (e) => e.stopPropagation();   // click in meniu nu-l inchide
document.addEventListener("click", () => closeOpt());
fontSel.onchange = async () => {
  const r = await window.api.setFont(fontSel.value);
  if (r && r.ok) { FontUI.apply(r.font); statusEl.textContent = T("status.font", { font: FontUI.byId(r.font).label }); }
};
// schimbarea limbii: o salvam in config; main o trimite live si la overlay-uri/debug
langSel.onchange = async () => {
  const r = await window.api.setLang(langSel.value);
  if (r && r.ok) {
    langAuto = !!r.auto;
    I18N.setLang(r.lang);
    langSel.value = langAuto ? "auto" : r.lang;
    relang();
  }
};
window.api.onFont((f) => { FontUI.apply(f); fontSel.value = f; });
document.getElementById("scan").onclick = async () => {
  statusEl.textContent = T("status.scanning");
  const r = await window.api.scanNow();
  render(r.rows, r.error, r.panelMissing, r.errorKey);
  statusEl.textContent = T("status.done", { n: r.rows.length });
};
document.getElementById("optRefresh").onclick = async () => {
  statusEl.textContent = T("status.loadingPrices");
  const r = await window.api.refreshPrices();
  if (r.at) setPricesTime(r.at, r.stale);
  statusEl.textContent = r.ok
    ? (r.stale ? T("status.pricesCached", { n: r.count }) : T("status.pricesUpdated", { n: r.count }))
    : T("status.error", { error: r.error });
  closeOpt();
};
document.getElementById("optOcr").onclick = async () => {
  statusEl.textContent = T("status.ocrChecking");
  const r = await window.api.checkOcr();
  if (r.ok && r.engine) {
    const langs = (r.langs && r.langs.length) ? r.langs.join(", ") : "profile languages";
    statusEl.textContent = T("status.ocrOk", { langs });
  } else if (r.ok && !r.engine) {
    statusEl.textContent = T("status.ocrMissing");
  } else {
    statusEl.textContent = T("status.ocrFailed", { error: r.error || T("common.random") });
  }
  closeOpt();
};
document.getElementById("bmc").onclick = () => {
  window.api.openExternal("https://buymeacoffee.com/iulian.icb");
};

// ---------- update (GitHub Releases) ----------
let updateInfo = null; // { latest, current, releaseUrl, assets } cand e disponibil
const updBanner = document.getElementById("updBanner");
const updBtn = document.getElementById("optUpdate");

async function checkUpdateNow(silent) {
  try {
    const r = await window.api.checkUpdate();
    if (!r || !r.ok) { if (!silent) statusEl.textContent = T("status.updateCheckFailed"); return; }
    if (r.updateAvailable) {
      updateInfo = r;
      updBanner.hidden = false;
      updBanner.textContent = T("banner.update", { latest: r.latest, current: r.current });
      updBtn.textContent = T("opt.updateNow");
      if (!silent) statusEl.textContent = T("status.updateAvailable", { ver: r.latest });
    } else {
      updateInfo = null;
      updBanner.hidden = true;
      updBtn.textContent = T("opt.update");
      if (!silent) statusEl.textContent = r.reason === "no-releases" ? T("status.noReleases") : T("status.upToDate");
    }
  } catch (e) {
    if (!silent) statusEl.textContent = T("status.updateCheckFailed");
  }
}

updBanner.onclick = () => {
  if (updateInfo && updateInfo.releaseUrl) window.api.openExternal(updateInfo.releaseUrl);
};

updBtn.onclick = async () => {
  if (!updateInfo) { await checkUpdateNow(false); return; } // recheck daca nu stim inca
  statusEl.textContent = T("status.downloading");
  updBtn.disabled = true;
  const r = await window.api.doUpdate(); // assetul e ales in main process
  updBtn.disabled = false;
  if (r.ok) statusEl.textContent = r.mode === "installer"
    ? T("status.updateInstaller", { name: r.name })
    : T("status.updatePortable", { name: r.name });
  else statusEl.textContent = T("status.updateFailed", { error: r.error });
  closeOpt();
};
document.getElementById("optDebug").onclick = () => {
  window.api.openDebug();
  closeOpt();
};

window.api.onScan((data) => {
  if (data.pricesAt) setPricesTime(data.pricesAt, data.pricesStale);
  render(data.rows, data.error, data.panelMissing, data.errorKey);
});

// alerta sonora: item nou de la 1 Divine in sus
window.api.onAlert((d) => {
  ping();
  const n = (d && d.count) || 1;
  statusEl.textContent = n > 1 ? T("status.alertMany", { n }) : T("status.alertOne");
});

// avertismente din main proces (audit S6): ex. fereastra principala s-a blocat.
// Afisam mesajul in bara de stare + il pastram vizibil pana la urmatorul scan.
let noticeText = "";
window.api.onNotice((d) => {
  if (!d) return;
  if (d.kind === "unresponsive") {
    noticeText = T("app.unresponsive");
    statusEl.textContent = noticeText;
  }
});


// ---------- tabs ----------
function showTab(which) {
  const ids = { prices: "tab-prices", planner: "tab-planner", combos: "tab-combos", guide: "tab-guide" };
  for (const k of Object.keys(ids)) {
    document.getElementById(ids[k]).hidden = k !== which;
    document.getElementById("tabBtn" + k[0].toUpperCase() + k.slice(1)).classList.toggle("active", k === which);
  }
}
document.getElementById("tabBtnPrices").onclick = () => showTab("prices");
document.getElementById("tabBtnPlanner").onclick = () => showTab("planner");
document.getElementById("tabBtnCombos").onclick = () => showTab("combos");
document.getElementById("tabBtnGuide").onclick = () => { if (guideEnabled) showTab("guide"); };

// ---------- Rune Planner ----------
let plannerRunes = [];
let plannerChase = [];
let allRecipes = [];
const TIER_ORDER = { SS: 0, S: 1, A: 2, B: 3, C: 4 };
const runeCounts = new Map();   // nume runa -> numar de aparitii (suporta duplicate)
const plExactEl = document.getElementById("plExact");
const plMoreEl = document.getElementById("plMore");
const plChipsEl = document.getElementById("plChips");
const plChaseEl = document.getElementById("plChase");
const plAdviceEl = document.getElementById("plAdvice");
const plStatusEl = document.getElementById("plStatus");

function runeShort(n) { return String(n).replace(/\s*Rune$/i, ""); }
function dgrHtml(d) { return `<span class="dgr d${d.max}" title="${esc(T("planner.dangerTip", { sum: d.sum, max: d.max }))}">${esc(T("planner.danger", { sum: d.sum }))}</span>`; }
function selectedList() { const out = []; for (const [n, c] of runeCounts) for (let i = 0; i < c; i++) out.push(n); return out; }
function bumpRune(name, delta) { const c = (runeCounts.get(name) || 0) + delta; if (c <= 0) runeCounts.delete(name); else runeCounts.set(name, c); }

async function initPlanner() {
  const d = await window.api.plannerData();
  if (!d || !d.ok) { plStatusEl.textContent = T("planner.unavailable"); return; }
  plannerRunes = d.runes;
  plannerChase = d.chase || [];
  allRecipes = d.recipes || [];
  renderChips();
  renderChase();
  renderCombos();
  RuneReader.init(plannerRunes).catch(() => {});
  window.api.getConfig().then((c) => { if (c) setRuneOvlBtn(!!c.runeOverlay); }).catch(() => {});
}
function renderChips() {
  const sorted = plannerRunes.slice().sort((a, b) =>
    (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) ||
    (b.rare ? 1 : 0) - (a.rare ? 1 : 0) ||
    a.name.localeCompare(b.name));
  plChipsEl.innerHTML = sorted.map((r) => {
    const cnt = runeCounts.get(r.name) || 0;
    const sel = cnt ? " sel" : "";
    const rare = r.rare ? " rare" : "";
    const badge = cnt > 1 ? `<b class="cn">×${cnt}</b>` : "";
    const tb = (r.tier === "SS" || r.tier === "S" || r.tier === "A") ? `<b class="tb ${r.tier}" title="${esc(T("planner.tierTip", { tier: r.tier }))}">${r.tier}</b>` : "";
    const tip = T("planner.chipTip", { rare: r.rare ? T("planner.rare") : "", tier: r.tier, effects: r.effects.join(" · ") });
    return `<div class="chip${sel}${rare}" data-name="${esc(r.name)}" title="${esc(tip)}"><img src="../data/runes/rune-${esc(r.slug)}.webp" alt="">${tb}<span>${esc(runeShort(r.name))}</span>${badge}</div>`;
  }).join("");
  plChipsEl.querySelectorAll(".chip").forEach((c) => {
    const n = c.dataset.name;
    c.onclick = () => { bumpRune(n, 1); renderChips(); updatePlan(); };
    c.oncontextmenu = (e) => { e.preventDefault(); bumpRune(n, -1); renderChips(); updatePlan(); };
  });
}
function countsOf(arr) { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; }
function renderChase() {
  if (!plannerChase.length) { plChaseEl.innerHTML = ""; return; }
  plChaseEl.innerHTML = plannerChase.map((c) => {
    const target = countsOf(c.runes);
    let on = runeCounts.size > 0;
    if (on) for (const [n, cnt] of runeCounts) if ((target.get(n) || 0) < cnt) { on = false; break; }
    const isBoon = c.kind === "boon";
    const q = c.qty > 1 ? `${c.qty}× ` : "";
    return `<div class="citem${on ? " on" : ""}"><span class="ck${isBoon ? " boon" : ""}">${esc(T(isBoon ? "planner.boon" : "planner.jackpot"))}</span><span class="cr">${q}${esc(c.reward)}</span><span class="cu">${esc(c.runes.map(runeShort).join(" · "))}</span>${on ? `<span class="cst">${esc(T("planner.onTrack"))}</span>` : ""}</div>`;
  }).join("");
}
function renderPlanList(el, arr, emptyMsg) {
  if (!arr || !arr.length) { el.innerHTML = emptyMsg ? `<div class="empty">${esc(emptyMsg)}</div>` : `<div class="empty">—</div>`; return; }
  el.innerHTML = arr.map((r) => {
    const runes = r.runes.map(runeShort).join(" · ");
    // interpolarea i18n este esc-ata (audit S5): valorile vin din fisierele noastre de date
    const extra = r.danger.extra ? esc(T("planner.moreRunes", { n: r.danger.extra })) : "";
    const costTxt = r.dispCost ? esc(T("planner.cost", { cost: r.dispCost })) : "";
    const price = r.disp ? esc(r.disp) : (r.random ? T("common.random") : "?");
    const q = r.qty > 1 ? `<span class="rq">${r.qty}×</span>` : "";
    const netHtml = r.dispNet != null ? `<span class="net ${r.netPos ? "pos" : "neg"}" title="${esc(T("planner.netTip"))}">${r.netPos ? "+" : "−"}${esc(r.dispNet)}</span>` : "";
    const boon = /boon$/i.test(r.reward) ? `<span class="boonb" title="${esc(T("planner.boonTip"))}">${esc(T("planner.boon"))}</span>` : "";
    return `<div class="pr">${q}<span class="rname">${esc(r.reward)}<span class="sub">${esc(runes)}${extra}${costTxt}</span></span>${boon}${dgrHtml(r.danger)}${netHtml}<span class="rprice">${price}</span></div>`;
  }).join("");
}
async function updatePlan() {
  const runes = selectedList();
  if (!runes.length) {
    plExactEl.innerHTML = `<div class="empty">${esc(T("planner.emptyExact"))}</div>`;
    plMoreEl.innerHTML = "";
    plAdviceEl.textContent = "";
    renderChase();
    return;
  }
  const res = await window.api.planRecipes(runes);
  if (!res || !res.ok) { plExactEl.innerHTML = `<div class="err">${esc((res && res.error) || "error")}</div>`; return; }
  renderPlanList(plExactEl, res.exact, T("planner.noExact"));
  renderPlanList(plMoreEl, res.contains, "");
  const a = res.advice || { good: [], bad: [] };
  const parts = [];
  if (a.good.length) parts.push(`<span class="spread">${esc(T("planner.spread"))}</span> ${esc(a.good.map(runeShort).join(", "))}`);
  if (a.bad.length) parts.push(`<span class="avoid">${esc(T("planner.avoid"))}</span> ${esc(a.bad.map(runeShort).join(", "))}`);
  plAdviceEl.innerHTML = parts.join(" &nbsp;·&nbsp; ");
  renderChase();
}
document.getElementById("clrRunes").onclick = () => { runeCounts.clear(); renderChips(); updatePlan(); };

// overlay separat de rune (fereastra proprie, click-through, in dreapta regiunii de rune)
const runeOvlBtn = document.getElementById("runeOvl");
function setRuneOvlBtn(on) { runeOvlBtn.textContent = T("planner.overlay", { state: stateOf(on) }); runeOvlBtn.classList.toggle("on", on); }
runeOvlBtn.onclick = async () => {
  const res = await window.api.toggleRuneOverlay(!runeOvlBtn.classList.contains("on"));
  if (res && res.ok) setRuneOvlBtn(res.on);
  else plStatusEl.textContent = T("planner.overlayFailed", { error: (res && res.error) || "failed" });
};
window.api.onRuneOverlayState((on) => setRuneOvlBtn(on));

// rune reader extracted to runereader.js (shared with the rune overlay)

document.getElementById("setRuneRegion").onclick = async () => {
  plStatusEl.textContent = T("planner.dragRuneRegion");
  await window.api.selectRuneRegion();
  plStatusEl.textContent = T("planner.runeRegionSaved");
};
document.getElementById("rdRunes").onclick = async () => {
  if (!RuneReader.ready()) { plStatusEl.textContent = T("planner.loadingTemplates"); await RuneReader.init(plannerRunes); }
  plStatusEl.textContent = T("planner.readingRunes");
  const r = await window.api.captureRunes();
  if (!r || !r.ok) { plStatusEl.textContent = T("planner.readFailed", { error: (r && r.error) || "unknown" }); return; }
  try {
    const res = await RuneReader.detect(r.dataUrl, r.scale);
    const det = res.det;
    if (!det.length) { plStatusEl.textContent = T("planner.noRunes"); return; }
    // rand fara incredere mare = probabil pamant/obiecte, nu panoul Runeshape:
    // nu importam nimic, doar spunem ce a vazut si de ce.
    if (!res.ok) {
      plStatusEl.textContent = T("planner.lowConf");
      return;
    }
    runeCounts.clear();
    let low = 0;
    for (const dm of det) { if (plannerRunes.some((x) => x.name === dm.name)) bumpRune(dm.name, 1); if (dm.sc < 0.45) low++; }
    renderChips(); updatePlan();
    const note = res.rows > 1 ? T("planner.multiRow", { rows: res.rows, n: det.length }) : "";
    plStatusEl.textContent = T("planner.detected", { list: det.map((dm) => runeShort(dm.name) + " (" + dm.sc.toFixed(2) + ")").join(", ") }) + (low ? T("planner.checkLow") : "") + note;
  } catch (e) { plStatusEl.textContent = T("planner.matchError", { error: e }); }
};

// ---------- All Combos ----------
const cbSearchEl = document.getElementById("cbSearch");
const cbCatEl = document.getElementById("cbCat");
const cbCountEl = document.getElementById("cbCount");
const cbListEl = document.getElementById("cbList");
function fmtVal(r) {
  if (r.value == null) return r.random ? T("common.random") : "—";
  return "~" + r.value + " " + (r.valueCur || "");
}
function renderCombos() {
  const q = cbSearchEl.value.trim().toLowerCase();
  const cat = cbCatEl.value;
  const arr = allRecipes.filter((r) =>
    (cat === "all" || r.category === cat) &&
    (!q || (r.reward + " " + r.runes.join(" ")).toLowerCase().includes(q)));
  arr.sort((a, b) =>
    String(a.category).localeCompare(b.category) ||
    (b.value || 0) - (a.value || 0) ||
    a.reward.localeCompare(b.reward));
  cbCountEl.textContent = T(arr.length === 1 ? "combos.countOne" : "combos.countMany", { n: arr.length }) + T("combos.hint");
  cbListEl.innerHTML = arr.map((r) => {
    const runes = r.runes.map(runeShort).join(" · ");
    const qbadge = r.qty > 1 ? `<span class="rq">${r.qty}×</span>` : "";
    const boon = /boon$/i.test(r.reward) ? `<span class="boonb">${esc(T("planner.boon"))}</span>` : "";
    return `<div class="pr">${qbadge}<span class="rname">${esc(r.reward)}<span class="sub">${esc(runes)}</span></span>${boon}<span class="ctag">${esc(r.category || "")}</span>${dgrHtml(r.danger)}<span class="rprice">${esc(fmtVal(r))}</span></div>`;
  }).join("") || `<div class="empty">${esc(T("combos.none"))}</div>`;
}
cbSearchEl.oninput = renderCombos;
cbCatEl.onchange = renderCombos;

// ---------- Guide ----------
const guideEl = document.getElementById("guideBody");
function renderGuide() {
  const all = window.GUIDE || {};
  const g = all[I18N.lang] || all.en;
  if (!g) { guideEl.innerHTML = ""; return; }
  const secs = (g.sections || []).map((s) => `<h3>${esc(s.h)}</h3>${s.b || ""}`).join("");
  let loot = "";
  const lt = window.GUIDE_LOOT;
  if (lt && g.loot) {
    const c = g.loot.cols, grp = g.loot.g;
    const row = (r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="tr ${esc(r[3][0])}">${esc(r[3])}</td></tr>`;
    const table = (rows) => `<table class="gt"><tr>${c.map((x) => `<th>${esc(x)}</th>`).join("")}</tr>${rows.map(row).join("")}</table>`;
    loot = `<h3>${esc(g.loot.title)}</h3>` +
      `<p class="glbl">${esc(grp.rumors)}</p>` + table(lt.rumors) +
      `<p class="glbl">${esc(grp.uniques)}</p>` + table(lt.uniques) +
      `<p class="glbl">${esc(grp.bosses)}</p>` + table(lt.bosses) +
      `<p class="glbl">${esc(grp.sagas)}</p>` + table(lt.sagas) +
      `<p class="gsrc">${esc(g.loot.src)}: <a href="${esc(lt.sheet)}" data-ext>${esc(g.loot.srcLink)}</a></p>`;
  }
  const link = g.link
    ? ` <a href="${esc(g.link)}" data-ext>${esc(g.linkText || g.link)}</a>`
    : "";
  guideEl.innerHTML =
    `<h2>${esc(g.title || "")}</h2>` +
    `<p class="gsub">${esc(g.sub || "")}</p>` +
    secs +
    loot +
    `<div class="credit">${esc(g.credit || "")}${link ? `<span class="src">${link}</span>` : ""}</div>`;
  guideEl.scrollTop = 0;
  guideEl.querySelectorAll("a[data-ext]").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); window.api.openExternal(a.getAttribute("href")); };
  });
}

// redesenam textele dinamice dupa o schimbare de limba (selector live)
function relang() {
  langSel.options[0].textContent = T("opt.langAuto");
  gameLangSel.options[0].textContent = T("opt.gameLangAuto");
  langSel.value = langAuto ? "auto" : I18N.lang;
  setOvlBtn(overlayOn); setSndBtn(soundOn); setNmBtn(namesOn);
  setPricesTime(lastPricesAt, lastPricesStale);
  render(curRows, null);
  renderChips(); renderChase(); updatePlan(); renderCombos();
  if (guideEnabled) renderGuide();
  statusEl.textContent = T(hasRegion ? "status.regionSet" : "status.chooseRegion");
  checkUpdateNow(true);
}

async function start() {
  await I18N.init();
  I18N.apply(document);
  await boot();
  await initPlanner();
  relang();
  I18N.live(() => relang());
}
start();
