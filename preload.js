const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setLeague: (league) => ipcRenderer.invoke("set-league", league),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openDebug: () => ipcRenderer.invoke("open-debug"),
  getDebug: () => ipcRenderer.invoke("get-debug"),
  checkOcr: () => ipcRenderer.invoke("check-ocr"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  doUpdate: (asset) => ipcRenderer.invoke("do-update", asset),
  scanNow: () => ipcRenderer.invoke("scan-now"),
  selectRegion: () => ipcRenderer.invoke("select-region"),
  refreshPrices: () => ipcRenderer.invoke("refresh-prices"),
  onScan: (cb) => ipcRenderer.on("scan", (_e, data) => cb(data)),
  sendRegion: (region) => ipcRenderer.send("region-selected", region),
});
