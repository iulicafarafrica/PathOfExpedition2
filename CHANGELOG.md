# Changelog

All notable changes to Path of Expedition. This project follows Semantic
Versioning; each release is tagged `vX.Y.Z` and matches the version in
`package.json`.

## [1.3.1] - 2026-11-21

### Added
- Refresh prices button in the Prices toolbar, also available under Options > Refresh prices.

### Changed
- Manual price refresh now re-prices the items already displayed without starting a new OCR scan.

### Fixed
- The Prices updated timestamp now updates after every fetch: on launch, on the automatic 30-minute refresh, and on manual refresh.

## [1.3.0] - 2026-11-21

### Added
- UI themes: Parchment, Dark and Light. The selected theme is saved between sessions.
- Larger interface scale for improved readability.

### Changed
- Larger cards on the Other tools tab.
- The Buy me a coffee link now points to ko-fi.com/nr5xdev.
- Theme changes apply only to the application window; the in-game overlay and OCR behaviour are unaffected.

### Security
- External URL allowlist reduced to the links actually used by the application.

## [1.2.2] - 2026-11-21

### Changed
- Other tools entries renamed to PoE 1 and 2 Chat Alert and PoE 1 & 2 Trade Watcher.
- Both action buttons renamed to Get tool.

## [1.2.1] - 2026-11-21

### Changed
- Both Other tools buttons now link to nr5x.dev/path-of-exile.
- Updated descriptions for Chat Alert and Trade Watcher.

### Security
- External URL allowlist updated; the previous GitHub and Chrome Web Store entries were removed.

## [1.2.0] - 2026-11-21

### Added
- Configurable sound alert threshold: 1, 5, 10 or 20 Divine.
- Quick filter chips for the price list: All, 1+ and 10+.
- Session summary with total Divine per run, drop count, best drop, Divine per hour, Reset run, and the last 10 runs.
- Overlay style settings: opacity, text size, bar scale, text colour and highlight colour.

### Fixed
- A startup issue that could reset the saved configuration due to the initialisation order of the alert threshold value.
