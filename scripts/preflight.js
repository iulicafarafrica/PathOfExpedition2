#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gate de calitate pentru Path of Expedition.
//
// Ruleaza automat inainte de fiecare build (npm run dist -> predist) si in CI
// (npm run preflight). Orice verificare esuata opreste build-ul.
//
//   node scripts/preflight.js            -> toate verificarile
//   node scripts/preflight.js --fast     -> fara audit de retea
//   node scripts/preflight.js --no-tests -> fara rularea testelor
//   node scripts/preflight.js --release  -> strict: tag + working tree trebuie
//                                           sa fie curate (inainte de publicare)
//
// Codul de iesire: 0 = totul ok, 1 = exista esecuri.
// ---------------------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const FAST = process.argv.includes("--fast");
const NO_TESTS = process.argv.includes("--no-tests");
const RELEASE = process.argv.includes("--release");

const results = [];
let failed = 0;
let warned = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { results.push(["ok", name, ""]); return true; }
    if (typeof r === "string") { results.push(["warn", name, r]); warned++; return true; }
    if (r && typeof r === "object") {
      results.push(["fail", name, r.detail || ""]);
      failed++;
      return false;
    }
    results.push(["fail", name, "verificare nereusita"]);
    failed++;
    return false;
  } catch (e) {
    results.push(["fail", name, e && e.message ? e.message : String(e)]);
    failed++;
    return false;
  }
}

function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
}
function pkg() { return JSON.parse(read("package.json")); }

// ---------------------------------------------------------------------------
// 1. Versiune / release
// ---------------------------------------------------------------------------
check("package.json: versiune semver valida", () => {
  const v = pkg().version;
  if (!/^\d+\.\d+\.\d+$/.test(v)) return { detail: "versiune invalida: " + v };
  return true;
});

check("tag-ul de release corespunde versiunii din package.json", () => {
  const v = pkg().version;
  let tags = "";
  try { tags = sh("git", ["tag", "--list", "v*"]); } catch { return "git indisponibil - verificat manual"; }
  const names = tags.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!names.includes("v" + v)) {
    const msg = "nu exista tag-ul v" + v + " (tags: " + names.slice(-6).join(", ") +
      "). Creeaza tag-ul DUPA ce ai commitat sursa, inainte de release.";
    return RELEASE ? { detail: msg } : msg;
  }
  // tag-ul trebuie sa arate spre commitul sursa publicata
  try {
    const tagCommit = sh("git", ["rev-list", "-n", "1", "v" + v]).trim();
    const head = sh("git", ["rev-parse", "HEAD"]).trim();
    if (tagCommit !== head) {
      const msg = "tag-ul v" + v + " arata spre " + tagCommit.slice(0, 7) +
        ", iar HEAD este " + head.slice(0, 7) + ". Muta tag-ul (git tag -f -a v" + v + " HEAD).";
      return RELEASE ? { detail: msg } : msg;
    }
  } catch { /* HEAD difera de tag - ok daca vrei release dintr-un commit vechi */ }
  return true;
});

check("working tree curat (nimic necomandat)", () => {
  let out = "";
  try { out = sh("git", ["status", "--porcelain"]); } catch { return "git indisponibil"; }
  const lines = out.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length) {
    const msg = "commit sau stash mai intai (" + lines.length + " fisier(e) modificate) - altfel pierzi sursa publicata";
    return RELEASE ? { detail: msg } : msg;
  }
  return true;
});

// ---------------------------------------------------------------------------
// 2. Securitate
// ---------------------------------------------------------------------------
const RENDERERS = ["index", "overlay", "runeoverlay", "debug", "select"];

check("toate ferestrele au CSP cu script-src 'self' (fara 'unsafe-inline')", () => {
  const bad = [];
  for (const r of RENDERERS) {
    const html = read("renderer/" + r + ".html");
    const m = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    if (!m) { bad.push(r + ": fara CSP"); continue; }
    const csp = m[1];
    const scriptSrc = (csp.match(/script-src([^;]*)/) || ["", ""])[1];
    if (!scriptSrc) { bad.push(r + ": fara script-src"); continue; }
    if (/unsafe-inline/.test(scriptSrc)) bad.push(r + ": script-src contine 'unsafe-inline'");
    if (!/'self'/.test(scriptSrc)) bad.push(r + ": script-src nu contine 'self'");
  }
  if (bad.length) return { detail: bad.join("; ") + " - muta scripturile inline in renderer/*.js" };
  return true;
});

check("niciun <script> inline in renderer/*.html", () => {
  const bad = [];
  for (const r of RENDERERS) {
    const html = read("renderer/" + r + ".html");
    const re = /<script(?![^>]*\bsrc=)[^>]*>/g;
    const m = html.match(re);
    if (m) bad.push(r + ".html: " + m.length + " script inline");
  }
  if (bad.length) return { detail: bad.join("; ") };
  return true;
});

check("toate scripturile referite exista", () => {
  const bad = [];
  for (const r of RENDERERS) {
    const html = read("renderer/" + r + ".html");
    const re = /<script[^>]*\bsrc="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (!exists(path.join("renderer", m[1]))) bad.push(m[1] + " (din " + r + ".html) nu exista");
    }
  }
  if (bad.length) return { detail: bad.join("; ") };
  return true;
});

check("fiecare renderer/*.js este folosit de un HTML", () => {
  const orphans = fs.readdirSync(path.join(ROOT, "renderer"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => {
      const htmls = RENDERERS.map((r) => read("renderer/" + r + ".html")).join("\n");
      return !htmls.includes('src="' + f + '"');
    });
  if (orphans.length) return { detail: "scripturi nefolosite: " + orphans.join(", ") };
  return true;
});

check("allowlist-ul de URL-uri externe este folosit (lib/net.js)", () => {
  const net = read("lib/net.js");
  const main = read("main.js");
  if (!/EXTERNAL_ALLOW/.test(net)) return { detail: "lib/net.js nu mai defineste EXTERNAL_ALLOW" };
  if (!/isExternalAllowed/.test(main)) return { detail: "main.js nu foloseste libNet.isExternalAllowed" };
  if (/shell\.openExternal\(/.test(main) && !/isExternalAllowed/.test(main)) {
    return { detail: "main.js apeleaza shell.openExternal fara verificarea allowlist-ului" };
  }
  return true;
});

check("updater-ul cere sha256 + size (nu accepta binare neverificate)", () => {
  const lib = read("lib/update.js");
  if (!/sha256/.test(lib)) return { detail: "lib/update.js nu mai verifica sha256" };
  if (!/refusing to run an unverified binary/.test(lib)) {
    return { detail: "lib/update.js nu mai refuza assetul fara digest" };
  }
  const main = read("main.js");
  if (/integrity check skipped/.test(main)) return { detail: "main.js mai are ramura 'integrity check skipped'" };
  return true;
});

check("zero dependinte runtime (appul livreaza doar cod propriu)", () => {
  const p = pkg();
  const deps = p.dependencies || {};
  const names = Object.keys(deps);
  if (names.length) return { detail: "dependencies nenule: " + names.join(", ") + " - muta-le in devDependencies" };
  return true;
});

check("Electron pe o versiune suportata (nu EOL)", () => {
  const p = pkg();
  const ev = (p.devDependencies && p.devDependencies.electron) || "";
  const m = ev.match(/(\d+)/);
  if (!m) return { detail: "versiune electron nerecognoscuta: " + ev };
  const major = Number(m[1]);
  const SUPPORTED = [45, 44, 43];   // ultimele 3 majore acceptate de maintaineri
  if (major < SUPPORTED[SUPPORTED.length - 1]) {
    return { detail: "Electron " + major + " e EOL (suportate: " + SUPPORTED.join(", ") + "). Actualizeaza." };
  }
  if (major < SUPPORTED[0]) return "Electron " + major + " nu e ultima majora (" + SUPPORTED[0] + " exista)";
  return true;
});

check("niciun secret in fisierele urmarite de git", () => {
  const patterns = [
    /ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
    /sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  let files = [];
  try { files = sh("git", ["ls-files"]).split(/\r?\n/).filter(Boolean); } catch { return "git indisponibil"; }
  const hits = [];
  for (const f of files) {
    if (/\.(png|jpe?g|exe|blockmap|ico)$/i.test(f)) continue;
    let content = "";
    try { content = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    for (const re of patterns) if (re.test(content)) hits.push(f);
  }
  if (hits.length) return { detail: "posibile secrete in: " + hits.join(", ") };
  return true;
});

// ---------------------------------------------------------------------------
// 3. Build / packaging
// ---------------------------------------------------------------------------
check("package.json build.files contine lib/ si renderer/", () => {
  const files = (pkg().build && pkg().build.files) || [];
  const need = ["lib/**/*", "renderer/**/*", "main.js", "preload.js"];
  const missing = need.filter((n) => !files.includes(n));
  if (missing.length) return { detail: "lipsesc din build.files: " + missing.join(", ") };
  return true;
});

check("ocr.ps1 vechi nu mai exista in repo", () => {
  const p = pkg();
  const files = (p.build && p.build.files) || [];
  if (files.includes("ocr.ps1")) return { detail: "ocr.ps1 e inca in build.files (scriptul real e incorporat in main.js)" };
  if (exists("ocr.ps1")) return { detail: "ocr.ps1 exista inca in radacina (e o copie stale)" };
  return true;
});

check("testele exista si sunt conectate la npm test", () => {
  const p = pkg();
  if (!p.scripts || !p.scripts.test) return { detail: "lipseste scriptul npm test" };
  if (!exists("test/run.js")) return { detail: "lipseste test/run.js" };
  return true;
});

// ---------------------------------------------------------------------------
// 4. Teste
// ---------------------------------------------------------------------------
if (!NO_TESTS) {
  check("npm test (suitea de regresie)", () => {
    let out = "";
    try {
      out = sh(process.execPath, [path.join("test", "run.js")]);
    } catch (e) {
      const msg = (e.stdout || "") + (e.stderr || "");
      const m = msg.match(/\[test\] (\d+) trecute, (\d+) esuate/);
      return { detail: m ? (m[2] + " teste au esuat:\n" + (msg.split("\n").filter((l) => l.includes("FAIL")).join("\n"))) : ("testele au esuat:\n" + msg.slice(-800)) };
    }
    const m = out.match(/\[test\] (\d+) trecute, (\d+) esuate/);
    if (!m) return { detail: "output neasteptat de la teste:\n" + out.slice(-400) };
    if (Number(m[2]) > 0) return { detail: m[2] + " teste au esuat" };
    results.push(["info", "suite de regresie", m[1] + " teste trecute"]);
    return true;
  });

  check("release-guard (pluginul care blocheaza push-urile de tag gresite)", () => {
    let out = "";
    try {
      out = sh(process.execPath, [path.join("scripts", "test-release-guard.js")]);
    } catch (e) {
      const msg = (e.stdout || "") + (e.stderr || "");
      return { detail: "testele release-guard au esuat:\n" + msg.slice(-900) };
    }
    const m = out.match(/(\d+) trecute, (\d+) esuate/);
    if (!m) return { detail: "output neasteptat de la testele release-guard" };
    if (Number(m[2]) > 0) return { detail: m[2] + " teste release-guard au esuat" };
    results.push(["info", "release-guard", m[1] + " teste trecute"]);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 5. Audit de retea (optional)
// ---------------------------------------------------------------------------
if (!FAST) {
  check("npm audit --omit=dev (dependinte runtime)", () => {
    let out = "";
    try {
      out = sh("npm", ["audit", "--omit=dev", "--json"]);
    } catch (e) {
      out = e.stdout || "";
      if (!out) return "audit indisponibil (fara retea) - sarit";
    }
    let j = null;
    try { j = JSON.parse(out); } catch { return "audit indisponibil (fara retea) - sarit"; }
    const meta = (j && j.metadata && j.metadata.vulnerabilities) || {};
    const total = (meta.total || 0) + (meta.info || 0);
    if (total > 0) return { detail: total + " vulnerabilitati in dependintele de productie" };
    return true;
  });
}

// ---------------------------------------------------------------------------
// Raport
// ---------------------------------------------------------------------------
const ICONS = { ok: "  OK  ", warn: " ATENT ", fail: " FAIL ", info: " INFO " };
console.log("");
console.log("  Preflight - Path of Expedition");
console.log("  " + "-".repeat(74));
for (const [st, name, detail] of results) {
  console.log("  [" + (ICONS[st] || st) + "] " + name);
  if (detail) {
    for (const line of String(detail).split("\n")) console.log("           " + line);
  }
}
console.log("  " + "-".repeat(74));
console.log("  " + failed + " esecuri, " + warned + " atentionari, " +
  results.filter((r) => r[0] === "ok").length + " verificari ok");
console.log("");
process.exit(failed ? 1 : 0);
