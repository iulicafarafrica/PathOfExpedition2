// ---------------------------------------------------------------------------
// release-guard: blocheaza push-ul unui tag de release care nu corespunde
// sursei publicate.
//
// Problema pe care o previne: un tag creat automat de GitHub (din `main`) sau
// un tag mutat gresit face ca pagina de release sa arate sursa altui
// commit - deci binarel publicat nu are sursa in repo. Pentru o aplicatie
// care isi publica binarele, asta e o problema de incredibilitate.
//
// Regula verificata la push:
//   1. tag-ul exista local
//   2. package.json din commitul tag-ului are EXACT versiunea din numele tag-ului
//   3. commitul tag-ului este in ramura care se publica
//   + avertismente: tree murdar, tag lightweight, artefacte lipsa in dist/
//
// Bypass intentionat: `git push --no-verify` NU functioneaza aici (nu e git
// hook), dar comanda se poate rescrie manual daca chiar stii ce faci.
// ---------------------------------------------------------------------------
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// ATENTIE: fara flag-ul 'g' pentru .test() - un regex global tine lastIndex
// intre apeluri si ar da rezultate false/true alternativ.
const TAG_RE = /v\d+\.\d+\.\d+/;
const TAG_RE_ALL = /v\d+\.\d+\.\d+/g;

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
    }).trim();
  } catch {
    return null;
  }
}

function gitOk(args, cwd) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore", timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

// comanda este un push de tag? (nu ne intereseaza push-urile de ramuri)
function isTagPush(cmd) {
  if (typeof cmd !== "string") return false;
  if (!/\bgit\b[^|;&]*\bpush\b/.test(cmd)) return false;
  return /refs\/tags\//.test(cmd) || /--tags\b/.test(cmd) || /--follow-tags\b/.test(cmd) || TAG_RE.test(cmd);
}

// ce tag-uri sunt impinse?
function pushedTags(cmd, cwd) {
  const found = new Set();
  const m = String(cmd).match(TAG_RE_ALL) || [];
  for (const t of m) found.add(t);
  if (/--tags\b|--follow-tags\b/.test(cmd)) {
    const all = git(["tag", "--list", "v*"], cwd);
    if (all) for (const t of all.split(/\r?\n/)) if (t.trim()) found.add(t.trim());
  }
  return [...found];
}

// ramura locala pe care se face push (pentru "origin main" -> "main")
function targetBranch(cmd, cwd) {
  const args = String(cmd).split(/\s+/).filter(Boolean);
  const i = args.indexOf("push");
  if (i === -1) return null;
  const rest = args.slice(i + 1).filter((a) => !a.startsWith("-"));
  for (const a of rest) {
    if (a === "origin" || a === "upstream") continue;
    if (/^[A-Za-z0-9._\/-]+$/.test(a) && !TAG_RE.test(a)) {
      // "origin main" -> main ; "main" -> main
      return a.includes("/") ? a.split("/").pop() : a;
    }
  }
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || null;
}

// compara doua versiuni semver: -1 / 0 / 1
function cmpVer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// verifica un tag; returneaza { problems: [], warnings: [] }
function checkTag(tag, cmd, cwd) {
  const problems = [];
  const warnings = [];

  const commit = git(["rev-parse", tag + "^{commit}"], cwd);
  if (!commit) {
    problems.push(
      `tag-ul "${tag}" nu exista local. Creeaza-l pe commitul sursei: ` +
      `git tag -a ${tag} -m "${tag}: <rezumat>"`
    );
    return { problems, warnings };
  }

  // 2. versiunea din package.json trebuie sa corespunda tag-ului
  let version = null;
  const raw = git(["show", tag + ":package.json"], cwd);
  if (raw) {
    try { version = JSON.parse(raw).version || null; } catch { version = null; }
  }
  if (!version) {
    problems.push(`nu pot citi package.json din commitul tag-ului "${tag}"`);
  } else {
    const want = tag.replace(/^v/, "");
    const c = cmpVer(version, want);
    if (c === 0) {
      // perfect: sursa publicata are exact versiunea din tag
    } else if (c > 0) {
      // tagul indica spre o surza MAI NOUA (ex. v1.1.17 -> sursa 1.1.18):
      // acceptabil - sursa contine toate feature-urile versiunii din tag.
      warnings.push(
        `tag-ul "${tag}" indica spre sursa versiunea "${version}" (mai noua). ` +
        `Acceptabil daca sursa contine toate feature-urile lui ${tag} - documenteaza asta in README.`
      );
    } else {
      // PERICOL: tagul pretinde o versiune care NU exista in sursa
      // (cazul v1.1.17: tag pe commitul cu package.json 1.1.13).
      problems.push(
        `tag-ul "${tag}" nu corespunde sursei: package.json din acel commit are versiunea ` +
        `"${version}", dar tag-ul spune "${want}" - adica sursa publicata nu contine deloc ` +
        `versiunea ${want}. Fie muti tag-ul pe commitul corect ` +
        `(git tag -f -a ${tag} -m "..."), fie comiteaza sursa versiunii ${want} inainte de push.`
      );
    }
  }

  // 3. commitul tag-ului trebuie sa fie in ramura publicata
  const branch = targetBranch(cmd, cwd);
  if (branch) {
    const branchHead = git(["rev-parse", branch], cwd);
    if (branchHead && !gitOk(["merge-base", "--is-ancestor", commit, branchHead], cwd)) {
      problems.push(
        `commitul tag-ului "${tag}" (${commit.slice(0, 7)}) NU este in ramura "${branch}" ` +
        `(${branchHead.slice(0, 7)}). Commită sursa inainte de push: ` +
        `git add -A && git commit -m "..." && git tag -f -a ${tag} -m "..."`
      );
    }
  } else {
    warnings.push("nu am putut deduce ramura publicata - am verificat doar tag-ul");
  }

  // avertismente (nu blocheaza)
  const dirty = git(["status", "--porcelain"], cwd);
  if (dirty) {
    warnings.push(
      "working tree-ul nu e curat (" + dirty.split(/\r?\n/).filter(Boolean).length +
      " fisier(e)) - sursa publicata e commitul, nu fisierele de pe disk"
    );
  }
  const type = git(["cat-file", "-t", tag], cwd);
  if (type && type !== "tag") {
    warnings.push(`tag-ul "${tag}" e lightweight (fara mesaj) - prefera "git tag -a"`);
  }
  const ver = (version || "").replace(/^v/, "");
  if (ver) {
    const portable = path.join(cwd, "dist", `Path of Expedition ${ver}.exe`);
    if (!fs.existsSync(portable)) {
      warnings.push(`nu exista "dist/Path of Expedition ${ver}.exe" - ai construit?`);
    }
  }
  return { problems, warnings };
}

// tag-urile care exista deja pe remote (nu le mai publicam, deci nu le verificam)
function remoteTags(cwd) {
  const out = git(["ls-remote", "--tags", "origin"], cwd);
  if (!out) return null;   // fara retea / fara remote -> nu putem filtra
  const set = new Set();
  for (const line of out.split(/\r?\n/)) {
    const ref = (line.split(/\s+/)[1] || "").replace("refs/tags/", "");
    const name = ref.replace(/\^\{\}$/, "");
    if (name) set.add(name);
  }
  return set;
}

// functie pura-ish, testabila: ce ar bloca acest push?
function inspectPush(cmd, cwd) {
  if (!isTagPush(cmd)) return { isTagPush: false, tags: [], problems: [], warnings: [] };
  const all = pushedTags(cmd, cwd);
  // verificam doar tag-urile NOI (cele deja pe remote sunt istorie publicata)
  const already = remoteTags(cwd);
  const fresh = already ? all.filter((t) => !already.has(t)) : all;
  const problems = [];
  const warnings = [];
  if (already) {
    const skipped = all.filter((t) => already.has(t));
    if (skipped.length) {
      warnings.push("tag-uri deja publicate (verificate doar informativ): " + skipped.join(", "));
    }
  }
  for (const t of fresh) {
    const r = checkTag(t, cmd, cwd);
    for (const p of r.problems) problems.push(p);
    for (const w of r.warnings) warnings.push(w);
  }
  if (!all.length) problems.push("push de tag-uri, dar nu am gasit niciun tag de verificat");
  return { isTagPush: true, tags: fresh, allTags: all, problems, warnings };
}

const plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (!input || input.tool !== "bash") return;
    const cmd = output && output.args ? output.args.command : "";
    const cwd = input.directory || process.cwd();
    let r;
    try {
      r = inspectPush(cmd, cwd);
    } catch (e) {
      // daca verificarea noastra crapa, NU blocam push-ul (am putea strica o
      // operatie legitima) - dar nici nu tacem.
      console.log("[release-guard] verificarea a esuat, push neblocat: " + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!r.isTagPush) return;

    for (const w of r.warnings) {
      console.log("[release-guard] ATENTIE: " + w);
    }
    if (!r.problems.length) {
      console.log("[release-guard] OK: " + r.tags.join(", ") + " - tag(uri) corespund sursei publice.");
      return;
    }
    const msg =
      "BLOCHAT de release-guard: push-ul de tag de release nu corespunde sursei publicate.\n" +
      r.problems.map((p) => "  - " + p).join("\n") +
      "\n\nRepara sursa (commit + tag) si reia push-ul.";
    console.log("[release-guard] " + msg);
    // aparare in adancime: chiar daca throw-ul nu ar opri comanda,
    // o inlocuim cu un mesaj, ca nimic sa nu fie impins.
    if (output && output.args) {
      output.args.command = `echo "[release-guard] push blocat: ${r.problems.length} problema(e) - vezi mesajul de mai sus"`;
    }
    throw new Error(msg);
  },
});

module.exports = plugin;
module.exports.inspectPush = inspectPush;
module.exports.isTagPush = isTagPush;
module.exports.checkTag = checkTag;
module.exports.targetBranch = targetBranch;
module.exports.cmpVer = cmpVer;
