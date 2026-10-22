// Teste pentru release-guard: repo-uri git reale, in %TEMP%.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const guard = require("D:/ExiledExchange2/expedition/.opencode/plugin/release-guard.js");

const g = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function mkRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rg-"));
  g(d, ["init", "-q"]);
  g(d, ["config", "user.email", "t@t.t"]);
  g(d, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x", version: "1.2.3" }, null, 2));
  fs.writeFileSync(path.join(d, "main.js"), "console.log(1)");
  g(d, ["add", "-A"]);
  g(d, ["commit", "-qm", "init"]);
  return d;
}

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}

// 1) push de ramura = NU e blocat
{
  const d = mkRepo();
  const r = guard.inspectPush("git push origin main", d);
  t("push de ramura nu e tratat ca tag", !r.isTagPush);
  t("push de ramura: nicio problema", r.problems.length === 0);
}
// 2) tag corect (versiune == package.json, commit in ramura) = OK
{
  const d = mkRepo();
  g(d, ["tag", "-a", "v1.2.3", "-m", "release"]);
  const r = guard.inspectPush("git push origin v1.2.3", d);
  t("tag corect: acceptat", r.problems.length === 0, JSON.stringify(r.problems));
  t("tag corect: gasit un tag", r.tags.length === 1 && r.tags[0] === "v1.2.3");
}
// 3) REPRODUCEREA BUGULUI REAL: tag v1.1.17 creat automat pe un commit cu
//    package.json 1.1.13 (sursa versiunii 1.1.17 nu e in repo) = BLOCAT
{
  const d = mkRepo();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x", version: "1.1.13" }));
  g(d, ["add", "-A"]); g(d, ["commit", "-qm", "old source"]);
  g(d, ["tag", "-a", "v1.1.17", "-m", "release"]);
  const r = guard.inspectPush("git push origin v1.1.17", d);
  t("tag pe sursa mai veche (cazul real v1.1.17): blocat", r.problems.length > 0, JSON.stringify(r.problems));
  t("mesajul explica mismatch-ul", /nu corespunde sursei/.test(r.problems.join(" ")));
  t("mesajul spune ca sursa nu contine versiunea", /nu contine deloc/.test(r.problems.join(" ")));
}
// 4) tag inexistent = BLOCAT
{
  const d = mkRepo();
  const r = guard.inspectPush("git push origin v9.9.9", d);
  t("tag inexistent: blocat", r.problems.length > 0);
  t("mesajul cere crearea tag-ului", /git tag -a/.test(r.problems.join(" ")));
}
// 5) tag pe un commit care NU e in ramura curenta = BLOCAT
{
  const d = mkRepo();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ version: "1.2.4" }));
  g(d, ["add", "-A"]); g(d, ["commit", "-qm", "bump"]);
  g(d, ["checkout", "-q", "-b", "side"]);
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ version: "9.9.9" }));
  g(d, ["add", "-A"]); g(d, ["commit", "-qm", "side"]);
  g(d, ["tag", "-a", "v9.9.9", "-m", "side"]);
  g(d, ["checkout", "-q", "master"]);
  const r = guard.inspectPush("git push origin v9.9.9", d);
  t("tag din alta ramura: blocat", r.problems.length > 0, JSON.stringify(r.problems));
  t("mesajul cere commit inainte de push", /git add -A/.test(r.problems.join(" ")));
}
// 6) push --tags verifica toate tag-urile
{
  const d = mkRepo();
  g(d, ["tag", "-a", "v1.2.3", "-m", "ok"]);
  g(d, ["tag", "-a", "v7.7.7", "-m", "bad"]);
  const r = guard.inspectPush("git push origin --tags", d);
  t("push --tags: verifica toate tag-urile", r.tags.length === 2);
  t("push --tags: blocat din cauza tag-ului gresit", r.problems.length > 0);
}
// 7) refs/tags/... si --follow-tags sunt recunoscute
{
  const d = mkRepo();
  t("forma refs/tags recunoscuta", guard.isTagPush("git push origin refs/tags/v1.2.3"));
  t("forma --follow-tags recunoscuta", guard.isTagPush("git push origin main --follow-tags"));
  t("comanda fara push nu e tratata", !guard.isTagPush("git tag -a v1.2.3"));
  t("comanda compusa e tratata", guard.isTagPush("git commit -m x && git push origin v1.2.3"));
}
// 7b) tag care indica spre o sursa MAI NOUA (cazul documentat v1.1.17) = doar atentionare
{
  const d = mkRepo();
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ version: "1.2.4" }));
  g(d, ["add", "-A"]); g(d, ["commit", "-qm", "bump"]);
  g(d, ["tag", "-a", "v1.2.3", "-m", "old tag pe sursa noua"]);
  const r = guard.inspectPush("git push origin v1.2.3", d);
  t("tag spre sursa mai noua: NU e blocat", r.problems.length === 0, JSON.stringify(r.problems));
  t("tag spre sursa mai noua: atentionare", r.warnings.some((w) => /mai noua/.test(w)));
}
// 7c) tag care pretinde o versiune mai noua decat sursa = BLOCAT (cazul v1.1.17 original)
{
  const d = mkRepo();   // package.json = 1.2.3
  g(d, ["tag", "-a", "v1.5.0", "-m", "tag prea nou"]);   // sursa nu are 1.5.0
  const r = guard.inspectPush("git push origin v1.5.0", d);
  t("tag cu versiune mai noua decat sursa: blocat", r.problems.length > 0, JSON.stringify(r.problems));
  t("mesajul explica ca sursa nu contine versiunea", /nu contine deloc/.test(r.problems.join(" ")));
}
// 8) hook-ul blocheaza efectiv comanda (output.args este mutat + throw)
async function testHook() {
  const d = mkRepo();                       // package.json = 1.2.3
  g(d, ["tag", "-a", "v9.9.9", "-m", "bad"]);   // tag pretinde o versiune mai noua decat sursa
  const plugin = await guard();
  const hook = plugin["tool.execute.before"];
  const output = { args: { command: "git push origin v9.9.9" } };
  let threw = false;
  try { await hook({ tool: "bash", directory: d }, output); } catch { threw = true; }
  t("hook-ul arunca (blocheaza comanda)", threw);
  t("hook-ul a inlocuit comanda (aprare in adancime)", !/git push/.test(output.args.command));
  // push de ramura: trece nestingherit
  const output2 = { args: { command: "git push origin main" } };
  let threw2 = false;
  try { await hook({ tool: "bash", directory: d }, output2); } catch { threw2 = true; }
  t("hook-ul lasa push-ul de ramura sa treaca", !threw2 && /git push/.test(output2.args.command));
}

// 9) tag-uri deja pe remote = nu se verifica (sunt istorie publicata)
{
  const d = mkRepo();
  // remote local (bare) + tag deja publicat
  const bare = d + "-remote.git";
  execFileSync("git", ["init", "-q", "--bare", bare], { encoding: "utf8" });
  g(d, ["remote", "add", "origin", bare]);
  g(d, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  g(d, ["tag", "-a", "v1.2.3", "-m", "ok"]);
  g(d, ["push", "-q", "origin", "refs/tags/v1.2.3"]);
  // tag nou, gresit
  g(d, ["tag", "-a", "v2.0.0", "-m", "bad"]);   // sursa are 1.2.3 -> versiune mai noua
  const r = guard.inspectPush("git push origin --tags", d);
  t("tag deja publicat: nu e verificat", !r.tags.includes("v1.2.3"), JSON.stringify(r.tags));
  t("tag nou: este verificat", r.tags.includes("v2.0.0"));
  t("tag nou gresit: blocat", r.problems.length > 0, JSON.stringify(r.problems));
  t("mesajul noteaza tagurile deja publicate", r.warnings.some((w) => /deja publicate/.test(w)));
}

testHook().then(() => {
  console.log(`\n  ${pass} trecute, ${fail} esuate`);
  process.exit(fail ? 1 : 0);
});
