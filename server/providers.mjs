import fs from "node:fs";
import path from "node:path";
import {
  exec,
  home,
  json,
  detectStack,
  id,
  repoName,
  isProjectManifest,
} from "./domain.mjs";
import { credential } from "../cloud/credentials.mjs";
import { summarizeWorkflowRuns } from "./project-state.mjs";
const ghPath =
  ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find((p) => fs.existsSync(p)) ||
  "gh";
export async function gh(endpoint) {
  if (process.env.HUB_DEMO === "1")
    throw new Error("Demo mode: provider connections are disabled.");
  if (process.env.HUB_CLOUD === "1" || process.env.HUB_GITHUB_TOKEN) {
    const token =
      process.env.HUB_CLOUD === "1"
        ? await credential("github")
        : process.env.HUB_GITHUB_TOKEN;
    if (!token)
      throw new Error("Connect GitHub in Connections to refresh live issues.");
    const response = await fetch("https://api.github.com/" + endpoint, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    }).catch(() => {
      throw new Error("GitHub could not refresh. Try again.");
    });
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "Repository unavailable or access missing."
          : [401, 403].includes(response.status)
            ? "GitHub access needs attention. Reconnect in Connections."
            : "GitHub could not refresh. Try again.",
      );
    return response.json();
  }
  try {
    const result = await exec(ghPath, ["api", endpoint], {
      timeout: 25000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  } catch (e) {
    const s = String(e.stderr || "");
    throw new Error(
      /404/.test(s)
        ? "Repository unavailable or access missing."
        : /401|403|auth login/.test(s)
          ? "GitHub sign-in needs attention. Run gh auth login in Terminal."
          : "GitHub could not refresh. Check your connection and try again.",
    );
  }
}
function token() {
  return (
    process.env.HUB_VERCEL_TOKEN ||
    process.env.VERCEL_TOKEN ||
    [
      path.join(home, "Library/Application Support/com.vercel.cli/auth.json"),
      path.join(
        process.env.XDG_DATA_HOME || path.join(home, ".local/share"),
        "com.vercel.cli/auth.json",
      ),
    ]
      .map((file) => json(file)?.token)
      .find(Boolean)
  );
}
export async function vercel(endpoint) {
  if (process.env.HUB_DEMO === "1")
    throw new Error("Demo mode: provider connections are disabled.");
  const cloud = process.env.HUB_CLOUD === "1";
  const auth = cloud ? await credential("vercel") : token();
  if (!auth)
    throw new Error(
      cloud
        ? "Connect Vercel in Connections to refresh deployments."
        : "Sign in with vercel login in Terminal, then refresh.",
    );
  let r;
  try {
    r = await fetch("https://api.vercel.com" + endpoint, {
      headers: { Authorization: "Bearer " + auth },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(
      "Vercel could not refresh. Check your connection and try again.",
    );
  }
  if (!cloud && [401, 403].includes(r.status)) {
    const cli = process.env.HUB_VERCEL_CLI || "vercel";
    if (cli)
      try {
        const result = await exec(cli, ["api", endpoint, "--method", "GET"], {
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        });
        return JSON.parse(result.stdout);
      } catch {}
  }
  if (!r.ok)
    throw new Error(
      r.status === 401
        ? cloud
          ? "Vercel access expired. Reconnect in Connections."
          : "Vercel sign-in expired. Run vercel login in Terminal."
        : r.status === 403
          ? "Vercel access is missing for this team."
          : "Vercel request failed (" + r.status + ").",
    );
  return r.json();
}
export async function connections() {
  const live =
    process.env.HUB_CLOUD === "1"
      ? await (await import("../cloud/live.mjs")).integrationConfig()
      : {};
  const [g, v] = await Promise.allSettled([
    gh("user"),
    live.vercelWebhookId
      ? Promise.resolve({
          user: { username: "Live deployment events" },
          mode: "events",
        })
      : vercel("/v2/user"),
  ]);
  return {
    github:
      g.status === "fulfilled"
        ? { connected: true, account: g.value.login }
        : { connected: false, error: g.reason.message },
    vercel:
      v.status === "fulfilled"
        ? {
            connected: true,
            mode: v.value.mode,
            account:
              v.value.user?.username || v.value.user?.name || "Signed in",
          }
        : { connected: false, error: v.reason.message },
  };
}
export async function repositories() {
  return (await gh("user/repos?sort=pushed&per_page=100")).map((r) => ({
    repo: r.full_name,
    name: r.name,
    updatedAt: r.pushed_at,
    private: r.private,
  }));
}
export async function vercelProjects() {
  if (process.env.HUB_CLOUD === "1" && !(await credential("vercel"))) {
    const catalog = (
      await (
        await import("../cloud/store.mjs")
      ).readCache("integration:vercel-projects")
    )?.value;
    if (catalog?.length) return catalog;
  }
  const scopes =
    process.env.HUB_CLOUD === "1" && process.env.HUB_TEAM_ID
      ? [process.env.HUB_TEAM_ID]
      : [
          null,
          ...((await vercel("/v2/teams?limit=100")).teams || []).map(
            (t) => t.id,
          ),
        ];
  const pages = await Promise.allSettled(
    scopes.map(async (teamId) => {
      const out = [];
      let cursor;
      for (let i = 0; i < 5; i++) {
        const data = await vercel(
          "/v9/projects?limit=100" +
            (teamId ? "&teamId=" + encodeURIComponent(teamId) : "") +
            (cursor ? "&from=" + cursor : ""),
        );
        out.push(
          ...(data.projects || []).map((p) => ({
            id: p.id,
            name: p.name,
            teamId,
            repo:
              p.link?.org && p.link?.repo
                ? p.link.org + "/" + p.link.repo
                : null,
          })),
        );
        cursor = data.pagination?.next;
        if (!cursor) break;
      }
      return out;
    }),
  );
  const projects = pages
    .filter((p) => p.status === "fulfilled")
    .flatMap((p) => p.value);
  if (!projects.length && pages.every((p) => p.status === "rejected"))
    throw pages[0].reason;
  return [...new Map(projects.map((p) => [p.id, p])).values()];
}
export async function remoteProject(value) {
  let repo = repoName(value);
  if (!repo) throw new Error("Enter owner/repository or a GitHub URL.");
  const meta = await gh("repos/" + repo);
  repo = meta.full_name || repo;
  let packages = [];
  try {
    const tree = await gh(
      "repos/" +
        repo +
        "/git/trees/" +
        encodeURIComponent(meta.default_branch) +
        "?recursive=1",
    );
    const files = (tree.tree || [])
      .filter((f) => f.type === "blob" && isProjectManifest(f.path))
      .slice(0, 20);
    const found = await Promise.allSettled(
      files.map(async (f) => {
        const data = await gh(
          "repos/" +
            repo +
            "/contents/" +
            f.path.split("/").map(encodeURIComponent).join("/"),
        );
        const p = JSON.parse(Buffer.from(data.content, "base64").toString());
        return {
          source: "GitHub: " + f.path,
          dependencies: { ...p.dependencies, ...p.devDependencies },
        };
      }),
    );
    packages = found
      .filter((x) => x.status === "fulfilled")
      .map((x) => x.value);
  } catch {}
  return {
    id: id("github:" + repo),
    name: meta.name,
    path: null,
    repo,
    stack: detectStack(packages, [
      {
        name: "GitHub",
        kind: "source",
        role: "Source + issues",
        evidence: ["GitHub: " + repo],
      },
    ]),
    files: [],
    scannedAt: new Date().toISOString(),
    modifiedAt: meta.pushed_at,
    vercel: null,
  };
}
export async function githubSnapshot(repo) {
  if (!repo) return { status: "unlinked", issues: [], pulls: [], runs: [] };
  const [issues, runs] = await Promise.allSettled([
    (async () => {
      const all = [];
      for (let page = 1; page <= 10; page++) {
        const r = await gh(
          `repos/${repo}/issues?state=open&sort=updated&per_page=100&page=${page}`,
        );
        all.push(...r);
        if (r.length < 100) return { all, truncated: false };
      }
      return { all, truncated: true };
    })(),
    gh(`repos/${repo}/actions/runs?per_page=10`),
  ]);
  const normalize = (x) => ({
    id: x.id,
    number: x.number,
    title: x.title,
    url: x.html_url,
    updatedAt: x.updated_at,
    labels: x.labels?.map((l) => l.name) || [],
    author: x.user?.login,
  });
  const data = {
    status: issues.status === "fulfilled" ? "connected" : "error",
    issues: [],
    pulls: [],
    runs: [],
    syncedAt: new Date().toISOString(),
  };
  if (issues.status === "fulfilled") {
    data.issues = issues.value.all
      .filter((i) => !i.pull_request)
      .map(normalize);
    data.pulls = issues.value.all.filter((i) => i.pull_request).map(normalize);
    data.truncated = issues.value.truncated;
  } else {
    data.error = issues.reason.message;
    delete data.syncedAt;
  }
  if (runs.status === "fulfilled")
    data.runs = (runs.value.workflow_runs || []).map((r) => ({
      id: r.id,
      title: r.name,
      state: r.conclusion || r.status,
      branch: r.head_branch,
      url: r.html_url,
      createdAt: r.created_at,
      provider: "GitHub Actions",
    }));
  else data.runsError = runs.reason.message;
  return data;
}
export async function githubAttention(repo) {
  if (!repo)
    return {
      status: "unlinked",
      tone: "neutral",
      label: "No repository",
      runs: [],
    };
  try {
    const metadata = await gh("repos/" + repo);
    const branch = metadata.default_branch;
    if (!branch) throw new Error("The repository has no default branch yet.");
    const [result, workflows] = await Promise.all([
      gh(
        `repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
      ),
      gh(`repos/${repo}/actions/workflows?per_page=100`),
    ]);
    const active = (workflows.workflows || [])
      .filter((workflow) => workflow.state === "active")
      .map((workflow) => workflow.id);
    return summarizeWorkflowRuns(
      branch,
      result.workflow_runs || [],
      active,
      workflows.total_count <= (workflows.workflows || []).length,
    );
  } catch (error) {
    return {
      status: "error",
      tone: "neutral",
      label: "Build status unavailable",
      error: error.message,
      runs: [],
    };
  }
}
export async function deploymentSnapshot(link) {
  if (!link?.projectId) return { status: "unlinked", deployments: [] };
  try {
    const data = await vercel(
      "/v7/deployments?limit=15&projectId=" +
        encodeURIComponent(link.projectId) +
        (link.teamId ? "&teamId=" + encodeURIComponent(link.teamId) : ""),
    );
    return {
      status: "connected",
      syncedAt: new Date().toISOString(),
      deployments: (data.deployments || []).map((d) => ({
        id: d.uid || d.id,
        title: d.meta?.githubCommitMessage?.split("\n")[0] || d.name,
        state: d.state || d.readyState,
        branch: d.meta?.githubCommitRef || d.target || "Preview",
        createdAt: new Date(d.createdAt || d.created).toISOString(),
        url: d.inspectorUrl?.startsWith("https://vercel.com/")
          ? d.inspectorUrl
          : "https://vercel.com/" + (d.url || ""),
        siteUrl: d.url ? "https://" + d.url : null,
        provider: "Vercel",
      })),
    };
  } catch (e) {
    return { status: "error", error: e.message, deployments: [] };
  }
}
