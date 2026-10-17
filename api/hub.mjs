import crypto from "node:crypto";
import {
  readState,
  changeState,
  readCache,
  saveCache,
  rateLimit,
} from "../cloud/store.mjs";
import {
  HttpError,
  validateOrigin,
  getOwnerSession,
  csrfFor,
  checkCsrf,
  authProxy,
  readBody,
  appOrigin,
} from "../cloud/security.mjs";
import { saveCredential } from "../cloud/credentials.mjs";
import {
  connections,
  repositories,
  vercelProjects,
  remoteProject,
  githubSnapshot,
  githubAttention,
  deploymentSnapshot,
} from "../server/providers.mjs";
import { validateSubscription, id } from "../server/domain.mjs";
import { linkRepository } from "../server/project-state.mjs";
import {
  integrationConfig,
  integrationSecret,
  liveChats,
  liveDeployments,
  saveChats,
  saveDeployment,
} from "../cloud/live.mjs";
import {
  secureEqual,
  verifyWebhook,
  deploymentEvent,
  sanitizeChatSync,
} from "../server/live-data.mjs";

export const config = { api: { bodyParser: false } };
async function rawBody(req) {
  if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
    const value = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    if (value.length > 512000) throw new HttpError(413, "Payload too large.");
    return value;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 512000) throw new HttpError(413, "Payload too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

process.env.HUB_CLOUD = "1";
const pending = new Map();
async function cached(key, read, force = false, ttl = 120000) {
  if (pending.has(key)) return pending.get(key);
  const work = (async () => {
    const previous = await readCache(key);
    if (!force && previous && Date.now() - previous.at < ttl)
      return previous.value;
    let next = await read();
    if (next.status === "error" && previous?.value?.syncedAt)
      next = {
        ...previous.value,
        status: "error",
        error: next.error,
        stale: true,
      };
    await saveCache(key, next);
    return next;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
function withVercel(project, chosen) {
  if (!chosen) return project;
  project.vercel = {
    projectId: chosen.id,
    teamId: chosen.teamId,
    name: chosen.name,
  };
  if (!project.stack.some((n) => n.name === "Vercel"))
    project.stack.push({
      id: id("Vercel"),
      name: "Vercel",
      role: "Hosting",
      kind: "deploy",
      detected: false,
      evidence: ["Vercel project linked in Project Hub"],
    });
  return project;
}
function send(res, status, data) {
  res.statusCode = status;
  res.end(JSON.stringify(data));
}
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(req.url, appOrigin());
    const raw = req.query?.path || url.searchParams.get("path");
    const route =
      "/" +
      (Array.isArray(raw)
        ? raw.join("/")
        : raw || url.pathname.replace(/^\/api\//, ""));
    // Machine endpoints use separate, narrowly scoped credentials. They never accept owner cookies.
    if (route === "/events/vercel" && req.method === "POST") {
      const rawBodyValue = await rawBody(req);
      if (
        !verifyWebhook(
          rawBodyValue,
          req.headers["x-vercel-signature"],
          await integrationSecret("vercelSecret"),
        )
      )
        throw new HttpError(401, "Invalid webhook signature.");
      let event;
      try {
        event = JSON.parse(rawBodyValue.toString());
      } catch {
        throw new HttpError(400, "Invalid event.");
      }
      const config = await integrationConfig();
      const linkedIds = config.allTeamProjects
        ? (await readState()).projects
            .filter((p) => p.vercel?.teamId === config.teamId)
            .map((p) => p.vercel.projectId)
        : config.projectIds || [];
      const row = deploymentEvent(event, config.teamId, linkedIds);
      if (row) {
        await saveDeployment(row);
        await saveCache("integration:last-vercel-event", {
          id: event.id,
          type: event.type,
          projectId: row.projectId,
          receivedAt: new Date().toISOString(),
        });
      }
      return send(res, 200, { received: true });
    }
    if (["/sync/projects", "/sync/chats"].includes(route)) {
      const secret = await integrationSecret("chatSecret");
      if (
        !secret ||
        !secureEqual(req.headers.authorization, "Bearer " + secret)
      )
        throw new HttpError(401, "Invalid sync credential.");
      if (!(await rateLimit("chat-sync", 30, 60)))
        throw new HttpError(429, "Sync limit reached.");
      const state = await readState();
      if (route === "/sync/projects" && req.method === "GET")
        return send(res, 200, {
          projects: state.projects.map(({ id, name, repo }) => ({
            id,
            name,
            repo,
          })),
        });
      if (route === "/sync/chats" && req.method === "POST") {
        let body;
        try {
          body = JSON.parse((await rawBody(req)).toString());
        } catch {
          throw new HttpError(400, "Invalid sync data.");
        }
        let value;
        try {
          value = sanitizeChatSync(
            body,
            state.projects.map((p) => p.id),
          );
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        await saveChats(value);
        return send(res, 200, { syncedAt: value.capturedAt });
      }
      throw new HttpError(405, "Method not allowed.");
    }
    validateOrigin(req);
    if (route === "/health" && req.method === "GET")
      return send(res, 200, { app: "project-hub", version: 2, cloud: true });
    if (route.startsWith("/auth/"))
      return await authProxy(req, res, route.slice(6));
    if (route === "/session" && req.method === "GET") {
      try {
        await getOwnerSession(req);
        return send(res, 200, { authenticated: true });
      } catch (error) {
        if (error.status === 401)
          return send(res, 200, { authenticated: false });
        throw error;
      }
    }
    const { session, user } = await getOwnerSession(req);
    if (req.method !== "GET" && !checkCsrf(req.headers["x-hub-token"], session))
      throw new HttpError(403, "Reload Project Hub and try again.");
    if (!(await rateLimit("owner:requests", 240, 60)))
      throw new HttpError(429, "Please wait a minute before refreshing.");
    if (route === "/state" && req.method === "GET")
      return send(res, 200, {
        ...(await readState()),
        csrf: csrfFor(session),
        initialization: null,
        cloud: true,
        owner: { name: user.name, email: user.email },
      });
    if (route === "/connections" && req.method === "GET")
      return send(
        res,
        200,
        await cached(
          "connections",
          connections,
          url.searchParams.has("refresh"),
        ),
      );
    if (route === "/repositories" && req.method === "GET")
      return send(res, 200, await cached("repositories", repositories));
    if (route === "/vercel-projects" && req.method === "GET")
      return send(res, 200, await cached("vercel-projects", vercelProjects));
    const providerMatch = route.match(/^\/connections\/(github|vercel)$/);
    if (providerMatch && req.method === "POST") {
      const provider = providerMatch[1],
        b = await readBody(req),
        token = String(b.token || "").trim();
      if (token.length < 20 || token.length > 4096 || /\s/.test(token))
        throw new HttpError(400, "Paste a valid provider access token.");
      const endpoint =
        provider === "github"
          ? "https://api.github.com/user"
          : process.env.HUB_TEAM_ID
            ? "https://api.vercel.com/v9/projects?limit=1&teamId=" +
              encodeURIComponent(process.env.HUB_TEAM_ID)
            : "https://api.vercel.com/v2/user";
      const check = await fetch(endpoint, {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!check.ok)
        throw new HttpError(
          400,
          "This token could not access your account. Check its scope and try again.",
        );
      await saveCredential(provider, token);
      await cached("connections", connections, true);
      return send(res, 200, { ok: true });
    }
    if (
      (route === "/preview" || route === "/projects") &&
      req.method === "POST"
    ) {
      const b = await readBody(req);
      if (b.path)
        throw new HttpError(
          400,
          "Use a GitHub repository to connect a project from any device.",
        );
      let p = await remoteProject(b.repo);
      if (route === "/preview") return send(res, 200, p);
      try {
        const matches = (
          await cached("vercel-projects", vercelProjects)
        ).filter((v) => v.repo?.toLowerCase() === p.repo.toLowerCase());
        if (matches.length === 1) p = withVercel(p, matches[0]);
      } catch {}
      return send(
        res,
        200,
        await changeState((state) => {
          const duplicate = state.projects.find(
            (x) => x.repo?.toLowerCase() === p.repo.toLowerCase(),
          );
          if (duplicate) return { project: duplicate, existing: true };
          state.projects.push(p);
          return { project: p };
        }),
      );
    }
    const projectMatch = route.match(
      /^\/projects\/([a-f0-9]{16})\/(snapshot|chats|live|rescan|vercel|repository|attention)$/,
    );
    if (projectMatch) {
      const state = await readState(),
        project = state.projects.find((p) => p.id === projectMatch[1]);
      if (!project) throw new HttpError(404, "Project not found.");
      const action = projectMatch[2];
      if (action === "live" && req.method === "GET") {
        const [chats, vercel] = await Promise.all([
          liveChats(project.id),
          liveDeployments(project.vercel),
        ]);
        return send(res, 200, { chats, vercel });
      }
      if (action === "attention" && req.method === "GET")
        return send(
          res,
          200,
          await cached(
            "attention:" + project.repo,
            () => githubAttention(project.repo),
            url.searchParams.has("refresh"),
          ),
        );
      if (action === "repository" && req.method === "POST") {
        const body = await readBody(req);
        const fresh = await remoteProject(body.repo);
        return send(
          res,
          200,
          await changeState((state) =>
            linkRepository(state, project.id, fresh),
          ),
        );
      }
      if (action === "snapshot" && req.method === "GET") {
        const force = url.searchParams.has("refresh");
        const [github, vercel] = await Promise.all([
          cached(
            "github:" + project.repo,
            () => githubSnapshot(project.repo),
            force,
            30000,
          ),
          (async () =>
            (await liveDeployments(project.vercel)) ||
            cached(
              "vercel:" + JSON.stringify(project.vercel),
              () => deploymentSnapshot(project.vercel),
              force,
              30000,
            ))(),
        ]);
        return send(res, 200, { github, vercel });
      }
      if (action === "chats" && req.method === "GET")
        return send(res, 200, await liveChats(project.id));
      if (action === "rescan" && req.method === "POST") {
        if (!project.repo)
          throw new HttpError(
            400,
            "This project has no GitHub repository to scan. Its imported stack is saved.",
          );
        const fresh = await remoteProject(project.repo);
        return send(
          res,
          200,
          await changeState((s) => {
            const p = s.projects.find((x) => x.id === project.id);
            const updated = {
              ...p,
              stack: fresh.stack,
              scannedAt: fresh.scannedAt,
              modifiedAt: fresh.modifiedAt,
            };
            if (p.vercel)
              withVercel(updated, {
                id: p.vercel.projectId,
                teamId: p.vercel.teamId,
                name: p.vercel.name,
              });
            Object.assign(p, updated);
            return p;
          }),
        );
      }
      if (action === "vercel" && req.method === "POST") {
        const b = await readBody(req),
          choices = await cached("vercel-projects", vercelProjects);
        const chosen = choices.find((x) => x.id === b.projectId);
        if (!chosen)
          throw new HttpError(400, "Choose one of your Vercel projects.");
        return send(
          res,
          200,
          await changeState((s) =>
            withVercel(
              s.projects.find((x) => x.id === project.id),
              chosen,
            ),
          ),
        );
      }
    }
    if (route === "/subscriptions" && req.method === "POST") {
      const b = await readBody(req),
        uuid = crypto.randomUUID();
      return send(
        res,
        200,
        await changeState((s) => {
          const sub = { ...validateSubscription(b, s.projects), id: uuid };
          s.subscriptions.push(sub);
          return sub;
        }),
      );
    }
    const subMatch = route.match(/^\/subscriptions\/([a-f0-9-]{36})$/);
    if (subMatch && ["PUT", "DELETE"].includes(req.method)) {
      const b = req.method === "PUT" ? await readBody(req) : null;
      return send(
        res,
        200,
        await changeState((s) => {
          const i = s.subscriptions.findIndex((x) => x.id === subMatch[1]);
          if (i < 0) throw new HttpError(404, "Subscription not found.");
          if (req.method === "DELETE") {
            s.subscriptions.splice(i, 1);
            return { ok: true };
          }
          const sub = {
            ...validateSubscription(b, s.projects),
            id: subMatch[1],
          };
          s.subscriptions[i] = sub;
          return sub;
        }),
      );
    }
    throw new HttpError(404, "Not found.");
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("Hub request failed:", error.name);
    // Never send database errors, query text or provider credentials to the browser.
    send(res, status, {
      error:
        status === 500
          ? "The hub could not finish that request. Please try again."
          : error.message,
    });
  }
}
