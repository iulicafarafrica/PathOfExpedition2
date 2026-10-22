// Scriptul aplicatiei pentru select.html (extras din HTML ca sa putem
// folosi o CSP fara 'unsafe-inline').
I18N.init().then(() => I18N.apply(document)).catch(() => {});
window.addEventListener("error", (e) => {
  // logueaza erorile in consola principalului
  console.error("SELECT ERROR:", e.message, "at", e.filename, e.lineno);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const region = {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    window.api.sendRegion(region);
    window.close();
  }
  if (e.key === "Escape") window.close();
});
