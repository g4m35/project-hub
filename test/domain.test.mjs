import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  repoName,
  detectStack,
  validateSubscription,
  safePath,
  manifests,
  isProjectManifest,
} from "../server/domain.mjs";
test("GitHub remotes normalize without accepting credentials or other hosts", () => {
  assert.equal(
    repoName("git@github.com:example/notes-app.git"),
    "example/notes-app",
  );
  assert.equal(repoName("https://github.com/org/repo.git"), "org/repo");
  for (const x of [
    "https://secret@github.com/org/repo",
    "https://evil.com/org/repo",
    "../repo",
    "org/..",
    "$(touch /tmp/x)",
    "--help",
  ])
    assert.equal(repoName(x), null);
});
test("stack detection reduces duplicate framework nodes and retains evidence", () => {
  const stack = detectStack([
    {
      source: "apps/web/package.json",
      dependencies: { next: "1", react: "1", pg: "1" },
    },
    {
      source: "apps/mobile/package.json",
      dependencies: { expo: "1", "react-native": "1" },
    },
  ]);
  assert.deepEqual(
    stack.map((n) => n.name),
    ["Next.js", "Expo", "PostgreSQL"],
  );
  assert.deepEqual(stack[0].evidence, ["apps/web/package.json"]);
});
test("file discovery skips dependencies and symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "package.json"), "{}");
    fs.symlinkSync("/tmp", path.join(root, "linked"));
    assert.deepEqual(manifests(root), [path.join(root, "package.json")]);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
test("stack scans exclude nested examples and fixtures but allow an explicitly chosen example", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-manifest-"));
  try {
    for (const dir of ["apps/web", "examples/demo", "fixtures/app"])
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    const files = [
      "package.json",
      "apps/web/package.json",
      "examples/demo/package.json",
      "fixtures/app/package.json",
    ];
    for (const file of files) fs.writeFileSync(path.join(root, file), "{}");
    assert.deepEqual(
      manifests(root)
        .map((file) => path.relative(root, file))
        .sort(),
      ["apps/web/package.json", "package.json"],
    );
    assert.deepEqual(files.filter(isProjectManifest), [
      "package.json",
      "apps/web/package.json",
    ]);
    const example = path.join(root, "examples/demo");
    assert.deepEqual(manifests(example), [path.join(example, "package.json")]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const p = [{ id: "project" }];
const valid = {
  name: "Hosting",
  amount: 20,
  currency: "CAD",
  nextDue: "2026-10-10",
  interval: "monthly",
  projectId: "project",
};
test("billing validates amount, currency, calendar date and project association", () => {
  assert.equal(validateSubscription(valid, p).amount, 20);
  for (const change of [
    { amount: "" },
    { amount: -1 },
    { amount: "NaN" },
    { currency: "XYZ" },
    { nextDue: "2026-02-30" },
    { nextDue: "2026-13-01" },
    { interval: "weekly" },
    { projectId: "missing" },
  ])
    assert.throws(() => validateSubscription({ ...valid, ...change }, p));
});
test("zero-cost and shared annual bills retain their explicit currency and interval", () => {
  const v = validateSubscription(
    {
      ...valid,
      amount: 0,
      currency: "USD",
      interval: "yearly",
      projectId: "shared",
    },
    p,
  );
  assert.equal(v.amount, 0);
  assert.equal(v.interval, "yearly");
  assert.equal(v.currency, "USD");
});
test("folder access rejects the home root and system directories", () => {
  for (const p of [
    "/",
    os.homedir(),
    "/etc",
    "/tmp",
    path.join(os.homedir(), ".ssh"),
  ])
    assert.throws(() => safePath(p));
});
