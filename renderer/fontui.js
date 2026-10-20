// Selectie de font (fonturi sistem Windows, fara descarcare) partajata intre
// fereastra principala si overlay-urile. Alegerea e un token persistat in config;
// aici mapam token -> CSS font-stack si il punem pe variabila --ui-font.
(function () {
  const TOKENS = [
    { id: "segoe",     label: "Segoe UI",         stack: "'Segoe UI', Tahoma, sans-serif" },
    { id: "georgia",   label: "Georgia",          stack: 'Georgia, "Times New Roman", serif' },
    { id: "cambria",   label: "Cambria",          stack: 'Cambria, "Times New Roman", serif' },
    { id: "consolas",  label: "Consolas",         stack: "'Consolas', 'Courier New', monospace" },
    { id: "verdana",   label: "Verdana",          stack: 'Verdana, Geneva, sans-serif' },
    { id: "tahoma",    label: "Tahoma",           stack: 'Tahoma, Geneva, sans-serif' },
    { id: "trebuchet", label: "Trebuchet MS",     stack: "'Trebuchet MS', Tahoma, sans-serif" },
    { id: "times",     label: "Times New Roman",  stack: '"Times New Roman", Times, serif' },
    { id: "courier",   label: "Courier New",      stack: '"Courier New", Courier, monospace' },
    { id: "arial",     label: "Arial",            stack: 'Arial, Helvetica, sans-serif' },
    { id: "norse",     label: "Norse (fantasy)",  stack: '"Norse", Georgia, serif' },
  ];
  const DEFAULT = "segoe";
  function byId(id) { return TOKENS.find((t) => t.id === id) || TOKENS[0]; }
  // aplica fontul pe intreaga fereastra (variabila CSS citita de toate regulile)
  function apply(id) {
    document.documentElement.style.setProperty("--ui-font", byId(id).stack);
    return byId(id).id;
  }
  window.FontUI = { TOKENS, DEFAULT, byId, apply };
})();
