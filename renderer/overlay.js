// Scriptul aplicatiei pentru overlay.html (extras din HTML ca sa putem
// folosi o CSP fara 'unsafe-inline').
const chipsEl = document.getElementById("chips");
const legendEl = document.getElementById("legend");

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// mini-grafic 7 zile din sparkline.data (se deseneaza direct: ultima valoare == totalChange)
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
  const col = trend === "down" ? "#ff9090" : trend === "up" ? "#7ee08a" : "#cbbc92";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

// prag pt "market mover": variatie pe 7 zile peste care marcăm itemul ca pump
const PUMP_PCT = 15;

function render(data) {
  const minDiv = (data && data.minDivine) || 0;   // prag de valoare (ascunde sub el)
  const hideNames = !!(data && data.hideNames);   // jocul arata deja numele la stanga
  const rows = ((data && data.rows) || []).filter((r) => r.y > 0 && (r.totalDivine || 0) >= minDiv);
  const scale = (data && data.scale) || 1;
  chipsEl.innerHTML = rows.map((r) => {
    // sageata + procentul exact al variatiei (sparkline.totalChange, 7 zile)
    let trend = "";
    if (r.trend === "up" || r.trend === "down") {
      const arrow = r.trend === "up" ? "▲" : "▼";
      const pct = Number.isFinite(r.trendPct) ? ` ${Math.abs(r.trendPct).toFixed(1)}%` : "";
      const pump = Number.isFinite(r.trendPct) && r.trendPct >= PUMP_PCT ? " pump" : "";
      trend = `<span class="trend ${r.trend}${pump}">${arrow}${pct}</span>`;
    }
    const spark = sparkSvg(r.trendData, r.trend);
    const ico = r.icon ? `<img class="ico" src="${esc(r.icon)}" alt="">` : "";
    const name = hideNames ? "" : `<span class="name">${esc(r.displayName || r.matchedName || r.name)}</span>`;
    // pret unitar; totalul in paranteza doar daca sunt 2x/3x sau mai multe
    const unit = r.dispUnit != null ? r.dispUnit : (r.display ? String(r.display.text).split(" (")[0] : "?");
    const price = esc(unit) + (r.dispTotal != null ? ` (${esc(r.dispTotal)})` : "");
    const top = Math.round(r.y / scale) - 5;
    const tier = r.tier ? " " + esc(r.tier) : (r.display ? "" : " unknown");
    return `<div class="bar${tier}" style="top:${top}px">${ico}${name}${spark}${trend}<span class="price">${price}</span></div>`;
  }).join("");
  // legenda doar cand exista randuri (nu peste un overlay gol)
  legendEl.hidden = rows.length === 0;
}

// overlay pur informativ: fereastra e mereu click-through, fara forward,
// deci nu intercepteaza mouse-ul si nu introduce lag in joc.

// fontul ales in Options: citim la pornire + primim live prin "app-font"
I18N.init().then(() => { I18N.apply(document); render(lastData); }).catch(() => {});
I18N.live(() => { I18N.apply(document); render(lastData); });
window.api.getConfig().then((c) => FontUI.apply((c && c.font) || FontUI.DEFAULT)).catch(() => {});
window.api.onFont((f) => FontUI.apply(f));

// acelasi canal "scan" ca fereastra principala (preload expune onScan)
let lastData = null;
window.api.onScan((d) => { lastData = d; render(d); });
