const { app, BrowserWindow } = require("electron");
const URL = "https://poe.ninja/poe2/economy/forbiddenrites/runes/ward-rune";
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(URL, { timeout: 30000 }).catch((e) => console.log("load:", e.message));
  await new Promise((r) => setTimeout(r, 6000));
  try {
    const txt = await win.webContents.executeJavaScript(`
      (function(){
        var out = {};
        // toata textul, cu structur pe randuri
        var all = (document.body.innerText||"").split(/\\n+/).filter(function(x){return x.trim();});
        // gaseste randurile cu "Chaos", "Exalted", "Divine" si cele dinainte (numarul)
        out.relevant = [];
        for (var i=0;i<all.length;i++){
          var line = all[i];
          if (/Chaos|Exalted|Divine|Exchange|Volume/i.test(line) && line.length < 60){
            // ia numarul de pe randul sau sau anterior
            out.relevant.push(all.slice(Math.max(0,i-1), i+2).join(" ~ "));
          }
        }
        // si context in jurul lui 95
        var raw=(document.body.innerText||"");
        var k=raw.indexOf("95");
        while(k>=0 && k<raw.length){
          var seg=raw.slice(Math.max(0,k-40),k+40).replace(/\\s+/g," ");
          if(/[Ee]xalted|[Cc]haos|[Dd]ivine/.test(seg)){ out.nineetyfive=seg; break; }
          k=raw.indexOf("95",k+1);
        }
        return out;
      })()
    `);
    console.log("=== RANDURI RELEVANTE (poe.ninja Ward Rune) ===");
    (txt.relevant||[]).forEach(function(r){ console.log("  "+r); });
    console.log("\\ncontext 95:", txt.nineetyfive||"(nimic)");
  } catch (e) { console.log("exec err:", e.message); }
  app.quit();
});
