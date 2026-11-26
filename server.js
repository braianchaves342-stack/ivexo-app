const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const ROOT = __dirname;
const WS = path.join(ROOT, "workspace");
const TRASH = path.join(WS, ".trash");

fs.mkdirSync(TRASH, { recursive: true });

app.use(express.json({ limit: "100mb" }));
app.use(express.static(path.join(ROOT, "renderer")));

function isSafeName(name) {
  return typeof name === "string"
    && name.length > 0
    && name !== "."
    && name !== ".."
    && !name.startsWith(".")
    && /^[a-zA-Z0-9._-]+$/.test(name);
}

function metadata(name, directory, includeContent) {
  const filePath = path.join(directory, name);
  const stat = fs.statSync(filePath);
  const file = {
    name,
    size: stat.size,
    updatedAt: stat.mtimeMs
  };
  if (includeContent) file.content = fs.readFileSync(filePath, "utf8");
  return file;
}

function listFiles(directory, includeContent) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith("."))
    .map(entry => metadata(entry.name, directory, includeContent))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

app.get("/api/files", (req, res) => {
  res.json(listFiles(WS, true));
});

app.post("/api/files", (req, res) => {
  const { name, content } = req.body || {};
  if (!isSafeName(name) || typeof content !== "string") {
    return res.status(400).json({ error: "nombre o contenido invalido" });
  }
  fs.writeFileSync(path.join(WS, name), content, "utf8");
  return res.json({ ok: true, name });
});

app.delete("/api/files/:name", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "nombre invalido" });
  const source = path.join(WS, name);
  const destination = path.join(TRASH, name);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return res.status(404).json({ error: "archivo no encontrado" });
  }
  if (fs.existsSync(destination)) return res.status(409).json({ error: "ya existe en papelera" });
  fs.renameSync(source, destination);
  return res.json({ ok: true, name });
});

app.post("/api/files/:name/restore", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "nombre invalido" });
  const source = path.join(TRASH, name);
  const destination = path.join(WS, name);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return res.status(404).json({ error: "archivo no encontrado en papelera" });
  }
  if (fs.existsSync(destination)) return res.status(409).json({ error: "ya existe un archivo con ese nombre" });
  fs.renameSync(source, destination);
  return res.json({ ok: true, name });
});

app.get("/api/trash", (req, res) => {
  res.json(listFiles(TRASH, false));
});

app.post("/api/trash/restore-all", (req, res) => {
  const restored = [];
  const conflicts = [];
  for (const entry of fs.readdirSync(TRASH, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const destination = path.join(WS, entry.name);
    if (fs.existsSync(destination)) {
      conflicts.push(entry.name);
      continue;
    }
    fs.renameSync(path.join(TRASH, entry.name), destination);
    restored.push(entry.name);
  }
  return res.json({ restored, conflicts });
});

app.delete("/api/trash/empty", (req, res) => {
  const deleted = [];
  for (const entry of fs.readdirSync(TRASH, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    fs.unlinkSync(path.join(TRASH, entry.name));
    deleted.push(entry.name);
  }
  return res.json({ ok: true, deleted: deleted.length });
});

app.delete("/api/trash/:name", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "nombre invalido" });
  const target = path.join(TRASH, name);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).json({ error: "archivo no encontrado en papelera" });
  }
  fs.unlinkSync(target);
  return res.json({ ok: true, name });
});

app.get("/api/health", (req, res) => res.json({ ok: true, port: req.socket.localPort, app: "IVEXO" }));

app.get("/api/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) return res.status(400).json({ error: "Ingresá un término para buscar videos." });
  if (query.length > 100) return res.status(400).json({ error: "La búsqueda no puede superar 100 caracteres." });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Falta configurar YOUTUBE_API_KEY en el servidor." });
  }

  const upstreamUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  upstreamUrl.searchParams.set("key", apiKey);
  upstreamUrl.searchParams.set("part", "snippet");
  upstreamUrl.searchParams.set("type", "video");
  upstreamUrl.searchParams.set("maxResults", "10");
  upstreamUrl.searchParams.set("safeSearch", "moderate");
  upstreamUrl.searchParams.set("q", query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      const message = String(payload.error?.message || "YouTube API rechazó la búsqueda.").slice(0, 240);
      console.warn(`YouTube API search failed (${upstream.status}): ${message}`);
      return res.status(502).json({ error: message });
    }

    const items = (Array.isArray(payload.items) ? payload.items : [])
      .map(item => {
        const id = item.id?.videoId;
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
        const snippet = item.snippet || {};
        const thumbnails = snippet.thumbnails || {};
        const thumbnailUrl = [thumbnails.medium?.url, thumbnails.high?.url, thumbnails.default?.url]
          .find(value => {
            if (typeof value !== "string") return false;
            try {
              const thumbnail = new URL(value);
              return thumbnail.protocol === "https:" &&
                (thumbnail.hostname === "i.ytimg.com" || thumbnail.hostname.endsWith(".ytimg.com"));
            } catch {
              return false;
            }
          }) || "";
        return {
          id,
          title: String(snippet.title || ""),
          description: String(snippet.description || ""),
          channelTitle: String(snippet.channelTitle || ""),
          thumbnailUrl
        };
      })
      .filter(Boolean);

    return res.json({ items });
  } catch (error) {
    const timedOut = error.name === "AbortError";
    console.error(`YouTube API search ${timedOut ? "timed out" : "failed"}: ${error.name}`);
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "La búsqueda de YouTube tardó demasiado." : "No se pudo conectar con YouTube."
    });
  } finally {
    clearTimeout(timeout);
  }
});

function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  startServer(port)
    .then(server => console.log(`IVEXO listening on http://127.0.0.1:${server.address().port}`))
    .catch(error => {
      console.error("Could not start IVEXO server:", error);
      process.exitCode = 1;
    });
}

module.exports = { app, startServer };
