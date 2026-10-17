import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  scanProject,
  discover,
  home,
  exec,
  validateSubscription,
  id,
} from "./domain.mjs";
import {
  connections,
  repositories,
  vercelProjects,
  remoteProject,
  githubSnapshot,
  githubAttention,
  deploymentSnapshot,
} from "./providers.mjs";
import { collectChats } from "../scripts/chat-reader.mjs";
import { chatView } from "./live-data.mjs";
import { linkRepository } from "./project-state.mjs";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataDir = process.env.HUB_DATA_DIR || path.join(appRoot, ".data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const dataFile = path.join(dataDir, "hub.json");
let state;
try {
  state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT")
    throw new Error(
      "Project Hub data cannot be read. Your saved file has been preserved at " +
        dataFile,
    );
  state = { version: 1, projects: [], subscriptions: [], seeded: false };
}
function save() {
  const temp = dataFile + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temp, dataFile);
}
const cache = new Map(),
  pending = new Map();
const ttl = 120000;
async function cached(key, fn, force = false, cacheTtl = ttl) {
  const previous = cache.get(key);
  if (pending.has(key)) return pending.get(key);
  if (previous && !force && Date.now() - previous.at < cacheTtl)
    return previous.value;
  const promise = Promise.resolve()
    .then(fn)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
function retainLastGood(next, prev) {
  if (next.status === "error" && prev?.syncedAt)
    return { ...prev, status: "error", error: next.error, stale: true };
  return next;
}
async function snapshot(project, force = false) {
  return cached(
    "snapshot:" + project.id,
    async () => {
      const old = cache.get("snapshot:" + project.id)?.value;
      const [github, vercel] = await Promise.all([
        cached(
          "github:" + project.repo,
          () => githubSnapshot(project.repo),
          force,
          30000,
        ),
        cached(
          "vercel:" + JSON.stringify(project.vercel),
          () => deploymentSnapshot(project.vercel),
          force,
          30000,
        ),
      ]);
      return {
        github: retainLastGood(github, old?.github),
        vercel: retainLastGood(vercel, old?.vercel),
      };
    },
    force,
    30000,
  );
}
// A fresh install stays empty until the user explicitly adds a project.
const initialization = null;
if (!fs.existsSync(dataFile)) save();
function currentChats(projectId) {
  if (process.env.HUB_ENABLE_CHATS !== "1" || process.env.HUB_DEMO === "1")
    return chatView(null, projectId);
  return chatView(
    collectChats(state.projects, {
      localStateFile: dataFile,
      includeUnassigned: process.env.HUB_INCLUDE_UNASSIGNED_CHATS === "1",
    }),
    projectId,
  );
}
const port = Number(process.env.PORT || 3007),
  origin = "http://127.0.0.1:" + port,
  csrf = crypto.randomBytes(32).toString("hex");
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64000) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
    send(res, 403, { error: "Open Project Hub at " + origin });
    return;
  }
  if (
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}`
  ) {
    send(res, 403, { error: "Origin not allowed." });
    return;
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    send(res, 403, { error: "Cross-site access not allowed." });
    return;
  }
  try {
    const url = new URL(req.url, origin),
      route = url.pathname;
    if (route.startsWith("/api/")) {
      if (
        req.method !== "GET" &&
        (req.headers["x-hub-token"] !== csrf ||
          req.headers["content-type"] !== "application/json")
      ) {
        send(res, 403, { error: "Reload Project Hub and try again." });
        return;
      }
      if (route === "/api/health" && req.method === "GET") {
        send(res, 200, { app: "project-hub", version: 1 });
        return;
      }
      if (route === "/api/state" && req.method === "GET") {
        send(res, 200, { ...state, csrf, initialization });
        return;
      }
      if (route === "/api/connections" && req.method === "GET") {
        send(
          res,
          200,
          await cached(
            "connections",
            connections,
            url.searchParams.has("refresh"),
          ),
        );
        return;
      }
      if (route === "/api/discover" && req.method === "GET") {
        send(res, 200, await discover());
        return;
      }
      if (route === "/api/repositories" && req.method === "GET") {
        send(res, 200, await cached("repos", repositories));
        return;
      }
      if (route === "/api/vercel-projects" && req.method === "GET") {
        send(res, 200, await cached("vercel-projects", vercelProjects));
        return;
      }
      if (route === "/api/preview" && req.method === "POST") {
        const b = await body(req);
        send(
          res,
          200,
          b.path
            ? await scanProject(b.path, b.name)
            : await remoteProject(b.repo),
        );
        return;
      }
      if (route === "/api/projects" && req.method === "POST") {
        const b = await body(req);
        const p = b.path
          ? await scanProject(b.path, b.name)
          : await remoteProject(b.repo);
        const duplicate = state.projects.find(
          (x) => x.id === p.id || (!p.path && x.repo === p.repo),
        );
        if (duplicate) {
          send(res, 200, { project: duplicate, existing: true });
          return;
        }
        if (!p.vercel && p.repo) {
          try {
            const matches = (
              await cached("vercel-projects", vercelProjects)
            ).filter((v) => v.repo?.toLowerCase() === p.repo.toLowerCase());
            if (matches.length === 1) {
              p.vercel = {
                projectId: matches[0].id,
                teamId: matches[0].teamId,
                name: matches[0].name,
              };
              if (!p.stack.some((n) => n.name === "Vercel"))
                p.stack.push({
                  id: id("Vercel"),
                  name: "Vercel",
                  role: "Hosting",
                  kind: "deploy",
                  evidence: ["Vercel repository match: " + p.repo],
                  detected: true,
                });
            }
          } catch {}
        }
        state.projects.push(p);
        save();
        send(res, 200, { project: p });
        return;
      }
      const match = route.match(
        /^\/api\/projects\/([a-f0-9]{16})(?:\/(snapshot|rescan|open|vercel|chats|live|repository|attention))?$/,
      );
      if (match) {
        const p = state.projects.find((x) => x.id === match[1]);
        if (!p) {
          send(res, 404, { error: "Project not found." });
          return;
        }
        if (match[2] === "snapshot" && req.method === "GET") {
          send(res, 200, await snapshot(p, url.searchParams.has("refresh")));
          return;
        }
        if (match[2] === "attention" && req.method === "GET") {
          send(
            res,
            200,
            await cached(
              "attention:" + p.repo,
              () => githubAttention(p.repo),
              url.searchParams.has("refresh"),
            ),
          );
          return;
        }
        if (match[2] === "repository" && req.method === "POST") {
          const input = await body(req);
          const fresh = await remoteProject(input.repo);
          const linked = linkRepository(state, p.id, fresh);
          save();
          cache.delete("snapshot:" + p.id);
          send(res, 200, linked);
          return;
        }
        if (match[2] === "live" && req.method === "GET") {
          send(res, 200, {
            chats: currentChats(p.id),
            vercel: (await snapshot(p)).vercel,
          });
          return;
        }
        if (match[2] === "chats" && req.method === "GET") {
          send(res, 200, currentChats(p.id));
          return;
        }
        if (match[2] === "rescan" && req.method === "POST") {
          if (!p.path && !p.repo)
            throw new Error(
              "This saved stack has no folder or repository to rescan.",
            );
          const fresh = p.path
            ? await scanProject(p.path, p.name)
            : await remoteProject(p.repo);
          Object.assign(p, fresh, { vercel: fresh.vercel || p.vercel });
          save();
          cache.delete("snapshot:" + p.id);
          send(res, 200, p);
          return;
        }
        if (match[2] === "open" && req.method === "POST") {
          if (!p.path) throw new Error("This project has no local folder.");
          if (process.platform === "win32")
            throw new Error("Open this folder in File Explorer: " + p.path);
          await exec(process.platform === "darwin" ? "open" : "xdg-open", [
            p.path,
          ]);
          send(res, 200, { ok: true });
          return;
        }
        if (match[2] === "vercel" && req.method === "POST") {
          const b = await body(req);
          const choices = await cached("vercel-projects", vercelProjects);
          const chosen = choices.find((x) => x.id === b.projectId);
          if (!chosen) throw new Error("Choose one of your Vercel projects.");
          p.vercel = {
            projectId: chosen.id,
            teamId: chosen.teamId,
            name: chosen.name,
          };
          if (!p.stack.some((n) => n.name === "Vercel"))
            p.stack.push({
              id: id("Vercel"),
              name: "Vercel",
              role: "Hosting",
              kind: "deploy",
              evidence: ["Vercel project linked in Project Hub"],
              detected: false,
            });
          save();
          cache.delete("snapshot:" + p.id);
          send(res, 200, p);
          return;
        }
      }
      if (route === "/api/open-t3" && req.method === "POST") {
        if (process.platform !== "darwin")
          throw new Error("Open T3 Code from your application launcher.");
        await exec("open", ["-a", "T3 Code (Alpha)"]);
        send(res, 200, { ok: true });
        return;
      }
      if (route === "/api/subscriptions" && req.method === "POST") {
        const b = await body(req);
        const sub = {
          ...validateSubscription(b, state.projects),
          id: crypto.randomUUID(),
        };
        state.subscriptions.push(sub);
        save();
        send(res, 200, sub);
        return;
      }
      const submatch = route.match(/^\/api\/subscriptions\/([a-f0-9-]{36})$/);
      if (submatch) {
        const index = state.subscriptions.findIndex(
          (s) => s.id === submatch[1],
        );
        if (index < 0) {
          send(res, 404, { error: "Subscription not found." });
          return;
        }
        if (req.method === "PUT") {
          const b = await body(req);
          state.subscriptions[index] = {
            ...validateSubscription(b, state.projects),
            id: submatch[1],
          };
          save();
          send(res, 200, state.subscriptions[index]);
          return;
        }
        if (req.method === "DELETE") {
          state.subscriptions.splice(index, 1);
          save();
          send(res, 200, { ok: true });
          return;
        }
      }
      send(res, 404, { error: "Not found." });
      return;
    }
    if (req.method !== "GET") {
      send(res, 405, { error: "Method not allowed." });
      return;
    }
    const rel =
      route === "/"
        ? "index.html"
        : decodeURIComponent(route).replace(/^\//, "");
    const file = path.resolve(appRoot, "dist", rel);
    if (!file.startsWith(path.join(appRoot, "dist") + "/")) {
      send(res, 404, { error: "Not found." });
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(res, 404, { error: "Not found." });
      return;
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    res.setHeader(
      "Cache-Control",
      rel === "index.html" ? "no-cache" : "public, max-age=3600",
    );
    res.setHeader(
      "Content-Type",
      {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
      }[path.extname(file).slice(1)] || "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 400, { error: e.message || "Something went wrong." });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log("Project Hub ready at " + origin),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE" ? "Project Hub port is already in use." : e.message,
  );
  process.exit(1);
});
