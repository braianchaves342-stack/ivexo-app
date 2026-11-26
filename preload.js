const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const web = Object.freeze({
  open: (id, url) => ipcRenderer.invoke("ivexo:web:open", id, url),
  navigate: (id, url) => ipcRenderer.invoke("ivexo:web:navigate", id, url),
  close: id => ipcRenderer.invoke("ivexo:web:close", id),
  setBounds: (id, bounds, visible) => ipcRenderer.invoke("ivexo:web:bounds", id, bounds, visible),
  focus: id => ipcRenderer.invoke("ivexo:web:focus", id),
  nav: (id, action) => ipcRenderer.invoke("ivexo:web:nav", id, action),
  onNavigated: callback => subscribe("ivexo:web:navigated", callback),
  onTitle: callback => subscribe("ivexo:web:title", callback),
  onError: callback => subscribe("ivexo:web:error", callback)
});

contextBridge.exposeInMainWorld("ivexo", Object.freeze({ web }));
