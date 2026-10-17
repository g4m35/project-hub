import crypto from "node:crypto";

export const CHAT_FRESH_MS = 45000;
const events = {
  "deployment.created": "BUILDING",
  "deployment.ready": "READY",
  "deployment.succeeded": "READY",
  "deployment.error": "ERROR",
  "deployment.canceled": "CANCELED",
  "deployment.promoted": "READY",
  "deployment.rollback": "READY",
};
export function secureEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function verifyWebhook(raw, signature, secret) {
  return (
    !!secret &&
    /^[a-f0-9]{40}$/.test(signature || "") &&
    secureEqual(
      crypto.createHmac("sha1", secret).update(raw).digest("hex"),
      signature,
    )
  );
}
const short = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const date = (v) =>
  Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
export function safeHttps(value, hostname) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!hostname || u.hostname === hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function normalizeDeployment(
  d,
  { projectId, teamId, state, eventAt, links = {} } = {},
) {
  const host = short(d.url, 300).replace(/^https:\/\//, "");
  const siteUrl = /^[a-z0-9.-]+\.vercel\.app$/i.test(host)
    ? "https://" + host
    : null;
  return {
    id: short(d.uid || d.id, 100),
    projectId,
    teamId,
    title: short(
      d.meta?.githubCommitMessage?.split("\n")[0] || d.name || "Deployment",
    ),
    state: state || d.state || d.readyState || "UNKNOWN",
    branch: short(d.meta?.githubCommitRef || d.target || "Preview", 120),
    target: short(d.target, 30) || null,
    createdAt: date(d.createdAt || d.created || eventAt),
    eventAt: date(eventAt || d.ready || d.createdAt || d.created),
    url:
      safeHttps(links.deployment || d.inspectorUrl, "vercel.com") ||
      (projectId
        ? `https://vercel.com/~/deployments/${encodeURIComponent(d.uid || d.id)}`
        : null),
    siteUrl,
    provider: "Vercel",
  };
}
export function deploymentEvent(event, teamId, projectIds) {
  const payload = event?.payload;
  if (
    !events[event?.type] ||
    payload?.team?.id !== teamId ||
    !projectIds.includes(payload?.project?.id)
  )
    return null;
  if (
    !/^dpl_[a-zA-Z0-9]+$/.test(payload.deployment?.id || "") ||
    !date(event.createdAt)
  )
    return null;
  return normalizeDeployment(
    { ...payload.deployment, target: payload.target },
    {
      projectId: payload.project.id,
      teamId,
      state: events[event.type],
      eventAt: event.createdAt,
      links: payload.links,
    },
  );
}
export function sanitizeChatSync(body, projectIds, now = Date.now()) {
  if (
    !body ||
    !Array.isArray(body.projects) ||
    body.projects.length > 100 ||
    !date(body.capturedAt) ||
    Math.abs(now - new Date(body.capturedAt).getTime()) > 120000
  )
    throw new Error("Invalid chat sync payload.");
  const sources = {};
  for (const name of ["codex", "t3"])
    sources[name] = ["connected", "unavailable", "missing"].includes(
      body.sources?.[name],
    )
      ? body.sources[name]
      : "unavailable";
  const seen = new Set();
  return {
    capturedAt: date(body.capturedAt),
    sources,
    projects: body.projects
      .filter(
        (p) =>
          (projectIds.includes(p.id) || p.id === "unassigned") &&
          !seen.has(p.id) &&
          seen.add(p.id),
      )
      .map((p) => {
        if (!Array.isArray(p.chats) || p.chats.length > 100)
          throw new Error("Too many chats.");
        return {
          id: p.id,
          chats: p.chats
            .filter(
              (c) =>
                ["Codex", "T3 Code"].includes(c.app) &&
                typeof c.id === "string" &&
                (c.app === "Codex"
                  ? /^[a-zA-Z0-9_-]{8,100}$/
                  : /^[a-zA-Z0-9_:%-]{8,500}$/
                ).test(c.id) &&
                date(c.updatedAt),
            )
            .map((c) => ({
              id: c.id,
              title: short(c.title) || "Untitled chat",
              app: c.app,
              updatedAt: date(c.updatedAt),
              state: ["active", "needs_input", "idle", "error"].includes(
                c.state,
              )
                ? c.state
                : "idle",
            })),
        };
      }),
  };
}
export function chatView(sync, projectId, now = Date.now()) {
  if (!sync)
    return { status: "unconnected", chats: [], sources: {}, syncedAt: null };
  const online = now - new Date(sync.capturedAt).getTime() < CHAT_FRESH_MS;
  const sources = sync.sources || {};
  const rows = (
    sync.projects?.find((p) => p.id === projectId)?.chats || []
  ).filter((c) => sources[c.app === "Codex" ? "codex" : "t3"] === "connected");
  const allChats = [
    ...new Map(
      (sync.projects || [])
        .flatMap((p) => (p.chats || []).map((c) => ({ ...c, projectId: p.id })))
        .filter(
          (c) => sources[c.app === "Codex" ? "codex" : "t3"] === "connected",
        )
        .map((c) => [c.app + ":" + c.id, c]),
    ).values(),
  ]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 150);
  return {
    status: online
      ? Object.values(sources).includes("connected")
        ? "connected"
        : "error"
      : "offline",
    allChats: allChats.map((c) => ({
      ...c,
      state: online ? c.state : "unknown",
    })),
    syncedAt: sync.capturedAt,
    sources,
    chats: rows.map((c) => ({ ...c, state: online ? c.state : "unknown" })),
  };
}
