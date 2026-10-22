// ---------------------------------------------------------------------------
// Test end-to-end al fluxului de update: alegerea assetului, descarcare,
// verificare integritate si modul de pornire - in ambele tipuri de instalare.
//
// Server HTTP local = falsa descarcare; assetul trece prin VERIFICAREA REALA
// (host allowlist + dimensiune + sha256), iar URL-ul oficial ramane
// https://github.com/... (altfel n-am verifica nimic).
// ---------------------------------------------------------------------------
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const libUpdate = require("D:/ExiledExchange2/expedition/lib/update.js");

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}

// payload-uri false (simuleaza cele doua artefacte publicate)
const PORTABLE_BYTES = Buffer.from("MZ portable build payload ".repeat(500));
const SETUP_BYTES = Buffer.from("MZ setup installer payload ".repeat(700));

const server = http.createServer((req, res) => {
  if (req.url.includes("portable")) {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(PORTABLE_BYTES);
  } else {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(SETUP_BYTES);
  }
});

// assetele "oficiale" (cum le da API-ul GitHub)
function makeAssets() {
  return [
    {
      name: "Path.of.Expedition.1.1.19.exe",
      url: "https://github.com/iulicafarafrica/PathOfExpedition2/releases/download/v1.1.19/Path.of.Expedition.1.1.19.exe",
      size: PORTABLE_BYTES.length,
      sha256: crypto.createHash("sha256").update(PORTABLE_BYTES).digest("hex"),
    },
    {
      name: "Path.of.Expedition.Setup.1.1.19.exe",
      url: "https://github.com/iulicafarafrica/PathOfExpedition2/releases/download/v1.1.19/Path.of.Expedition.Setup.1.1.19.exe",
      size: SETUP_BYTES.length,
      sha256: crypto.createHash("sha256").update(SETUP_BYTES).digest("hex"),
    },
  ];
}

// fetchImpl: pastreaza URL-ul oficial pentru verificarea hostului, dar ia
// byteii de la serverul local
function localFetch(url, init) {
  const local = "http://127.0.0.1:" + server.address().port + (url.includes("Setup") ? "/setup" : "/portable");
  return fetch(local, init);
}

function makeOpts(isPortable) {
  const calls = { relaunch: [], openPath: [], written: [], quit: 0 };
  return {
    calls,
    opts: {
      isPortable,
      fetchImpl: localFetch,
      writeFile: (p, buf) => { calls.written.push({ p, len: buf.length }); },
      openPath: async (p) => { calls.openPath.push(p); return ""; },
      relaunch: (o) => { calls.relaunch.push(o); },
      quit: () => { calls.quit++; },
      destDir: fs.mkdtempSync(path.join(os.tmpdir(), "upd-")),
      log: () => {},
      quitDelayMs: 0,
    },
  };
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  console.log("  server local pe " + port);
  const assets = makeAssets();

  // --- 1) INSTALAT (Setup) -> se descarca Setup-ul si se porneste installerul
  {
    const chosen = libUpdate.pickAsset(assets, false);
    t("instalat: se alege Setup-ul", chosen.name.includes("Setup"), chosen.name);
    const { calls, opts } = makeOpts(false);
    const r = await libUpdate.performUpdate(chosen, opts);
    t("instalat: modul raportat = installer", r.mode === "installer", r.mode);
    t("instalat: s-a descarcat Setup-ul (dim corecta)", calls.written.length === 1 && calls.written[0].len === SETUP_BYTES.length);
    t("instalat: installerul a fost pornit (openPath)", calls.openPath.length === 1 && calls.openPath[0].includes("Setup"), JSON.stringify(calls.openPath));
    t("instalat: nu s-a relansat in portable", calls.relaunch.length === 0);
  }

  // --- 2) PORTABLE -> se descarca exe-ul portable si se relanseaza in el
  {
    const chosen = libUpdate.pickAsset(assets, true);
    t("portable: se alege exe-ul portable (nu Setup)", !chosen.name.includes("Setup"), chosen.name);
    const { calls, opts } = makeOpts(true);
    const r = await libUpdate.performUpdate(chosen, opts);
    t("portable: modul raportat = portable", r.mode === "portable", r.mode);
    t("portable: s-a descarcat exe-ul portable (dim corecta)", calls.written.length === 1 && calls.written[0].len === PORTABLE_BYTES.length);
    t("portable: relaunch in noul exe", calls.relaunch.length === 1 && calls.relaunch[0].execPath.includes("Path.of.Expedition.1.1.19.exe"), JSON.stringify(calls.relaunch));
    t("portable: installerul NU a fost pornit", calls.openPath.length === 0);
    await new Promise((r2) => setTimeout(r2, 30));   // timerul de inchidere
    t("portable: aplicatia se inchide dupa relans", calls.quit === 1, String(calls.quit));
  }

  // --- 3) integritate: sha256 gresit -> NU se porneste nimic
  {
    const bad = { ...assets[0], sha256: "0".repeat(64) };
    const { calls, opts } = makeOpts(true);
    let err = null;
    try { await libUpdate.performUpdate(bad, opts); } catch (e) { err = e; }
    t("sha256 gresit: se arunca eroare", !!err && /SHA-256 mismatch/.test(err.message), err && err.message);
    t("sha256 gresit: nu s-a pornit nimic", calls.relaunch.length === 0 && calls.openPath.length === 0);
  }

  // --- 4) integritate: dimensiune gresita -> refuzat
  {
    const bad = { ...assets[0], size: assets[0].size + 10 };
    const { calls, opts } = makeOpts(false);
    let err = null;
    try { await libUpdate.performUpdate(bad, opts); } catch (e) { err = e; }
    t("dim gresita: se arunca eroare", !!err && /Size mismatch/.test(err.message), err && err.message);
    t("dim gresita: nu s-a pornit installerul", calls.openPath.length === 0);
  }

  // --- 5) integritate: fara digest -> refuzat (audit S2)
  {
    const bad = { ...assets[0], sha256: null };
    const { calls, opts } = makeOpts(true);
    let err = null;
    try { await libUpdate.performUpdate(bad, opts); } catch (e) { err = e; }
    t("fara digest: se arunca eroare", !!err && /sha256/.test(err.message), err && err.message);
    t("fara digest: nu s-a pornit nimic", calls.relaunch.length === 0);
  }

  // --- 6) host strain -> refuzat inainte de descarcare
  {
    const bad = { ...assets[0], url: "https://evil.example.com/x.exe" };
    const { calls, opts } = makeOpts(true);
    let err = null;
    try { await libUpdate.performUpdate(bad, opts); } catch (e) { err = e; }
    t("host strain: se arunca eroare", !!err && /Blocked download host/.test(err.message), err && err.message);
    t("host strain: nu s-a pornit nimic", calls.relaunch.length === 0);
  }

  // --- 7) serverul cade (HTTP 500) -> raportat, nu pornit
  {
    const chosen = libUpdate.pickAsset(assets, false);
    const { calls, opts } = makeOpts(false);
    opts.fetchImpl = async () => ({ ok: false, status: 500 });
    let err = null;
    try { await libUpdate.performUpdate(chosen, opts); } catch (e) { err = e; }
    t("HTTP 500: se arunca eroare", !!err && /HTTP 500/.test(err.message), err && err.message);
    t("HTTP 500: nu s-a pornit installerul", calls.openPath.length === 0);
  }

  // --- 8) alegerea assetului: portable prioritar, setup la backup
  {
    const onlySetup = [assets[1]];
    t("doar Setup in lista: portable primeste Setup (fallback)", libUpdate.pickAsset(onlySetup, true).name.includes("Setup"));
    const onlyPortable = [assets[0]];
    t("doar portable in lista: installer primeste portable (fallback)", libUpdate.pickAsset(onlyPortable, false).name.includes("1.1.19.exe") && !libUpdate.pickAsset(onlyPortable, false).name.includes("Setup"));
    t("lista goala: null", libUpdate.pickAsset([], true) === null);
  }

  server.close();
  console.log(`\n  ${pass} trecute, ${fail} esuate`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("EROARE:", e); server.close(); process.exit(1); });
