const { app, BrowserWindow, ipcMain, desktopCapturer, screen, nativeImage, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const crypto = require("crypto");
const { parseLines } = require("./rows");
const planner = require("./planner");

// alertele sonore pornesc fara gest de utilizator (altfel AudioContext-ul din renderer e blocat)
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// ---------- single instance ----------
// o singura instanta in rulare: a doua pornire nu mai merge mai departe (previne
// rulare dubla + lock-uri de fisier pe dist). Fereastra existenta: o aduci in focus.
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------- logging ----------
const LOG_FILE = path.join(os.tmpdir(), "xpc-debug.log");
let logLines = [];        // buffer circular de loguri (pt fereastra Debug)
let lastOcrLines = [];    // liniile OCR brute din ultimul scan (pt Debug)
const LOG_BUF_MAX = 300;
const LOG_MAX_BYTES = 1_000_000;   // ~1 MB; peste asta rotim (nu crestem la infinit in %TEMP%)
let logBytes = 0;                  // dimensiunea curenta a fisierului de log (tinuta manual)
try { logBytes = fs.statSync(LOG_FILE).size; } catch { logBytes = 0; }
function pushLog(line) {
  logLines.push(line);
  if (logLines.length > LOG_BUF_MAX) logLines.shift();
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  try {
    if (logBytes > LOG_MAX_BYTES) {   // rotim: pastram o singura generatie (.1)
      try { fs.renameSync(LOG_FILE, LOG_FILE + ".1"); } catch {}
      logBytes = 0;
    }
    const chunk = line + "\n";
    fs.appendFileSync(LOG_FILE, chunk);
    logBytes += Buffer.byteLength(chunk);
  } catch {}
  pushLog(line);
  console.log(line);
}
log("=== START ===");
log("configPath:", path.join(app.getPath ? "(app not ready)" : "", "config.json"));

let win = null;
let debugWin = null;   // fereastra Debug (log OCR)
let overlayWin = null;   // overlay-ul transparent peste panoul din joc
let runeOverlayWin = null;   // overlay separat, doar pt rune (Rune Planner)
let lastScanPayload = null;  // ultimul scan reusit (repornit odata cu overlay-ul)
let lastCaptureK = 0;   // raportul px fizici/DIP al ultimei capturi (alinierea chipurilor)
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
$null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
# App-ul este doar in engleza, deci vrem explicit motorul OCR englez: pe un Windows
# cu alta limba de afisare (fr/de/...), TryCreateFromUserProfileLanguages alege motorul
# acelei limbi (citeste gresit textul englez) sau da NULL daca pachetul OCR de profil
# lipseste. Fallback: limbile de profil, apoi orice limba OCR instalata.
$engine = $null
try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language "en-US")) } catch {}
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) {
  try {
    $avail = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
    if ($avail.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($avail[0]) }
  } catch {}
}
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
    catch (e) { log("ocrScriptPath: cannot write OCR script:", target, String(e)); }
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
    ["-NoProfile", "-NonInteractive", "-NoLogo", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ocrScriptPath()],
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
          } catch (e2) { log("OCR-JSON-PARSE-ERROR:", e.message, "line=", JSON.stringify(line.slice(0,80))); cb({ ok: false, error: String(e) }); }
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
      log("OCR: process busy, resetting (self-heal)");
      try { if (ocrProc) ocrProc.kill(); } catch {}
      ocrProc = null;
      ocrPending = null;
    }
    const proc = ensureOcrProc();
    const timer = setTimeout(() => {
      // Proces blocat: il omoram ca urmatorul scan sa porneasca proaspat.
      log("OCR timeout: killing OCR process (self-heal)");
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

// ---------- helper cald pt overlay-ul de rune: fereastra activa + captura rapida ----------
// Overlay-ul de rune nu are un ancor OCR ca cel de preturi (regiunea lui e doar un
// rand din panou), deci se baza doar pe potrivirea iconitelor - care poate da
// false positives pe desktop/alta aplicatie. Cerem ca fereastra din fata sa fie
// jocul; altfel overlay-ul nu deseneaza nimic (ramane complet transparent).
// Captura se face cu GDI (CopyFromScreen) intr-un proces PowerShell cald: ~45ms,
// fata de ~600ms cat dureaza desktopCapturer-ul folosit de scanarea de preturi.
const FG_PS1 = `Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][FgWin]::SetProcessDPIAware()
function Read-Fg {
  try {
    $h = [FgWin]::GetForegroundWindow()
    $procId = 0
    [void][FgWin]::GetWindowThreadProcessId($h, [ref]$procId)
    $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
    $sb = New-Object System.Text.StringBuilder 512
    [void][FgWin]::GetWindowText($h, $sb, 512)
    return [ordered]@{ ok = $true; process = $procName; title = $sb.ToString() }
  } catch {
    return [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $line = $line.Trim()
  if ($line -eq "") { continue }
  if ($line -eq "fg") {
    $obj = [ordered]@{ ok = $true; fg = (Read-Fg) }
  } elseif ($line.StartsWith("tick|")) {
    $a = $line.Split("|")
    try {
      $x = [int]$a[1]; $y = [int]$a[2]; $w = [int]$a[3]; $h = [int]$a[4]; $out = $a[5]
      $fg = Read-Fg
      $bmp = New-Object System.Drawing.Bitmap $w, $h
      $gr = [System.Drawing.Graphics]::FromImage($bmp)
      $gr.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
      $gr.Dispose()
      $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
      # luminozitate medie pe o grila rara: prinde capturile negre din fullscreen exclusiv
      $sum = 0.0; $n = 0
      for ($yy = 0; $yy -lt $h; $yy += 24) {
        for ($xx = 0; $xx -lt $w; $xx += 24) { $c = $bmp.GetPixel($xx, $yy); $sum += ($c.R + $c.G + $c.B) / 3.0; $n++ }
      }
      $bmp.Dispose()
      $obj = [ordered]@{ ok = $true; fg = $fg; path = $out; w = $w; h = $h; avg = [math]::Round($sum / [math]::Max(1, $n), 2) }
    } catch {
      $obj = [ordered]@{ ok = $false; error = $_.Exception.Message }
    }
  } else {
    continue
  }
  Write-Output ($obj | ConvertTo-Json -Compress -Depth 5)
  [Console]::Out.Flush()
}
`;
let fgProc = null, fgBuf = "", fgPending = null;
function fgScriptPath() {
  const ver = require("crypto").createHash("sha1").update(FG_PS1).digest("hex").slice(0, 8);
  const target = path.join(os.tmpdir(), `xpc-fg-${ver}.ps1`).replace(/\//g, "\\");
  if (!fs.existsSync(target)) {
    try { fs.writeFileSync(target, FG_PS1, "utf8"); }
    catch (e) { log("fgScriptPath: cannot write script:", String(e)); }
  }
  return target;
}
function ensureFgProc() {
  if (fgProc && !fgProc.killed) return fgProc;
  fgProc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-NoLogo", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", fgScriptPath()],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );
  fgProc.stdout.setEncoding("utf8");
  fgProc.stdout.on("data", (chunk) => {
    fgBuf += chunk;
    let idx;
    while ((idx = fgBuf.indexOf("\n")) >= 0) {
      const line = fgBuf.slice(0, idx).replace(/\r$/, "");
      fgBuf = fgBuf.slice(idx + 1);
      if (!line) continue;
      let obj = null;
      try { obj = JSON.parse(line); } catch {}
      if (fgPending) { const cb = fgPending; fgPending = null; cb(obj); }
    }
  });
  fgProc.on("exit", () => { fgProc = null; });
  fgProc.on("error", () => { fgProc = null; });
  log("fg: foreground helper started");
  return fgProc;
}
function stopFgProc() {
  fgPending = null;
  fgBuf = "";
  try { if (fgProc && !fgProc.killed) fgProc.kill(); } catch {}
  fgProc = null;
}
function fgRequest(line, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try { proc = ensureFgProc(); } catch { return resolve(null); }
    if (!proc) return resolve(null);
    const timer = setTimeout(() => { if (fgPending) { fgPending = null; resolve(null); } }, timeoutMs || 3000);
    fgPending = (obj) => { clearTimeout(timer); resolve(obj); };
    try { proc.stdin.write(line + "\n"); }
    catch { clearTimeout(timer); fgPending = null; resolve(null); }
  });
}
// jocul = Path of Exile / Path of Exile 2 (standalone sau Steam)
function isGameWindow(fg) {
  if (!fg || !fg.ok) return false;
  return /pathofexile|poe/i.test(fg.process || "") || /path of exile/i.test(fg.title || "");
}
// captura rapida (GDI in helper) + foreground intr-un singur round-trip (~60ms);
// renderer-ul primeste data URL-ul sau isGame:false (si nu deseneaza nimic).
let runeGrabSeq = 0, runeGrabBlack = 0, runeGrabDisabled = false;
async function captureRunesFast() {
  const r = config.runeRegion;
  if (!r) return { ok: false, error: "Set the rune region first." };
  const disp = screen.getAllDisplays().find((d) => d.id === r.displayId) || screen.getPrimaryDisplay();
  const sf = disp.scaleFactor || 1;
  const px = Math.round(r.x * sf), py = Math.round(r.y * sf);
  const pw = Math.round(r.width * sf), ph = Math.round(r.height * sf);
  const file = path.join(os.tmpdir(), "xpc-rune-frame-" + (++runeGrabSeq % 2) + ".png");
  const res = await fgRequest(`tick|${px}|${py}|${pw}|${ph}|${file}`, 4000);
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "capture helper failed" };
  if (!isGameWindow(res.fg)) return { ok: true, isGame: false };
  // GDI nu citeste jocurile in fullscreen exclusiv (captura iese neagra) -> fallback
  if (!runeGrabDisabled && typeof res.avg === "number" && res.avg < 1.5) {
    if (++runeGrabBlack >= 3) { runeGrabDisabled = true; log("rune-frame: GDI black, using desktopCapturer fallback"); }
    const legacy = await captureRunesLegacy();
    return legacy.ok ? { ...legacy, isGame: true } : legacy;
  }
  runeGrabBlack = 0;
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return { ok: false, error: String(e) }; }
  return {
    ok: true, isGame: true, width: pw, height: ph, scale: pw / r.width,
    dataUrl: "data:image/png;base64," + buf.toString("base64"),
  };
}
let lastRows = [];
let scanning = false;        // guard: nu suprapunem doua scan-uri (poll + buton)
let lastScanHash = null;     // hash-ul ultimei capturi OCR-uite (skip daca ecranul n-a schimbat)
let lastScanPricesAt = 0;    // fetchedAt-ul preturilor de la ultimul OCR (refacem daca s-au schimbat)
const ALERT_MIN_DIVINE = 1;  // alerta sonora: item (stack) de la 1 Divine in sus
let lastAlertSet = new Set();// itemele scumpe de la scanul anterior (ca sa nu sunăm repetat)

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
        ["-NoProfile", "-NonInteractive", "-NoLogo", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", OCR_CHECK_PS1],
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
// rulam varianta portable? wrapper-ul electron-builder seteaza aceste variabile;
// altfel suntem o instalare facuta cu Setup-ul.
const IS_PORTABLE = !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);

function parseVer(v) {
  return String(v || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}
// Extrage "1.2.3" dintr-un tag ("v1.0.4") SAU din numele release-ului
// ("Path of Expedition 1.0.4"). Asa update-ul merge si daca tag-ul nu e semver
// curat (ex. "Pathofexepedition103" -> luam versiunea din nume).
function extractVersion(s) {
  const m = String(s || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? `${m[1]}.${m[2]}.${m[3] || "0"}` : null;
}
function isNewerVer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// fetch cu timeout (AbortController): o retea lenta/agatata nu blocheaza pornirea
async function fetchT(url, opts = {}, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkUpdate() {
  try {
    const r = await fetchT(GITHUB_API_LATEST, {
      headers: { "User-Agent": NINJA_UA, "Accept": "application/vnd.github+json" },
    }, 10000);
    if (r.status === 404) return { ok: true, updateAvailable: false, reason: "no-releases" };
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    // versiunea: din tag, altfel din numele release-ului (tag-urile nu-s mereu semver)
    const latest = extractVersion(j.tag_name) || extractVersion(j.name) || "";
    const cur = app.getVersion();
    const assets = (j.assets || [])
      .filter((a) => /\.exe$/i.test(a.name))
      .map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        // sha256-ul asset-ului (GitHub il expune ca "digest": "sha256:...") pt verificare
        sha256: String(a.digest || "").replace(/^sha256:/i, "").toLowerCase() || null,
      }));
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

// Alege asset-ul de ACELASI TIP: instalat -> Setup, portable -> exe-ul portable.
// (altfel o instalare s-ar trezi cu o copie portable in %TEMP% si invers)
function pickAsset(assets) {
  if (!assets || !assets.length) return null;
  const setup = assets.find((a) => /setup/i.test(a.name));
  const portable = assets.find((a) => !/setup/i.test(a.name));
  return IS_PORTABLE ? (portable || setup) : (setup || portable);
}

async function doUpdate(asset) {
  if (!asset || !asset.url) throw new Error("No asset to download");
  // Doar host-uri GitHub: asset-ul vine din release-ul nostru, niciodata un URL arbitrar.
  const host = new URL(asset.url).hostname;
  if (!/^(github\.com|objects\.githubusercontent\.com)$/i.test(host)) {
    throw new Error("Blocked download host: " + host);
  }
  const dest = path.join(os.tmpdir(), asset.name.replace(/[^\w.\- ]+/g, "_"));
  const r = await fetch(asset.url, { headers: { "User-Agent": NINJA_UA } });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  // Integritate: dimensiunea + sha256 (din metadatele release-ului GitHub).
  // Daca nu se potrivesc, NU rulam binarul corupt/alterat.
  if (asset.size && buf.length !== asset.size) {
    throw new Error(`Size mismatch (expected ${asset.size}, got ${buf.length}) — download aborted`);
  }
  if (asset.sha256) {
    const h = crypto.createHash("sha256").update(buf).digest("hex");
    if (h !== asset.sha256) throw new Error("SHA-256 mismatch — download aborted");
    log(`update: sha256 ok (${h})`);
  } else {
    log("update: release without sha256 - integrity check skipped");
  }
  fs.writeFileSync(dest, buf);
  log(`update: downloaded ${asset.name} (${buf.length} bytes) -> ${dest}`);
  if (IS_PORTABLE) {
    // o singura instanta: daca am lansa acum noua copie, ar fi redirectionata catre
    // cea veche si ar iesi. Deci pornim noul exe DUPA ce iesim noi (relaunch).
    app.relaunch({ execPath: dest, args: [] });
    log("update: restarting into", dest);
    setTimeout(() => { try { app.quit(); } catch { app.exit(0); } }, 800);
    return { ok: true, dest, name: asset.name, mode: "portable", restarting: true };
  }
  // instalare cu Setup: installer-ul cere singur inchiderea aplicatiei, apoi o reporneste
  const launchErr = await shell.openPath(dest); // porneste noul exe / installerul
  if (launchErr) throw new Error(launchErr);
  return { ok: true, dest, name: asset.name, mode: "installer" };
}

// ---------- prețuri PoE Ninja ----------
// Endpoint: GET /poe2/api/economy/exchange/current/overview?league=...&type=...
// Return: { lines: [{id, primaryValue, ...}], items: [{id, name, category}], core: {...} }
// primaryValue = pret in moneda PRIMARA a ligii (core.primary: de obicei "divine",
// dar pe hardcore poate fi "exalted"). Normalizam totul la "per 1 Divine" mai jos.
const NINJA_BASE = "https://poe.ninja/poe2/api/economy";
const NINJA_UA = "PathOfExpedition/1.0 (desktop app; contact: local)";
// Categoriile care apar efectiv ca recompense in panoul Runeshape/Expedition.
// Restul categoriilor din poe.ninja nu apar niciodata in panou si doar
// maresc suprafata de potriviri fuzzy gresite.
const NINJA_TYPES = ["Currency", "Runes", "Expedition", "Verisium", "UncutGems"];
// Ligile oferite in dropdown.
// Sirul e folosit VERBATIM ca parametru "league" al API-ului poe.ninja, asa ca
// "HC X" e varianta Hardcore a ligii "X". "Standard" e liga permanenta (poe.ninja
// are date reale de exchange pentru ea); "Hardcore" permanent e omis intentionat
// (poe.ninja n-are date de exchange pentru el).
const AVAILABLE_LEAGUES = ["Forbidden Rites", "HC Forbidden Rites", "Runes of Aldur", "HC Runes of Aldur", "Standard"];
let priceCache = { map: {}, fetchedAt: 0 };   // map: nameLower -> {price, id, name}; price = in Divine
let pricesStale = false;                      // true = afisam prețuri din snapshot local (offline)
const PRICE_TTL = 5 * 60 * 1000;               // 5 min (respectam cache-ul lor ~5 min)
// ---------- offline cache: ultimul snapshot de prețuri pe disk ----------
function pricesCachePath() {
  return path.join(app.getPath("userData"), "prices-cache.json");
}
function savePricesSnapshot() {
  try {
    if (!priceCache.map || !Object.keys(priceCache.map).length) return;
    fs.writeFileSync(pricesCachePath(), JSON.stringify({ league: config.league, fetchedAt: priceCache.fetchedAt, map: priceCache.map }));
  } catch (e) { log("savePricesSnapshot:", e.message); }
}
function loadPricesSnapshot(league) {
  try {
    const j = JSON.parse(fs.readFileSync(pricesCachePath(), "utf8"));
    if (!j || j.league !== league || !j.map || !Object.keys(j.map).length) return false;
    const map = j.map;
    const keysByLength = {};
    for (const k of Object.keys(map)) (keysByLength[k.length] = keysByLength[k.length] || []).push(k);
    priceCache = { map, keysByLength, fetchedAt: j.fetchedAt || 0 };
    pricesStale = true;
    log("prices from local cache (offline):", Object.keys(map).length, "items");
    return true;
  } catch { return false; }
}
// rate-uri: cate unitati de moneda core per 1 Divine (calculate din core.rates al API-ului)
let xchgRates = { chaos: null, exalted: null };

// sparkline de la poe.ninja: {totalChange: %, data: [%/zi]} (7 zile).
// totalChange = variatia totala pe perioada -> trendul afisat (sageta dupa nume).
function sparkTrend(sp) {
  const t = sp && typeof sp === "object" ? parseFloat(sp.totalChange) : NaN;
  if (!Number.isFinite(t)) return null;
  if (t > 0.5) return "up";
  if (t < -0.5) return "down";
  return "flat";
}
// procentul exact al variatiei (sparkline.totalChange, 7 zile) -> pe chipuri
function sparkPct(sp) {
  const t = sp && typeof sp === "object" ? parseFloat(sp.totalChange) : NaN;
  return Number.isFinite(t) ? t : null;
}
// seria de 7 valori (curba pe 7 zile) -> mini-graficul din overlay. Se deseneaza
// direct, fara acumulare: ultima valoare == totalChange (verificat live pe API).
function sparkData(sp) {
  const d = sp && Array.isArray(sp.data) ? sp.data : null;
  if (!d) return null;
  const nums = d.map((v) => Math.round(parseFloat(v) * 10) / 10).filter((v) => Number.isFinite(v));
  return nums.length >= 2 ? nums : null;
}
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
// Tier de valoare ABSOLUT (in Divine), folosit pt evidentierea randurilor in UI.
// Praguri fixe ca sa fie constante intre scanuri (nu relative la ce e pe ecran):
//   "top" >= 10 div (auriu), "high" >= 1 div (verde), restul = fara clasa.
// (NU estompam itemele ieftine: toate se afiseaza la fel de lizibil.)
function valueTier(div) {
  if (div == null) return null;
  if (div >= 10) return "top";
  if (div >= 1) return "high";
  return null;
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
      const r = await fetchT(url, { headers }, 20000);
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
        // iconita itemului: poe.ninja da doar calea relativa (/gen/image/...), iar
        // fisierele reale stau pe CDN-ul official (verificat live: web.poecdn.com -> 200)
        const icon = it.image ? "https://web.poecdn.com" + it.image : null;
        out.push({ id: line.id, name: it.name, price: divine, category: it.category, trend: sparkTrend(line.sparkline), trendPct: sparkPct(line.sparkline), trendData: sparkData(line.sparkline), icon });
      }
      if (out.length) log("fetchPrices:", type, "->", out.length, "items (primary=" + primary + ")");
      return out;
    } catch (e) {
      log("fetchPrices:", type, "ERROR", e.message);
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
  // bucket pe lungimea cheii (folosit de pasul fuzzy)
  const keysByLength = {};
  for (const k of Object.keys(map)) {
    (keysByLength[k.length] = keysByLength[k.length] || []).push(k);
  }
  if (Object.keys(map).length === 0) {
    // poe.ninja / retea indisponibila: recadere la ultimul snapshot local (aceeasi liga)
    if (loadPricesSnapshot(league)) return priceCache.map;
  }
  pricesStale = false;
  priceCache = { map, keysByLength, fetchedAt: Date.now() };
  savePricesSnapshot();
  log("fetchPrices: DONE total", Object.keys(map).length, "items");
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
// fallback pentru cifre OCR confundate cu litere (0->o, 1->l, 5->s, 8->b)
function digitFold(s) {
  return s.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s").replace(/8/g, "b");
}
// gemurile necizelate au preturi foarte diferite intre niveluri: fara nivel citit -> fara pret
function isUncutGem(key) {
  return /uncut (skill|spirit|support) gem/.test(key);
}
// prag-uri pentru matching
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
// NU folosim "contains": altfel "mind rune"
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

// ---------- afisare preț in moneda corecta (logica autoCurrency) ----------
// Regula (identica cu afisarea de pe site-ul poe.ninja):
//   pret in Divine >= ~1  -> afisam in Divine
//   pret in Divine <  ~1  -> afisam in moneda "core" (Exalted, fallback Chaos)
// Adica itemii ieftini apar in Exalted, iar cei scumpi in Divine.
// Rotunjire de AFIȘARE, identica cu afisarea de pe poe.ninja (displayRounding).
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
// moneda core pentru itemii ieftini: Exalted, fallback Chaos.
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
  const defaults = { league: "Forbidden Rites", region: null, runeRegion: null, overlay: false, runeOverlay: false, soundAlert: false, minDivine: 0, hideNames: false, font: "segoe" };
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    log("loadConfig: read", raw.length, "chars");
    const cfg = Object.assign({}, defaults, JSON.parse(raw));
    log("loadConfig: OK");
    return cfg;
  } catch (e) {
    log("loadConfig: ERROR", e.message);
    return defaults;
  }
}
function saveConfig() {
  try {
    const s = JSON.stringify(config, null, 2);
    log("saveConfig: stringify OK", s.length, "chars");
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), s);
    log("saveConfig: scris OK");
  } catch (e) {
    log("saveConfig: ERROR", e.message);
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
    show: false,   // apare doar dupa primul render (fara flash alb la pornire)
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.on("unresponsive", () => log("WINDOW UNRESPONSIVE (main window)"));
  win.on("responsive", () => log("window responsive again"));
  win.setMenuBarVisibility(false);   // fara meniul File/Edit/View (neprofesional)
  win.on("close", () => {
    const r = win.getBounds();
    config.window = { x: r.x, y: r.y, width: r.width, height: r.height };
    saveConfig();
    // daca inchidem fereastra principala, dispare si overlay-ul (fara fantome peste joc)
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
    overlayWin = null;
    if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.close();
    runeOverlayWin = null;
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
// Ancor de panou: titlul "Runeshape Combinations" (OCR il da ca "Runeshape Combinati0M").
// E specific panoului de runeshaping si NU apare in market/altceva -> il folosim ca gate:
// daca lipseste din OCR, nu suntem pe panou si nu arat nimic (evita false positives din market).
const PANEL_ANCHOR = /runeshape|ruweshape|runeshupe|combin/i;
async function doScan(force) {
  if (selectOpen) { log("doScan: selectOpen, skipped"); return { rows: [], error: null };
  }
  if (!config.region) { log("doScan: no region"); return { rows: [], error: "Choose a region first (Select region)." };
  }
  try {
    let shot = await captureRegion(config.region);
    if (config.region && shot.width) lastCaptureK = shot.width / config.region.width;  // pt alinierea chipurilor din overlay
    // PERFORMANTA: daca pixelii regiunii sunt identici cu ultimul scan SI preturile
    // nu s-au reimprospatat, nu mai pornim OCR-ul (cel mai scump pas) - refolosim
    // ultimul rezultat. Asa nu mai consumam CPU la fiecare 3s cand nu se schimba nimic.
    const pHash = crypto.createHash("sha1")
      .update(Buffer.from(shot.data.buffer, shot.data.byteOffset, shot.data.byteLength))
      .digest("hex");
    if (!force && pHash === lastScanHash && priceCache.fetchedAt === lastScanPricesAt) {
      return { rows: lastRows, at: Date.now(), pricesAt: priceCache.fetchedAt, pricesStale, unchanged: true };
    }
    log("doScan: START");
    // salvam PNG in temp (cu path Windows ca sa mearga WinRT StorageFile)
    const img = nativeImage.createFromBitmap(Buffer.from(shot.data), { width: shot.width, height: shot.height });
    const tmp = path.join(os.tmpdir(), `xpc-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`).replace(/\//g, "\\");
    fs.writeFileSync(tmp, img.toPNG());
    const result = await ocrRecognize(tmp);
    try { fs.unlinkSync(tmp); } catch {}
    log("doScan: OCR result ok=", result.ok, "lines=", (result.lines||[]).length);
    if (!result.ok) { log("doScan: OCR error", result.error); return { rows: [], error: result.error || "OCR error" }; }
    const lines = (result.lines || [])
      .map((l) => ({ text: (l.text || "").trim(), y: l.y || 0 }))
      .filter((l) => l.text.length > 0);
    lastOcrLines = lines.map((l) => l.text);   // pt fereastra Debug
    // GATE de panou: fara ancorul "Runeshape Combinations" nu suntem pe panou
    // (ex. suntem in market) -> golim, ca sa nu arat itemi din alte ecrane.
    if (!lines.some((l) => PANEL_ANCHOR.test(l.text))) {
      log("doScan: panel anchor MISSING (not on Runeshaping) -> clearing");
      lastRows = [];
      lastScanHash = pHash;
      lastScanPricesAt = priceCache.fetchedAt;
      return { rows: [], at: Date.now(), pricesAt: priceCache.fetchedAt, pricesStale, panelMissing: true };
    }
    const rows = parseLines(lines);
    // FILTRU CHAT: pastram doar randuri cu cantitate explicita (Nx) SAU item cunoscut in API.
    // Chat-ul din joc (peste panou) nu are nici "Nx", nici nu e un item -> e respins.
    const kept = [];
    let filtered = 0;   // cate linii au fost respinse ca zgomot (nu le logam individual)
    for (const r of rows) {
      const p = lookupPrice(r.name);
      const qty = r.qty || 1;
        r.price = p ? p.price : null;            // pret UNITAR in Divine (raw)
        r.matchedName = p ? p.name : null;
        r.category = p ? p.category : null;      // pt linkul catre pagina itemului pe poe.ninja
        r.trend = p ? p.trend : null;            // "up" | "down" | "flat" | null
        r.trendPct = p ? p.trendPct : null;      // variatia in % pe 7 zile (pe chipuri)
        r.trendData = p ? p.trendData : null;    // seria de 7 valori (mini-graficul din overlay)
        r.icon = p ? p.icon : null;              // iconita itemului (CDN poecdn)
      r.totalDivine = p ? p.price * qty : null;  // TOTALUL stack-ului in Divine (pt tier)
      // Pretul afisat = TOTALUL stack-ului; pentru qty>1 aratam si unitar.
      const total = p ? displayPrice(p.price * qty, "auto") : null;
      const unit = (p && qty > 1) ? displayPrice(p.price, "auto") : null;
      // afisare ca in overlay: pret UNITAR, iar totalul stack-ului in paranteza cand sunt 2x+
      r.display = total
        ? { value: total.value, currency: total.currency, text: (unit ? unit.text : total.text) + (unit ? ` (${total.text})` : "") }
        : null;
      // pt overlay: pretul UNITAR principal, iar in paranteza TOTALUL doar daca qty>1
      const u = p ? displayPrice(p.price, "auto") : null;
      const t = (p && qty > 1) ? displayPrice(p.price * qty, "auto") : null;
      r.dispUnit = u ? u.text : null;
      r.dispTotal = t ? t.text : null;
      if (!p && !r.explicit) { filtered++; continue; }   // zgomot (chat/fereastra straina)
      kept.push(r);
    }
    // Tier pe valoare absoluta (in Divine) -> colorare constanta in UI.
    for (const r of kept) r.tier = valueTier(r.totalDivine);
    rows.length = 0; rows.push(...kept);
    lastRows = rows;
    lastScanHash = pHash;
    lastScanPricesAt = priceCache.fetchedAt;
    log("doScan: rows=", rows.length, "(filtered", filtered + ")", JSON.stringify(rows.map((r) => r.qty + "x" + r.name)));
    // ALERTA SONORA: item nou (fata de scanul anterior) cu valoare >= 1 Divine.
    // Comparăm setul de nume scumpe ca sa sunăm o singura data per item nou.
    const highNow = new Set();
    let newHigh = 0;
    for (const r of rows) {
      if ((r.totalDivine || 0) >= ALERT_MIN_DIVINE) {
        const key = String(r.matchedName || r.name).toLowerCase();
        highNow.add(key);
        if (!lastAlertSet.has(key)) newHigh++;
      }
    }
    lastAlertSet = highNow;
    if (config.soundAlert && newHigh > 0) {
      log("alert: new items >= " + ALERT_MIN_DIVINE + " div:", newHigh);
      if (win && !win.isDestroyed()) win.webContents.send("alert", { count: newHigh });
    }
    return { rows, at: Date.now(), pricesAt: priceCache.fetchedAt, pricesStale };
  } catch (e) {
    return { rows: [], error: String(e) };
  }
}

// ---------- polling ----------
// Un singur punct de intrare pt scan: nu suprapune scan-uri si nu re-trimite
// catre UI cand rezultatul e neschimbat (mai putin IPC + mai putine re-render-uri).
async function runScan(force) {
  if (scanning) return { rows: lastRows, at: Date.now(), busy: true };
  scanning = true;
  try {
    const r = await doScan(force === true);
    if (!r.unchanged) broadcast(r);
    return r;
  } finally {
    scanning = false;
  }
}
// frecventa de scan in functie de overlay: ON -> rapid (3s, e pe panou);
// OFF -> lent (30s, doar fundal) ca sa NU punem presiune pe GPU/capture in timpul jocului.
function pollMs() { return config.overlay ? 3000 : 30000; }
function startPoll() {
  stopPoll();
  const ms = pollMs();
  log("startPoll: interval", ms/1000 + "s (overlay " + (config.overlay ? "ON" : "OFF") + ")");
  pollTimer = setInterval(() => { runScan(false); }, ms);
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- overlay in-game (chip-uri cu preturi peste panou) ----------
// Fereastra acopera DOAR banda de chipuri din dreapta regiunii (nu si panoul):
// chipurile stau in afara chenarului Runeshape (nu acopera numele itemelor) si
// suprafata compusa peste joc e mica -> nu incomodeaza jocul (fara lag).
const OVERLAY_STRIP = 420;   // px DIP de banda libera in dreapta regiunii
                              // (bara: nume + mini-grafic + trend% + cantitate + pret)

function overlayBounds() {
  const r = config.region;
  if (!r) return null;
  return { x: r.x + r.width, y: r.y, width: OVERLAY_STRIP, height: r.height };
}
// Fereastra e transparenta si click-through (jocul ramane jucabil). NU mai e
// exclusa din screen capture: sta in banda din DREAPTA regiunii (x = region.x +
// region.width), deci nu se suprapune niciodata cu crop-ul OCR si poti face
// screenshot overlay-ului in joc. Pozitia = regiunea salvata (aceleasi coordonate
// DIP pe care le foloseste si crop-ul capturii).
function overlayScale() {
  const reg = config.region;
  const disp = reg
    ? screen.getDisplayNearestPoint({ x: reg.x + reg.width / 2, y: reg.y + reg.height / 2 })
    : screen.getPrimaryDisplay();
  return disp.scaleFactor || 1;
}
let lastOverlaySig = "";   // semnatura continutului trimis ultima data (skip re-render inutil)
function sendOverlay(r) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (r && r.error) return; // pe o eroare de scan nu stergem ce e afisat
  const payload = r && r.rows ? r : (lastScanPayload || { rows: [] });
  const k = lastCaptureK || overlayScale();
  // PERFORMANTA: daca ce s-ar afisa e identic cu ultimul frame, nu mai trimitem
  // IPC si nu mai re-randam overlay-ul (malloc inutil). k intra in semnatura pt ca
  // pozitionarea barelor depinde de scale.
  const sig = JSON.stringify([k, !!payload.pricesStale, config.minDivine, !!config.hideNames,
    (payload.rows || []).map((x) => [x.name, x.y, x.dispUnit, x.dispTotal, x.trend, x.trendPct, x.tier, x.icon])]);
  if (sig === lastOverlaySig) return;
  lastOverlaySig = sig;
  // inaltimea ferestrei urmeaza intinderea randurilor (nu tot panoulul -> mai putin lag);
  // +110 DIP jos = loc pt legenda (sageti + grafic) fara sa acopere ultima bara
  const ys = (payload.rows || []).map((x) => x.y || 0);
  const h = Math.min(1200, Math.max(140, Math.round((ys.length ? Math.max(...ys) : 0) / k) + 110));
  const b = overlayBounds();
  if (b && Math.abs(overlayWin.getBounds().height - h) > 12) overlayWin.setBounds({ ...b, height: h });
  overlayWin.webContents.send("scan", { ...payload, scale: k, minDivine: config.minDivine, hideNames: !!config.hideNames });
}
function broadcast(r) {
  if (r && !r.error) lastScanPayload = r;
  win?.webContents.send("scan", r);
  sendOverlay(r);
}
// randul cu cea mai mare valoare din ultimul scan (pt hotkey-urile copy/open)
function topRow() {
  const rows = (lastScanPayload && lastScanPayload.rows) || lastRows || [];
  let best = null;
  for (const r of rows) {
    if (!r) continue;
    if (!best || (r.totalDivine || 0) > (best.totalDivine || 0)) best = r;
  }
  return best;
}
function toggleOverlay(on) {
  if (on !== true) {
    config.overlay = false;
    saveConfig();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
    overlayWin = null;
    lastOverlaySig = "";   // urmatoarea pornire va re-trimite frame-ul complet
    if (config.region) startPoll();   // coboram la frecventa lenta de fundal (30s)
    return { ok: true, on: false };
  }
  if (!config.region) return { ok: false, on: false, error: "Set a region first (Select region)." };
  const b = overlayBounds();
  lastOverlaySig = "";   // la (re)creare re-trimitem frame-ul complet
  if (overlayWin && !overlayWin.isDestroyed()) { overlayWin.setBounds(b); return { ok: true, on: true }; }
  overlayWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");   // peste joc (borderless)
  // FARA setContentProtection: overlay-ul e in afara regiunii OCR, deci poate fi
  // fotografiat/screen-recorded normal (Snipping Tool, Print Screen, OBS).
  // 100% click-through, fara "forward": fereastra nu primeste NICIUN eveniment
  // de mouse, deci nu introduce lag de input in joc (overlay pur informativ).
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setMenuBarVisibility(false);
  overlayWin.loadFile(path.join(__dirname, "renderer", "overlay.html"));
  overlayWin.once("ready-to-show", () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.showInactive();   // nu fura focusul de la joc
      sendOverlay(null);
    }
  });
  overlayWin.on("closed", () => { overlayWin = null; lastOverlaySig = ""; });  // config.overlay ramane cum e salvat
  config.overlay = true;
  saveConfig();
  if (config.region) { startPoll(); runScan(false); }   // frecventa rapida (3s) + scan imediat
  return { ok: true, on: true };
}

// ---------- overlay separat de RUNE (Rune Planner) ----------
// Fereastra proprie, independenta de overlay-ul de preturi: transparenta, click-through,
// pozitionata in dreapta regiunii de rune. Randata de runeoverlay.html care isi face
// singur captura (capture-runes) + template-matching + reverse-lookup, pe un interval.
const RUNE_OVERLAY_STRIP = 430;   // px DIP de banda libera in dreapta regiunii de rune
function runeOverlayBounds() {
  const r = config.runeRegion;
  if (!r) return null;
  return { x: r.x + r.width, y: r.y, width: RUNE_OVERLAY_STRIP, height: Math.max(140, r.height) };
}
function toggleRuneOverlay(on) {
  if (on !== true) {
    config.runeOverlay = false;
    saveConfig();
    if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.close();
    runeOverlayWin = null;
    stopFgProc();   // nu mai tinem procesul de detecție a ferestrei active
    return { ok: true, on: false };
  }
  if (!config.runeRegion) return { ok: false, on: false, error: "Set the rune region first." };
  const b = runeOverlayBounds();
  if (runeOverlayWin && !runeOverlayWin.isDestroyed()) { runeOverlayWin.setBounds(b); return { ok: true, on: true }; }
  runeOverlayWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  runeOverlayWin.setAlwaysOnTop(true, "screen-saver");
  runeOverlayWin.setIgnoreMouseEvents(true);
  runeOverlayWin.setMenuBarVisibility(false);
  runeOverlayWin.loadFile(path.join(__dirname, "renderer", "runeoverlay.html"));
  runeOverlayWin.once("ready-to-show", () => {
    if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.showInactive();   // nu fura focusul
  });
  runeOverlayWin.on("closed", () => { runeOverlayWin = null; });
  config.runeOverlay = true;
  saveConfig();
  return { ok: true, on: true };
}
function notifyRuneOverlayState() {
  if (win && !win.isDestroyed()) win.webContents.send("rune-overlay-state", !!(runeOverlayWin && !runeOverlayWin.isDestroyed()));
}

// ---------- IPC ----------
ipcMain.handle("get-config", () => ({ ...config, version: app.getVersion(), availableLeagues: AVAILABLE_LEAGUES, pricesAt: priceCache.fetchedAt, pricesStale }));
// ---------- Rune Planner (baza de date + reverse-lookup) ----------
// Datele (data/runes.json + data/recipes.json) se incarca o singura data.
planner.loadData();
ipcMain.handle("planner-data", () => {
  try { return { ok: true, runes: planner.listRunes(), chase: planner.listChase(), recipes: planner.listRecipes() }; }
  catch (e) { log("planner-data:", e.message); return { ok: false, error: String(e) }; }
});
// rune: lista de nume detectate/vazute in panou -> retete eligibile + preturi.
ipcMain.handle("plan-recipes", (_e, runes) => {
  try {
    const list = Array.isArray(runes) ? runes.filter((x) => typeof x === "string").slice(0, 64) : [];
    const priceOf = (name) => { const p = lookupPrice(name); return p ? p.price : null; };
    const res = planner.matchRecipes(list, { priceOf });
    const enrich = (a) => a.map((r) => {
      const total = r.priced ? displayPrice(r.value, "auto") : null;
      const unit = r.priced ? displayPrice(r.unitValue, "auto") : null;
      // fallback: valoarea statica din poe2db (convertita in Divine cu ratele curente)
      let disp = total ? total.text : null;
      if (!disp && r.src) {
        const perDiv = r.src.cur === "divine" ? 1 : (xchgRates[r.src.cur] || null);
        const div = perDiv ? r.src.value / perDiv : null;
        disp = div != null ? "~" + displayPrice(div, "auto").text : r.src.value + " " + (r.src.cur || "");
      }
      // cost rune de intrare + valoare neta
      const costDisp = r.cost != null ? displayPrice(r.cost, "auto") : null;
      const netDisp = r.net != null ? displayPrice(Math.abs(r.net), "auto") : null;
      return {
        ...r,
        disp,
        dispUnit: unit ? unit.text : null,
        dispCost: costDisp ? costDisp.text : null,
        dispNet: netDisp ? netDisp.text : null,
        netPos: r.net != null ? r.net >= 0 : null,
      };
    });
    return { ok: true, exact: enrich(res.exact), contains: enrich(res.contains).slice(0, 30), advice: planner.propagateAdvice(list) };
  } catch (e) { log("plan-recipes:", e.message); return { ok: false, error: String(e) }; }
});
// health-check Windows OCR (butonul "Check OCR")
ipcMain.handle("check-ocr", () => checkOcrHealth());
// citirea runelor din panou: capturam regiunea runeRegion si trimitem PNG in renderer,
// unde se face template-matching-ul (Chromium decodeaza webp/png nativ, mult mai rapid).
async function captureRunesLegacy() {
  try {
    if (!config.runeRegion) return { ok: false, error: "Set the rune region first." };
    const shot = await captureRegion(config.runeRegion);
    const k = shot.width ? shot.width / config.runeRegion.width : 1;
    const img = nativeImage.createFromBitmap(Buffer.from(shot.data), { width: shot.width, height: shot.height });
    return { ok: true, dataUrl: "data:image/png;base64," + img.toPNG().toString("base64"), width: shot.width, height: shot.height, scale: k };
  } catch (e) { log("capture-runes:", e.message); return { ok: false, error: String(e) }; }
}
ipcMain.handle("capture-runes", () => captureRunesLegacy());
// cadru rapid pt overlay-ul de rune (foreground + captura GDI); vezi captureRunesFast
ipcMain.handle("rune-frame", () => captureRunesFast());
// update: verificare ultimul release GitHub + descarcare/lanare
ipcMain.handle("check-update", () => checkUpdate());
ipcMain.handle("do-update", async () => {
  // Asset-ul e ales in main process, nu in renderer: rendererul poate doar SORI
  // update-ul, niciodata ce se descarca/lanseaza (altfel un XSS in renderer
  // ar putea descarca si executa orice URL).
  try {
    const info = await checkUpdate();
    if (!info.ok) throw new Error(info.error || "Update check failed");
    if (!info.updateAvailable) throw new Error("No update available");
    const asset = pickAsset(info.assets);
    if (!asset) throw new Error("No downloadable asset in the release");
    const res = await doUpdate(asset);
    return res;
  } catch (e) {
    log("update failed: " + e);
    return { ok: false, error: String(e) };
  }
});
// deschide un link extern in browserul implicit; doar URL-uri allowlist-uite
// (buymeacoffee + release page + pagini de item poe.ninja), ca un renderer
// compromis sa nu poata deschide orice.
const EXTERNAL_ALLOW = [
  /^https:\/\/buymeacoffee\.com\/iulian\.icb\/?$/i,
  /^https:\/\/github\.com\/iulicafarafrica\/PathOfExpedition2(\/|$)/i,
  /^https:\/\/poe\.ninja\/poe2\/economy\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
];
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && EXTERNAL_ALLOW.some((re) => re.test(url))) shell.openExternal(url);
});

// pagina itemului pe poe.ninja (volum, istoric de preț):
// /poe2/economy/{league}/{category}/{name-slug} — structura verificata din sitemap-ul lor.
const LEAGUE_SLUGS = {
  "Forbidden Rites": "forbiddenrites",
  "HC Forbidden Rites": "forbiddenriteshc",
  "Runes of Aldur": "runesofaldur",
  "HC Runes of Aldur": "runesofaldurhc",
  "Standard": "standard",
};
const CATEGORY_SLUGS = { Currency: "currency", Runes: "runes", UncutGems: "uncut-gems", Verisium: "verisium", Expedition: "expedition" };
// "Jeweller's Orb" -> "jewellers-orb": apostroful se scoate (NU devine cratima).
// Verificat pe toti cei 277 de itemi din API (toate categoriile); slug-ul e
// identic in orice liga, se schimba doar segmentul de liga din URL.
function nameSlug(s) {
  return String(s || "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function poeNinjaItemUrl(league, category, name) {
  const ls = LEAGUE_SLUGS[league], cs = CATEGORY_SLUGS[category], ns = nameSlug(name);
  if (!ls || !cs || !ns) return null;
  return `https://poe.ninja/poe2/economy/${ls}/${cs}/${ns}`;
}
// pagina itemului pe poe.ninja (volum, istoric de pret); URL-ul e construit in main
// din componente validate (rendererul nu poate injecta un URL arbitrar).
function openItemPage(r) {
  const league = r && AVAILABLE_LEAGUES.includes(r.league) ? r.league : config.league;
  const category = r && NINJA_TYPES.includes(r.category) ? r.category : null;
  const raw = r ? (r.matchedName || r.name) : null;   // numele din API (nu textul OCR)
  const name = typeof raw === "string" && nameSlug(raw) ? raw : null;
  const url = category && name ? poeNinjaItemUrl(league, category, name) : null;
  if (url && EXTERNAL_ALLOW.some((re) => re.test(url))) shell.openExternal(url);
  return url;
}
// click pe un rand -> pagina itemului
ipcMain.handle("open-item", (_e, r) => openItemPage(r));
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
  if (config.region) await runScan(false);
  return league;
});
ipcMain.handle("refresh-prices", async () => {
  try {
    const map = await fetchPrices(config.league || "Forbidden Rites");
    return { ok: true, count: Object.keys(map).length, at: priceCache.fetchedAt, stale: pricesStale };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle("scan-now", async () => {
  const r = await runScan(true);   // fortat: utilizatorul a cerut un scan nou
  return r;   // broadcast() a trimis deja rezultatul catre ambele ferestre
});
// pornire/oprire overlay in joc (butonul "Overlay" din fereastra principala);
// primeste doar boolean, nimic altceva
ipcMain.handle("toggle-overlay", (_e, on) => toggleOverlay(on === true));
ipcMain.handle("toggle-rune-overlay", (_e, on) => { const res = toggleRuneOverlay(on === true); notifyRuneOverlayState(); return res; });
// alerta sonora la item >= 1 Divine: doar boolean, persistat in config
ipcMain.handle("set-sound-alert", (_e, on) => {
  config.soundAlert = on === true;
  saveConfig();
  lastAlertSet = new Set();   // re-armăm: la urmatorul scan valutăm ce e pe ecran
  return { ok: true, on: config.soundAlert };
});
// prag de afisare (in Divine): ascunde itemele sub valoarea aleasa. 0 = arata tot.
ipcMain.handle("set-min-value", (_e, v) => {
  const n = Number(v);
  config.minDivine = Number.isFinite(n) && n > 0 ? n : 0;
  saveConfig();
  sendOverlay(lastScanPayload);   // re-trimite catre overlay ca sa aplice filtrul
  return { ok: true, minDivine: config.minDivine };
});
// numele itemului in overlay: redundant cand panoul din joc il arata deja la stanga,
// deci poate fi ascuns (ramane doar pretul + trend). Doar boolean, persistat.
ipcMain.handle("set-hide-names", (_e, on) => {
  config.hideNames = on === true;
  saveConfig();
  sendOverlay(lastScanPayload);   // re-trimite catre overlay ca sa aplice schimbarea
  return { ok: true, hideNames: config.hideNames };
});
// fontul UI (token din FontUI.TOKENS): persistat + trimis live la ambele overlay-uri
function pushFontToOverlays() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send("app-font", config.font);
  if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.webContents.send("app-font", config.font);
}
ipcMain.handle("set-font", (_e, f) => {
  const id = String(f || "");
  const known = ["georgia", "segoe", "cambria", "consolas", "verdana", "tahoma", "trebuchet", "times", "courier", "arial", "norse"];
  config.font = known.includes(id) ? id : "segoe";
  saveConfig();
  pushFontToOverlays();
  return { ok: true, font: config.font };
});
// flux comun de selectare region; kind = "scan" (regiunea de preturi) | "rune" (iconitele de rune)
function selectRegionFlow(kind) {
  selectOpen = true;   // nu fac scan cat timp box-ul e deschis
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();  // nu acoperim box-ul de selectie
  if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.hide();
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
      log(kind + " region-selected:", JSON.stringify(region));
      selectOpen = false;
      const ovl = overlayWin && !overlayWin.isDestroyed() ? overlayWin : null;
      const r = region || {};
      if (![r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) || r.width < 40 || r.height < 30) {
        log("region rejected: invalid geometry");
        try { sel.close(); } catch {}
        if (ovl && kind === "scan") ovl.showInactive();
        if (runeOverlayWin && !runeOverlayWin.isDestroyed()) runeOverlayWin.showInactive();
        resolve(null);
        return;
      }
      try {
        const disp = screen.getDisplayNearestPoint({ x: region.x + region.width / 2, y: region.y + region.height / 2 });
        const reg = { x: region.x, y: region.y, width: region.width, height: region.height, displayId: disp.id };
        if (kind === "rune") {
          config.runeRegion = reg;
          saveConfig();
          if (runeOverlayWin && !runeOverlayWin.isDestroyed()) {
            const rb = runeOverlayBounds();
            if (rb) { runeOverlayWin.setBounds(rb); runeOverlayWin.showInactive(); }
          }
        } else {
          config.region = reg;
          saveConfig();
          if (ovl) { ovl.setBounds(overlayBounds()); ovl.showInactive(); }
          lastScanHash = null;
          lastOverlaySig = "";
          startPoll();
        }
        sel.close();
        resolve(reg);
      } catch (e) {
        console.error("SELECT-ERROR:", e);
        try { sel.close(); } catch {}
        resolve(null);
      }
    });
  });
}
ipcMain.handle("select-region", () => selectRegionFlow("scan"));
ipcMain.handle("select-rune-region", () => selectRegionFlow("rune"));

// securitate: aplicația e doar local - blocam navigarea externa si crearea de ferestre
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

if (isSingleInstance) app.whenReady().then(() => {
  // overlay-urile NU pornesc automat la lansare: la fiecare start incep OPRITE
  // (si salvam starea), ca sa nu apara peste joc fara sa fie cerute explicit.
  config.overlay = false;
  config.runeOverlay = false;
  saveConfig();
  createWindow();
  // pornim scanarea + overlay-urile IMEDIAT (fara sa asteptam preturile), ca
  // aplicatia sa se simta deschisa din prima; preturile se incarca in background
  if (config.region) startPoll();
  // preturile: in background (cu timeout), NU blocheaza deschiderea ferestrelor.
  // primul scan (la 3s) le prinde deja incarcate; pana atunci itemele arata "unknown".
  fetchPrices(config.league || "Forbidden Rites").catch(() => {});
  // auto-refresh preturi la 30 min
  setInterval(async () => {
    try {
      await fetchPrices(config.league || "Forbidden Rites");
      log("auto-refresh: prices updated", Object.keys(priceCache.map).length);
    } catch (e) { log("auto-refresh: error", e.message || e); }
  }, 30 * 60 * 1000);
  // daca ramanem pe prețuri "stale" (offline), reîncercam la 5 min
  setInterval(async () => {
    if (!pricesStale) return;
    try { await fetchPrices(config.league || "Forbidden Rites"); }
    catch (e) { log("retry prices:", e.message || e); }
  }, 5 * 60 * 1000);
});
// la inchidere: opresc polling-ul si OMOR procesul PowerShell OCR (cald) ca sa nu ramana orfan
app.on("will-quit", () => {
  try { stopPoll(); } catch {}
  try { if (ocrProc && !ocrProc.killed) ocrProc.kill(); } catch {}
  try { stopFgProc(); } catch {}
});
app.on("window-all-closed", () => app.quit());

// prinde erorile nemanagite ca sa vedem exact unde e bug-ul
process.on("uncaughtException", (e) => {
  log("UNCAUGHT EXCEPTION:", e && e.stack ? e.stack : String(e));
});
process.on("unhandledRejection", (e) => {
  log("UNHANDLED REJECTION:", e && e.stack ? e.stack : String(e));
});
// crash-uri de sub-proces (renderer/GPU/utility) -> in log, ca sa vedem freeze-uri/crash-uri
app.on("child-process-gone", (_e, d) => {
  log("CHILD PROCESS GONE:", (d && d.type) || "?", "reason=" + ((d && d.reason) || "?"), "exitCode=" + ((d && d.exitCode) ?? "?"));
});
app.on("render-process-gone", (_e, _wc, d) => {
  log("RENDER PROCESS GONE:", (d && d.reason) || "?", "exitCode=" + ((d && d.exitCode) ?? "?"));
});
