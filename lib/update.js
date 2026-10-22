// Logica updater-ului - functii pure (testabile fara Electron).
// Download-ul si pornirea raman in main.js; aici sunt doar deciziile:
//  - ce asset alegem (portable vs installer)
//  - cum verificam integritatea (dimensiune + sha256) INAINTE de a rula bin-arul

"use strict";

const crypto = require("crypto");

// host-uri permise pentru descarcare (asset-urile vin din release-ul nostru de GitHub)
const ALLOWED_DOWNLOAD_HOSTS = /^(github\.com|objects\.githubusercontent\.com)$/i;

// Alege asset-ul de ACELASI TIP: instalat -> Setup, portable -> exe-ul portable.
// (altfel o instalare s-ar trezi cu o copie portable in %TEMP% si invers)
function pickAsset(assets, isPortable) {
  if (!assets || !assets.length) return null;
  const setup = assets.find((a) => /setup/i.test(a.name));
  const portable = assets.find((a) => !/setup/i.test(a.name));
  return isPortable ? (portable || setup) : (setup || portable);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Verifica un asset descarcat. ARUNCA o eroare daca nu poate fi verificat:
// nu pornim NICIODATA un binar fara sha256 + dimensiune (audit S2).
// Returneaza { sha256 } la success.
function verifyAsset(asset, buf) {
  if (!asset) throw new Error("No asset to verify");
  const host = hostOf(asset.url);
  if (!ALLOWED_DOWNLOAD_HOSTS.test(host)) {
    throw new Error("Blocked download host: " + host);
  }
  if (!asset.sha256) {
    throw new Error("Release has no sha256 digest - refusing to run an unverified binary");
  }
  if (!asset.size) {
    throw new Error("Release has no size - refusing to run an unverified binary");
  }
  if (buf.length !== asset.size) {
    throw new Error(`Size mismatch (expected ${asset.size}, got ${buf.length}) - download aborted`);
  }
  const h = sha256Hex(buf);
  const expected = String(asset.sha256).replace(/^sha256:/i, "").trim().toLowerCase();
  if (h !== expected) throw new Error("SHA-256 mismatch - download aborted");
  return { sha256: h, size: buf.length };
}

function hostOf(url) {
  try { return new URL(url).hostname; }
  catch { return ""; }
}

// ---------------------------------------------------------------------------
// Executia update-ului (testabila: toate dependintele sunt injectate)
// ---------------------------------------------------------------------------
// opts = {
//   isPortable: boolean          - true daca rulam din build-ul portable
//   fetchImpl:  (url, init) => Response
//   writeFile:  (path, buffer) => void
//   openPath:   (path) => Promise<string>   (shell.openPath - pentru installer)
//   relaunch:   ({ execPath, args }) => void (app.relaunch - pentru portable)
//   quit:       () => void
//   destDir:    string           (de obicei os.tmpdir())
//   log:        (...args) => void
//   quitDelayMs: number          (implicit 800)
// }
//
// Regula: instalat -> descarca Setup-ul si il porneste (installerul cere
// inchiderea aplicatiei si repornește); portable -> descarca exe-ul portable
// si reporneste in el (app.relaunch), ca sa nu ramanem doua instante.
async function performUpdate(asset, opts) {
  const o = opts || {};
  if (!asset || !asset.url) throw new Error("No asset to download");
  const nodePath = require("node:path");
  const dest = nodePath.join(o.destDir || require("node:os").tmpdir(), asset.name.replace(/[^\w.\- ]+/g, "_"));
  const log = o.log || (() => {});
  const r = await o.fetchImpl(asset.url, { headers: { "User-Agent": "PathOfExpedition" } });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  // INTEGRITATE: host + dimensiune + sha256 - toate obligatorii.
  const v = verifyAsset(asset, buf);
  log(`update: sha256 ok (${v.sha256})`);
  o.writeFile(dest, buf);
  log(`update: downloaded ${asset.name} (${buf.length} bytes) -> ${dest}`);
  if (o.isPortable) {
    // o singura instanta: daca am lansa acum noua copie, ar fi redirectionata
    // catre cea veche si am iesi. Deci pornim noul exe DUPA ce iesim noi.
    o.relaunch({ execPath: dest, args: [] });
    log("update: restarting into", dest);
    const delay = o.quitDelayMs === undefined ? 800 : o.quitDelayMs;
    setTimeout(() => o.quit(), delay);
    return { ok: true, dest, name: asset.name, mode: "portable", restarting: true };
  }
  // instalare cu Setup: installer-ul cere singur inchiderea aplicatiei, apoi o reporneste
  const launchErr = await o.openPath(dest);
  if (launchErr) throw new Error(launchErr);
  return { ok: true, dest, name: asset.name, mode: "installer" };
}

module.exports = { pickAsset, verifyAsset, performUpdate, sha256Hex, hostOf, ALLOWED_DOWNLOAD_HOSTS };
