import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  verifyWebhook,
  secureEqual,
  deploymentEvent,
  sanitizeChatSync,
  chatView,
  normalizeDeployment,
} from "../server/live-data.mjs";
import { matchingProjects, collectChats } from "../scripts/chat-reader.mjs";

test("webhook signatures cover the exact body and reject tampering and missing keys", () => {
  const body = Buffer.from('{"type":"deployment.succeeded"}'),
    secret = "test-only";
  const signature = crypto
    .createHmac("sha1", secret)
    .update(body)
    .digest("hex");
  assert.equal(verifyWebhook(body, signature, secret), true);
  assert.equal(
    verifyWebhook(Buffer.concat([body, Buffer.from(" ")]), signature, secret),
    false,
  );
  assert.equal(verifyWebhook(body, signature, undefined), false);
  assert.equal(verifyWebhook(body, "invalid", secret), false);
  assert.equal(secureEqual(undefined, "Bearer secret"), false);
});
test("deployment events accept only linked projects and the expected team", () => {
  const event = {
    type: "deployment.succeeded",
    createdAt: Date.now(),
    payload: {
      team: { id: "team_expected" },
      project: { id: "prj_known" },
      deployment: {
        id: "dpl_example",
        name: "demo",
        url: "demo.vercel.app",
        meta: { githubCommitMessage: "New release\nDetails" },
      },
      target: "production",
      links: { deployment: "https://vercel.com/team/project/id" },
    },
  };
  const result = deploymentEvent(event, "team_expected", ["prj_known"]);
  assert.equal(result.state, "READY");
  assert.equal(result.title, "New release");
  assert.equal(result.target, "production");
  assert.equal(deploymentEvent(event, "other", ["prj_known"]), null);
  assert.equal(deploymentEvent(event, "team_expected", ["prj_other"]), null);
  assert.equal(
    deploymentEvent({ ...event, type: "project.created" }, "team_expected", [
      "prj_known",
    ]),
    null,
  );
  assert.equal(
    normalizeDeployment(
      {
        id: "dpl_x",
        url: "evil.test",
        inspectorUrl: "javascript:alert(1)",
        created: Date.now(),
      },
      { projectId: "prj_known" },
    ).siteUrl,
    null,
  );
});
test("chat sync is a metadata allowlist and rejects stale/future payloads", () => {
  const now = Date.now(),
    at = new Date(now).toISOString();
  const body = {
    capturedAt: at,
    sources: { codex: "connected", t3: "missing" },
    secret: "must not copy",
    projects: [
      {
        id: "known",
        path: "/private",
        chats: [
          {
            id: "chat_123456",
            title: "Build site",
            app: "Codex",
            updatedAt: at,
            state: "active",
            body: "private transcript",
            cwd: "/private",
          },
        ],
      },
      { id: "unrelated", chats: [] },
    ],
  };
  const clean = sanitizeChatSync(body, ["known"], now);
  assert.equal(clean.projects.length, 1);
  assert.equal(JSON.stringify(clean).includes("private"), false);
  assert.equal("secret" in clean, false);
  assert.throws(() =>
    sanitizeChatSync(
      { ...body, capturedAt: new Date(now - 180000).toISOString() },
      ["known"],
      now,
    ),
  );
  assert.throws(() =>
    sanitizeChatSync(
      { ...body, capturedAt: new Date(now + 180000).toISOString() },
      ["known"],
      now,
    ),
  );
});
test("offline Mac and unreadable app never retain a current activity state", () => {
  const now = Date.now();
  const sync = {
    capturedAt: new Date(now - 50000).toISOString(),
    sources: { codex: "connected", t3: "unavailable" },
    projects: [
      {
        id: "p",
        chats: [
          { id: "c", app: "Codex", state: "active" },
          { id: "t", app: "T3 Code", state: "needs_input" },
        ],
      },
    ],
  };
  const result = chatView(sync, "p", now);
  assert.equal(result.status, "offline");
  assert.equal(result.chats.length, 1);
  assert.equal(result.chats[0].state, "unknown");
  assert.equal(chatView(null, "p", now).status, "unconnected");
});
test("project matching uses exact repository or deepest local root, never a similar title", () => {
  const ps = [
    { id: "a", repo: "owner/app", roots: ["/work/app"] },
    { id: "b", repo: "owner/nested", roots: ["/work/app/nested"] },
  ];
  assert.deepEqual(
    matchingProjects({ repo: "git@github.com:owner/app.git" }, ps).map(
      (p) => p.id,
    ),
    ["a"],
  );
  assert.deepEqual(
    matchingProjects({ cwd: "/work/app/nested/src" }, ps).map((p) => p.id),
    ["b"],
  );
  assert.equal(
    matchingProjects({ cwd: "/work/application", title: "app" }, ps).length,
    0,
  );
});
test("read-only Codex sync includes new chats, excludes archived chats, and reflects edits next pass", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hub-chats-"));
  fs.mkdirSync(path.join(home, ".codex"));
  const file = path.join(home, ".codex/state_5.sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,git_origin_url TEXT,updated_at INTEGER,rollout_path TEXT,archived INTEGER,has_user_event INTEGER)",
  );
  const insert = db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)");
  insert.run(
    "chat_new_123",
    "A current chat",
    "/app",
    "https://github.com/owner/app.git",
    Math.floor(Date.now() / 1000),
    "/missing",
    0,
    1,
  );
  insert.run(
    "chat_old_123",
    "Archived chat",
    "/app",
    "https://github.com/owner/app.git",
    Math.floor(Date.now() / 1000),
    "/missing",
    1,
    1,
  );
  const ps = [{ id: "project", repo: "owner/app" }];
  assert.equal(collectChats(ps, { home }).projects[0].chats.length, 1);
  db.exec("UPDATE threads SET title='Edited live' WHERE id='chat_new_123'");
  assert.equal(
    collectChats(ps, { home }).projects[0].chats[0].title,
    "Edited live",
  );
  db.exec("UPDATE threads SET archived=1");
  assert.equal(collectChats(ps, { home }).projects[0].chats.length, 0);
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("unmatched chat metadata is excluded unless explicitly enabled", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hub-unmatched-"));
  fs.mkdirSync(path.join(home, ".codex"));
  const db = new DatabaseSync(path.join(home, ".codex/state_5.sqlite"));
  try {
    db.exec(
      "CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,git_origin_url TEXT,updated_at INTEGER,rollout_path TEXT,archived INTEGER)",
    );
    db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?)").run(
      "unmatched_123",
      "Private unrelated title",
      "/unrelated",
      null,
      Math.floor(Date.now() / 1000),
      "/missing",
      0,
    );
    assert.equal(collectChats([], { home }).projects.length, 0);
    assert.equal(
      collectChats([], { home, includeUnassigned: true }).projects[0].chats
        .length,
      1,
    );
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
