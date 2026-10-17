# Path of Expedition

A small Windows desktop app for Path of Exile 2. It reads the Runeshape / Expedition reward panel from your screen and tells you what those drops are actually worth, using live prices from poe.ninja.

I made it because I was tired of mentally converting "2x Greater Orb of Transmutation" into exalted every time a run closed out.

**This project is not affiliated with, endorsed by, or sponsored by Grinding Gear Games.** "Path of Exile", "Path of Exile 2", and related marks belong to Grinding Gear Games. This tool is a fan-made convenience; GGG's ToS apply to everything you do in-game. It is also not affiliated with poe.ninja — the app just uses their public exchange API for prices, same as their own website does.

---

## Quick start

1. Grab the latest `.exe` from [Releases](https://github.com/iulicafarafrica/PathOfExpedition2/releases) (the portable one is enough, no install needed). If you'd like, run it through [VirusTotal](https://www.virustotal.com/gui/file-analysis/ZDUxNWFlNzU4Yjk5MjA0ZDBhYmUwMDJiZmEzYThlM2Q6MTc5MjI1NzEzNg==) first — this is the current build, and the project is fully open source so you can also just read the code or build it yourself (see [Open source & security](#open-source--security)).
2. Run it and pick your **league** from the dropdown.
3. In-game, open the **Runeshape Combinations** panel.
4. Click **Select region**, drag the green box over the reward panel and resize it to cover the list, then press **Enter**.
5. That's it. It scans the panel every 3 seconds and shows the running total as items land.

Your region and league are saved, so the next time you launch it just picks up where you left off. If you move the game window, re-select the region.

## Features

| Feature | What it does |
| --- | --- |
| Region capture | You frame the part of the screen that matters (the reward list). It works on multi-monitor setups and handles DPI scaling, so 125%/150% displays are fine. |
| Windows OCR | Reads the panel text using the OCR built into Windows itself — no cloud, no extra engine, no model downloads. See [How the OCR works](#how-the-ocr-works). |
| Smart name matching | OCR isn't perfect, so matching is layered: exact → digit fixes (`0→o`, `1→l`, …) → prefix → fuzzy edit-distance. It also fixes possessives ("Jeweller s" → "Jewellers") and refuses to guess levels on uncut gems. |
| Live poe.ninja prices | Pulls the exchange overview for Currency, Runes, Expedition, Verisium and UncutGems, normalizes everything to "per 1 Divine", and converts it to the league's primary currency correctly (exalted on HC, divine on softcore). |
| Auto currency | Cheap items show in exalted, expensive ones in divine — same rounding rules as the poe.ninja site, so numbers match what you'd see there. |
| Stack totals | Prices are shown for the whole stack (`5x` = 5 × unit), with the unit price in parentheses when qty > 1. |
| Value tiers | The most valuable drop glows green, the least is dimmed. Easy to spot what mattered. |
| League switch | Change league in-app; prices reload and the current panel is re-priced immediately. |
| Auto-scan | Scans every 3 s once a region is set. No start/stop button to forget. |
| Price auto-refresh | Prices reload every 30 minutes (poe.ninja caches ~5 min anyway); **Refresh prices** forces it on demand. |
| Chat/noise filter | Chat lines and panel noise that isn't a priced item and has no explicit `Nx` quantity get dropped, so the list stays clean. |
| Update check | Checks GitHub Releases on launch and every 30 min. When a newer release is out, a banner appears and **Update now** downloads and launches it. |
| Check OCR | Verifies that the Windows OCR engine is present and which languages are installed. Useful when the text looks garbled. |
| Debug window | Shows the raw OCR lines and an app log for the last scans — the first place to look when something reads wrong. |
| Buy me a coffee | If it saves you money or sanity, a coffee is appreciated: https://buymeacoffee.com/iulian.icb |

## How the OCR works

There is no Tesseract, no Python, no neural model downloaded on first run. The app uses **Windows' own OCR engine** — the `Windows.Media.Ocr` WinRT API, the same one behind "Copy text from image" in Windows Photos and the clipboard OCR.

Per scan, the pipeline is:

1. **Capture** — Electron's `desktopCapturer` grabs the full screen at native resolution, the saved region is cropped out (with DPI scaling applied), and the crop is written to a temp PNG.
2. **Recognize** — a small bundled PowerShell script (`ocr.ps1`) loads the PNG through the WinRT imaging stack and runs `OcrEngine.RecognizeAsync`. The engine is created from your Windows profile languages (`TryCreateFromUserProfileLanguages`), so it uses whatever OCR language you have installed. It returns each line's text plus its x/y position, as JSON.
3. **Parse** — the main process groups lines into reward rows (name + `Nx` quantity), filters out noise, and matches them against the price cache.

Everything runs locally on your machine; no screenshot or text ever leaves it.

**Requirement:** an OCR language pack must be installed in Windows. For the English UI, make sure English OCR is on:

> Settings → Time & Language → Language & region → (your language) → Language options → **Download** under "Optional features" (OCR).

If in-game text comes out garbled or items don't match, hit **Check OCR** in the app — it tells you whether the engine loads and which languages are available. If it says the engine is unavailable, install the language pack and restart the app.

## Tech

- **Electron** — main process in Node.js (capture, OCR, prices, IPC), `contextIsolation` + sandboxed renderer, no remote code, navigation locked down.
- **electron-builder** — ships as a portable `.exe` and an NSIS installer (x64).
- **Vanilla HTML/CSS/JS** for the UI — one screen, no framework, no build step for the renderer.
- **WinRT OCR via PowerShell** (`System.Runtime.WindowsRuntime` → `Windows.Media.Ocr`, `Windows.Graphics.Imaging`) — Windows-native recognition, no external OCR dependency.
- **poe.ninja exchange API** (`/poe2/api/economy/exchange/current/overview`) — same data their website displays; results normalized to per-1-Divine internally.
- **GitHub Releases API** — update detection and download.

Dev notes: `npm run dev` runs it unpackaged, `npm run dist` builds both executables into `dist/`.

## Open source & security

The whole app is in this repository, [MIT licensed](LICENSE), and there is no hidden or "proprietary" part. The `.exe` in the releases is exactly this source built with electron-builder — nothing is injected after the fact.

**What it talks to over the network** (full list, verifiable in `main.js`):

- `poe.ninja` exchange API — prices (the same endpoint their website uses)
- `api.github.com` — this repo's release feed, for the update check
- the release's `.exe` download URL — **only** when you press "Update now"
- buymeacoffee.com — **only** when you click the footer link

That's it. No telemetry, no analytics, no other endpoints. Screenshots and OCR text are processed locally and never uploaded anywhere. Your settings live in a single `config.json` under your Windows user data folder (`%APPDATA%\path-of-expedition`).

**Build it yourself** (Windows, Node 18+):

```
git clone https://github.com/iulicafarafrica/PathOfExpedition2
cd PathOfExpedition2
npm install
npm run dist
```

The executables land in `dist/`. `package-lock.json` pins the dependencies, so a fresh clone builds the same thing.

**VirusTotal scan of the current build:** <https://www.virustotal.com/gui/file-analysis/ZDUxNWFlNzU4Yjk5MjA0ZDBhYmUwMDJiZmEzYThlM2Q6MTc5MjI1NzEzNg==>. (New releases get a new hash — feel free to re-scan before running.)

**"Wait, my antivirus flagged it?"** — that happens, and it's worth understanding. A single engine (so far: McAfee) reports a detection like `Ti!89ED4493BBF4`. That name is **not a known virus** — it's the first 12 characters of the file's own SHA-256, which is how McAfee labels its *generic behavioral* (heuristic) detections, as opposed to a signature for real malware (which would carry a family name like `W32.Sality` or `Trojan:Win32/...`). What feeds the heuristic in this case: the exe is **unsigned** (no code-signing certificate yet), the portable build is a self-extracting archive with a bundled Electron runtime, and the app spawns a local PowerShell process for Windows OCR and captures a screen region — exactly the behaviors those engines like to watch. The tells that it's a false positive: 1-2 of ~70 engines flagging it, the code above is the entire app (read it or build it yourself), and it talks to no network endpoint beyond the ones listed. If your AV or a new VirusTotal scan shows something different from that pattern, please open an issue — and consider holding off on running the file until it's looked at. I'm working toward code-signing the releases, which removes most of these flags at the source.

## Troubleshooting

- **Garbled text / nothing matches** → wrong or missing OCR language (see above). The Debug window shows exactly what OCR read.
- **Some drops missing** → make sure the region covers the whole list, the panel isn't covered by chat or another window, and in-game UI scale is normal.
- **Wrong price** → poe.ninja has no data for that item, or it's a level-specific uncut gem (the app deliberately won't guess). Prices are always the current exchange value, not a fixed "base".
- **Rate-limited by poe.ninja** → the app respects their ~5 min cache and refreshes at most every 30 min; if you spam Refresh, you'll hit their limits.
- **Multi-monitor** → select the region on the monitor where the panel actually is; the app binds the capture to that display.

## Support

If this saves you a headache (or a few exalted), consider a coffee:

☕ **https://buymeacoffee.com/iulian.icb**

Issues and ideas: [GitHub issues](https://github.com/iulicafarafrica/PathOfExpedition2/issues).
