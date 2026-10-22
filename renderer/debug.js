// Scriptul aplicatiei pentru debug.html (extras din HTML ca sa putem
// folosi o CSP fara 'unsafe-inline').
const metaEl = document.getElementById("meta");
const ocrEl = document.getElementById("ocr");
const logsEl = document.getElementById("logs");
const T = (k, v) => I18N.t(k, v);

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
}

// logurile vin ca DELTA (doar liniile noi) - nu re-trimitem tot bufferul la 1.5s
let logBuf = [];
let lastSeq = 0;

async function refresh() {
  const d = await window.api.getDebug(lastSeq);
  const pricesAgo = d.pricesAt ? T("debug.pricesAgo", { s: Math.round((Date.now() - d.pricesAt) / 1000) }) : T("debug.pricesNever");
  metaEl.innerHTML =
    `${esc(T("debug.metaLeague"))} <b>${esc(d.league || "?")}</b> &nbsp;|&nbsp; ${esc(T("debug.metaRegion"))} <b>${esc(T(d.region ? "debug.regionSet" : "debug.regionNot"))}</b> &nbsp;|&nbsp; ${esc(T("debug.metaPrices"))} <b>${esc(pricesAgo)}</b>`;

  ocrEl.innerHTML = d.ocrLines.length
    ? d.ocrLines.map((t, i) => `${i + 1}. ${esc(t)}`).join("\n")
    : `<span class="empty">${esc(T("debug.noOcr"))}</span>`;

  if (d.full) logBuf = d.logs.slice().reverse();
  else if (d.logs && d.logs.length) logBuf = d.logs.slice().reverse().concat(logBuf);
  if (logBuf.length > 300) logBuf = logBuf.slice(0, 300);
  lastSeq = d.seq || lastSeq;

  logsEl.innerHTML = logBuf.length
    ? logBuf.map(esc).join("\n")
    : `<span class="empty">${esc(T("debug.noLogs"))}</span>`;
}

function relang() {
  I18N.apply(document);
  document.title = T("debug.title") + " — Path of Expedition";
}
I18N.init().then(() => { relang(); refresh(); }).catch(() => refresh());
I18N.live(() => { relang(); refresh(); });
setInterval(refresh, 1500);
