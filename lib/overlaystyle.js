"use strict";
// Stilul overlay-ului in-game (opacitate, marime text, scara barelor, culori).
// Valorile vin din renderer, deci le validam aici inainte sa ajunga in config
// sau in CSS-ul overlay-ului. Functii pure -> testate in test/run.js.

const DEFAULTS = Object.freeze({
  opacity: 0.96,
  fontSize: 14,
  scale: 1,
  text: "#ead9a8",
  accent: "#86e592",
});

function clamp(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function hex(v, dflt) {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : dflt;
}

function normalize(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    opacity: clamp(s.opacity, 0.2, 1, DEFAULTS.opacity),
    fontSize: Math.round(clamp(s.fontSize, 10, 24, DEFAULTS.fontSize)),
    scale: clamp(s.scale, 0.7, 1.6, DEFAULTS.scale),
    text: hex(s.text, DEFAULTS.text),
    accent: hex(s.accent, DEFAULTS.accent),
  };
}

// Aplica un patch peste stilul curent; campurile invalide revin la valori sigure.
function patch(base, update) {
  const b = normalize(base);
  const u = update && typeof update === "object" ? update : {};
  return normalize({ ...b, ...u });
}

module.exports = { DEFAULTS, normalize, patch };
