---
description: Ritualul complet de release (versiune, commit, tag, build, verificare, push)
agent: build
---

Publica o versiune noua a Path of Expedition. Urmeaza ordinea **exacta** de mai jos -
durata de la "edit" la "release" a fost cauza tag-ului v1.1.17 gresit.

1. **Ce versiune?** $ARGUMENTS (implicit: urmatoarea patch/minor fata de `package.json`).
   Actualizeaza `package.json` (`version`) si nimic altceva.
2. **Verifica ca ai terminat treaba:**
   - `npm run preflight` -> trebuie sa fie **0 esecuri**;
   - daca ai schimbat UI-ul sau continutul: verifica aplicatia **packaged** prin CDP
     (UI-ul se randeaza, feature-ul nou merge, **0 erori de consola**).
3. **Commit** sursa: grupa logic (nu "totul in un commit"), mesaj in stilul repo-ului
   (`<versiune>: <rezumat>`), fara secrete si fara artefacte locale.
4. **Tag** pe commitul nou: `git tag -a v<versiune> -m "<versiune>: <rezumat>"`.
   Tag-ul **trebuie** sa indice sursa publicata. Nu crea release-ul de pe `main`.
5. **Build**: `npm run dist` (gate-ul ruleaza automat). Verifica ca au iesit ambele
   artefacte in `dist/`: `Path of Expedition <v>.exe` si `Path of Expedition Setup <v>.exe`.
6. **Verifica artefactul construit** (nu sursa): porneste exe-ul cu
   `--remote-debugging-port=9333`, verifica UI + ghid + overlay + scan + 0 erori consola.
7. **Push**: `git push origin main` si `git push origin v<versiune>`.
8. **Release pe GitHub:** foloseste **tag-ul creat la pasul 4** (nu lasa GitHub sa creeze
   altul) si ataseaza cele doua `.exe` din `dist/`. Note de release: ce s-a schimbat,
   in cate cuvinte, cu creditari pentru sursele comunitare (u/Sidnv, Jestra1229) daca
   continutul Guide-ului s-a schimbat.
9. **Verifica final**: pagina release-ului arata surra corecta (tag -> commitul cu
   sursa binarelui), iar `git ls-remote --tags origin` arata tag-ul nou.
10. Raporteaza: versiune, commit, tag, dimensiunile artefactelor, linkul release-ului si
    orice pas lasat nefacut.

Daca un pas esueaza, **opreste-te acolo** si raporteaza - nu continua cu un release
jumatat facut.
