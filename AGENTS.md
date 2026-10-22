# Path of Expedition — project rules

Electron app (main process + 5 sandboxed renderers) that OCRs the PoE2 Expedition
"Runeshape" panel and prices the drops live from poe.ninja. Windows only, offline-first,
**zero runtime dependencies** (Electron + this repo's own code only).

These rules exist because each one was learned the hard way. **Read them before changing
anything, and never work around a failing check — fix the cause.**

---

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run from source. |
| `npm test` | 63 regression tests (`test/run.js`), no dependencies needed. |
| `npm run preflight` | **The gate.** Tests + all invariants (security, packaging, release discipline). Run before you claim anything is done. |
| `npm run preflight:release` | Strict mode — also requires a clean tree and a tag matching the version. Run before publishing. |
| `npm run dist` | Builds portable + installer. Runs `predist` → the gate runs automatically; a failing check stops the build. |
| `npm run build-names` | Regenerates `data/names/*.json` from the official trade API (network). |

`npm run preflight -- --fast` skips the network audit. Never skip the rest.

**Slash commands (this project):** `/preflight` (run the gate and fix it),
`/release` (the full release ritual), `/audit` (security/performance/robustness review).
Use them instead of improvising the steps.

---

## Non-negotiable invariants

### Release discipline
1. **Commit the source before you build or publish.** A binary whose source is not in
   git is unshippable — the tag would point at older code and nobody could audit it.
2. **The tag `v<version>` must point at the commit that contains exactly the published
   source.** Create it *after* the commit, never let GitHub auto-create it from `main`.
   (This is how `v1.1.17` ended up pointing at the 1.1.13 commit.)
3. Order is fixed: **edit → `npm run preflight` → commit → tag → build → verify the
   built app → push → create the GitHub release using the existing tag.**
4. Bump `package.json` version first; the tag must match it (the gate checks this).
5. Never commit local artifacts (screenshots, `.ahk`, `.ps1` helpers). `.gitignore` lists
   them — add to it if a new one appears.

### Security
6. `script-src` in every renderer is exactly `'self'`. **No `'unsafe-inline'` for scripts.**
   Move inline `<script>` blocks into `renderer/<page>.js`. Inline *styles* are fine.
7. Every window keeps `contextIsolation: true` + `sandbox: true`. No `nodeIntegration`.
8. External links only via `lib/net.js` (`isExternalAllowed`) — anchored regexes only.
   A new domain = a new regex **plus a test** in `test/run.js`.
9. The updater **must** verify sha256 + size before running anything. No "skip" path.
10. Anything user-visible that crosses the IPC boundary is escaped (`esc()` in the
    renderers) — including i18n interpolations. No raw `T(...)` inside `innerHTML`.
11. Error messages that reach the UI come back as **translation keys** (`errorKey`),
    never as English strings from the main process.
12. Zero runtime dependencies. New npm packages go to `devDependencies` only, and only
    if they are not shipped in the app.
13. Keep Electron on a supported major (the gate checks it). Bump it in its own commit.

### Performance
14. Never walk pixels in JS over a full-screen capture — use `nativeImage.crop`
    (2.9× faster, measured, byte-identical output).
15. No sync file I/O in hot paths (`appendFileSync` etc.). Buffer and write async.
16. Do not allocate key arrays inside per-item loops — cache them.
17. Memoize repeated lookups (the planner calls `lookupPrice` ~1700× per click).

### Code shape
18. Logic that can be pure goes in `lib/` as a **pure function with a test**. `main.js`
    orchestrates; it does not compute. This is how the main process got test coverage.
19. When you refactor matching/pricing, prove equivalence: compare old vs new on the
    real price map (golden-master script) before you ship.
20. Comments explain *why*, not *what*. Match the surrounding style (Romanian comments,
    English identifiers).

### Content & localization
21. The UI has **10 languages** (en, nl, de, fr, es, pt, ru, ja, ko, th). Any new UI
    string goes into **all 10** `renderer/locales.js` blocks — the test enforces parity.
22. The Guide tab content is community-sourced and **credited**: u/Sidnv (Reddit guide)
    and Jestra1229 (Expedition Cheatsheet). Keep the credits when editing it.
23. Prices/loot data comes from poe.ninja and the official trade API — cite the source
    in comments and README.

---

## Before you say "done"

```bash
npm run preflight        # must be green
npm run dist             # gate runs again automatically
```

Then verify the **packaged** app, not just the source: launch
`dist/Path of Expedition <version>.exe` with `--remote-debugging-port=NNNN`, connect over
CDP and check that the UI renders, the changed feature works, and there are **zero console
errors** (a CSP violation shows up there). Source-only checks miss renderer/CSP bugs.

---

## Layout

```
main.js            Electron main: capture, OCR, prices, overlays, IPC, updater
preload.js         contextBridge API (the only renderer↔main surface)
lib/               pure, tested helpers: text, prices, update, capture, net
renderer/          index.html+index.js (main UI), overlay, runeoverlay, debug, select
renderer/guide.js  Guide content, 10 locales + loot tables (community-sourced)
renderer/locales.js  all UI strings, 10 languages
rows.js            OCR lines → item rows
planner.js         runes → 322 Runeshape recipes
names.js           localized item names (OCR language ↔ English)
data/              runes, recipes, name maps (offline databases)
scripts/preflight.js  the gate
test/run.js        regression tests
tools/build-names.js regenerates data/names
AGENTS.md          these rules (loaded automatically in every session)
docs/AUDIT-CHECKLIST.md  the audit checklist
.opencode/command/ /preflight, /release, /audit
```

## Details

`docs/AUDIT-CHECKLIST.md` — the full security/performance/robustness checklist to re-run
before a major release, with the reasoning behind each item.
