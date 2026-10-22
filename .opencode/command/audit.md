---
description: Audit de securitate, performanta si robustețe al aplicatiei (checklist complet)
agent: build
---

Ruleaza un audit complet al Path of Expedition, pe baza `docs/AUDIT-CHECKLIST.md`.

1. Citeste `AGENTS.md` (invariantele) si `docs/AUDIT-CHECKLIST.md` (checklist-ul).
2. Verifica **fiecare** sectiune din checklist, ca in tabelul de mai jos. Marcheaza
   fiecare rand: OK / PROBLEM / N/A (cu motiv).
   - 1. Release & git hygiene
   - 2. Security (izolare renderer, retea, updater, supply chain)
   - 3. Performance (captura, preturi, nume, loguri, debug, OCR)
   - 4. Robustness (lib/ pur, echivalenta refactor, exceptii, temp, localizare)
   - 5. Verification (ce a fost efectiv verificat, ce a ramas neverificat)
   - 6. Content (credite, surse de date, corectitudinea afirmatiilor despre patch-uri)
3. Pentru fiecare problema: **sevitate** (CRITICAL / HIGH / MEDIUM / LOW / INFO),
   **fisier:linie**, **de ce conteaza**, **fix concret**.
4. Verifica faptele, nu doar impresiile: foloseste `Select-String`/`grep` pe cod,
   citeste efectiv fisierele, si masoara ce se poate masura (benchmarks mici in
   `%TEMP%`, ex. `node -e` sau un script Electron temporar). Verifica si ca un claim
   din README corespunde realitatii (ex. lista de endpointuri).
5. Nu modifica nimic in acest pas (audit = read-only). Raporteaza si propune un plan
   de remediere ordonat pe severitate si efort.
6. Daca un claim anterior (din rapoarte vechi) se dovedeste fals, spune-o explicit si
   corecteaza-l.

La final, intreaba utilizatorul: ce vrea remediat acum, ce ramane pentru mai tarziu.
