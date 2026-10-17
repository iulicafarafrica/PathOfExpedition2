const { app, BrowserWindow, ipcMain, desktopCapturer, screen, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { parseLines } = require("./rows");

// ---------- logging ----------
const LOG_FILE = path.join(os.tmpdir(), "xpc-debug.log");
let logLines = [];        // buffer circular de loguri (pt fereastra Debug)
let lastOcrLines = [];    // liniile OCR brute din ultimul scan (pt Debug)
const LOG_BUF_MAX = 300;
function pushLog(line) {
  logLines.push(line);
  if (logLines.length > LOG_BUF_MAX) logLines.shift();
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
  pushLog(line);
  console.log(line);
}
log("=== START ===");
log("configPath:", path.join(app.getPath ? "(app not ready)" : "", "config.json"));

let win = null;
let debugWin = null;   // fereastra Debug (log OCR)
let config = loadConfig();
let pollTimer = null;
let selectOpen = false;   // True cand box-ul de selectie e deschis (nu fac scan)
let ocrProc = null;       // procesul PowerShell pentru Windows OCR (cald)
let ocrPending = null;    // request-ul in asteptare
let ocrScriptTmp = null;  // path-ul la scriptul .ps1 scris in temp

// ---------- OCR: Windows OCR nativ (WinRT) printr-un proces PowerShell cald ----------
const OCR_PS1 = `Add-Type -AssemblyName System.Runtime.WindowsRuntime
# stdout MUSTI fie UTF-8: altfel PowerShell 5.1 scrie in codepage-ul OEM (ex. CP437,
# unde bullet-ul "•" = byte 0x07) si Node primeste caractere de control care rup JSON-ul.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function AwaitWinRt([object]$a, [type]$t) {
  $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  } | Select-Object -First 1
  $task = $m.MakeGenericMethod($t).Invoke($null, @($a))
  $task.Wait()
  return $task.Result
}
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Error "No OCR engine"; exit 1 }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim()
  if ($p -eq "") { continue }
  try {
    $file = AwaitWinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $stream = AwaitWinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = AwaitWinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = AwaitWinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try { [void]$stream.Dispose() } catch {}
    if ($bmp.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8) {
      $bmp = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bmp, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
    }
    $result = AwaitWinRt ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $lines = @()
    foreach ($ln in $result.Lines) {
      # BoundingRect la Lines e NULL; folosim Words pentru Y
      $ys = @(); $xs = @()
      foreach ($w in $ln.Words) {
        if ($w.BoundingRect) { $ys += $w.BoundingRect.Y; $xs += $w.BoundingRect.X }
      }
      $minY = if ($ys.Count -gt 0) { [math]::Round(($ys | Measure-Object -Minimum).Minimum, 1) } else { 0 }
      $minX = if ($xs.Count -gt 0) { [math]::Round(($xs | Measure-Object -Minimum).Minimum, 1) } else { 0 }
      # sanitizeaza textul: elimina control chars care rupe JSON-ul
      # IMPORTANT: backslash-urile din regex-uri sunt dublate intentional;
      # acest string e un template literal JS, altfel ar fi interpretat de JS.
      $cleanText = ($ln.Text -replace "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", " ") -replace "\\s+", " "
      $lines += [ordered]@{ text = $cleanText; y = $minY; x = $minX }
    }
    $resp = [ordered]@{ ok = $true; lines = $lines }
  } catch {
    $resp = [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
  Write-Output ($resp | ConvertTo-Json -Depth 4 -Compress)
  [Console]::Out.Flush()
}
`;
function ocrScriptPath() {
  // Numele contine hash-ul continutului: daca scriptul OCR se schimba, scriem un fisier
  // NOU, ca sa nu-l reutilizam pe cel vechi/corupt ramas in temp (fisierul vechi poate fi
  // inca folosit de un proces OCR deja pornit, deci nu-l rescriem peste el).
  const ver = require("crypto").createHash("sha1").update(OCR_PS1).digest("hex").slice(0, 8);
  const target = path.join(os.tmpdir(), `xpc-ocr-${ver}.ps1`).replace(/\//g, "\\");
  if (ocrScriptTmp === target && fs.existsSync(target)) return target;
  if (!fs.existsSync(target)) {
    try { fs.writeFileSync(target, OCR_PS1, "utf8"); }
    catch (e) { log("ocrScriptPath: nu pot scrie scriptul OCR:", target, String(e)); }
  }
  if (fs.existsSync(target)) ocrScriptTmp = target;
  // curatenie best-effort: eliminam versiunile vechi de script (pot fi blocate -> ignoram)
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (/^xpc-ocr(-v?[0-9a-f]{8})?\.ps1$/.test(f) && f !== path.basename(target)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
      }
    }
  } catch {}
  return ocrScriptTmp || target;
}
function ensureOcrProc() {
  if (ocrProc && !ocrProc.killed) return ocrProc;
  ocrProc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-NoLogo", "-ExecutionPolicy", "Bypass", "-File", ocrScriptPath()],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );
  ocrProc.stdout.setEncoding("utf8");
  ocrProc.stderr.setEncoding("utf8");
  let buf = "";
  ocrProc.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line) continue;
      log("OCR-STDOUT:", line.slice(0, 100));
      if (ocrPending) {
        const cb = ocrPending;
        ocrPending = null;
        try { cb(JSON.parse(line)); }
        catch (e) {
          // defensiv: daca PowerShell tot iese in codepage OEM, apar caractere
          // de control in interiorul stringurilor JSON -> le eliminam si repetam.
          try {
            const cleaned = line.split("").filter((c) => c.charCodeAt(0) >= 32).join("");
            cb(JSON.parse(cleaned));
          } catch (e2) { log("OCR-JSON-PARSE-ERROARE:", e.message, "line=", JSON.stringify(line.slice(0,80))); cb({ ok: false, error: String(e) }); }
        }
      }
    }
  });
  ocrProc.on("exit", () => { ocrProc = null; });
  ocrProc.on("error", () => { ocrProc = null; });
  return ocrProc;
}
function ocrRecognize(imagePath) {
  return new Promise((resolve) => {
    // Daca un request anterior inca asteapta (PowerShell/WinRT blocat), il anulam
    // si recream procesul - altfel noul request scrie intr-un proces blocat si pica.
    if (ocrPending) {
      log("OCR: proces ocupat, resetez (self-heal)");
      try { if (ocrProc) ocrProc.kill(); } catch {}
      ocrProc = null;
      ocrPending = null;
    }
    const proc = ensureOcrProc();
    const timer = setTimeout(() => {
      // Proces blocat: il omoram ca urmatorul scan sa porneasca proaspat.
      log("OCR timeout: omor procesul OCR (self-heal)");
      try { proc.kill(); } catch {}
      if (ocrProc === proc) ocrProc = null;
      ocrPending = null;
      resolve({ ok: false, error: "OCR timeout" });
    }, 20000);
    ocrPending = (result) => { clearTimeout(timer); ocrPending = null; resolve(result); };
    try { proc.stdin.write(imagePath + "\n"); }
    catch (e) {
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      if (ocrProc === proc) ocrProc = null;
      ocrPending = null;
      resolve({ ok: false, error: String(e) });
    }
  });
}
let lastRows = [];

// ---------- health-check OCR (butonul "Check OCR") ----------
// Verifica daca Windows OCR (WinRT Windows.Media.Ocr) e disponibil, ce limbi sunt
// instalate si daca motorul se creeaza din limbile profilului. Returneaza JSON.
const OCR_CHECK_PS1 = [
  "try {",
  "  Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "  $null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]",
  "  $langs = @()",
  "  try { $langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) } catch {}",
  "  $engine = $null",
  "  try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() } catch {}",
  "  $obj = [ordered]@{ ok = $true; engine = ($null -ne $engine); langs = $langs }",
  "  ConvertTo-Json -InputObject $obj -Compress",
  "} catch {",
  "  ConvertTo-Json -InputObject ([ordered]@{ ok = $false; error = $_.Exception.Message }) -Compress",
  "}",
].join("\n");

function checkOcrHealth() {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", OCR_CHECK_PS1],
        { windowsHide: true }
      );
    } catch (e) { return resolve({ ok: false, error: String(e) }); }
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => resolve({ ok: false, error: String(e) }));
    p.on("close", () => {
      const raw = out.trim();
      try { resolve(JSON.parse(raw)); }
      catch { resolve({ ok: false, error: (err.trim() || raw || "Unknown OCR error") }); }
    });
  });
}

// ---------- update (GitHub Releases) ----------
// Verificam ultimul release din repo; daca versiunea e mai noua ca cea curenta,
// aratam "Update available". Butonul Update descarca noul exe si il lanseaza.
const GITHUB_REPO = "iulicafarafrica/PathOfExpedition2";
const GITHUB_API_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

function parseVer(v) {
  return String(v || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}
function isNewerVer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function checkUpdate() {
  try {
    const r = await fetch(GITHUB_API_LATEST, {
      headers: { "User-Agent": NINJA_UA, "Accept": "application/vnd.github+json" },
    });
    if (r.status === 404) return { ok: true, updateAvailable: false, reason: "no-releases" };
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    const latest = String(j.tag_name || "").replace(/^v/i, "");
    const cur = app.getVersion();
    const assets = (j.assets || [])
      .filter((a) => /\.exe$/i.test(a.name))
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    return {
      ok: true,
      current: cur,
      latest,
      updateAvailable: isNewerVer(latest, cur),
      releaseUrl: j.html_url,
      assets,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Alege asset-ul: preferim exe-ul PORTABLE (fara "Setup" in nume), altfel orice .exe.
function pickAsset(assets) {
  if (!assets || !assets.length) return null;
  return assets.find((a) => !/setup/i.test(a.name)) || assets[0];
}

async function doUpdate(asset) {
  if (!asset || !asset.url) throw new Error("No asset to download");
  const dest = path.join(os.tmpdir(), asset.name.replace(/[^\w.\- ]+/g, "_"));
  const r = await fetch(asset.url, { headers: { "User-Agent": NINJA_UA } });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log(`update: downloaded ${asset.name} (${buf.length} bytes) -> ${dest}`);
  const launchErr = await shell.openPath(dest); // pornește noul exe / installerul
  if (launchErr) throw new Error(launchErr);
  return dest;
}

// ---------- prețuri PoE Ninja ----------
// Endpoint: GET /poe2/api/economy/exchange/current/overview?league=...&type=...
// Return: { lines: [{id, primaryValue, ...}], items: [{id, name, category}], core: {...} }
// primaryValue = pret in moneda PRIMARA a ligii (core.primary: de obicei "divine",
// dar pe hardcore poate fi "exalted"). Normalizam totul la "per 1 Divine" mai jos.
const NINJA_BASE = "https://poe.ninja/poe2/api/economy";
const NINJA_UA = "PathOfExpedition/1.0 (desktop app; contact: local)";
// Categoriile care pot aparea ca recompense in panoul Runeshape (ca la fork-uri).
// Categoriile care apar efectiv ca recompense in panoul Runeshape/Expedition.
// Identic cu cele doua fork-uri de referinta (Endre + pedro); restul categoriilor
// nu apar niciodata in panou si doar maresc suprafata de potriviri fuzzy gresite.
const NINJA_TYPES = ["Currency", "Runes", "Expedition", "Verisium", "UncutGems"];
// Ligile oferite in dropdown (ca fork-ul pedro: AppConfig.AvailableLeagues).
// Sirul e folosit VERBATIM ca parametru "league" al API-ului poe.ninja, asa ca
// "HC X" e varianta Hardcore a ligii "X". "Standard" e liga permanenta (poe.ninja
// are date reale de exchange pentru ea); "Hardcore" permanent e omis intentionat
// (poe.ninja n-are date de exchange pentru el).
const AVAILABLE_LEAGUES = ["Forbidden Rites", "HC Forbidden Rites", "Runes of Aldur", "HC Runes of Aldur", "Standard"];
let priceCache = { map: {}, fetchedAt: 0 };   // map: nameLower -> {price, id, name}; price = in Divine
const PRICE_TTL = 5 * 60 * 1000;               // 5 min (respectam cache-ul lor ~5 min)
// rate-uri: cate unitati de moneda core per 1 Divine (calculate din core.rates al API-ului)
let xchgRates = { chaos: null, exalted: null };

function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// pentru matching: normalizeaza si posesivele (jeweller s -> jewellers)
function matchKey(s) {
  return normName(s).replace(/\b(\w+) s\b/g, "\$1s").replace(/\s+/g, " ").trim();
}
async function fetchPrices(league) {
  log("fetchPrices: START league=", league);
  const headers = {
    "User-Agent": NINJA_UA,
    "Accept": "application/json",
    "Referer": "https://poe.ninja/poe2/",
  };
  const tasks = NINJA_TYPES.map(async (type) => {
    const url = `${NINJA_BASE}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) { log("fetchPrices:", type, "HTTP", r.status); return []; }
      const j = await r.json();
      // moneda primara a ligii + rate-urile. rates[x] = cate x = 1 unitate primara.
      // (pe softcore primary=divine; pe hardcore primary=exalted si rates are "divine")
      const primary = (j && j.core && j.core.primary) || "divine";
      const rates = (j && j.core && j.core.rates) || {};
      const divPerPrimary = primary === "divine" ? 1 : (rates.divine || 0);
      const exPerPrimary = primary === "exalted" ? 1 : (rates.exalted || 0);
      const chaosPerPrimary = rates.chaos || 0;
      // normalizam rate-urile la "per 1 Divine" (identice in orice tip)
      if (divPerPrimary > 0) {
        if (exPerPrimary) xchgRates.exalted = exPerPrimary / divPerPrimary;
        if (chaosPerPrimary) xchgRates.chaos = chaosPerPrimary / divPerPrimary;
      }
      const byId = {};
      (j.items || []).forEach((it) => { if (it.id) byId[it.id] = it; });
      const out = [];
      for (const line of j.lines || []) {
        const it = byId[line.id];
        if (!it || !it.name) continue;
        // pretul in Divine: primaryValue e in moneda primara -> convertim
        const divine = (line.primaryValue || 0) * (divPerPrimary || 1);
        out.push({ id: line.id, name: it.name, price: divine, category: it.category });
      }
      if (out.length) log("fetchPrices:", type, "->", out.length, "itemuri (primary=" + primary + ")");
      return out;
    } catch (e) {
      log("fetchPrices:", type, "ERROARE", e.message);
      return [];
    }
  });
  const results = await Promise.all(tasks);
  const map = {};
  for (const arr of results) {
    for (const p of arr) {
      const key = matchKey(p.name);
      if (key && !map[key]) map[key] = p;
    }
  }
  // bucket pe lungimea cheii (folosit de pasul fuzzy, ca in fork-uri)
  const keysByLength = {};
  for (const k of Object.keys(map)) {
    (keysByLength[k.length] = keysByLength[k.length] || []).push(k);
  }
  priceCache = { map, keysByLength, fetchedAt: Date.now() };
  log("fetchPrices: GATA total", Object.keys(map).length, "itemuri");
  return map;
}
// --- matching fuzzy (OCR garble: "Chaos"->"Chao", "Jeweller's"->"Jeweller s") ---
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
// similaritate 0..1 intre doua chei normalizate (edit-distance, FARA bonus de substring)
function keySimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
// fallback pentru cifre OCR confundate cu litere (0->o, 1->l, 5->s, 8->b), ca in fork-uri
function digitFold(s) {
  return s.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s").replace(/8/g, "b");
}
// gemurile necizelate au preturi foarte diferite intre niveluri: fara nivel citit -> fara pret
function isUncutGem(key) {
  return /uncut (skill|spirit|support) gem/.test(key);
}
// prag-uri identice cu fork-urile (price-match.ts / ScanEngine.cs)
const PREFIX_MIN_LENGTH = 10;
const FUZZY_MIN_LENGTH = 6;
const FUZZY_THRESHOLD = 0.84;
const HIGH_CONFIDENCE_THRESHOLD = 0.92;
// cel mai bun candidat fuzzy: doar chei cu lungime in [len-3, len+3], scor edit-distance
function bestFuzzyMatch(name) {
  let bestKey = null;
  let bestScore = FUZZY_THRESHOLD; // trebuie sa depaseasca strict pragul
  for (let len = Math.max(0, name.length - 3); len <= name.length + 3; len++) {
    const bucket = priceCache.keysByLength[len];
    if (!bucket) continue;
    for (const k of bucket) {
      const s = keySimilarity(name, k);
      if (s > bestScore) { bestScore = s; bestKey = k; }
    }
  }
  return bestKey ? { key: bestKey, score: bestScore } : null;
}
// exact -> digit-fold exact -> prefix (>=10) -> fuzzy (>=6, bucket ±3, 0.84)
// Algoritm portat din ambele fork-uri. NU folosim "contains": altfel "mind rune"
// s-ar potrivi gresit cu "perfect mind rune".
function lookupPrice(name) {
  const key = matchKey(name);
  if (!key) return null;
  const hit = (k, exact) => ({ ...priceCache.map[k], matchedKey: k, exact });
  // 1. exact
  if (priceCache.map[key]) return hit(key, true);
  // 2. gem fara nivel citit / fara potrivire exacta -> necunoscut (nu ghicim nivelul)
  if (isUncutGem(key)) return null;
  // 3. digit-folded exact
  if (/\d/.test(key)) {
    const folded = digitFold(key);
    if (folded !== key && priceCache.map[folded]) return hit(folded, true);
  }
  // 4. prefix (doar nume lungi; extrage cheia cea mai scurta care incepe cu numele)
  if (key.length >= PREFIX_MIN_LENGTH) {
    let bestKey = null;
    for (const k of Object.keys(priceCache.map)) {
      if (k.startsWith(key) && (bestKey === null || k.length < bestKey.length)) bestKey = k;
    }
    if (bestKey !== null) return hit(bestKey, true);
  }
  // 5. fuzzy (edit-distance, bucket de lungime)
  if (key.length >= FUZZY_MIN_LENGTH) {
    const f = bestFuzzyMatch(key);
    if (f) return hit(f.key, f.score >= HIGH_CONFIDENCE_THRESHOLD);
  }
  return null;
}

// ---------- afisare preț in moneda corecta (logica autoCurrency din fork-uri) ----------
// Regula (identica cu Exiled Exchange 2 / PoeAncientsPriceHelper):
//   pret in Divine >= ~1  -> afisam in Divine
//   pret in Divine <  ~1  -> afisam in moneda "core" (Exalted, fallback Chaos)
// Adica itemii ieftini apar in Exalted, iar cei scumpi in Divine.
// Rotunjire de AFIȘARE, portata 1:1 din fork (Prices.ts -> displayRounding).
// Diferenta fata de vechiul formatValue: sub 10 se face toFixed(1) (nu toFixed(2)),
// peste 2250 se scurteaza k/m/b/t, restul se rotunjeste la intreg.
function formatValue(v, truncateLargeNumbers = true) {
  const a = Math.abs(v);
  if (a < 10) return String(Number(v.toFixed(1)));
  if (truncateLargeNumbers && a > 2250) {
    if (a < 1050000) return Number((v / 1000).toFixed(1)) + "k";
    if (a < 1050000000) return Number((v / 1000000).toFixed(1)) + "m";
    if (a < 1050000000000) return Number((v / 1e9).toFixed(1)) + "b";
    return Number((v / 1e12).toFixed(1)) + "t";
  }
  return String(Math.round(v));
}
// moneda core pentru itemii ieftini: Exalted (ca la fork-uri), fallback Chaos.
function coreCurrency() {
  if (xchgRates.exalted) return { id: "exalted", abbrev: "ex", perDiv: xchgRates.exalted };
  if (xchgRates.chaos) return { id: "chaos", abbrev: "c", perDiv: xchgRates.chaos };
  return null;
}
// divineValue = pretul (totalul stack-ului) in Divine.
// disp = "auto" (implicit) | "div" | "exalted" | "chaos".
function displayPrice(divineValue, disp) {
  if (divineValue == null) return null;
  const divText = () => ({ value: divineValue, currency: "div", text: formatValue(divineValue) + " div" });
  if (disp === "div") return divText();
  if (disp === "exalted") {
    if (!xchgRates.exalted) return divText();
    const v = divineValue * xchgRates.exalted;
    return { value: v, currency: "exalted", text: formatValue(v) + " ex" };
  }
  if (disp === "chaos") {
    if (!xchgRates.chaos) return divText();
    const v = divineValue * xchgRates.chaos;
    return { value: v, currency: "chaos", text: formatValue(v) + " c" };
  }
  // "auto": ieftin -> moneda core (ex), scump (~>=1 div) -> divine
  const core = coreCurrency();
  if (!core) return divText();
  const coreValue = divineValue * core.perDiv;
  if (coreValue > core.perDiv * 0.94) {          // ~ >= 1 Divine
    if (coreValue < core.perDiv * 1.06) return { value: 1, currency: "div", text: "1 div" };  // snap la 1 div
    return divText();
  }
  return { value: coreValue, currency: core.id, text: formatValue(coreValue) + " " + core.abbrev };
}

// ---------- config ----------
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function loadConfig() {
  const defaults = { league: "Forbidden Rites", region: null };
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    log("loadConfig: citit", raw.length, "chari");
    const cfg = Object.assign({}, defaults, JSON.parse(raw));
    log("loadConfig: OK");
    return cfg;
  } catch (e) {
    log("loadConfig: ERROARE", e.message);
    return defaults;
  }
}
function saveConfig() {
  try {
    const s = JSON.stringify(config, null, 2);
    log("saveConfig: stringify OK", s.length, "chari");
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), s);
    log("saveConfig: scris OK");
  } catch (e) {
    log("saveConfig: ERROARE", e.message);
  }
}

// ---------- fereastra ----------
function createWindow() {
  const b = config.window;
  win = new BrowserWindow({
    width: b?.width || 720,
    height: b?.height || 640,
    x: b?.x,
    y: b?.y,
    minWidth: 600,
    minHeight: 480,
    title: "Path of Expedition",
    backgroundColor: "#111827",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.setMenuBarVisibility(false);   // fara meniul File/Edit/View (neprofesional)
  win.on("close", () => {
    const r = win.getBounds();
    config.window = { x: r.x, y: r.y, width: r.width, height: r.height };
    saveConfig();
  });
}

// ---------- regiune (captura ecran) ----------
async function captureRegion(region) {
  const displays = screen.getAllDisplays();
  const disp = displays.find((d) => d.id === region.displayId) || screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(disp.size.width * disp.scaleFactor),
      height: Math.round(disp.size.height * disp.scaleFactor),
    },
    fetchWindowIcons: false,
  });
  const src = sources.find((s) => s.display_id === String(disp.id)) || sources[0];
  const size = src.thumbnail.getSize();
  const bmp = src.thumbnail.toBitmap();
  const W = size.width;
  const H = size.height;
  // convertim coordonatele regiunii (DIP) in pixeli
  const kx = W / disp.bounds.width;
  const ky = H / disp.bounds.height;
  const px = Math.round((region.x - disp.bounds.x) * kx);
  const py = Math.round((region.y - disp.bounds.y) * ky);
  const pw = Math.round(region.width * kx);
  const ph = Math.round(region.height * ky);
  // crop din bitmap (BGRA)
  const full = new Uint8Array(bmp.buffer, bmp.byteOffset, bmp.length);
  const out = new Uint8Array(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    const sy = py + y;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < pw; x++) {
      const sx = px + x;
      if (sx < 0 || sx >= W) continue;
      const si = (sy * W + sx) * 4;
      const di = (y * pw + x) * 4;
      out[di] = full[si];
      out[di + 1] = full[si + 1];
      out[di + 2] = full[si + 2];
      out[di + 3] = 255;
    }
  }
  return { width: pw, height: ph, data: out };
}
// ---------- OCR (Windows OCR nativ) + parsing ----------
async function doScan() {
  log("doScan: START");
  if (selectOpen) { log("doScan: selectOpen, sarit"); return { rows: [], error: null };
  }
  if (!config.region) { log("doScan: fara regiune"); return { rows: [], error: "Choose a region first (Select region)." };
  }
  try {
    let shot = await captureRegion(config.region);
    // salvam PNG in temp (cu path Windows ca sa mearga WinRT StorageFile)
    const img = nativeImage.createFromBitmap(Buffer.from(shot.data), { width: shot.width, height: shot.height });
    const tmp = path.join(os.tmpdir(), `xpc-${Date.now()}.png`).replace(/\//g, "\\");
    fs.writeFileSync(tmp, img.toPNG());
    const result = await ocrRecognize(tmp);
    try { fs.unlinkSync(tmp); } catch {}
    log("doScan: OCR rezultat ok=", result.ok, "lines=", (result.lines||[]).length);
    if (!result.ok) { log("doScan: OCR error", result.error); return { rows: [], error: result.error || "OCR error" }; }
    const lines = (result.lines || [])
      .map((l) => ({ text: (l.text || "").trim(), y: l.y || 0 }))
      .filter((l) => l.text.length > 0);
    lastOcrLines = lines.map((l) => l.text);   // pt fereastra Debug
    const rows = parseLines(lines);
    log("doScan: rows parseate=", rows.length, JSON.stringify(rows.map((r) => r.qty + "x" + r.name)));
    // FILTRU CHAT: pastram doar randuri cu cantitate explicita (Nx) SAU item cunoscut in API.
    // Chat-ul din joc (peste panou) nu are nici "Nx", nici nu e un item -> e respins.
    const kept = [];
    for (const r of rows) {
      const p = lookupPrice(r.name);
      const qty = r.qty || 1;
      r.price = p ? p.price : null;            // pret UNITAR in Divine (raw)
      r.matchedName = p ? p.name : null;
      r.totalDivine = p ? p.price * qty : null;  // TOTALUL stack-ului in Divine (pt tier)
      // Pretul afisat = TOTALUL stack-ului (ca la fork-uri); pentru qty>1 aratam si unitar.
      const total = p ? displayPrice(p.price * qty, "auto") : null;
      const unit = (p && qty > 1) ? displayPrice(p.price, "auto") : null;
      r.display = total
        ? { value: total.value, currency: total.currency, text: total.text + (unit ? ` (${unit.text} each)` : "") }
        : null;
      if (!p && !r.explicit) { log("doScan: FILTRU (chat/zgomot):", JSON.stringify(r.raw)); continue; }
      kept.push(r);
    }
    // Tier pe valoare (ca Endre: valueTier high/mid/low) -> pentru colorare in UI.
    const priced = kept.filter((r) => r.totalDivine != null).map((r) => r.totalDivine);
    if (priced.length) {
      const max = Math.max(...priced);
      const min = Math.min(...priced);
      for (const r of kept) {
        if (r.totalDivine == null) { r.tier = null; continue; }
        r.tier = r.totalDivine === max ? "high" : r.totalDivine === min ? "low" : "mid";
      }
    }
    rows.length = 0; rows.push(...kept);
    lastRows = rows;
    return { rows, at: Date.now(), pricesAt: priceCache.fetchedAt };
  } catch (e) {
    return { rows: [], error: String(e) };
  }
}

// ---------- polling ----------
function startPoll() {
  stopPoll();
  log("startPoll: pornit");
  pollTimer = setInterval(async () => {
    const r = await doScan();
    win?.webContents.send("scan", r);
  }, 3000);
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- IPC ----------
ipcMain.handle("get-config", () => ({ ...config, availableLeagues: AVAILABLE_LEAGUES, pricesAt: priceCache.fetchedAt }));
// health-check Windows OCR (butonul "Check OCR")
ipcMain.handle("check-ocr", () => checkOcrHealth());
// update: verificare ultimul release GitHub + descarcare/lanare
ipcMain.handle("check-update", () => checkUpdate());
ipcMain.handle("do-update", async (_e, asset) => {
  try {
    const dest = await doUpdate(asset);
    return { ok: true, dest };
  } catch (e) {
    log("update failed: " + e);
    return { ok: false, error: String(e) };
  }
});
// deschide un link extern in browser-ul implicit (used by footer "Buy me a coffee")
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https:\/\//i.test(url)) shell.openExternal(url);
});
// buffer de debug: loguri + liniile OCR brute din ultimul scan
ipcMain.handle("get-debug", () => ({
  logs: logLines.slice(),
  ocrLines: lastOcrLines.slice(),
  league: config.league,
  region: config.region,
  pricesAt: priceCache.fetchedAt,
}));
// fereastra Debug (log OCR + starea app)
ipcMain.handle("open-debug", () => {
  if (debugWin && !debugWin.isDestroyed()) { debugWin.focus(); return; }
  debugWin = new BrowserWindow({
    width: 720, height: 520,
    title: "Debug — Path of Expedition",
    backgroundColor: "#111827",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  debugWin.setMenuBarVisibility(false);
  debugWin.loadFile(path.join(__dirname, "renderer", "debug.html"));
  debugWin.on("closed", () => { debugWin = null; });
});
ipcMain.handle("set-league", async (_e, league) => {
  if (!AVAILABLE_LEAGUES.includes(league)) return config.league;
  config.league = league;
  saveConfig();
  log("set-league:", league);
  // re-incarca preturile pentru noua liga
  try { await fetchPrices(league); } catch {}
  // re-scaneaza imediat (daca regiunea e deja setata) ca sa afiseze noile preturi
  if (config.region) { const r = await doScan(); win?.webContents.send("scan", r); }
  return league;
});
ipcMain.handle("refresh-prices", async () => {
  try {
    const map = await fetchPrices(config.league || "Forbidden Rites");
    return { ok: true, count: Object.keys(map).length, at: priceCache.fetchedAt };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle("scan-now", () => doScan());
ipcMain.handle("select-region", async () => {
  selectOpen = true;   // nu fac scan cat timp box-ul e deschis
  // deschide o fereastra mica simpla de selectie (drag box)
  const sel = new (require("electron").BrowserWindow)({
    width: 500,
    height: 350,
    x: 100,
    y: 100,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: "#111827ee",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  sel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sel.loadFile(path.join(__dirname, "renderer", "select.html"));
  return new Promise((resolve) => {
    ipcMain.once("region-selected", (_e, region) => {
      log("region-selected: primit", JSON.stringify(region));
      selectOpen = false;
      try {
        // completam displayId cu display-ul primar (sau cel mai apropiat)
        const disp = screen.getDisplayNearestPoint({ x: region.x + region.width / 2, y: region.y + region.height / 2 });
        config.region = { x: region.x, y: region.y, width: region.width, height: region.height, displayId: disp.id };
        saveConfig();
        startPoll();   // porneste scanarea automata imediat ce regiunea e setata
        sel.close();
        resolve(config.region);
      } catch (e) {
        console.error("SELECT-ERROR:", e);
        try { sel.close(); } catch {}
        resolve(null);
      }
    });
  });
});

// securitate: aplicația e doar local - blocam navigarea externa si crearea de ferestre
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

app.whenReady().then(async () => {
  createWindow();
  // incarca preturile la pornire (nu blocheaza UI)
  try { await fetchPrices(config.league || "Forbidden Rites"); } catch {}
  // daca regiunea e deja salvata, porneste scanarea automata (fara buton Start)
  if (config.region) startPoll();
  // auto-refresh preturi la 30 min (ca fork-ul: UPDATE_INTERVAL_MS)
  setInterval(async () => {
    try {
      await fetchPrices(config.league || "Forbidden Rites");
      log("auto-refresh: preturi actualizate", Object.keys(priceCache.map).length);
    } catch (e) { log("auto-refresh: eroare", e.message || e); }
  }, 30 * 60 * 1000);
});
app.on("window-all-closed", () => app.quit());

// prinde erorile nemanagite ca sa vedem exact unde e bug-ul
process.on("uncaughtException", (e) => {
  console.error("[UNCAUGHT]", e && e.stack ? e.stack : e);
});
process.on("unhandledRejection", (e) => {
  console.error("[UNHANDLED]", e && e.stack ? e.stack : e);
});
