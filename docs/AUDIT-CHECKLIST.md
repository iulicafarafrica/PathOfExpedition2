# Audit checklist — Path of Expedition

The checklist used for the 1.1.18 audit. Re-run it before a major release, after a big
refactor, or whenever the app touches the network, the screen, or the updater.

Everything here has a **mechanical guard** (see `scripts/preflight.js` / `test/run.js`) or
is marked as *manual*. If you add an invariant, add its guard in the same commit — an
invariant nobody checks is a comment, not a rule.

---

## 1. Release & git hygiene

| Check | How | Guard |
| --- | --- | --- |
| Version in `package.json` is the released version | `npm run preflight` | automated |
| Tag `v<version>` exists **and points at the published source commit** | `git rev-list -n 1 v<version>` vs `HEAD` | automated |
| A **new** tag's source actually contains that version | `release-guard` plugin (`.opencode/plugin/`) | automated for AI-assisted pushes |
| Working tree clean before building | `git status --porcelain` | automated (warning) |
| No local artifacts in the repo | `git ls-files` vs README usage | automated (`.gitignore`) |
| No secrets committed | pattern scan over tracked files | automated |
| Every released version's source is in git | `git log --oneline -- tags` | manual |

**Failure mode this prevents:** publishing a binary whose source was never committed.
The tag then points at older code and the "open source, build it yourself" claim breaks.

---

## 2. Security

### Renderer isolation
- [ ] Every `BrowserWindow`: `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`.
- [ ] Global `web-contents-created` handler blocks `will-navigate` and denies
      `setWindowOpenHandler`.
- [ ] CSP present in **all 5** renderers; `script-src 'self'` (no `'unsafe-inline'`).
- [ ] No inline `<script>` in HTML (they would need `'unsafe-inline'`).
- [ ] Every value from data/i18n/OCR is escaped before it reaches `innerHTML`.

### Network
- [ ] Every outbound URL is either an allowlisted regex (`lib/net.js`) or built in the
      main process from validated components.
- [ ] New domain → anchored regex **+ test** in `test/run.js`.
- [ ] PowerShell is spawned with an **argv array**, never a shell string; parameters come
      from fixed maps, never from user input.
- [ ] The endpoint list in the README matches reality
      (poe.ninja, web.poecdn.com, api.github.com, release asset, buymeacoffee).

### Updater
- [ ] Download host allowlisted (`github.com`, `objects.githubusercontent.com`).
- [ ] sha256 **and** size verified before the file is written or run; missing digest is
      a hard error, never a skip.
- [ ] Portable vs installer asset chosen by install type (`pickAsset`).

### Supply chain
- [ ] `dependencies` is empty — nothing third-party ships with the app.
- [ ] Electron on a supported major.
- [ ] `npm audit` — only build-time advisories may remain; they must be dev-only.

---

## 3. Performance

| Hot path | Rule | Measured |
| --- | --- | --- |
| Screen capture | crop natively, never loop pixels in JS | 22.0 ms → 7.6 ms per scan (2.9×) |
| Price lookup | memoize; cache key arrays | ~1700 lookups/click → ~33 distinct |
| Name resolution | cache `Object.keys(dict)` (WeakMap) | per call, was re-allocating |
| Log writes | buffer + async append | was `appendFileSync` per line |
| Debug window | send deltas, not the whole buffer | was 300 lines every 1.5 s |
| OCR | skip when the region is unchanged (hash) | keeps idle cost near zero |

Rule of thumb: anything that runs on a timer or per scanned item must be O(1) in
allocations and must not block the main thread.

---

## 4. Robustness

- [ ] Pure logic lives in `lib/` with tests; `main.js` orchestrates.
- [ ] Refactors of matching/pricing prove equivalence against the old implementation on
      the real price map (golden-master comparison), not just on hand-picked cases.
- [ ] Uncaught exceptions produce a user-visible recovery path (Restart/Quit), not a
      silent log line.
- [ ] A hung window is announced to the user and recovered (reload), not ignored.
- [ ] Temp files are cleaned: swept at startup, and `%TEMP%` writes are bounded.
- [ ] Errors shown to the user are localized (translation keys, not English strings).
- [ ] Every new locale key exists in all 10 languages (test enforces parity).

---

## 5. Verification (before "done")

1. `npm run preflight` → green.
2. `npm run dist` → the gate runs again; artifacts exist.
3. Launch the **packaged** app and verify over CDP:
   - the UI renders (no blank page),
   - the changed feature works,
   - **0 console errors** (CSP violations show up here),
   - the OCR path still returns lines,
   - overlays open and close.
4. `git status` is clean; tag matches the version; push.

---

## 6. Content

- [ ] Guide/loot content stays credited to its sources (u/Sidnv, Jestra1229).
- [ ] Loot tables come from the spreadsheet; values are re-checked before being edited.
- [ ] Patch-number claims (e.g. "0.5.4 added the atlas tree") come from official notes.
