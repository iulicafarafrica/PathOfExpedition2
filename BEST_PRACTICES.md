# Best Practices — ce am cercetat și ce am aplicat

Cercetate din: **Electron Security Checklist** oficial (electronjs.org/docs/latest/tutorial/security)
și **fork-ul de referință** Endre-Tonnessen/Exiled-Exchange-2-Expedition-Checker.

Toate schimbările de mai jos sunt **non-breaking** — pipeline-ul (WGC → Windows OCR →
parser → matching → prețuri) n-a atins funcțional. Fiecare a fost testată după aplicare.

---

## ✅ APLICATE (sigure, verificate)

### 1. Content Security Policy (CSP)
- **De ce:** Electron avertizează "Insecure Content-Security-Policy" fără CSP. CSP e o
  barieră suplimentară contra XSS/data-injection.
- **Ce am făcut:** adăugat `<meta http-equiv="Content-Security-Policy">` în `index.html`
  și `select.html`. Politică: `default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:` (blocăm conținut remote,
  permitem scripturi/stiluri inline care avem).
- **Verificare:** avertismentul CSP a dispărut din log (0 apariții).

### 2. Sandbox pe renderere
- **De ce:** "You should enable the sandbox in all renderers" (Electron). Isolează procesul
  renderer de Node.js.
- **Ce am făcut:** `sandbox: true` pe ambele ferestre (main + select).
- **De ce e sigur:** preload sandbox-uit poate folosi `contextBridge` + `ipcRenderer`
  (send/on/invoke) — exact ce folosim. Testat izolat: `window.api` se expune, IPC merge.

### 3. Context Isolation (deja avea)
- `contextIsolation: true` + `nodeIntegration` implicit false. Corect, păstrat.

### 4. Guard-uri de navigare
- **De ce:** aplicația e 100% locală. Navigarea externă / `window.open` din renderer e
  risc inutil.
- **Ce am făcut:** handler `web-contents-created` care face `preventDefault()` pe
  `will-navigate` și `setWindowOpenHandler(() => ({action:"deny"}))`.

### 5. Doar conținut local
- Ambele ferestre folosesc `loadFile()` (file://), nu `loadURL` remote. Corect.

### 6. Igienă dependencies
- **Eliminat `tesseract.js`** (1.6M, neutilizat — am trecut la Windows OCR nativ).
  Verificat: zero referințe în cod. `npm prune` l-a scos din node_modules.

### 7. `author` în package.json
- electron-builder avertiza "author is missed". Adăugat. Avertismentul a dispărut.

### 8. Error handlers globale (deja avea)
- `process.on("uncaughtException")` + `unhandledRejection` + log fișier `xpc-debug.log`.

### 9. Loguri structurate
- `log()` scrie în `C:\Users\gigid\AppData\Local\Temp\xpc-debug.log` la fiecare pas
  important (fetch, scan, OCR, parse). Ușurează debugging-ul.

---

## 🔧 RECOMANDĂRI (nu am aplicat — ar cere refactoring, risc să strică)

Conform "fără să strici codul", am notat ce ar mai fi de făcut MAI TÂRZI:

### A. Proxy prin backend (recursiune PoE Ninja)
- PoE Ninja recomandă: desktop apps ar trebui să proxieze request-urile prin un propriu
  backend (cache, User-Agent, control volum) în loc să bage per-user traffic direct.
- **Acum:** apelăm direct din main process cu `User-Agent` descriptiv + TTL 5 min
  (respectăm cache-ul lor). E acceptabil pentru un tool local. Proxy e overkill acum.

### B. Tests automate (vitest)
- Fork-ul are suite de teste (OCR text repair, price matching, rune detection).
- **Recomandare:** extrage `rows.js` (parser) + `lookupPrice` (matching) într-un modul
  testabil și scrie teste unitare pe cazurile OCR garble ("IX"→"1x", "Chao"→"Chaos").
- Nu am făcut: ar cere restructurare. `rows.js` e deja un modul curat (module.exports),
  gata de testat separat când vrem.

### C. TypeScript
- Fork-ul e TypeScript (tipuri pe IPC, pe OCR result).
- **Recomandare:** migre la TS când aplicația crește. Acum JS-ul simplu e mai ușor de
  maintain'd pentru un tool mic.

### D. Icon + semnătură
- Electron folosește "default Electron icon". electron-builder avertizează.
- **Recomandare:** adaugă un `icon.ico` + semnătură de cod pentru distribuție pe internet.
- Nu am făcut: am nevoie de asset-ul icon + certificat.

### E. Actualizare Electron
- Electron 31.7.7 e folosit. "By updating Electron to the latest version, you ensure
  critical vulnerabilities are patched."
- **Recomandare:** bump la ultima versiune Electron stabil periodic.

---

## Arhitectură — ce e bine (păstrat din fork)

- **Doar TEXT trece la renderer** (nu pixeli) prin IPC — `scan` trimite `{rows:[{name,qty,price}]}`.
- **OCR ca subprocess** (non-blocking) — nu blochează main thread.
- **Prețuri în Divine Orbs** (primary reference currency) — consistent cu API-ul.
- **Config persistat** în `userData/config.json` — regiunea + pozitia ferestrei supraviețuiesc restart-ului.
