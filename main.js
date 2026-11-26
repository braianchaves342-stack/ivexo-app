const { app, BrowserWindow, WebContentsView, ipcMain } = require("electron");
const path = require("node:path");
const { startServer } = require("./server");

const WEB_PARTITION = "persist:ivexo-web";
const MAX_BROWSER_VIEWS = 100;
const views = new Map();
let mainWindow = null;
let localServer = null;

app.commandLine.appendSwitch("enable-gpu-rasterization");

function assertRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("Solicitud IPC no autorizada.");
  }
}

function validateViewId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error("Identificador de ventana inválido.");
  return id;
}

function normalizeWebUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Ingresá una dirección web válida.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("IVEXO solo permite direcciones HTTP o HTTPS.");
  }
  if (url.username || url.password) throw new Error("La URL no puede incluir credenciales.");
  return url.href;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function browserState(item, url) {
  const history = item.view.webContents.navigationHistory;
  sendToRenderer("ivexo:web:navigated", {
    id: item.id,
    url,
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward()
  });
}

function createBrowserView(id, url) {
  if (views.size >= MAX_BROWSER_VIEWS) {
    throw new Error(`Límite alcanzado: máximo ${MAX_BROWSER_VIEWS} vistas de navegador.`);
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: WEB_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const item = { id, view, requestedUrl: url };
  views.set(id, item);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);

  view.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      normalizeWebUrl(targetUrl);
    } catch {
      event.preventDefault();
    }
  });

  view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const destination = normalizeWebUrl(targetUrl);
      item.requestedUrl = destination;
      view.webContents.loadURL(destination).catch(error => {
        sendToRenderer("ivexo:web:error", { id, message: error.message });
      });
    } catch (error) {
      sendToRenderer("ivexo:web:error", { id, message: error.message });
    }
    return { action: "deny" };
  });

  view.webContents.on("did-navigate", (_event, currentUrl) => browserState(item, currentUrl));
  view.webContents.on("did-navigate-in-page", (_event, currentUrl) => browserState(item, currentUrl));
  view.webContents.on("page-title-updated", (_event, title) => {
    sendToRenderer("ivexo:web:title", { id, title: String(title || "") });
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      sendToRenderer("ivexo:web:error", { id, message: errorDescription || `Error de navegación ${errorCode}.`, url: validatedUrl });
    }
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    sendToRenderer("ivexo:web:error", { id, message: `La página se cerró inesperadamente (${details.reason}).` });
  });

  return item;
}

function closeBrowserView(id) {
  const item = views.get(id);
  if (!item) return false;
  views.delete(id);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(item.view);
  if (!item.view.webContents.isDestroyed()) item.view.webContents.destroy();
  return true;
}

ipcMain.handle("ivexo:web:open", (event, rawId, rawUrl) => {
  assertRenderer(event);
  const id = validateViewId(rawId);
  const url = normalizeWebUrl(rawUrl);
  let item = views.get(id);
  if (!item) item = createBrowserView(id, url);
  if (item.requestedUrl !== url) {
    item.requestedUrl = url;
    item.view.webContents.loadURL(url).catch(error => {
      sendToRenderer("ivexo:web:error", { id, message: error.message, url });
    });
  } else if (item.view.webContents.getURL() === "") {
    item.view.webContents.loadURL(url).catch(error => {
      sendToRenderer("ivexo:web:error", { id, message: error.message, url });
    });
  }
  return { id, url };
});

ipcMain.handle("ivexo:web:navigate", (event, rawId, rawUrl) => {
  assertRenderer(event);
  const id = validateViewId(rawId);
  const item = views.get(id);
  if (!item) throw new Error("La pestaña de navegador ya no existe.");
  const url = normalizeWebUrl(rawUrl);
  item.requestedUrl = url;
  return item.view.webContents.loadURL(url).then(() => true);
});

ipcMain.handle("ivexo:web:close", (event, rawId) => {
  assertRenderer(event);
  return closeBrowserView(validateViewId(rawId));
});

ipcMain.handle("ivexo:web:bounds", (event, rawId, bounds, visible) => {
  assertRenderer(event);
  const item = views.get(validateViewId(rawId));
  if (!item) return false;

  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const shouldShow = Boolean(visible) &&
    [x, y, width, height].every(Number.isFinite) &&
    width >= 2 && height >= 2;

  if (shouldShow) {
    const { width: areaWidth, height: areaHeight } = mainWindow.getContentBounds();
    const left = Math.max(0, Math.min(Math.round(x), areaWidth - 1));
    const top = Math.max(0, Math.min(Math.round(y), areaHeight - 1));
    const right = Math.max(left + 1, Math.min(Math.round(x + width), areaWidth));
    const bottom = Math.max(top + 1, Math.min(Math.round(y + height), areaHeight));
    item.view.setBounds({ x: left, y: top, width: right - left, height: bottom - top });
  }
  item.view.setVisible(shouldShow);
  return true;
});

ipcMain.handle("ivexo:web:focus", (event, rawId) => {
  assertRenderer(event);
  const item = views.get(validateViewId(rawId));
  if (!item) return false;
  mainWindow.contentView.removeChildView(item.view);
  mainWindow.contentView.addChildView(item.view);
  item.view.webContents.focus();
  return true;
});

ipcMain.handle("ivexo:web:nav", (event, rawId, action) => {
  assertRenderer(event);
  const item = views.get(validateViewId(rawId));
  if (!item) return false;
  const contents = item.view.webContents;
  const history = contents.navigationHistory;
  if (action === "back" && history.canGoBack()) history.goBack();
  else if (action === "forward" && history.canGoForward()) history.goForward();
  else if (action === "reload") contents.reload();
  else return false;
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: "#111214",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    for (const id of views.keys()) closeBrowserView(id);
    mainWindow = null;
  });

  const port = localServer.address().port;
  return mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  localServer = await startServer(0);
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  console.error("No se pudo iniciar IVEXO:", error);
  app.quit();
});

app.on("before-quit", () => {
  for (const id of views.keys()) closeBrowserView(id);
  if (localServer) localServer.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
