import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function repoKey(value) {
  return String(value || "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}
function contains(root, cwd) {
  return !!root && !!cwd && (cwd === root || cwd.startsWith(root + path.sep));
}
export function matchingProjects(chat, projects) {
  const exact = projects.filter(
    (p) => p.repo && repoKey(p.repo) === repoKey(chat.repo),
  );
  if (exact.length) return exact;
  // Use explicit, already-assigned project prefixes only for named chats without a repository.
  if (chat.assignedName) {
    const named = projects.filter(
      (p) =>
        p.name &&
        (chat.assignedName.toLowerCase() === p.name.toLowerCase() ||
          [" — ", ": ", " · ", " - "].some((separator) =>
            chat.assignedName
              .toLowerCase()
              .startsWith(p.name.toLowerCase() + separator),
          )),
    );
    if (named.length === 1) return named;
  }
  // Specific nested projects win. Raw prompt text never decides project membership.
  const candidates = projects.filter((p) =>
    (p.roots || []).some((root) => contains(root, chat.cwd)),
  );
  const depth = Math.max(
    0,
    ...candidates.flatMap((p) =>
      p.roots.filter((r) => contains(r, chat.cwd)).map((r) => r.length),
    ),
  );
  return candidates.filter((p) =>
    p.roots.some((r) => r.length === depth && contains(r, chat.cwd)),
  );
}
function repositoryAt(folder) {
  for (let i = 0; folder && i < 5; i++, folder = path.dirname(folder)) {
    try {
      let git = path.join(folder, ".git");
      if (fs.statSync(git).isFile())
        git = path.resolve(
          folder,
          fs
            .readFileSync(git, "utf8")
            .replace(/^gitdir:\s*/, "")
            .trim(),
        );
      if (fs.existsSync(path.join(git, "commondir")))
        git = path.resolve(
          git,
          fs.readFileSync(path.join(git, "commondir"), "utf8").trim(),
        );
      const config = fs.readFileSync(path.join(git, "config"), "utf8");
      return (
        config
          .match(/\[remote "origin"\]([^\[]*)/)?.[1]
          ?.match(/url\s*=\s*(.*)/)?.[1]
          ?.trim() || null
      );
    } catch {}
  }
  return null;
}
function tailActivity(file, now) {
  try {
    const stat = fs.statSync(file);
    if (now - stat.mtimeMs > 90000) return { state: "idle", at: stat.mtimeMs };
    const size = Math.min(65536, stat.size),
      buffer = Buffer.alloc(size);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, size, stat.size - size);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buffer.toString().split("\n").reverse();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const type = event.type === "event_msg" && event.payload?.type;
        if (["task_complete", "turn_aborted", "task_aborted"].includes(type))
          return { state: "idle", at: stat.mtimeMs };
        if (type === "task_started")
          return { state: "active", at: stat.mtimeMs };
      } catch {}
    }
    return { state: "active", at: stat.mtimeMs };
  } catch {
    return { state: "idle", at: 0 };
  }
}
function open(file) {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA busy_timeout=1500");
  return db;
}
export function collectChats(
  projects,
  {
    home = os.homedir(),
    now = Date.now(),
    localStateFile,
    includeUnassigned = false,
  } = {},
) {
  let local = [];
  try {
    local =
      JSON.parse(
        fs.readFileSync(
          localStateFile || path.join(process.cwd(), ".data/hub.json"),
          "utf8",
        ),
      ).projects || [];
  } catch {}
  const mapped = projects.map((p) => ({
    ...p,
    roots: [
      ...(p.path ? [p.path] : []),
      ...local
        .filter(
          (l) =>
            l.id === p.id || (p.repo && repoKey(l.repo) === repoKey(p.repo)),
        )
        .map((l) => l.path)
        .filter(Boolean),
    ],
  }));
  const result = {
    capturedAt: new Date(now).toISOString(),
    sources: { codex: "missing", t3: "missing" },
    projects: projects.map((p) => ({ id: p.id, chats: [] })),
  };
  const all = [];
  const repositories = new Map();
  const repoFor = (folder) => {
    if (!repositories.has(folder))
      repositories.set(folder, repositoryAt(folder));
    return repositories.get(folder);
  };
  const addRoots = (rows) => {
    for (const r of rows) {
      const matches = mapped.filter(
        (p) =>
          p.name?.toLowerCase() === r.name?.toLowerCase() ||
          (p.repo && repoKey(p.repo) === repoKey(repoFor(r.path))),
      );
      for (const p of matches)
        if (r.path && !p.roots.includes(r.path)) p.roots.push(r.path);
    }
  };
  let db;
  try {
    db = open(path.join(home, ".codex/state_5.sqlite"));
    if (db) {
      try {
        addRoots(
          db
            .prepare(
              "SELECT p.name,r.path FROM projects p JOIN project_roots r ON r.project_id=p.id",
            )
            .all(),
        );
      } catch {}
      const columns = db
        .prepare("PRAGMA table_info(threads)")
        .all()
        .map((c) => c.name);
      const hasName = columns.includes("name");
      const notChild = columns.includes("source")
        ? " AND source NOT LIKE '%subagent%'"
        : "";
      const rows = db
        .prepare(
          `SELECT id,title,${hasName ? "name" : "NULL AS name"},cwd,git_origin_url,updated_at,rollout_path FROM threads WHERE archived=0${notChild} ORDER BY updated_at DESC LIMIT 500`,
        )
        .all();
      for (const r of rows) {
        const match = matchingProjects(
          {
            repo: r.git_origin_url || repoFor(r.cwd),
            cwd: r.cwd,
            assignedName: r.name,
          },
          mapped,
        );
        const activity = tailActivity(r.rollout_path, now);
        all.push({
          id: r.id,
          title:
            r.name || r.title.split("\n")[0].slice(0, 160) || "Untitled chat",
          app: "Codex",
          updatedAt: new Date(
            Math.max(r.updated_at * 1000, activity.at),
          ).toISOString(),
          state: activity.state,
          projectIds: match.map((p) => p.id),
        });
      }
      result.sources.codex = "connected";
    }
  } catch {
    result.sources.codex = "unavailable";
  } finally {
    db?.close();
    db = null;
  }
  try {
    const v2 = path.join(home, ".t3/userdata/statev2.sqlite");
    db = open(
      fs.existsSync(v2) ? v2 : path.join(home, ".t3/userdata/state.sqlite"),
    );
    if (db) {
      addRoots(
        db
          .prepare(
            "SELECT title AS name,workspace_root AS path FROM projection_projects WHERE deleted_at IS NULL",
          )
          .all(),
      );
      const hasV2 = !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='orchestration_v2_projection_threads'",
        )
        .get();
      const rows = hasV2
        ? db
            .prepare(
              `SELECT t.thread_id,t.title,t.updated_at,p.workspace_root,
        json_extract(t.payload_json,'$.worktreePath') AS worktree_path,
        (SELECT r.status FROM orchestration_v2_projection_runs r WHERE r.thread_id=t.thread_id ORDER BY r.ordinal DESC LIMIT 1) AS run_status,
        (SELECT count(*) FROM orchestration_v2_projection_runtime_requests q WHERE q.thread_id=t.thread_id AND q.status='pending') AS pending
        FROM orchestration_v2_projection_threads t JOIN projection_projects p ON p.project_id=t.project_id
        WHERE t.archived_at IS NULL AND t.deleted_at IS NULL AND t.thread_id NOT LIKE 'thread:provider:%' ORDER BY t.updated_at DESC LIMIT 500`,
            )
            .all()
        : db
            .prepare(
              `SELECT t.thread_id,t.title,t.updated_at,p.workspace_root,t.worktree_path,
          s.status AS run_status,(t.pending_approval_count+t.pending_user_input_count) AS pending
          FROM projection_threads t JOIN projection_projects p ON p.project_id=t.project_id
          LEFT JOIN projection_thread_sessions s ON s.thread_id=t.thread_id
          WHERE t.archived_at IS NULL AND t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 500`,
            )
            .all();
      for (const r of rows) {
        const match = matchingProjects(
          {
            repo: repoFor(r.worktree_path || r.workspace_root),
            cwd: r.worktree_path || r.workspace_root,
            assignedName: r.title,
          },
          mapped,
        );
        all.push({
          id: r.thread_id,
          title: r.title,
          app: "T3 Code",
          updatedAt: r.updated_at,
          state: r.pending
            ? "needs_input"
            : ["running", "active"].includes(r.run_status)
              ? "active"
              : r.run_status === "failed"
                ? "error"
                : "idle",
          projectIds: match.map((p) => p.id),
        });
      }
      result.sources.t3 = "connected";
    }
  } catch {
    result.sources.t3 = "unavailable";
  } finally {
    db?.close();
  }
  for (const p of result.projects)
    p.chats = all
      .filter((c) => c.projectIds.includes(p.id))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 80)
      .map(({ projectIds, ...c }) => c);
  if (includeUnassigned)
    result.projects.push({
      id: "unassigned",
      chats: all
        .filter(
          (c) =>
            !c.projectIds.length &&
            now - new Date(c.updatedAt).getTime() < 14 * 86400000,
        )
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 80)
        .map(({ projectIds, ...c }) => c),
    });
  return result;
}
