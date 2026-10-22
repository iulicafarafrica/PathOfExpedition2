// Allowlist-ul de URL-uri externe - functie pura (testabila fara Electron).
//
// Rendererul nu poate deschide orice URL: doar cele din lista de mai jos
// ajung la shell.openExternal (in main proces). Regex-uri ancorate, ca un
// subdomeniu sau o cale similara sa nu treaca de verificare.

"use strict";

const EXTERNAL_ALLOW = [
  // pagina de suport
  /^https:\/\/buymeacoffee\.com\/iulian\.icb\/?$/i,
  // repository-ul proiectului (release-uri, issues)
  /^https:\/\/github\.com\/iulicafarafrica\/PathOfExpedition2(\/|$)/i,
  // pagina de item pe poe.ninja: /poe2/economy/{liga}/{categorie}/{item}
  /^https:\/\/poe\.ninja\/poe2\/economy\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  // creditele din tab-ul Guide: ghidul lui u/Sidnv pe Reddit
  /^https:\/\/(www\.)?reddit\.com\/r\/pathofexile2builds\/comments\/[a-z0-9]+\/[a-z0-9_-]+\/?$/i,
  // foaia de calcul "Expedition Cheatsheet" a lui Jestra1229
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(\/.*)?$/i,
];

function isExternalAllowed(url) {
  if (typeof url !== "string" || !url) return false;
  return EXTERNAL_ALLOW.some((re) => re.test(url));
}

module.exports = { EXTERNAL_ALLOW, isExternalAllowed };
