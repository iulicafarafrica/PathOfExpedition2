# Changelog

All notable changes to **Path of Expedition**. This project uses the version in
`package.json` and the matching Git tag (`vX.Y.Z`).

## [1.3.1] - 2026-11-21

### Added
- **Refresh prices** button in the Prices toolbar (also available in **Options → Refresh prices**).
- Refreshing re-prices the items already on screen immediately, without a new OCR scan.

### Fixed
- The **Prices updated** timestamp now updates after every fetch (launch, 30-minute auto-refresh and manual refresh), not only after a scan.

## [1.3.0] - 2026-11-21

### Added
- **UI themes**: Parchment, Dark and Light, selectable from **Options → Theme** and saved between sessions. Only the app window changes - the in-game overlay and OCR are untouched.
- UI scaled up by 30% for readability.

### Changed
- Larger cards on the **Other tools** tab.
- **Buy me a coffee** now links to `https://ko-fi.com/nr5xdev`.
- External URL allowlist reduced to the links actually used.

## [1.2.2] - 2026-11-21

### Changed
- Other tools titles: **PoE 1 and 2 Chat Alert** and **PoE 1 & 2 Trade Watcher**.
- Both buttons renamed to **Get tool**.

## [1.2.1] - 2026-11-21

### Changed
- Both Other tools buttons link to `https://nr5x.dev/path-of-exile`.
- Updated descriptions for Chat Alert and Trade Watcher.
- Allowlist updated; the old GitHub and Chrome Web Store links were removed.

## [1.2.0] - 2026-11-21

### Added
- Configurable **sound alert threshold**: 1 / 5 / 10 / 20 Divine.
- Quick filter chips: **All / 1+ / 10+**.
- **Session summary**: total Divine per run, drop count, best drop, Divine/hour, **Reset run** and the last 10 runs.
- **Overlay style settings**: opacity, text size, bar scale, text and highlight colors.

### Fixed
- A startup bug that could reset the saved config (incorrect initialization order of `alertMin`).
