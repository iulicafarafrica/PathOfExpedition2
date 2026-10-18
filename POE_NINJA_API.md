# PoE Ninja API — Notes

## What is supported (public)
Only the **economy overview** endpoints (PoE1 + PoE2). No secrets — you can read them from the Network tab (F12).

## What is NOT allowed
- Builds/profiles API (character, PoB, auth) — internal, not meant for third parties.
- It can change or break at any time.
- Clients that abuse the economy endpoints get **blocked**.

## No stability guarantee
- The API exists for the website; it is not a product. "Supported public surface" means you are allowed to use it, NOT that it is stable.
- No versioning, no SLA. Breaking changes can appear without notice (best-effort).

## Guidance for apps
- Desktop apps should proxy requests through their own backend (not directly from the user's machine). That allows: caching, a proper User-Agent, and volume control.
- Responses are HTTP-cached (~5 min, ETag). Use conditional requests, respect the cache headers, do NOT bypass the cache.
- Data updates slowly: PoE1 ~15 min, **PoE2 ~1 hour**. Polling more often than every few minutes is wasted bandwidth.
- Send a **descriptive User-Agent** (identify the app + a contact).
- Be reasonable with concurrency and volume.
- Don't replicate the site. Build something new.

## Endpoints

### Economy leagues
- PoE1: `GET /poe1/api/economy/leagues`
- PoE2: `GET /poe2/api/economy/leagues`
- Returns an array of `{id, name}`. The first entry is the current temporary challenge league (use `id` as the `league` parameter).
- (We do not call this endpoint — see [Our implementation](#our-implementation).)

### Exchange overview (currencies — THE ONE WE USE)
- PoE2: `GET /poe2/api/economy/exchange/current/overview?league={league}&type={type}`

**PoE2 `type` values:**

| Value | Category |
|---------|-----------|
| Currency | Currency |
| Fragments | Fragments |
| Abyss | Abyssal Bones |
| UncutGems | Uncut Gems |
| LineageSupportGems | Lineage Gems |
| Essences | Essences |
| SoulCores | Soul Cores |
| Idols | Idols |
| Runes | Runes |
| Ritual | Omens |
| Expedition | Expedition |
| Delirium | Liquid Emotions |
| Breach | Catalysts |
| Verisium | Verisium |

**Response:**
- `lines[]`: `{id, primaryValue, volumePrimaryValue, maxVolumeCurrency, maxVolumeRate, sparkline}`
  - `primaryValue` = price in the primary reference currency (usually Divine)
  - `sparkline` = `{totalChange, data[]}` (7 days)
- `core`: `{primary, secondary, rates, items[]}`
  - `primary` / `secondary` = reference currencies; `rates` = exchange rates relative to the primary one
- `items[]` (top-level): per-item metadata `{id, name, category, image, detailsId}`
- `lines[]` and `items[]` are joined by `id`

### Stash item overview (uniques, gems, etc.)
- PoE2: `GET /poe2/api/economy/stash/current/item/overview?league={league}&type={type}`

**PoE2 `type` values:** UniqueWeapons, UniqueArmours, UniqueAccessories, UniqueFlasks, UniqueCharms, UniqueJewels, UniqueSanctumRelics, UniqueTablets, PrecursorTablets

**Response `lines[]`:** `{id, itemId, detailsId, name, baseType, category, primaryValue, listingCount, corrupted, levelRequired, ...}`
- `primaryValue` = value in the primary reference currency
- `name` = item name

### Stash currency overview (PoE1 ONLY)
- PoE2 currency is served through the **exchange overview** (not through stash)

## Our implementation
- Base URL: `https://poe.ninja/poe2/api/economy`
- Main endpoint: `GET /poe2/api/economy/exchange/current/overview?league={league}&type={type}`
- Categories we fetch (`NINJA_TYPES`): **Currency, Runes, Expedition, Verisium, UncutGems** (5 categories).
- We do **not** call the `/leagues` endpoint. Leagues are a **hardcoded** list:
  `Forbidden Rites`, `HC Forbidden Rites`, `Runes of Aldur`, `HC Runes of Aldur`, `Standard`.
  The selected league name is sent verbatim as the `league` parameter.
- We build a map `name(lowercased) -> {price, id, name}`, where `price` is normalized to Divine:
  `primaryValue * divinePerPrimary`, with `divinePerPrimary = 1` when `core.primary === "divine"`,
  otherwise `core.rates.divine`. This makes it work on leagues whose primary currency is Exalted (Hardcore).
- Exchange rates are normalized to "per 1 Divine": `exalted per div = exPerPrimary / divPerPrimary`,
  `chaos per div = chaosPerPrimary / divPerPrimary`.
- At scan time, OCR produces names (e.g. "Greater Orb of Augmentation") which are looked up in the map
  using layered matching (exact → digit fixes → prefix → fuzzy edit-distance).
- Prices are displayed with the **autoCurrency** logic (identical to how the poe.ninja website shows them):
  - price ~>= 1 Divine → shown in **Divine**
  - price < 1 Divine → shown in the **core** currency (Exalted, fallback Chaos)
  - there is **no manual currency dropdown** in the app — display is always `"auto"`.
- When poe.ninja or the network is unavailable, we fall back to the last saved snapshot
  (`prices-cache.json`) and mark the prices as "cached — offline".

## Our good-citizen rules
- User-Agent: `PathOfExpedition/1.0 (desktop app; contact: local)`
- We rely on poe.ninja's own HTTP cache (~5 min, ETag) and do not bypass it.
- Prices refresh automatically every **30 min** (and retry every **5 min** while offline).
- Scanning (OCR only) runs every **3 s** and does not hit the API.
- Request volume is kept minimal: 5 category requests per refresh.
