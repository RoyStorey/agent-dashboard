import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? "127.0.0.1";
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(root, "data"));
const extraHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const store = new Store(DATA_DIR);
const app = createApp({ store, allowedHosts: ["localhost", "127.0.0.1", "[::1]", ...extraHosts] });

// Serve the built dashboard (npm run build) if present; in dev, Vite serves it.
const dist = path.join(root, "dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Agent Dashboard API listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Data file: ${path.join(DATA_DIR, "db.json")}`);
  if (fs.existsSync(path.join(dist, "index.html"))) {
    console.log(`Dashboard: http://localhost:${PORT}`);
  } else {
    console.log("Dashboard (dev): http://localhost:5173  (run `npm run dev`)");
  }
});
