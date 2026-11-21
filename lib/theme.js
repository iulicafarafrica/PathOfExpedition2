// Temele UI pentru fereastra principala. Sunt doar culori CSS - overlay-ul de
// peste joc si OCR-ul nu depind de ele, deci nu pot strica preturile sau captura.
"use strict";

const THEMES = ["parchment", "dark", "light"];
const DEFAULT = "parchment";

function normalize(id) {
  const s = String(id || "");
  return THEMES.includes(s) ? s : DEFAULT;
}

module.exports = { THEMES, DEFAULT, normalize };
