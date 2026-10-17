# PoE Ninja API - Note

## Ce e suportat (public)
Doar endpoint-urile de **economy overview** (POE1 + POE2). Niciun secret — le citești din tab-ul Network (F12).

## Ce NU e permis
- Builds/profiles API (character, PoB, auth) — intern, nu e pentru third-party.
- Poate schimba/strica oricând.
- Clients care abuzează de economy endpoints → **block**.

## Fără garanție de stabilitate
- API-ul există pentru site, nu e un produs. "Supported public surface" = ai voie să-l folosești, NU e stabil.
- Fără versioning, fără SLA. Breaking changes pot apărea fără notificare (best-effort).

## Ghid pentru app-uri
- **Desktop apps trebuie să proxieze request-urile prin un propriu backend** (nu direct de pe mașina user-ului). Asta permite: cache, User-Agent corect, control volum.
- Responses sunt HTTP-cached (~5 min, ETag). Folosește conditional requests, respectă cache headers, NU bypassa cache.
- Datele se actualizează rar: POE1 ~15 min, **POE2 ~oră**. Polling mai des de câteva minute = bandwidth irosit.
- Trimite un **User-Agent descriptiv** (identifică app-ul + contact).
- Fii rezonabil cu concurența și volumul.
- Nu replica site-ul. Construiește ceva nou.

## Endpoints

### Economy leagues
- POE1: `GET /poe1/api/economy/leagues`
- POE2: `GET /poe2/api/economy/leagues`
- Return: array de `{id, name}`. Primul = current temporary challenge league (folosește `id` ca parametru `league`).

### Exchange overview (currencies - CEL FOLOSIT DE NOI)
- POE2: `GET /poe2/api/economy/exchange/current/overview?league={league}&type={type}`

**type valorile POE2:**
| Valoare | Categorie |
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
  - `primaryValue` = prețul în primary reference currency (Divine de obicei)
- `core`: `{primary, secondary, rates, items[]}`
  - `items[]`: `{id, name, category, image, detailsId}` (metadate, nume)
- `items[]` (top-level): metadata per item
- `lines[]` + `items[]` se leagă prin `id`

### Stash item overview (uniques, gems, etc.)
- POE2: `GET /poe2/api/economy/stash/current/item/overview?league={league}&type={type}`

**type POE2:** UniqueWeapons, UniqueArmours, UniqueAccessories, UniqueFlasks, UniqueCharms, UniqueJewels, UniqueSanctumRelics, UniqueTablets, PrecursorTablets

**Response `lines[]`:** `{id, itemId, detailsId, name, baseType, category, primaryValue, listingCount, corrupted, levelRequired, ...}`
- `primaryValue` = valoare în primary reference currency
- `name` = numele itemului

### Stash currency overview (DOAR POE1)
- POE2 currency e servit prin **exchange overview** (nu prin stash)

## Implementarea noastră
- Endpoint principal: `GET /poe2/api/economy/exchange/current/overview?league=...&type=Currency`
- Fetchăm mai multe `type` (Currency, Fragments, UncutGems, Essences, SoulCores, Idols, Runes, Verisium, Expedition)
- Facem un map: `name(lower) -> {price, id}`, unde `price` e normalizat in Divine
  (`primaryValue * divinePerPrimary`, ca sa mearga si pe ligi cu `core.primary = "exalted"`)
- La scan, OCR-ul dă nume (ex "Greater Orb of Augmentation"), le căutăm în map
- Afișăm prețul cu logica **autoCurrency** (ca EX2 / PoeAncientsPriceHelper):
  - pret ~>= 1 Divine -> in **Divine**
  - pret < 1 Divine -> in **Exalted** (moneda core; fallback Chaos)
  - modul manual (Div / Exalted / Chaos) ramane disponibil din dropdown

## Reguli de good-citizen
- User-Agent: `ExpeditionPriceChecker/1.0 (contact: ...)`
- Cache responses local ~5-10 min (ETag)
- Nu polling mai des de 5 min
- Limita concurența
