const desk = document.getElementById("desk");
const overlayRoot = document.getElementById("overlayRoot");
const MAX_WEB_WINDOWS = 20;
const IVEXO_ALLOWED_PORTS = new Set(["80", "443", "3000", "5173", "8080", "8443"]);
let webInteractionShield = null;
const nativeViewIds = new Set();
let nativeViewSyncFrame = 0;
const appState = {
  z: 10,
  desktop: 1,
  desktopCount: 3,
  nextWindow: 0,
  restoring: false,
  activeId: null
};

const APP_LABELS = {
  web: "Web",
  doc: "Documento",
  files: "Archivos",
  stream: "Steam",
  calc: "Cálculo",
  jenny: "Jenny",
  settings: "Ajustes",
  notes: "Notas",
  monitor: "Monitor"
};

const commandBus = {
  execute(command, args = {}) {
    switch (command) {
      case "openApp": return openApp(args.app, args);
      case "closeWindow": return closeWindow(args);
      case "closeAll": return closeAllWindows();
      case "minimizeWindow": return minimizeWindow(args);
      case "restoreWindow": return restoreWindow(args);
      case "focusWindow": return focusWindow(findWindow(args));
      case "moveWindow": return moveWindow(args);
      case "snapWindow": return snapWindow(args);
      case "switchDesktop": return switchDesktop(args.desktop);
      case "openTab": return openWebTab(args);
      case "searchWeb": return searchWeb(args.query || "");
      case "openYoutube": return openYoutube(args);
      case "createNote": return createPostIt(args.content || "");
      case "listWindows": return listWindows();
      default: throw new Error(`Comando desconocido: ${command}`);
    }
  }
};

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function toggleWebInteractionShield(active, cursor = "default") {
  if (!webInteractionShield) {
    webInteractionShield = document.createElement("div");
    webInteractionShield.id = "ivexo-interaction-shield";
    document.body.appendChild(webInteractionShield);
  }
  webInteractionShield.style.display = active ? "block" : "none";
  webInteractionShield.style.cursor = active ? cursor : "default";
}

function allWindows() {
  return [...desk.querySelectorAll(".cap")];
}

function visibleWindows() {
  return allWindows().filter(win => Number(win.dataset.desktop) === appState.desktop && win.dataset.state !== "minimized");
}

function findWindow(criteria = {}) {
  const list = allWindows();
  if (criteria.id) return list.find(win => win.dataset.id === criteria.id) || null;
  const token = String(criteria.app || criteria.title || "").toLowerCase();
  if (token) {
    return [...list].reverse().find(win =>
      win.dataset.app.toLowerCase() === token ||
      win.dataset.title.toLowerCase().includes(token)
    ) || null;
  }
  return list.find(win => win.dataset.id === appState.activeId) || [...list].reverse()[0] || null;
}

function persistLayout() {
  if (appState.restoring) return;
  const layout = {
    desktop: appState.desktop,
    desktopCount: appState.desktopCount,
    windows: allWindows().map(win => ({
      app: win.dataset.app,
      desktop: Number(win.dataset.desktop),
      state: win.dataset.state,
      left: win.style.left,
      top: win.style.top,
      width: win.style.width,
      height: win.style.height,
      snap: win.dataset.snap || ""
    }))
  };
  try {
    localStorage.setItem("ivexo.layout.v2", JSON.stringify(layout));
  } catch (error) {
    showToast(`No se pudo guardar el diseño: ${error.message}`);
  }
  scheduleNativeViewSync();
}

function renderDesktopBar() {
  const bar = document.getElementById("desktopBar");
  bar.replaceChildren();
  for (let desktop = 1; desktop <= appState.desktopCount; desktop += 1) {
    const group = document.createElement("span");
    group.className = "desktop-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `desktop-tab${desktop === appState.desktop ? " selected" : ""}`;
    button.textContent = String(desktop);
    button.title = `Escritorio ${desktop}`;
    button.addEventListener("click", () => commandBus.execute("switchDesktop", { desktop }));
    group.appendChild(button);
    if (desktop > 1) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "desktop-close";
      close.textContent = "×";
      close.title = `Cerrar escritorio ${desktop}`;
      close.addEventListener("click", () => closeDesktop(desktop));
      group.appendChild(close);
    }
    bar.appendChild(group);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "desktop-add";
  add.textContent = "+";
  add.title = "Nuevo escritorio";
  add.addEventListener("click", createDesktop);
  bar.appendChild(add);
}

function applyDesktopVisibility() {
  for (const win of allWindows()) {
    win.hidden = Number(win.dataset.desktop) !== appState.desktop;
  }
  for (const note of desk.querySelectorAll(".postit")) note.hidden = Number(note.dataset.desktop || 1) !== appState.desktop;
  renderDesktopBar();
  updateDock();
  scheduleNativeViewSync();
}

function switchDesktop(value) {
  let desktop = Number(value);
  if (!Number.isInteger(desktop)) desktop = appState.desktop === appState.desktopCount ? 1 : appState.desktop + 1;
  if (desktop < 1 || desktop > appState.desktopCount) return false;
  appState.desktop = desktop;
  appState.activeId = null;
  applyDesktopVisibility();
  persistLayout();
  return true;
}

function createDesktop() {
  appState.desktopCount += 1;
  switchDesktop(appState.desktopCount);
}

function closeDesktop(desktop) {
  if (desktop <= 1 || desktop > appState.desktopCount) return;
  for (const win of allWindows()) {
    const assigned = Number(win.dataset.desktop);
    if (assigned === desktop) win.dataset.desktop = "1";
    else if (assigned > desktop) win.dataset.desktop = String(assigned - 1);
  }
  for (const note of desk.querySelectorAll(".postit")) {
    const assigned = Number(note.dataset.desktop || 1);
    if (assigned === desktop) note.dataset.desktop = "1";
    else if (assigned > desktop) note.dataset.desktop = String(assigned - 1);
  }
  appState.desktopCount -= 1;
  if (appState.desktop === desktop) appState.desktop = 1;
  else if (appState.desktop > desktop) appState.desktop -= 1;
  applyDesktopVisibility();
  persistLayout();
}

function updateDock() {
  for (const button of document.querySelectorAll(".dock [data-open]")) {
    const app = button.dataset.open;
    let indicator = button.querySelector(".dock-indicator");
    if (!indicator) {
      indicator = document.createElement("i");
      indicator.className = "dock-indicator";
      indicator.setAttribute("aria-hidden", "true");
      button.appendChild(indicator);
    }
    const instances = allWindows().filter(win => win.dataset.app === app);
    button.classList.toggle("is-open", instances.some(win => win.dataset.state !== "minimized"));
    button.classList.toggle("is-minimized", instances.length > 0 && instances.every(win => win.dataset.state === "minimized"));
    button.classList.toggle("is-closed", instances.length === 0);
    button.title = instances.length ? `${APP_LABELS[app]} · ${instances.length} instancia(s)` : APP_LABELS[app];
  }
}

function focusWindow(win, saveLayout = true) {
  if (!win) return false;
  if (win.dataset.state === "minimized") restoreWindow({ id: win.dataset.id });
  if (Number(win.dataset.desktop) !== appState.desktop) switchDesktop(Number(win.dataset.desktop));
  for (const other of allWindows()) other.classList.toggle("active", other === win);
  win.style.zIndex = String(++appState.z);
  appState.activeId = win.dataset.id;
  updateDock();
  if (saveLayout) persistLayout();
  scheduleNativeViewSync();
  return true;
}

function scheduleNativeViewSync() {
  if (!window.ivexo?.web || nativeViewSyncFrame) return;
  nativeViewSyncFrame = window.requestAnimationFrame(syncNativeViews);
}

function syncNativeViews() {
  nativeViewSyncFrame = 0;
  const activeViews = new Map();
  for (const win of allWindows()) {
    if (win.hidden || win.style.display === "none" || win.dataset.state === "minimized") continue;
    if (Number(win.dataset.desktop) !== appState.desktop) continue;

    let host = null;
    let id = "";
    if (win.dataset.app === "web") {
      const state = win._webState;
      const tab = state?.tabs.find(item => item.id === state.active);
      if (tab?.nativeViewId && tab.nativeViewReady && tab.nativeViewActive) {
        id = tab.nativeViewId;
        host = tab.nativeViewHost;
      }
    } else if (win.dataset.app === "stream" && win._nativeViewId && win._steamViewUrl) {
      id = win._nativeViewId;
      host = win.querySelector(".steam-native-host");
    }

    if (!id || !host || !host.isConnected || host.closest("[hidden]")) continue;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    activeViews.set(id, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }

  for (const id of nativeViewIds) {
    const bounds = activeViews.get(id);
    window.ivexo.web.setBounds(id, bounds || { x: 0, y: 0, width: 0, height: 0 }, Boolean(bounds))
      .catch(error => showToast(`No se pudo actualizar la vista: ${error.message}`));
  }
}

function releaseNativeView(id) {
  if (!id) return;
  nativeViewIds.delete(id);
  if (window.ivexo?.web) {
    window.ivexo.web.close(id).catch(error => showToast(`No se pudo cerrar la vista: ${error.message}`));
  }
  scheduleNativeViewSync();
}

function makeCapsule(app, title, bodyHtml, options = {}) {
  const el = document.createElement("section");
  const id = `cap-${Date.now()}-${(++appState.nextWindow).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  el.className = "cap";
  el.dataset.id = id;
  el.dataset.app = app;
  el.dataset.title = title;
  el.dataset.desktop = String(options.desktop || appState.desktop);
  el.dataset.state = "open";
  el.style.left = `${40 + (allWindows().length % 5) * 34}px`;
  el.style.top = `${28 + (allWindows().length % 4) * 26}px`;
  el.style.zIndex = String(++appState.z);
  el.innerHTML = `<div class="cap-head"><b class="cap-title"></b><div class="cap-actions"><button type="button" data-window-action="minimize" title="Minimizar">−</button><button type="button" data-window-action="maximize" title="Maximizar/restaurar">□</button><button type="button" data-window-action="close" title="Cerrar">×</button></div></div><div class="cap-body"></div>`;
  el.querySelector(".cap-title").textContent = title;
  el.querySelector(".cap-body").innerHTML = bodyHtml;
  for (const direction of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
    const handle = document.createElement("span");
    handle.className = `cap-resize-handle cap-resize-${direction}`;
    handle.dataset.resize = direction;
    handle.setAttribute("aria-hidden", "true");
    el.appendChild(handle);
  }
  desk.appendChild(el);

  el.addEventListener("pointerdown", event => {
    if (el.dataset.app === "web" && event.target.closest(".cap-head") && !event.target.closest(".cap-actions button")) return;
    focusWindow(el);
  });
  el.querySelectorAll("[data-window-action]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const action = button.dataset.windowAction;
    if (action === "close") commandBus.execute("closeWindow", { id });
    if (action === "minimize") commandBus.execute("minimizeWindow", { id });
    if (action === "maximize") toggleMaximize(el);
  }));
  bindWindowDrag(el);
  focusWindow(el);
  updateDock();
  persistLayout();
  return el;
}

function bindWindowDrag(win) {
  const head = win.querySelector(".cap-head");
  win.querySelectorAll(".cap-resize-handle").forEach(handle => {
    let resize = null;
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      if (win.dataset.app === "web") toggleWebInteractionShield(true, getComputedStyle(handle).cursor);
      if (win.dataset.snap) restoreWindowRect(win);
      focusWindow(win, win.dataset.app !== "web");
      resize = {
        pointerId: event.pointerId,
        direction: handle.dataset.resize,
        left: win.offsetLeft,
        top: win.offsetTop,
        width: win.offsetWidth,
        height: win.offsetHeight,
        startX: event.clientX,
        startY: event.clientY,
        minWidth: parseFloat(getComputedStyle(win).minWidth) || 260,
        minHeight: parseFloat(getComputedStyle(win).minHeight) || 180
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!resize || resize.pointerId !== event.pointerId) return;
      const dx = event.clientX - resize.startX;
      const dy = event.clientY - resize.startY;
      const west = resize.direction.includes("w");
      const north = resize.direction.includes("n");
      const maxWidth = west ? resize.width + resize.left : desk.clientWidth - resize.left;
      const maxHeight = north ? resize.height + resize.top : desk.clientHeight - resize.top;
      const widthDelta = west ? -dx : dx;
      const heightDelta = north ? -dy : dy;
      const width = Math.max(resize.minWidth, Math.min(maxWidth, resize.width + widthDelta));
      const height = Math.max(resize.minHeight, Math.min(maxHeight, resize.height + heightDelta));

      win.style.width = `${width}px`;
      win.style.height = `${height}px`;
      if (west) win.style.left = `${resize.left + resize.width - width}px`;
      if (north) win.style.top = `${resize.top + resize.height - height}px`;
      scheduleNativeViewSync();
    });
    const finishResize = event => {
      if (!resize || resize.pointerId !== event.pointerId) return;
      resize = null;
      persistLayout();
      if (win.dataset.app === "web") toggleWebInteractionShield(false);
    };
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
  });

  let drag = null;
  head.addEventListener("pointerdown", event => {
    if (win.dataset.app === "web" && event.target.closest(".browser-toolbar, .browser-tabs, .web-external")) {
      focusWindow(win, false);
      return;
    }
    if (event.target.closest("button")) return;
    if (win.dataset.app === "web") event.stopPropagation();
    focusWindow(win, win.dataset.app !== "web");
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: win.offsetLeft,
      top: win.offsetTop,
      moved: false
    };
    head.setPointerCapture(event.pointerId);
    if (win.dataset.app === "web") toggleWebInteractionShield(true, "grabbing");
  });
  head.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (win.dataset.snap) restoreWindowRect(win);
    win.style.left = `${drag.left + event.clientX - drag.startX}px`;
    win.style.top = `${drag.top + event.clientY - drag.startY}px`;
    scheduleNativeViewSync();
  });
  head.addEventListener("pointerup", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      if (event.clientX < 20) commandBus.execute("snapWindow", { id: win.dataset.id, side: "left" });
      else if (event.clientX > window.innerWidth - 20) commandBus.execute("snapWindow", { id: win.dataset.id, side: "right" });
      else if (event.clientY < 10) commandBus.execute("snapWindow", { id: win.dataset.id, side: "max" });
      persistLayout();
    }
    drag = null;
    if (win.dataset.app === "web") toggleWebInteractionShield(false);
  });
  head.addEventListener("pointercancel", event => {
    if (win.dataset.app !== "web" || !drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    toggleWebInteractionShield(false);
  });
  head.addEventListener("dblclick", event => {
    if (win.dataset.app === "web" && event.target.closest(".browser-toolbar, .browser-tabs, .web-external")) return;
    if (!event.target.closest("button")) toggleMaximize(win);
  });
}

function saveWindowRect(win) {
  if (!win._restoreRect && !win.dataset.snap) {
    win._restoreRect = {
      left: win.style.left,
      top: win.style.top,
      width: win.style.width,
      height: win.style.height
    };
  }
}

function restoreWindowRect(win) {
  if (win._restoreRect) {
    Object.assign(win.style, win._restoreRect);
    win._restoreRect = null;
  }
  delete win.dataset.snap;
}

function snapWindow(args = {}) {
  const win = findWindow(args);
  if (!win) return false;
  const side = args.side || "max";
  saveWindowRect(win);
  win.dataset.snap = side;
  win.style.top = "0";
  win.style.height = "100%";
  if (side === "left") {
    win.style.left = "0";
    win.style.width = "50%";
  } else if (side === "right") {
    win.style.left = "50%";
    win.style.width = "50%";
  } else {
    win.style.left = "0";
    win.style.width = "100%";
  }
  focusWindow(win);
  persistLayout();
  return true;
}

function toggleMaximize(win) {
  if (win.dataset.snap === "max") restoreWindowRect(win);
  else commandBus.execute("snapWindow", { id: win.dataset.id, side: "max" });
}

function minimizeWindow(criteria = {}) {
  const win = findWindow(criteria);
  if (!win) return false;
  win.dataset.state = "minimized";
  win.classList.add("minimizing");
  win.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    if (win.isConnected && win.dataset.state === "minimized") win.style.display = "none";
  }, 260);
  if (appState.activeId === win.dataset.id) appState.activeId = null;
  updateDock();
  persistLayout();
  scheduleNativeViewSync();
  return true;
}

function restoreWindow(criteria = {}) {
  const win = findWindow(criteria);
  if (!win) return false;
  win.style.display = "flex";
  win.hidden = false;
  win.removeAttribute("aria-hidden");
  win.dataset.state = "open";
  win.classList.remove("minimizing");
  requestAnimationFrame(() => win.classList.remove("minimizing"));
  focusWindow(win);
  scheduleNativeViewSync();
  return true;
}

function closeWindow(criteria = {}) {
  const win = findWindow(criteria);
  if (!win) return false;
  if (typeof win._cleanup === "function") win._cleanup();
  win.remove();
  if (appState.activeId === win.dataset.id) appState.activeId = null;
  updateDock();
  persistLayout();
  return true;
}

function closeAllWindows() {
  for (const win of allWindows()) {
    if (typeof win._cleanup === "function") win._cleanup();
    win.remove();
  }
  appState.activeId = null;
  updateDock();
  persistLayout();
  return true;
}

function moveWindow(args = {}) {
  const win = findWindow(args);
  const desktop = Number(args.desktop);
  if (!win || !Number.isInteger(desktop) || desktop < 1 || desktop > appState.desktopCount) return false;
  win.dataset.desktop = String(desktop);
  applyDesktopVisibility();
  persistLayout();
  return true;
}

function listWindows() {
  return allWindows().map(win => ({
    id: win.dataset.id,
    app: win.dataset.app,
    title: win.dataset.title,
    state: win.dataset.state,
    desktop: Number(win.dataset.desktop)
  }));
}

function showAppError(app, error) {
  const win = makeCapsule("error", `Error en ${APP_LABELS[app] || app}`, `<div class="app-error"><p></p><button type="button" class="retry">Reintentar</button><button type="button" class="dismiss">Cerrar</button></div>`);
  win.querySelector(".app-error p").textContent = `Error en esta cápsula: ${error.message}`;
  win.querySelector(".retry").addEventListener("click", () => {
    commandBus.execute("closeWindow", { id: win.dataset.id });
    commandBus.execute("openApp", { app, newInstance: true });
  });
  win.querySelector(".dismiss").addEventListener("click", () => commandBus.execute("closeWindow", { id: win.dataset.id }));
  return win;
}

function openApp(app, options = {}) {
  if (!APP_LABELS[app]) throw new Error(`Aplicación desconocida: ${app}`);
  if (!options.newInstance && app !== "web") {
    const existing = [...allWindows()].reverse().find(win => win.dataset.app === app);
    if (existing) {
      if (existing.dataset.state === "minimized") restoreWindow({ id: existing.dataset.id });
      else focusWindow(existing);
      return existing;
    }
  }
  try {
    const openers = {
      web: openWeb,
      doc: openDoc,
      files: openFiles,
      stream: openSteam,
      calc: openCalc,
      jenny: openJenny,
      settings: openSettings,
      notes: openNotes,
      monitor: openMonitor
    };
    const win = openers[app](options.fileName);
    if (win && options.desktop) win.dataset.desktop = String(options.desktop);
    applyDesktopVisibility();
    return win;
  } catch (error) {
    return showAppError(app, error);
  }
}

function makeMenu(items, x, y) {
  document.querySelectorAll(".context-menu").forEach(menu => menu.remove());
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 230))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - items.length * 38 - 12))}px`;
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.addEventListener("click", () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const dismiss = event => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", dismiss, true);
    }
  };
  document.addEventListener("pointerdown", dismiss, true);
  return menu;
}

function showOverview() {
  overlayRoot.replaceChildren();
  const overlay = document.createElement("section");
  overlay.className = "overview";
  const heading = document.createElement("header");
  heading.innerHTML = "<b>Vista general</b>";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Volver";
  back.addEventListener("click", () => overlayRoot.replaceChildren());
  heading.appendChild(back);
  const grid = document.createElement("div");
  grid.className = "overview-grid";
  for (let desktop = 1; desktop <= appState.desktopCount; desktop += 1) {
    const card = document.createElement("article");
    card.className = "overview-desktop";
    card.dataset.desktop = String(desktop);
    const title = document.createElement("h2");
    title.textContent = `Escritorio ${desktop}`;
    card.appendChild(title);
    const windows = listWindows().filter(win => win.desktop === desktop);
    for (const item of windows) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "overview-window";
      tile.draggable = true;
      tile.textContent = `${item.title}${item.state === "minimized" ? " · minimizada" : ""}`;
      tile.addEventListener("click", () => {
        overlayRoot.replaceChildren();
        commandBus.execute("focusWindow", { id: item.id });
      });
      tile.addEventListener("dragstart", event => event.dataTransfer.setData("text/ivexo-window", item.id));
      card.appendChild(tile);
    }
    card.addEventListener("dragover", event => event.preventDefault());
    card.addEventListener("drop", event => {
      event.preventDefault();
      commandBus.execute("moveWindow", {
        id: event.dataTransfer.getData("text/ivexo-window"),
        desktop
      });
      overlayRoot.replaceChildren();
      showOverview();
    });
    grid.appendChild(card);
  }
  overlay.append(heading, grid);
  overlayRoot.appendChild(overlay);
}

const PALETTE_COMMANDS = [
  { label: "Abrir Web", run: () => commandBus.execute("openApp", { app: "web" }) },
  { label: "Abrir Documento", run: () => commandBus.execute("openApp", { app: "doc" }) },
  { label: "Abrir Archivos", run: () => commandBus.execute("openApp", { app: "files" }) },
  { label: "Abrir Steam", run: () => commandBus.execute("openApp", { app: "stream" }) },
  { label: "Abrir Cálculo", run: () => commandBus.execute("openApp", { app: "calc" }) },
  { label: "Abrir Jenny", run: () => commandBus.execute("openApp", { app: "jenny" }) },
  { label: "Cerrar ventana activa", run: () => commandBus.execute("closeWindow") },
  { label: "Cerrar todo", run: () => commandBus.execute("closeAll") },
  { label: "Minimizar ventana activa", run: () => commandBus.execute("minimizeWindow") },
  { label: "Restaurar ventana activa", run: () => commandBus.execute("restoreWindow") },
  { label: "Listar ventanas", run: () => showToast(formatWindowList(commandBus.execute("listWindows"))) },
  { label: "Nuevo escritorio", run: createDesktop },
  { label: "Cambiar escritorio", run: () => commandBus.execute("switchDesktop") },
  { label: "Crear nota", run: () => commandBus.execute("createNote", { content: "" }) }
];

function openCommandPalette() {
  overlayRoot.replaceChildren();
  const palette = document.createElement("section");
  palette.className = "command-palette";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Buscar o ejecutar un comando…";
  input.setAttribute("aria-label", "Comandos");
  const results = document.createElement("div");
  results.className = "palette-results";
  const render = () => {
    results.replaceChildren();
    const matches = PALETTE_COMMANDS.filter(item => item.label.toLowerCase().includes(input.value.toLowerCase()));
    for (const item of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        overlayRoot.replaceChildren();
        item.run();
      });
      results.appendChild(button);
    }
    palette._matches = matches;
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") overlayRoot.replaceChildren();
    if (event.key === "Enter" && palette._matches.length) {
      overlayRoot.replaceChildren();
      palette._matches[0].run();
    }
  });
  palette.append(input, results);
  overlayRoot.appendChild(palette);
  render();
  input.focus();
}

function formatWindowList(items) {
  if (!items.length) return "No hay ventanas abiertas.";
  return `Ventanas abiertas: ${items.map(item => `${item.title} (${item.state}, escritorio ${item.desktop})`).join("; ")}.`;
}

function createPostIt(content = "", existingName = "") {
  const colors = ["yellow", "pink", "green"];
  const note = document.createElement("article");
  const noteId = existingName || `nota-postit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.md`;
  note.className = `postit ${colors[Math.floor(Math.random() * colors.length)]}`;
  note.dataset.noteId = noteId;
  note.dataset.desktop = String(appState.desktop);
  note.style.left = `${80 + Math.floor(Math.random() * 100)}px`;
  note.style.top = `${70 + Math.floor(Math.random() * 80)}px`;
  note.innerHTML = `<header><b>Nota</b><button type="button" aria-label="Enviar a papelera">×</button></header><div class="postit-content" contenteditable="true" spellcheck="true"></div>`;
  note.querySelector(".postit-content").textContent = content;
  desk.appendChild(note);
  bindPostIt(note);
  persistLayout();
  savePostIt(note);
  return note;
}

function postItValue(note) {
  return note.querySelector(".postit-content").textContent;
}

function savePostIt(note) {
  const content = `# Post-it\n${postItValue(note)}`;
  return fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: note.dataset.noteId, content })
  }).then(response => {
    if (!response.ok) throw new Error(`No se pudo guardar la nota (${response.status})`);
  }).catch(error => showToast(error.message));
}

function bindPostIt(note) {
  const content = note.querySelector(".postit-content");
  let saveTimer;
  content.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => savePostIt(note), 350);
  });
  content.addEventListener("dblclick", () => {
    content.contentEditable = "true";
    content.focus();
  });
  note.querySelector("header button").addEventListener("click", async () => {
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(note.dataset.noteId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`No se pudo enviar a papelera (${response.status})`);
      note.remove();
    } catch (error) {
      showToast(error.message);
    }
  });
  const header = note.querySelector("header");
  let drag;
  header.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;
    drag = { x: event.clientX, y: event.clientY, left: note.offsetLeft, top: note.offsetTop, id: event.pointerId };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    note.style.left = `${drag.left + event.clientX - drag.x}px`;
    note.style.top = `${drag.top + event.clientY - drag.y}px`;
  });
  header.addEventListener("pointerup", () => {
    if (drag) persistLayout();
    drag = null;
  });
}

function toEmbed(rawUrl) {
  return toDirectYoutubeUrl(rawUrl);
}

function normalizeWebExternalUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function checkWebPortSecurity(urlString) {
  try {
    const parsed = new URL(urlString);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, port: parsed.port };
    }
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    const host = parsed.hostname.toLowerCase();
    const isLocal =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.");
    const ok = isLocal
      ? IVEXO_ALLOWED_PORTS.has(port)
      : (!parsed.port || IVEXO_ALLOWED_PORTS.has(port));
    if (ok) console.log(`[IVEXO] Hey, este puerto es seguro (${port})`);
    return { ok, port };
  } catch {
    return { ok: false, port: "" };
  }
}

function toDirectYoutubeUrl(raw) {
  try {
    const url = new URL(normalizeWebExternalUrl(raw));
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const youtubeHosts = new Set(["youtu.be", "youtube.com", "m.youtube.com", "music.youtube.com"]);
    if (!youtubeHosts.has(host)) return null;

    let videoId = null;
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || null;
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (/^\/(?:shorts|embed|live|v)\//.test(url.pathname)) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || null;
    }

    const validVideoId = videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
    if (!validVideoId) return url.href;
    const watchUrl = new URL("https://www.youtube.com/watch");
    watchUrl.searchParams.set("v", validVideoId);
    const list = url.searchParams.get("list");
    if (list && /^[a-zA-Z0-9_-]{4,128}$/.test(list)) watchUrl.searchParams.set("list", list);
    return watchUrl.href;
  } catch {
    return null;
  }
}

function makeGoogleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function makeWebTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return makeGoogleSearchUrl(raw);

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return makeGoogleSearchUrl(raw);
    return toDirectYoutubeUrl(url.href) || url.href;
  } catch (_) {
    return makeGoogleSearchUrl(raw);
  }
}

function openWeb() {
  if (allWindows().filter(win => win.dataset.app === "web").length >= MAX_WEB_WINDOWS) {
    showToast(`Límite alcanzado: máximo ${MAX_WEB_WINDOWS} ventanas Web.`);
    return null;
  }
  const win = makeCapsule("web", "Explorador Web", `<div class="browser-toolbar"><button type="button" data-nav="back" aria-label="Atrás">←</button><button type="button" data-nav="forward" aria-label="Adelante">→</button><button type="button" data-nav="home" aria-label="Inicio">Inicio</button><button type="button" data-nav="reload" aria-label="Recargar">↻</button><input class="web-url" placeholder="Buscar en Google o pegar una URL…" aria-label="Buscar en Google o URL"><button type="button" class="web-go">Ir</button></div><div class="browser-tabs" role="tablist"><button type="button" class="new-web-tab" aria-label="Nueva pestaña">+</button></div><div class="browser-panels"></div>`);
  const body = win.querySelector(".cap-body");
  body.classList.add("web-window-body");
  const head = win.querySelector(".cap-head");
  const capActions = head.querySelector(".cap-actions");
  const tabBar = body.querySelector(".browser-tabs");
  const panels = body.querySelector(".browser-panels");
  const urlInput = body.querySelector(".web-url");
  const toolbar = body.querySelector(".browser-toolbar");
  const goButton = body.querySelector(".web-go");
  const homeEntry = "ivexo:home";
  const searchEntryPrefix = "ivexo:video-search:";
  const wikiSearchEntryPrefix = "ivexo:wikipedia-search:";
  head.insertBefore(toolbar, capActions);
  head.insertBefore(tabBar, capActions);
  const newTabButton = tabBar.querySelector(".new-web-tab");
  const webState = { tabs: [], active: null };
  win._webState = webState;

  function getNativeTab(id) {
    return webState.tabs.find(tab => tab.nativeViewId === id) || null;
  }

  const unsubscribeNativeEvents = [
    window.ivexo.web.onNavigated(state => {
      const tab = getNativeTab(state.id);
      if (!tab) return;
      tab.nativeCurrentUrl = state.url;
      tab.nativeCanGoBack = state.canGoBack;
      tab.nativeCanGoForward = state.canGoForward;
      if (webState.active === tab.id && tab.nativeViewActive) {
        urlInput.value = state.url;
        toolbar.querySelector('[data-nav="back"]').disabled = !state.canGoBack && tab.index <= 0;
        toolbar.querySelector('[data-nav="forward"]').disabled = !state.canGoForward && tab.index >= tab.history.length - 1;
      }
      scheduleNativeViewSync();
    }),
    window.ivexo.web.onTitle(({ id, title }) => {
      const tab = getNativeTab(id);
      if (tab && title) {
        tab.label = title;
        tab.button.textContent = title.slice(0, 28);
      }
    }),
    window.ivexo.web.onError(({ id, message }) => {
      const tab = getNativeTab(id);
      if (tab) showNativeFailure(tab, message);
    })
  ];

  function showNativeFailure(tab, message = "") {
    tab.nativeViewActive = false;
    tab.fallbackMessage.textContent = isYoutubeUrl(tab.nativeCurrentUrl || tab.history[tab.index])
      ? "Este video no se puede ver adentro"
      : "No se pudo cargar el sitio";
    tab.fallbackDescription.textContent = message;
    tab.fallbackDescription.hidden = !message;
    tab.homeView.hidden = true;
    tab.searchView.hidden = true;
    tab.fallback.hidden = false;
    scheduleNativeViewSync();
  }

  function setNativeView(tab, url) {
    tab.requestedUrl = url;
    const portCheck = checkWebPortSecurity(url);
    if (!portCheck.ok) {
      showBlockedFallback(tab, `Puerto ${portCheck.port || "no permitido"} no habilitado.`);
      return;
    }
    if (!tab.nativeViewId) tab.nativeViewId = `web-${win.dataset.id}-${tab.id}`;
    tab.nativeViewActive = true;
    tab.fallback.hidden = true;
    tab.homeView.hidden = true;
    tab.searchView.hidden = true;
    if (tab.nativeViewReady && tab.nativeCurrentUrl === url) {
      scheduleNativeViewSync();
      return;
    }

    const request = tab.nativeViewReady
      ? window.ivexo.web.navigate(tab.nativeViewId, url)
      : window.ivexo.web.open(tab.nativeViewId, url);
    request.then(() => {
      if (!tab.panel.isConnected) {
        releaseNativeView(tab.nativeViewId);
        return;
      }
      tab.nativeViewReady = true;
      nativeViewIds.add(tab.nativeViewId);
      scheduleNativeViewSync();
    }).catch(error => showNativeFailure(tab, error.message));
  }

  function showBlockedFallback(tab, reasonText = "") {
    tab.nativeViewActive = false;
    tab.fallbackMessage.textContent = "Este sitio no se puede abrir";
    tab.fallbackDescription.textContent = reasonText;
    tab.fallbackDescription.hidden = !reasonText;
    tab.homeView.hidden = true;
    tab.searchView.hidden = true;
    tab.fallback.hidden = false;
    scheduleNativeViewSync();
  }

  function hideBlockedFallback(tab) {
    tab.fallback.hidden = true;
    tab.homeView.hidden = true;
    tab.searchView.hidden = true;
    tab.nativeViewActive = true;
    scheduleNativeViewSync();
  }

  function isYoutubeUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
      return ["youtu.be", "youtube.com", "m.youtube.com", "music.youtube.com"].includes(host);
    } catch {
      return false;
    }
  }

  function openYoutubeSafe(tab, url) {
    const externalUrl = normalizeWebExternalUrl(url);
    if (!tab || !externalUrl || !isYoutubeUrl(externalUrl)) return false;
    const directUrl = toDirectYoutubeUrl(externalUrl);
    if (directUrl) {
      navigateTab(tab, directUrl, false, directUrl);
      return true;
    }
    showBlockedFallback(tab, "No se pudo interpretar el enlace de YouTube.");
    return true;
  }

  function activateTab(tab) {
    webState.active = tab.id;
    for (const item of webState.tabs) {
      item.button.setAttribute("aria-selected", String(item === tab));
      item.item.classList.toggle("is-active", item === tab);
      item.panel.hidden = item !== tab;
    }
    const entry = tab.history[tab.index];
    if (entry === homeEntry) {
      tab.searchController?.abort();
      tab.nativeViewActive = false;
      tab.searchView.hidden = true;
      tab.fallback.hidden = true;
      tab.homeView.hidden = false;
      urlInput.value = "";
    } else if (entry && entry.startsWith(searchEntryPrefix)) {
      tab.nativeViewActive = false;
      tab.homeView.hidden = true;
      tab.fallback.hidden = true;
      tab.searchView.hidden = false;
      const query = entry.slice(searchEntryPrefix.length);
      urlInput.value = query;
      loadVideoSearch(tab, query);
    } else if (entry && entry.startsWith(wikiSearchEntryPrefix)) {
      tab.nativeViewActive = false;
      tab.homeView.hidden = true;
      tab.fallback.hidden = true;
      tab.searchView.hidden = false;
      const query = entry.slice(wikiSearchEntryPrefix.length);
      urlInput.value = query;
      loadWikipediaSearch(tab, query);
    } else if (entry) {
      tab.searchController?.abort();
      urlInput.value = tab.nativeCurrentUrl || entry;
      setNativeView(tab, entry);
    } else {
      tab.nativeViewActive = false;
      tab.homeView.hidden = true;
      tab.searchView.hidden = true;
      tab.fallback.hidden = true;
      urlInput.value = "";
    }
    const backButton = toolbar.querySelector('[data-nav="back"]');
    const forwardButton = toolbar.querySelector('[data-nav="forward"]');
    backButton.disabled = tab.index <= 0 && !tab.nativeCanGoBack;
    forwardButton.disabled = tab.index >= tab.history.length - 1 && !tab.nativeCanGoForward;
    scheduleNativeViewSync();
  }

  function pushInternalEntry(tab, entry) {
    tab.searchController?.abort();
    tab.history = tab.history.slice(0, tab.index + 1);
    tab.externalHistory = tab.externalHistory.slice(0, tab.index + 1);
    tab.history.push(entry);
    tab.externalHistory.push({ url: "", timestamp: Date.now() });
    tab.index = tab.history.length - 1;
    activateTab(tab);
  }

  function navigateHome(tab) {
    if (!tab) return;
    if (tab.history[tab.index] === homeEntry) {
      activateTab(tab);
      return;
    }
    pushInternalEntry(tab, homeEntry);
  }

  function searchVideos(tab, query) {
    const cleanQuery = String(query || "").trim();
    if (!tab || !cleanQuery) return;
    pushInternalEntry(tab, `${searchEntryPrefix}${cleanQuery}`);
  }

  function searchWikipedia(tab, query) {
    const cleanQuery = String(query || "").trim();
    if (!tab || !cleanQuery) return;
    pushInternalEntry(tab, `${wikiSearchEntryPrefix}${cleanQuery}`);
  }

  async function loadWikipediaSearch(tab, query) {
    tab.searchController?.abort();
    const controller = new AbortController();
    tab.searchController = controller;
    tab.searchStatus.textContent = "Buscando en Wikipedia…";
    tab.searchResults.replaceChildren();

    const apiUrl = new URL("https://es.wikipedia.org/w/api.php");
    apiUrl.searchParams.set("action", "query");
    apiUrl.searchParams.set("list", "search");
    apiUrl.searchParams.set("srsearch", query);
    apiUrl.searchParams.set("srlimit", "10");
    apiUrl.searchParams.set("format", "json");
    apiUrl.searchParams.set("formatversion", "2");
    apiUrl.searchParams.set("utf8", "1");
    apiUrl.searchParams.set("origin", "*");

    try {
      const response = await fetch(apiUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Wikipedia API respondió ${response.status}`);
      const data = await response.json();
      if (controller.signal.aborted || tab.history[tab.index] !== `${wikiSearchEntryPrefix}${query}`) return;
      if (data.error) throw new Error(data.error.info || "Wikipedia API devolvió un error.");

      const results = data.query?.search || [];
      if (!results.length) {
        tab.searchStatus.textContent = "No se encontraron resultados.";
        return;
      }

      tab.searchStatus.textContent = `Resultados de Wikipedia para “${query}”:`;
      for (const result of results) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "web-search-result web-search-result--article";
        const details = document.createElement("span");
        details.className = "web-search-result-details";
        const title = document.createElement("strong");
        title.textContent = result.title;
        const snippet = document.createElement("span");
        snippet.textContent = String(result.snippet || "").replace(/<[^>]*>/g, "");
        details.append(title, snippet);
        button.append(details);
        button.addEventListener("click", () => {
          const articlePath = encodeURIComponent(result.title.replace(/ /g, "_"));
          navigateTab(tab, `https://es.wikipedia.org/wiki/${articlePath}`);
        });
        tab.searchResults.appendChild(button);
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("No se pudo buscar en la API de Wikipedia:", error);
      tab.searchStatus.textContent = "No se pudo buscar en Wikipedia. Revisá la conexión e intentá de nuevo.";
    }
  }

  async function loadVideoSearch(tab, query) {
    tab.searchController?.abort();
    const controller = new AbortController();
    tab.searchController = controller;
    tab.searchStatus.textContent = "Buscando videos…";
    tab.searchResults.replaceChildren();

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `La búsqueda respondió ${response.status}.`);
      if (controller.signal.aborted || tab.history[tab.index] !== `${searchEntryPrefix}${query}`) return;

      const results = Array.isArray(data.items) ? data.items : [];
      if (!results.length) {
        tab.searchStatus.textContent = "No se encontraron videos.";
        return;
      }

      tab.searchStatus.textContent = `Videos para “${query}”:`;
      for (const video of results) {
        if (!/^[a-zA-Z0-9_-]{11}$/.test(String(video.id || ""))) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "web-search-result";
        const thumbnail = document.createElement("img");
        thumbnail.className = "web-search-thumbnail";
        thumbnail.alt = "";
        thumbnail.loading = "lazy";
        thumbnail.referrerPolicy = "no-referrer";
        try {
          const imageUrl = new URL(video.thumbnailUrl);
          if (imageUrl.protocol === "https:" &&
            (imageUrl.hostname === "i.ytimg.com" || imageUrl.hostname.endsWith(".ytimg.com"))) {
            thumbnail.src = imageUrl.href;
          } else {
            thumbnail.hidden = true;
          }
        } catch {
          thumbnail.hidden = true;
        }
        const details = document.createElement("span");
        details.className = "web-search-result-details";
        const title = document.createElement("strong");
        title.textContent = video.title || "Video de YouTube";
        const description = document.createElement("span");
        description.textContent = [video.channelTitle, video.description].filter(Boolean).join(" · ");
        details.append(title, description);
        button.append(thumbnail, details);
        button.addEventListener("click", () => {
          navigateTab(tab, `https://www.youtube.com/watch?v=${video.id}`);
        });
        tab.searchResults.appendChild(button);
      }
      if (!tab.searchResults.childElementCount) tab.searchStatus.textContent = "No se encontraron videos válidos.";
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("No se pudieron buscar videos:", error);
      tab.searchStatus.textContent = error.message || "No se pudieron buscar videos.";
    }
  }

  function addTab(label, initialUrl = "", externalUrl = initialUrl) {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = document.createElement("span");
    item.className = "web-tab-item";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className = "web-tab-select";
    button.textContent = label;
    button.addEventListener("click", () => activateTab(tab));
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "web-tab-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", `Cerrar pestaña ${label}`);
    closeButton.addEventListener("click", event => {
      event.stopPropagation();
      closeTab(tab);
    });
    item.append(button, closeButton);
    const panel = document.createElement("div");
    panel.className = "browser-panel";
    panel.hidden = true;
    const homeView = document.createElement("div");
    homeView.className = "web-home-view";
    homeView.hidden = true;
    const homeHeading = document.createElement("h2");
    homeHeading.textContent = "Inicio";
    const homeDescription = document.createElement("p");
    homeDescription.textContent = "Escribí para buscar en Google o pegá una URL para abrirla.";
    const shortcuts = document.createElement("div");
    shortcuts.className = "web-home-shortcuts";
    homeView.append(homeHeading, homeDescription, shortcuts);
    const searchView = document.createElement("div");
    searchView.className = "web-search-results";
    searchView.hidden = true;
    const searchStatus = document.createElement("p");
    searchStatus.className = "web-search-status";
    const searchResults = document.createElement("div");
    searchResults.className = "web-search-result-list";
    searchView.append(searchStatus, searchResults);
    const nativeViewHost = document.createElement("div");
    nativeViewHost.className = "web-native-host";
    nativeViewHost.setAttribute("aria-hidden", "true");
    const fallback = document.createElement("div");
    fallback.className = "web-blocked-fallback";
    fallback.hidden = true;
    const fallbackMessage = document.createElement("p");
    fallbackMessage.textContent = "Este sitio no permite verse adentro";
    const fallbackDescription = document.createElement("span");
    fallbackDescription.className = "web-blocked-desc";
    fallbackDescription.hidden = true;
    const homeButton = document.createElement("button");
    homeButton.className = "web-blocked-home";
    homeButton.type = "button";
    homeButton.textContent = "Volver a Inicio";
    fallback.append(fallbackMessage, fallbackDescription, homeButton);
    panel.append(homeView, searchView, nativeViewHost, fallback);
    const tab = {
      id, label, item, button, panel, nativeViewHost, homeView, searchView, searchStatus, searchResults,
      fallback, fallbackMessage, fallbackDescription, searchController: null,
      nativeViewId: "", nativeViewReady: false, nativeViewActive: false, nativeCurrentUrl: "",
      nativeCanGoBack: false, nativeCanGoForward: false,
      history: [], externalHistory: [], index: -1,
    };
    const homeShortcuts = [
      { label: "Wikipedia", url: "https://es.wikipedia.org/" },
      { label: "YouTube", url: "https://www.youtube.com/" },
      { label: "OpenStreetMap", url: "https://www.openstreetmap.org/export/embed.html?bbox=-58.54%2C-34.72%2C-58.34%2C-34.52&layer=mapnik" }
    ];
    for (const shortcut of homeShortcuts) {
      const shortcutButton = document.createElement("button");
      shortcutButton.type = "button";
      shortcutButton.className = "web-home-shortcut";
      shortcutButton.textContent = shortcut.label;
      shortcutButton.addEventListener("click", () => navigateTab(tab, shortcut.url));
      shortcuts.appendChild(shortcutButton);
    }
    homeButton.addEventListener("click", () => navigateHome(tab));
    webState.tabs.push(tab);
    tabBar.insertBefore(item, newTabButton);
    panels.appendChild(panel);
    if (initialUrl) navigateTab(tab, initialUrl, false, externalUrl || initialUrl);
    else navigateHome(tab);
    return tab;
  }

  function navigateTab(tab, url, replace = false, externalUrl = url) {
    const clean = normalizeWebExternalUrl(url);
    if (!clean) return false;
    const safeExternalUrl = normalizeWebExternalUrl(externalUrl) || clean;
    if (replace && tab.index >= 0) {
      tab.history[tab.index] = clean;
      tab.externalHistory[tab.index] = { url: safeExternalUrl, timestamp: Date.now() };
    } else {
      tab.history = tab.history.slice(0, tab.index + 1);
      tab.externalHistory = tab.externalHistory.slice(0, tab.index + 1);
      tab.history.push(clean);
      tab.externalHistory.push({ url: safeExternalUrl, timestamp: Date.now() });
      tab.index = tab.history.length - 1;
    }
    activateTab(tab);
    return true;
  }

  function closeTab(tab) {
    const index = webState.tabs.indexOf(tab);
    if (index === -1) return;
    const wasActive = webState.active === tab.id;
    tab.searchController?.abort();
    releaseNativeView(tab.nativeViewId);
    tab.item.remove();
    tab.panel.remove();
    webState.tabs.splice(index, 1);
    if (!webState.tabs.length) {
      activateTab(addTab("Nueva"));
    } else if (wasActive) {
      activateTab(webState.tabs[Math.max(0, index - 1)]);
    }
    persistLayout();
  }

  function goBack() {
    const tab = webState.tabs.find(item => item.id === webState.active);
    if (!tab) return;
    if (tab.nativeViewActive && tab.nativeCanGoBack) {
      window.ivexo.web.nav(tab.nativeViewId, "back").catch(error => showToast(error.message));
      return;
    }
    if (tab.index <= 0) return;
    tab.index -= 1;
    activateTab(tab);
  }

  function goForward() {
    const tab = webState.tabs.find(item => item.id === webState.active);
    if (!tab) return;
    if (tab.nativeViewActive && tab.nativeCanGoForward) {
      window.ivexo.web.nav(tab.nativeViewId, "forward").catch(error => showToast(error.message));
      return;
    }
    if (tab.index >= tab.history.length - 1) return;
    tab.index += 1;
    activateTab(tab);
  }

  function goHome() {
    const tab = webState.tabs.find(item => item.id === webState.active);
    if (tab) navigateHome(tab);
  }

  function reloadTab() {
    const tab = webState.tabs.find(item => item.id === webState.active);
    if (!tab || tab.index < 0) return;
    const entry = tab.history[tab.index];
    if (entry === homeEntry) {
      activateTab(tab);
      return;
    }
    if (entry.startsWith(searchEntryPrefix)) {
      loadVideoSearch(tab, entry.slice(searchEntryPrefix.length));
      return;
    }
    if (entry.startsWith(wikiSearchEntryPrefix)) {
      loadWikipediaSearch(tab, entry.slice(wikiSearchEntryPrefix.length));
      return;
    }
    window.ivexo.web.nav(tab.nativeViewId, "reload")
      .catch(error => showNativeFailure(tab, error.message));
  }

  win._addWebTab = addTab;
  win._navigateWeb = (url, label, externalUrl = url) => {
    const raw = normalizeWebExternalUrl(url);
    const directExternalUrl = toDirectYoutubeUrl(externalUrl) || normalizeWebExternalUrl(externalUrl);
    const target = toDirectYoutubeUrl(raw) || makeWebTarget(raw) || raw;
    if (!target || !directExternalUrl) {
      openYoutubeSafe(webState.tabs.find(item => item.id === webState.active), externalUrl);
      return null;
    }
    return addTab(label || "Nueva", target, directExternalUrl);
  };
  win._openYoutubeSafe = url => openYoutubeSafe(
    webState.tabs.find(item => item.id === webState.active),
    url
  );
  win._searchVideos = query => {
    const tab = webState.tabs.find(item => item.id === webState.active);
    searchVideos(tab, query);
    return tab || null;
  };
  win._searchWikipedia = query => {
    const tab = webState.tabs.find(item => item.id === webState.active);
    searchWikipedia(tab, query);
    return tab || null;
  };
  win._cleanup = () => {
    for (const tab of webState.tabs) {
      tab.searchController?.abort();
      releaseNativeView(tab.nativeViewId);
    }
    for (const unsubscribe of unsubscribeNativeEvents) unsubscribe();
  };

  addTab("Inicio");
  newTabButton.addEventListener("click", () => addTab("Nueva"));
  function navigateFromInput() {
    const rawInput = urlInput.value.trim();
    const activeTab = webState.tabs.find(tab => tab.id === webState.active);
    if (!activeTab || !rawInput) return;

    const target = makeWebTarget(rawInput);
    if (target) navigateTab(activeTab, target, false, target);
  }
  urlInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    navigateFromInput();
  });
  goButton.addEventListener("click", navigateFromInput);
  toolbar.querySelector('[data-nav="back"]').addEventListener("click", goBack);
  toolbar.querySelector('[data-nav="forward"]').addEventListener("click", goForward);
  toolbar.querySelector('[data-nav="home"]').addEventListener("click", goHome);
  toolbar.querySelector('[data-nav="reload"]').addEventListener("click", reloadTab);
  return win;
}

function getWebWindow() {
  const existing = [...allWindows()].reverse().find(win => win.dataset.app === "web");
  if (existing) {
    focusWindow(existing);
    return existing;
  }
  return openWeb();
}

function searchWeb(query) {
  const win = getWebWindow();
  return win._searchWikipedia(String(query || "").trim());
}

function openYoutube(args = {}) {
  const win = getWebWindow();
  const query = String(args.query || "").trim();
  const rawUrl = args.url || "";
  let url = toDirectYoutubeUrl(rawUrl);
  if (!url && rawUrl) {
    if (win._openYoutubeSafe(rawUrl)) return win;
    throw new Error("El enlace no es un video válido de YouTube.");
  }
  if (!url && query) {
    url = /lofi|lo-fi/i.test(query)
      ? "https://www.youtube.com/watch?v=jfKfPfyJRdk"
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }
  if (!url) url = "https://www.youtube.com/";
  return win._navigateWeb(url, "YouTube", url);
}

function openWebTab(args = {}) {
  if (args.tab === "youtube" || args.app === "youtube") return openYoutube(args);
  const win = getWebWindow();
  if (args.url) {
    const target = makeWebTarget(args.url);
    if (!target) return win._searchWikipedia(args.url);
    const externalUrl = toDirectYoutubeUrl(args.url) || target;
    return win._navigateWeb(target, args.label || "Nueva", externalUrl);
  }
  return win._addWebTab(args.label || "Nueva");
}

function openDoc(existingName = "") {
  const win = makeCapsule("doc", "Documento", `<div class="doc-toolbar"><select class="doc-files" aria-label="Archivo existente"><option value="">Elegí un archivo existente…</option></select><button type="button" class="doc-open">Abrir</button><button type="button" class="doc-save">Guardar</button><button type="button" class="doc-save-as">Guardar como</button></div><textarea class="doc-content" placeholder="Escribí acá…"></textarea><p class="doc-status" role="status"></p>`);
  const select = win.querySelector(".doc-files");
  const textarea = win.querySelector(".doc-content");
  const status = win.querySelector(".doc-status");
  let currentName = existingName;

  async function loadList() {
    try {
      const response = await fetch("/api/files");
      if (!response.ok) throw new Error(`No se pudieron leer los archivos (${response.status})`);
      const files = await response.json();
      select.replaceChildren(new Option("Elegí un archivo existente…", ""));
      for (const file of files) {
        const option = new Option(file.name, file.name);
        select.appendChild(option);
      }
      if (currentName) select.value = currentName;
      if (currentName) {
        const file = files.find(item => item.name === currentName);
        if (file) textarea.value = file.content;
      }
      status.textContent = `${files.length} archivo(s) disponible(s).`;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  win.querySelector(".doc-open").addEventListener("click", async () => {
    const name = select.value;
    if (!name) return showToast("Elegí un archivo.");
    try {
      const response = await fetch("/api/files");
      if (!response.ok) throw new Error(`No se pudo abrir (${response.status})`);
      const file = (await response.json()).find(item => item.name === name);
      if (!file) throw new Error("El archivo ya no existe.");
      currentName = name;
      textarea.value = file.content;
      status.textContent = `Abierto: ${name}`;
    } catch (error) {
      status.textContent = error.message;
    }
  });

  async function save(asNew) {
    let name = currentName;
    if (asNew || !name) name = `nota-${Date.now()}.md`;
    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: textarea.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `No se pudo guardar (${response.status})`);
      currentName = name;
      await loadList();
      status.textContent = `Guardado: ${name}`;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  win.querySelector(".doc-save").addEventListener("click", () => save(false));
  win.querySelector(".doc-save-as").addEventListener("click", () => save(true));
  loadList();
  return win;
}

function openFiles() {
  const win = makeCapsule("files", "Archivos", `<div class="file-actions"><input type="file" class="file-upload" multiple aria-label="Subir archivos"><button type="button" class="files-refresh">Recargar</button><button type="button" class="trash-open">Ver papelera</button><button type="button" class="trash-empty">Vaciar papelera</button><button type="button" class="trash-restore-all">Restaurar todo</button></div><p class="file-status" role="status"></p><div class="file-list"></div>`);
  const list = win.querySelector(".file-list");
  const status = win.querySelector(".file-status");

  async function loadFiles() {
    list.replaceChildren();
    try {
      const response = await fetch("/api/files");
      if (!response.ok) throw new Error(`Error al leer archivos (${response.status})`);
      const files = await response.json();
      status.textContent = `${files.length} archivo(s)`;
      for (const file of files) {
        const row = document.createElement("article");
        row.className = "file-row";
        const info = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = file.name;
        const meta = document.createElement("small");
        meta.textContent = `${formatBytes(file.size)} · ${new Date(file.updatedAt).toLocaleString()}`;
        info.append(title, meta);
        const actions = document.createElement("div");
        actions.className = "row-actions";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Abrir";
        open.addEventListener("click", () => commandBus.execute("openApp", { app: "doc", newInstance: true, fileName: file.name }));
        const trash = document.createElement("button");
        trash.type = "button";
        trash.textContent = "Papelera";
        trash.addEventListener("click", async () => {
          try {
            const result = await fetch(`/api/files/${encodeURIComponent(file.name)}`, { method: "DELETE" });
            if (!result.ok) throw new Error(`No se pudo mover (${result.status})`);
            await loadFiles();
          } catch (error) { status.textContent = error.message; }
        });
        actions.append(open, trash);
        row.append(info, actions);
        list.appendChild(row);
      }
      if (!files.length) list.textContent = "No hay archivos.";
    } catch (error) { status.textContent = error.message; }
  }

  async function loadTrash() {
    list.replaceChildren();
    try {
      const response = await fetch("/api/trash");
      if (!response.ok) throw new Error(`Error al leer papelera (${response.status})`);
      const files = await response.json();
      status.textContent = `Papelera: ${files.length} archivo(s)`;
      for (const file of files) {
        const row = document.createElement("article");
        row.className = "file-row";
        const info = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = file.name;
        const meta = document.createElement("small");
        meta.textContent = `${formatBytes(file.size)} · ${new Date(file.updatedAt).toLocaleString()}`;
        info.append(title, meta);
        const actions = document.createElement("div");
        actions.className = "row-actions";
        const restore = document.createElement("button");
        restore.type = "button";
        restore.textContent = "Restaurar";
        restore.addEventListener("click", async () => {
          const result = await fetch(`/api/files/${encodeURIComponent(file.name)}/restore`, { method: "POST" });
          if (!result.ok) return status.textContent = `No se pudo restaurar (${result.status})`;
          await loadTrash();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Eliminar para siempre";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`¿Eliminar permanentemente ${file.name}?`)) return;
          const result = await fetch(`/api/trash/${encodeURIComponent(file.name)}`, { method: "DELETE" });
          if (!result.ok) return status.textContent = `No se pudo eliminar (${result.status})`;
          await loadTrash();
        });
        actions.append(restore, remove);
        row.append(info, actions);
        list.appendChild(row);
      }
      if (!files.length) list.textContent = "La papelera está vacía.";
    } catch (error) { status.textContent = error.message; }
  }

  win.querySelector(".files-refresh").addEventListener("click", loadFiles);
  win.querySelector(".file-upload").addEventListener("change", async event => {
    const files = [...event.target.files];
    for (const file of files) {
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      try {
        const content = await file.text();
        const response = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, content })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `No se pudo subir ${name} (${response.status})`);
      } catch (error) {
        status.textContent = error.message;
        return;
      }
    }
    status.textContent = `${files.length} archivo(s) subido(s).`;
    event.target.value = "";
    await loadFiles();
  });
  win.querySelector(".trash-open").addEventListener("click", loadTrash);
  win.querySelector(".trash-empty").addEventListener("click", async () => {
    if (!window.confirm("¿Vaciar la papelera permanentemente?")) return;
    const response = await fetch("/api/trash/empty", { method: "DELETE" });
    if (!response.ok) return status.textContent = `No se pudo vaciar (${response.status})`;
    await loadTrash();
  });
  win.querySelector(".trash-restore-all").addEventListener("click", async () => {
    const response = await fetch("/api/trash/restore-all", { method: "POST" });
    if (!response.ok) return status.textContent = `No se pudo restaurar (${response.status})`;
    const result = await response.json();
    status.textContent = `Restaurados: ${result.restored.length}; conflictos: ${result.conflicts.length}`;
    await loadTrash();
  });
  loadFiles();
  return win;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function openSteam() {
  const homeUrl = "https://store.steampowered.com/";
  const win = makeCapsule("stream", "Steam", `<div class="steam-toolbar"><button type="button" class="steam-home">Inicio</button><input class="steam-query" type="search" placeholder="Buscar juegos en Steam…" aria-label="Buscar en Steam"><button type="button" class="steam-submit">Buscar</button><button type="button" class="steam-reload" aria-label="Recargar">↻</button></div><div class="steam-native-host" aria-label="Tienda Steam"></div><p class="steam-status" role="status">Conectando con Steam…</p>`);
  const queryInput = win.querySelector(".steam-query");
  const status = win.querySelector(".steam-status");
  const viewId = `steam-${win.dataset.id}`;
  let currentUrl = homeUrl;
  win._nativeViewId = viewId;
  win._steamViewUrl = currentUrl;

  const unsubscribeNativeError = window.ivexo.web.onError(({ id, message }) => {
    if (id === viewId) status.textContent = `No se pudo cargar Steam: ${message}`;
  });
  let viewReady = window.ivexo.web.open(viewId, homeUrl).then(() => {
    nativeViewIds.add(viewId);
    status.textContent = "Tienda Steam";
    scheduleNativeViewSync();
    return true;
  }).catch(error => {
    status.textContent = `No se pudo abrir Steam: ${error.message}`;
    return false;
  });
  win._cleanup = () => {
    unsubscribeNativeError();
    releaseNativeView(viewId);
  };

  function navigateSteam(url) {
    currentUrl = url;
    win._steamViewUrl = url;
    scheduleNativeViewSync();
    viewReady.then(ready => {
      if (!ready) return;
      return window.ivexo.web.navigate(viewId, url).then(() => { status.textContent = "Tienda Steam"; });
    }).catch(error => { status.textContent = `No se pudo navegar en Steam: ${error.message}`; });
  }

  function searchSteam() {
    const term = queryInput.value.trim();
    if (!term) return navigateSteam(homeUrl);
    const url = new URL("https://store.steampowered.com/search/");
    url.searchParams.set("term", term);
    navigateSteam(url.href);
  }

  win.querySelector(".steam-home").addEventListener("click", () => {
    queryInput.value = "";
    navigateSteam(homeUrl);
  });
  win.querySelector(".steam-submit").addEventListener("click", searchSteam);
  queryInput.addEventListener("keydown", event => {
    if (event.key === "Enter") searchSteam();
  });
  win.querySelector(".steam-reload").addEventListener("click", () => {
    window.ivexo.web.nav(viewId, "reload")
      .catch(error => { status.textContent = `No se pudo recargar Steam: ${error.message}`; });
  });
  return win;
}

function calculate(expression) {
  const source = expression.replace(/\s+/g, "");
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== source) throw new Error("Expresión inválida");
  let index = 0;
  function factor() {
    const token = tokens[index++];
    if (token === "+") return factor();
    if (token === "-") return -factor();
    if (token === "(") {
      const value = sum();
      if (tokens[index++] !== ")") throw new Error("Falta cerrar paréntesis");
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Número inválido");
    return value;
  }
  function product() {
    let value = factor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = factor();
      if (operator === "/" && right === 0) throw new Error("No se puede dividir por cero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error("Expresión inválida");
  return result;
}

function openCalc() {
  const win = makeCapsule("calc", "Cálculo", `<input class="calc-input" placeholder="Ej: (120 * 3) / 2" aria-label="Expresión"><div class="calc-output" aria-live="polite"></div>`);
  const input = win.querySelector(".calc-input");
  const output = win.querySelector(".calc-output");
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    try { output.textContent = `= ${calculate(input.value)}`; }
    catch (error) { output.textContent = error.message; }
  });
  return win;
}

function parseJennyCommand(message) {
  const text = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/cerra todo|cerrar todo/.test(text)) return { command: "closeAll", response: "Cerré todas las ventanas." };
  if (/cerra la web|cerrar la web/.test(text)) return { command: "closeWindow", args: { app: "web" }, response: "Cerré la ventana Web." };
  if (/(minimiza|minimizar).*(steam|stream)/.test(text)) return { command: "minimizeWindow", args: { app: "stream" }, response: "Minimicé Steam." };
  if (/pone la web a la izquierda|pon la web a la izquierda/.test(text)) return { command: "snapWindow", args: { app: "web", side: "left" }, response: "Ajusté Web a la izquierda." };
  const desktopMatch = text.match(/(?:escritorio|desktop)\s*(\d+)/);
  if (/llevame a musica|anda a musica/.test(text)) return { command: "switchDesktop", args: { desktop: 2 }, response: "Te llevé al escritorio 2." };
  if (desktopMatch && /(anda|llevame|cambia|cambiar|escritorio)/.test(text)) {
    return { command: "switchDesktop", args: { desktop: Number(desktopMatch[1]) }, response: `Cambié al escritorio ${desktopMatch[1]}.` };
  }
  if (/(abre|abri).*(youtube).*(lofi|lo-fi)/.test(text)) return { command: "openYoutube", args: { query: "lofi" }, response: "Abrí YouTube con lofi." };
  if (/(abre|abri).*(documento)/.test(text)) return { command: "openApp", args: { app: "doc" }, response: "Abrí Documento." };
  if (/(que tengo abierto|que esta abierto)/.test(text)) {
    return { command: "listWindows", response: () => formatWindowList(commandBus.execute("listWindows")) };
  }
  const noteMatch = text.match(/(?:crea|creame|crear)\s+(?:una\s+)?nota(?:\s+que\s+diga)?\s*(.*)/);
  if (noteMatch) return { command: "createNote", args: { content: noteMatch[1] || "" }, response: "Creé una nota." };
  if (/abrir web|abre web|abri web/.test(text)) return { command: "openApp", args: { app: "web" }, response: "Abrí Web." };
  return { response: "Puedo abrir apps, crear notas, organizar ventanas y cambiar de escritorio." };
}

function addJennyMessage(container, who, text) {
  const line = document.createElement("p");
  line.className = `jenny-message ${who}`;
  const label = document.createElement("b");
  label.textContent = who === "user" ? "Vos: " : "Jenny: ";
  const content = document.createElement("span");
  content.textContent = text;
  line.append(label, content);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function addJennyActions(container, actions) {
  const row = document.createElement("div");
  row.className = "quick-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => commandBus.execute(action.command, action.args || {}));
    row.appendChild(button);
  }
  container.appendChild(row);
}

function openJenny() {
  const win = makeCapsule("jenny", "Jenny - Consola", `<div class="jenny-chat" role="log"><p class="jenny-message assistant"><b>Jenny: </b><span>Hola, soy Jenny. Decime qué querés hacer.</span></p></div><div class="jenny-compose"><input class="jenny-input" placeholder="Escribile a Jenny…" aria-label="Mensaje para Jenny"><button class="jenny-send" type="button">Enviar</button></div>`);
  const chat = win.querySelector(".jenny-chat");
  const input = win.querySelector(".jenny-input");
  function send() {
    const message = input.value.trim();
    if (!message) return;
    addJennyMessage(chat, "user", message);
    input.value = "";
    const parsed = parseJennyCommand(message);
    let response = parsed.response;
    if (parsed.command) {
      try {
        const result = commandBus.execute(parsed.command, parsed.args || {});
        if (typeof response === "function") response = response(result);
      } catch (error) {
        response = `No pude completar la acción: ${error.message}`;
      }
    }
    addJennyMessage(chat, "assistant", response);
    const actions = [];
    if (parsed.command === "minimizeWindow" || parsed.command === "closeAll") {
      actions.push({ label: "Restaurar Steam", command: "restoreWindow", args: { app: "stream" } });
    }
    if (parsed.command === "switchDesktop" || parsed.command === "openYoutube") {
      actions.push({ label: "Ir a escritorio 2", command: "switchDesktop", args: { desktop: 2 } });
    }
    if (parsed.command && parsed.command !== "closeAll") {
      actions.push({ label: "Cerrar todo", command: "closeAll" });
    }
    if (actions.length) addJennyActions(chat, actions);
  }
  win.querySelector(".jenny-send").addEventListener("click", send);
  input.addEventListener("keydown", event => { if (event.key === "Enter") send(); });
  return win;
}

function openSettings() {
  const win = makeCapsule("settings", "Ajustes", `<h3>Fondo de pantalla</h3><div class="setting-row"><button data-background="night">Noche</button><button data-background="mint">Menta</button><button data-background="violet">Violeta</button><input type="color" class="custom-background" value="#111214" aria-label="Color de fondo"></div><h3>Tamaño del Dock</h3><div class="setting-row"><button data-dock-size="small">Chico</button><button data-dock-size="medium">Mediano</button><button data-dock-size="large">Grande</button></div><p class="settings-space"></p><button type="button" class="reset-ivexo danger">Reset IVEXO</button>`);
  win.querySelectorAll("[data-background]").forEach(button => button.addEventListener("click", () => setBackground(button.dataset.background)));
  win.querySelector(".custom-background").addEventListener("input", event => {
    document.documentElement.style.setProperty("--workspace-bg", event.target.value);
  });
  win.querySelectorAll("[data-dock-size]").forEach(button => button.addEventListener("click", () => {
    document.querySelector(".dock").dataset.size = button.dataset.dockSize;
  }));
  win.querySelector(".reset-ivexo").addEventListener("click", async () => {
    if (!window.confirm("¿Cerrar todas las ventanas y vaciar la papelera?")) return;
    const response = await fetch("/api/trash/empty", { method: "DELETE" });
    if (!response.ok) return showToast(`No se pudo vaciar la papelera (${response.status})`);
    closeAllWindows();
    localStorage.removeItem("ivexo.layout.v2");
    showToast("IVEXO reiniciado. Los archivos activos se conservaron.");
    commandBus.execute("openApp", { app: "settings", newInstance: true });
  });
  fetch("/api/files").then(response => {
    if (!response.ok) throw new Error(`No se pudo consultar el espacio (${response.status})`);
    return response.json();
  }).then(files => {
    const used = files.reduce((total, file) => total + file.size, 0);
    win.querySelector(".settings-space").textContent = `Espacio usado: ${formatBytes(used)} en ${files.length} archivo(s).`;
  }).catch(error => {
    win.querySelector(".settings-space").textContent = error.message;
  });
  return win;
}

function setBackground(name) {
  document.body.dataset.background = name;
}

function openNotes() {
  const win = makeCapsule("notes", "Notas", `<div class="notes-toolbar"><button type="button" class="note-add">+ Nota</button><span class="notes-status"></span></div><div class="notes-hint">Los post-its se guardan como archivos .md en workspace/.</div>`);
  const status = win.querySelector(".notes-status");
  win.querySelector(".note-add").addEventListener("click", () => createPostIt(""));
  fetch("/api/files").then(response => {
    if (!response.ok) throw new Error(`No se pudieron cargar las notas (${response.status})`);
    return response.json();
  }).then(files => {
    const notes = files.filter(file => file.name.startsWith("nota-postit-") && file.name.endsWith(".md"));
    for (const file of notes) {
      const content = file.content.replace(/^# Post-it\s*/, "");
      if (!desk.querySelectorAll(".postit").length || ![...desk.querySelectorAll(".postit")].some(note => note.dataset.noteId === file.name)) {
        createPostItFromFile(file.name, content);
      }
    }
    status.textContent = `${notes.length} nota(s) guardada(s).`;
  }).catch(error => { status.textContent = error.message; });
  return win;
}

function createPostItFromFile(name, content) {
  return createPostIt(content, name);
}

function openMonitor() {
  const win = makeCapsule("monitor", "Monitor IVEXO", `<div class="monitor-summary"></div><div class="monitor-list"></div><button type="button" class="monitor-close-all danger">Cerrar todo</button><button type="button" class="monitor-refresh">Actualizar</button>`);
  const summary = win.querySelector(".monitor-summary");
  const list = win.querySelector(".monitor-list");
  async function refresh() {
    const items = listWindows();
    let files = [];
    try {
      const response = await fetch("/api/files");
      if (!response.ok) throw new Error(`No se pudieron contar archivos (${response.status})`);
      files = await response.json();
    } catch (error) {
      summary.textContent = error.message;
    }
    summary.textContent = `${items.length} ventana(s) · ${files.length} archivo(s)`;
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "monitor-row";
      const label = document.createElement("span");
      label.textContent = `${item.id} · ${APP_LABELS[item.app]} · ${item.title} · ${item.state}`;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Cerrar a la fuerza";
      close.addEventListener("click", () => {
        commandBus.execute("closeWindow", { id: item.id });
        refresh();
      });
      row.append(label, close);
      list.appendChild(row);
    }
  }
  win.querySelector(".monitor-close-all").addEventListener("click", () => {
    commandBus.execute("closeAll");
    refresh();
  });
  win.querySelector(".monitor-refresh").addEventListener("click", refresh);
  refresh();
  return win;
}

function restoreLayout() {
  const raw = localStorage.getItem("ivexo.layout.v2");
  if (!raw) return false;
  let layout;
  try { layout = JSON.parse(raw); }
  catch (error) {
    showToast(`No se pudo restaurar el diseño: ${error.message}`);
    return false;
  }
  if (!layout || !Array.isArray(layout.windows)) return false;
  appState.restoring = true;
  appState.desktopCount = Math.max(3, Number(layout.desktopCount) || 3);
  renderDesktopBar();
  for (const saved of layout.windows) {
    if (!APP_LABELS[saved.app]) continue;
    const win = openApp(saved.app, { newInstance: true, desktop: saved.desktop });
    if (!win) continue;
    if (saved.left) win.style.left = saved.left;
    if (saved.top) win.style.top = saved.top;
    if (saved.width) win.style.width = saved.width;
    if (saved.height) win.style.height = saved.height;
    if (saved.snap) {
      win._restoreRect = { left: saved.left, top: saved.top, width: saved.width, height: saved.height };
      win.dataset.snap = saved.snap;
    }
    if (saved.state === "minimized") {
      win.dataset.state = "minimized";
      win.style.display = "none";
      win.classList.add("minimizing");
    }
  }
  appState.desktop = Math.min(Math.max(1, Number(layout.desktop) || 1), appState.desktopCount);
  appState.restoring = false;
  applyDesktopVisibility();
  updateDock();
  return true;
}

function cycleWindow() {
  const candidates = visibleWindows();
  if (candidates.length < 2) return;
  const index = candidates.findIndex(win => win.dataset.id === appState.activeId);
  focusWindow(candidates[(index + 1) % candidates.length]);
}

document.addEventListener("keydown", event => {
  if (event.altKey && event.key === "Tab") {
    event.preventDefault();
    cycleWindow();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "w") {
    event.preventDefault();
    commandBus.execute("closeWindow");
    return;
  }
  if (event.key === "Escape") {
    if (overlayRoot.firstChild) overlayRoot.replaceChildren();
    else commandBus.execute("minimizeWindow");
    return;
  }
  if (event.ctrlKey && event.key === "ArrowLeft") {
    event.preventDefault();
    commandBus.execute("switchDesktop", { desktop: Math.max(1, appState.desktop - 1) });
  } else if (event.ctrlKey && event.key === "ArrowRight") {
    event.preventDefault();
    commandBus.execute("switchDesktop", { desktop: Math.min(appState.desktopCount, appState.desktop + 1) });
  }
});

document.querySelector(".dock").addEventListener("click", event => {
  const button = event.target.closest("[data-open]");
  if (!button) return;
  commandBus.execute("openApp", { app: button.dataset.open });
});

document.querySelector(".dock").addEventListener("contextmenu", event => {
  const button = event.target.closest("[data-open]");
  if (!button) return;
  event.preventDefault();
  const instances = allWindows().filter(win => win.dataset.app === button.dataset.open);
  if (!instances.length) {
    commandBus.execute("openApp", { app: button.dataset.open });
    return;
  }
  makeMenu(instances.map((win, index) => ({
    label: `${index + 1}. ${win.dataset.title} · escritorio ${win.dataset.desktop}${win.dataset.state === "minimized" ? " · minimizada" : ""}`,
    action: () => commandBus.execute("focusWindow", { id: win.dataset.id })
  })), event.clientX, event.clientY);
});

desk.addEventListener("contextmenu", event => {
  if (event.target.closest(".cap,.postit")) return;
  event.preventDefault();
  makeMenu([
    { label: "Nueva nota", action: () => commandBus.execute("createNote") },
    { label: "Cambiar fondo", action: () => setBackground(document.body.dataset.background === "mint" ? "night" : "mint") },
    { label: "Ordenar ventanas", action: () => document.getElementById("btnAlign").click() },
    { label: "Nuevo escritorio", action: createDesktop },
    { label: "Vista general", action: showOverview }
  ], event.clientX, event.clientY);
});

desk.addEventListener("dragover", event => event.preventDefault());
desk.addEventListener("drop", event => {
  const id = event.dataTransfer.getData("text/ivexo-window");
  const desktop = event.target.closest(".overview-desktop");
  if (id && desktop) commandBus.execute("moveWindow", { id, desktop: desktop.dataset.desktop });
});

document.getElementById("btnAlign").addEventListener("click", () => {
  let y = 20;
  for (const win of visibleWindows()) {
    win.style.left = "40px";
    win.style.top = `${y}px`;
    y += 36;
  }
  persistLayout();
});

document.getElementById("btnSave").addEventListener("click", async () => {
  persistLayout();
  try {
    const response = await fetch("/api/files");
    if (!response.ok) throw new Error(`No se pudieron contar archivos (${response.status})`);
    const files = await response.json();
    showToast(`Diseño guardado · ${files.length} archivo(s) en workspace`);
  } catch (error) { showToast(error.message); }
});

document.getElementById("btnOverview").addEventListener("click", showOverview);
renderDesktopBar();
updateDock();
if (!restoreLayout()) commandBus.execute("openApp", { app: "web" });
