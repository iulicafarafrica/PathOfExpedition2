// Geometria decuparii capturii de ecran - functie pura (testabila fara Electron).
//
// Captura vine ca un "thumbnail" al intregului display (desktopCapturer).
// Thumbnail-ul e scalat la o anumita latime/inaltime, deci coordonatele regiunii
// (in DIP, relative la display) trebuie transformate in pixeli ai thumbnail-ului.
//
// scaleX = thumbW / displayW  (pixeli de thumbnail per DIP)
// rectul rezultat: { px, py, pw, ph } in pixeli de thumbnail.
//
// NOTA: rectul NU e incadrat in imagine - semnul lui e negativ daca regiunea
// iese din ecran (la fel ca in implementarea originala); intersectia se face
//  la decupare (vezi intersect()).

"use strict";

function computeCropRect(region, dispBounds, thumbSize) {
  const W = Math.max(0, Math.round(thumbSize.width));
  const H = Math.max(0, Math.round(thumbSize.height));
  if (!region || !dispBounds || W <= 0 || H <= 0) return { px: 0, py: 0, pw: 0, ph: 0, W, H };
  const kx = W / dispBounds.width;
  const ky = H / dispBounds.height;
  return {
    px: Math.round((region.x - dispBounds.x) * kx),
    py: Math.round((region.y - dispBounds.y) * ky),
    pw: Math.round(region.width * kx),
    ph: Math.round(region.height * ky),
    W,
    H,
  };
}

// intersectia rectului cu imaginea (pixeli valizi din captura).
// Pixelii sursa valizi sunt cei cu 0 <= px+x < W  ->  x in [max(0,-px), min(pw, W-px))
// dx/dy = offsetul in bufferul de iesire (pixelii din afara imaginii raman 0/transparenti,
// exact ca in implementarea originala).
function intersect(rect) {
  const dx = Math.max(0, -rect.px);
  const dy = Math.max(0, -rect.py);
  const iw = Math.max(0, Math.min(rect.pw, rect.W - rect.px) - dx);
  const ih = Math.max(0, Math.min(rect.ph, rect.H - rect.py) - dy);
  return { ix: rect.px + dx, iy: rect.py + dy, iw, ih, dx, dy };
}

module.exports = { computeCropRect, intersect };
