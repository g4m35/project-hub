import test from "node:test";
import assert from "node:assert/strict";
import {
  linkRepository,
  summarizeWorkflowRuns,
} from "../server/project-state.mjs";

const fresh = () => ({
  id: "remote-id",
  name: "repository-name",
  repo: "Owner/School",
  path: null,
  stack: [{ id: "web", name: "Next.js" }],
  scannedAt: "2026-10-16",
  modifiedAt: "2026-10-15",
});
const state = () => ({
  projects: [
    {
      id: "imported",
      name: "School",
      path: "/preserved/local/path",
      repo: null,
      importedChats: [{ title: "Keep this chat" }],
      chatsImportedAt: "2026-10-04",
      vercel: { projectId: "hosting" },
      stack: [{ id: "hosting", name: "Vercel" }],
    },
  ],
  subscriptions: [
    { id: "bill", projectId: "imported", amount: 12, nextDue: "2026-10-31" },
  ],
});
test("linking a repository preserves imported identity, chats, bills, name, path and hosting", () => {
  const saved = state(),
    before = structuredClone(saved);
  const linked = linkRepository(saved, "imported", fresh());
  for (const key of [
    "id",
    "name",
    "path",
    "importedChats",
    "chatsImportedAt",
    "vercel",
  ])
    assert.deepEqual(linked[key], before.projects[0][key]);
  assert.deepEqual(saved.subscriptions, before.subscriptions);
  assert.equal(saved.projects.length, 1);
  assert.equal(linked.repo, "Owner/School");
  assert.deepEqual(
    linked.stack.map((n) => n.name),
    ["Next.js", "Vercel"],
  );
});
test("duplicate and competing repository links fail without modifying state", () => {
  for (const setup of [
    (s) =>
      s.projects.push({
        id: "other",
        name: "Already here",
        repo: "owner/school",
      }),
    (s) => (s.projects[0].repo = "Owner/Another"),
  ]) {
    const saved = state();
    setup(saved);
    const before = structuredClone(saved);
    assert.throws(
      () => linkRepository(saved, "imported", fresh()),
      (e) => e.status === 409,
    );
    assert.deepEqual(saved, before);
  }
});
test("unknown projects and absent repositories are rejected", () => {
  assert.throws(
    () => linkRepository(state(), "missing", fresh()),
    (e) => e.status === 404,
  );
  assert.throws(
    () => linkRepository(state(), "imported", { ...fresh(), repo: null }),
    (e) => e.status === 400,
  );
});
const run = (id, workflow, branch, conclusion, day, event = "push") => ({
  id,
  workflow_id: workflow,
  name: "Workflow " + workflow,
  head_branch: branch,
  conclusion,
  status: conclusion ? "completed" : "in_progress",
  created_at: `2026-10-${day}T12:00:00Z`,
  event,
  html_url: "https://github.com/example/repo/actions/runs/" + id,
});
test("superseded failures, other branches and pull request runs do not mark the default branch broken", () => {
  const result = summarizeWorkflowRuns("main", [
    run(1, 10, "main", "failure", "14"),
    run(2, 10, "main", "success", "16"),
    run(3, 10, "feature", "failure", "16"),
    run(4, 20, "main", "failure", "16", "pull_request"),
  ]);
  assert.equal(result.tone, "good");
  assert.deepEqual(
    result.runs.map((r) => r.id),
    [2],
  );
});
test("each workflow keeps its latest run; failures in a different workflow remain visible", () => {
  const result = summarizeWorkflowRuns("main", [
    run(1, 10, "main", "failure", "15"),
    run(2, 20, "main", "success", "16"),
  ]);
  assert.equal(result.tone, "bad");
  assert.equal(result.runs.length, 2);
});
test("running, canceled and missing workflows are never presented as passed", () => {
  for (const runs of [
    [],
    [run(1, 10, "main", null, "16")],
    [run(1, 10, "main", "cancelled", "16")],
  ]) {
    const result = summarizeWorkflowRuns("main", runs);
    assert.equal(result.tone, "neutral");
    assert.notEqual(result.label, "Recent builds passed");
  }
});

test("missing active workflow coverage and a truncated workflow list cannot turn green", () => {
  const runs = [run(2, 10, "main", "success", "16")];
  const missing = summarizeWorkflowRuns("main", runs, [10, 20]);
  assert.equal(missing.tone, "neutral");
  assert.equal(missing.coverageComplete, false);
  assert.equal(missing.label, "Build coverage incomplete");
  assert.equal(
    summarizeWorkflowRuns("main", runs, [10], false).tone,
    "neutral",
  );
});
test("inactive workflows cannot leave stale failure warnings", () => {
  const result = summarizeWorkflowRuns(
    "main",
    [run(1, 20, "main", "failure", "15"), run(2, 10, "main", "success", "16")],
    [10],
  );
  assert.equal(result.tone, "good");
  assert.deepEqual(
    result.runs.map((r) => r.id),
    [2],
  );
});
test("partial remote detection preserves imported services without duplicate names", () => {
  const saved = state();
  saved.projects[0].stack.push({ id: "db", name: "PostgreSQL" });
  const linked = linkRepository(saved, "imported", fresh());
  assert.deepEqual(
    linked.stack.map((n) => n.name),
    ["Next.js", "Vercel", "PostgreSQL"],
  );
});
