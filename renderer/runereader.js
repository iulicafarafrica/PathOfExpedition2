// Rune reader (template matching) — partajat intre fereastra principala si overlay-ul de rune.
// Algoritm validat pe screenshot-ul real al panoului (20/20 pe randuri cunoscute):
// Otsu -> componente conectate -> celule icon -> pe fiecare celula: ink grayscale ->
// normalizare la bounding-box (RT) -> corelatie normalizata (NCC) cu template-urile (alpha sprite).
(function () {
  const RS = 64, RT = 48;
  let templates = null;
  let runeList = [];

  function otsuG(px) {
    const hist = new Array(256).fill(0); for (const v of px) hist[v]++;
    const total = px.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += t * hist[t]; const b = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2; if (b > best) { best = b; thr = t; } }
    return thr;
  }
  function normToF(arr, size, thrF) {
    let minx = size, miny = size, maxx = -1, maxy = -1;
    for (let i = 0; i < size * size; i++) if (arr[i] > thrF) { const x = i % size, y = (i / size) | 0; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    if (maxx < 0) return null;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    const out = new Float64Array(RT * RT);
    for (let ty = 0; ty < RT; ty++) for (let tx = 0; tx < RT; tx++) {
      const sx = minx + ((tx + 0.5) * bw) / RT, sy = miny + ((ty + 0.5) * bh) / RT;
      const x0 = Math.min(size - 1, Math.max(0, Math.floor(sx))), y0 = Math.min(size - 1, Math.max(0, Math.floor(sy)));
      const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      out[ty * RT + tx] = arr[y0 * size + x0] * (1 - fx) * (1 - fy) + arr[y0 * size + x1] * fx * (1 - fy) + arr[y1 * size + x0] * (1 - fx) * fy + arr[y1 * size + x1] * fx * fy;
    }
    return out;
  }
  function nccQ(a, b, R) {
    let best = -2;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < RT; y++) { const by = y + dy; if (by < 0 || by >= RT) continue; for (let x = 0; x < RT; x++) { const bx = x + dx; if (bx < 0 || bx >= RT) continue; const av = a[y * RT + x], bv = b[by * RT + bx]; n++; sa += av; sb += bv; saa += av * av; sbb += bv * bv; sab += av * bv; } }
      if (!n) continue; const num = n * sab - sa * sb, den = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb)); const sc = den > 0 ? num / den : -1;
      if (sc > best) best = sc;
    }
    return best;
  }
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

  async function init(runes) {
    if (Array.isArray(runes) && runes.length) runeList = runes;
    if (templates) return templates;
    const list = [];
    await Promise.all(runeList.map((r) => loadImg("../data/runes/rune-" + r.slug + ".webp").then((im) => {
      const c = document.createElement("canvas"); c.width = RS; c.height = RS;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, RS, RS); ctx.drawImage(im, 0, 0, RS, RS);
      const d = ctx.getImageData(0, 0, RS, RS).data;
      const a = new Float64Array(RS * RS); for (let i = 0; i < RS * RS; i++) a[i] = d[i * 4 + 3] / 255;
      const t = normToF(a, RS, 0.25);
      if (t) list.push({ name: r.name, img: t });
    }).catch(() => {})));
    templates = list;
    return list;
  }
  function ready() { return !!templates; }

  // lipim fragmentele aceluiasi glif (Otsu poate sparge o iconita in 2 componente):
  // aceeasi linie (suprapunere verticala mare) si separate orizontal de un gol mic.
  function mergeNear(cells, k) {
    const out = [];
    for (const cc of cells) {
      let hit = null;
      for (const m of out) {
        const gapX = Math.max(m.minx, cc.minx) - Math.min(m.maxx, cc.maxx);
        const ovY = Math.min(m.maxy, cc.maxy) - Math.max(m.miny, cc.miny) + 1;
        const nw = Math.max(m.maxx, cc.maxx) - Math.min(m.minx, cc.minx) + 1;
        if (gapX <= 3 * k && ovY > 0.5 * Math.min(m.h, cc.h) && nw <= 50 * k) { hit = m; break; }
      }
      if (hit) {
        hit.minx = Math.min(hit.minx, cc.minx); hit.miny = Math.min(hit.miny, cc.miny);
        hit.maxx = Math.max(hit.maxx, cc.maxx); hit.maxy = Math.max(hit.maxy, cc.maxy);
        hit.w = hit.maxx - hit.minx + 1; hit.h = hit.maxy - hit.miny + 1;
        hit.area = hit.w * hit.h; hit.cy = (hit.miny + hit.maxy) / 2;
      } else out.push({ ...cc });
    }
    return out;
  }

  function classifyCell(g, W, H, c) {
    const side = Math.min(c.w, c.h), ins = 0.10;
    const iw = Math.max(8, Math.round(side * (1 - 2 * ins)));
    const ix = c.minx + Math.round((c.w - iw) / 2), iy = c.maxy - side + 1 + Math.round((side - iw) / 2);
    const g64 = new Float64Array(RS * RS);
    for (let y = 0; y < RS; y++) for (let x = 0; x < RS; x++) {
      const sx0 = ix + (x * iw) / RS, sx1 = ix + ((x + 1) * iw) / RS, sy0 = iy + (y * iw) / RS, sy1 = iy + ((y + 1) * iw) / RS;
      let acc = 0, cnt = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) { if (sy < 0 || sy >= H) continue; for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) { if (sx < 0 || sx >= W) continue; acc += g[sy * W + sx]; cnt++; } }
      g64[y * RS + x] = cnt ? acc / cnt : 255;
    }
    const sorted = Array.from(g64).sort((a, b) => a - b);
    const base = sorted[Math.floor(sorted.length * 0.92)];
    const ink = new Float64Array(RS * RS);
    for (let i = 0; i < RS * RS; i++) ink[i] = Math.max(0, base - g64[i]) / 255;
    const q = normToF(ink, RS, 0.12);
    if (!q) return null;
    let best = null;
    for (const t of templates) { const sc = nccQ(q, t.img, 2); if (!best || sc > best.sc) best = { name: t.name, sc }; }
    return best;
  }

  // Un rand e "real" (panoul Runeshape) doar cand are macar o rune cu match
  // puternic SI o a doua decenta. Pe panoul real, fiecare rand are cel putin o
  // rune cu NCC >= ~0.70; pamantul/obiectele raman sub acesti praguri, asa ca
  // filtrul astea impiedica false-positives (cand panoul e inchis si in box
  // se vede pamantul/harta).
  const CONF = 0.6, CONF2 = 0.5;
  function rowOk(det) {
    if (!det || det.length < 2) return false;
    const s = det.map((d) => d.sc);
    return Math.max.apply(null, s) >= CONF && s.filter((x) => x >= CONF2).length >= 2;
  }

  async function detectRows(dataUrl, k) {
    k = k > 0 ? k : 1;
    const img = await loadImg(dataUrl);
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    const thr = otsuG(g);
    const bright = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) bright[i] = g[i] > thr ? 1 : 0;
    const lab = new Int32Array(W * H).fill(-1); const comps = []; const st = [];
    for (let i = 0; i < W * H; i++) {
      if (!bright[i] || lab[i] >= 0) continue;
      let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, area = 0, sy = 0;
      st.length = 0; st.push(i); lab[i] = i;
      while (st.length) {
        const p = st.pop(); const x = p % W, y = (p / W) | 0; area++; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (bright[q] && lab[q] < 0) { lab[q] = i; st.push(q); } }
      }
      comps.push({ minx, miny, maxx, maxy, area, w: maxx - minx + 1, h: maxy - miny + 1, cy: sy / area });
    }
    let cells = comps.filter((cc) => cc.area >= 150 * k * k && cc.w >= 18 * k && cc.w <= 50 * k && cc.h >= 18 * k && cc.h <= 55 * k && cc.w / cc.h > 0.55 && cc.w / cc.h < 1.7);
    if (!cells.length) return [];
    cells = mergeNear(cells, k);
    // grupam in randuri dupa cy, adaptiv la marimea iconitelor (prag = 0.7 * inaltimea mediana)
    const hs = cells.map((c) => c.h).sort((a, b) => a - b);
    const medH = hs[hs.length >> 1] || 30 * k;
    const gapY = Math.max(10 * k, medH * 0.7);
    const byY = cells.slice().sort((a, b) => a.cy - b.cy);
    const rows = [];
    let cur = null;
    for (const cc of byY) { if (!cur || cc.cy - cur.lastCy > gapY) { cur = { cy: cc.cy, lastCy: cc.cy, cells: [] }; rows.push(cur); } cur.cells.push(cc); cur.lastCy = cc.cy; cur.cy = (cur.cy + cc.cy) / 2; }
    rows.sort((a, b) => a.cy - b.cy);
    const out = [];
    for (const r of rows) {
      r.cells.sort((a, b) => a.minx - b.minx);
      const det = [];
      for (const cc of r.cells) { const m = classifyCell(g, W, H, cc); if (m) det.push(m); }
      out.push({ cy: r.cy, n: r.cells.length, det, ok: rowOk(det) });
    }
    return out;
  }

  async function detect(dataUrl, k) {
    const rows = await detectRows(dataUrl, k);
    if (!rows.length) return { det: [], rows: 0, sizes: [], ok: false };
    const pick = (arr) => { let b = arr[0]; for (const r of arr) if (r.det.length > b.det.length) b = r; return b; };
    const okRows = rows.filter((r) => r.ok);
    // preferam un rand cu incredere mare; daca nu e niciunul, intoarcem totusi
    // cel mai plin ca sa poata fi raportat/verificat manual (nu e "ok").
    const best = okRows.length ? pick(okRows) : pick(rows);
    return { det: best.det, rows: rows.length, sizes: rows.map((r) => r.n), cy: best.cy, ok: best.ok };
  }

  window.RuneReader = { init, ready, detect, detectRows };
})();
