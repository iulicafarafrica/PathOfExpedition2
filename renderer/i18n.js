// i18n minimal (fara dependinte): t() + traducerea automata a atributelor din HTML.
// Limbile sunt in locales.js (window.I18N_LOCALES); limba vine din config (main process).
(() => {
  const LOCALES = window.I18N_LOCALES || {};
  const FALLBACK = "en";
  let lang = FALLBACK;

  function pick(key) {
    const d = LOCALES[lang] || {};
    if (Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    const f = LOCALES[FALLBACK] || {};
    return Object.prototype.hasOwnProperty.call(f, key) ? f[key] : key;
  }
  function t(key, vars) {
    let s = pick(key);
    if (typeof s !== "string") return String(key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  }
  function apply(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((el) => { const k = el.getAttribute("data-i18n"); if (k) el.textContent = t(k); });
    r.querySelectorAll("[data-i18n-html]").forEach((el) => { const k = el.getAttribute("data-i18n-html"); if (k) el.innerHTML = t(k); });
    r.querySelectorAll("[data-i18n-title]").forEach((el) => { const k = el.getAttribute("data-i18n-title"); if (k) el.title = t(k); });
    r.querySelectorAll("[data-i18n-ph]").forEach((el) => { const k = el.getAttribute("data-i18n-ph"); if (k) el.placeholder = t(k); });
    if (r === document && document.documentElement) document.documentElement.lang = lang;
  }
  // lista pentru selectorul din Options: { id, name } (numele in limba respectiva)
  function list() {
    return Object.keys(LOCALES).map((id) => ({ id, name: (LOCALES[id] && LOCALES[id]["lang.name"]) || id }));
  }
  function setLang(id) {
    const code = String(id || "");
    lang = Object.prototype.hasOwnProperty.call(LOCALES, code) ? code : FALLBACK;
    apply(document);
    return lang;
  }
  // la pornire: limba salvata in config; apoi urmarim schimbarile live de la alte ferestre
  async function init() {
    try {
      const c = await window.api.getConfig();
      setLang(c && c.lang);
    } catch {}
    return lang;
  }
  function live(cb) {
    if (window.api && window.api.onLang) window.api.onLang((l) => { setLang(l); if (cb) cb(lang); });
  }

  window.I18N = {
    t, apply, setLang, init, live, list,
    get lang() { return lang; },
  };
})();
