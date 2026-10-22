---
description: Ruleaza gate-ul de calitate (teste + invariante) si repara ceea ce merge stricat
agent: build
---

Ruleaza gate-ul de proiect pentru Path of Expedition si repara problemele gasite.

1. Ruleaza `npm run preflight` (din radacina proiectului) si citeste TOT output-ul,
   inclusiv atentionarile.
2. Pentru fiecare **FAIL**:
   - citeste `AGENTS.md` (regulile non-negociabile) si `docs/AUDIT-CHECKLIST.md`;
   - identifica regula incalcata si **repara cauza**, nu verificarea;
   - nu modifica `scripts/preflight.js` ca sa treaca testul, decat daca regula insusi
     trebuie schimbata (atunci explica de ce in commit).
3. Pentru fiecare **ATENTIE**, decide si spune clar: se rezolva acum sau se lasa pentru
   release (ex. working tree murdar = commit inainte de build).
4. Repornește `npm run preflight` pana cand ies **0 esecuri**.
5. Daca ai atins codul aplicatiei (nu doar docs/config), verifica si build-ul:
   `npm run dist`, apoi testeaza aplicatia **packaged** (nu doar sursa) prin CDP:
   porneste `dist/Path of Expedition <versiune>.exe --remote-debugging-port=9333`,
   conecteaza-te, verifica ca UI-ul se randeaza si ca **nu exista erori de consola**
   (o incalcare CSP apare acolo).
6. Raporteaza: ce a fost stricat, ce ai reparat, ce ramane (daca ceva), si starea
   finala a gate-ului. Nu spune "gata" daca preflight-ul nu e verde.
