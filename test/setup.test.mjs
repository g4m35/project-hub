import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import {
  httpsOrigin,
  cloudConfig,
  syncLocation,
  launchAgent,
} from "../scripts/config.mjs";
import {
  ensureWebhook,
  vercelClient,
  projectCatalog,
  events,
} from "../scripts/vercel-events.mjs";
import { createHubAuth } from "../src/auth-client.mjs";

test("custom hub origins are accepted but credentials, paths and insecure transports are refused", () => {
  assert.equal(
    httpsOrigin("https://my-hub.example.org/"),
    "https://my-hub.example.org",
  );
  for (const value of [
    "http://my-hub.example.org",
    "https://name:password@example.org",
    "https://example.org/api",
    "https://example.org/?secret=x",
    "https://example.org/#x",
    "invalid",
  ])
    assert.throws(() => httpsOrigin(value));
  assert.notEqual(
    syncLocation("https://one.example.org").label,
    syncLocation("https://two.example.org").label,
  );
  const plist = launchAgent({
    label: "test",
    executable: "/Program & Files/node",
    script: "/some/<path>/sync.mjs",
    dir: "/sync",
  });
  assert.ok(plist.includes("Program &amp; Files"));
  assert.ok(plist.includes("&lt;path&gt;"));
});
test("cloud configuration rejects incomplete setup and accepts independent account settings", () => {
  const env = {
    HUB_APP_ORIGIN: "https://my-hub.example.org",
    HUB_OWNER_EMAIL: "owner@example.org",
    HUB_SESSION_SECRET: "x".repeat(64),
    DATABASE_URL: "postgresql://user:password@db.example.org/app",
    NEON_AUTH_BASE_URL: "https://auth.example.org/auth",
  };
  assert.equal(cloudConfig(env).origin, env.HUB_APP_ORIGIN);
  for (const key of Object.keys(env))
    assert.throws(() => cloudConfig({ ...env, [key]: "" }));
  assert.throws(() => cloudConfig({ ...env, HUB_SESSION_SECRET: "short" }));
});
test("auth client uses only the same-origin proxy and returns server errors", async () => {
  const calls = [];
  const auth = createHubAuth(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ ok: true });
  });
  await auth.emailOtp.sendVerificationOtp({
    email: "owner@example.org",
    type: "sign-in",
  });
  await auth.signIn.emailOtp({ email: "owner@example.org", otp: "123456" });
  await auth.signOut();
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "/api/auth/email-otp/send-verification-otp",
      "/api/auth/sign-in/email-otp",
      "/api/auth/sign-out",
    ],
  );
  assert.ok(
    calls.every(
      (c) =>
        c.init.credentials === "same-origin" && c.init.redirect === "error",
    ),
  );
  const denied = createHubAuth(async () =>
    Response.json({ error: "Use the owner email" }, { status: 403 }),
  );
  assert.equal(
    (await denied.signIn.emailOtp({})).error.message,
    "Use the owner email",
  );
});
test("Vercel client confines credentials to the API and scopes every request to the configured team", async () => {
  const calls = [];
  const client = vercelClient(
    "unit-test-token",
    "team_example",
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({ projects: [] });
    },
  );
  await client("/v9/projects?limit=100");
  assert.equal(calls[0].url.searchParams.get("teamId"), "team_example");
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(client("https://attacker.test/path"));
  assert.equal(calls.length, 1);
  const pages = await projectCatalog(async (route) =>
    route.includes("from=")
      ? { projects: [{ id: "two" }] }
      : { projects: [{ id: "one" }], pagination: { next: "cursor" } },
  );
  assert.equal(pages.length, 2);
});
test("webhook setup writes a private receipt, recovers it and refuses ambiguous duplicate creation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-webhook-"));
  const receiptFile = path.join(dir, "receipt.json");
  const hook = {
    id: "account_hook_test",
    url: "https://my-hub.example.org/api/events/vercel",
    secret: "synthetic-unit-test-secret",
    events,
  };
  let writes = 0;
  const request = async (route, body) => {
    if (body) {
      writes++;
      assert.equal(body.projectIds, undefined);
      return hook;
    }
    if (route === "/v1/webhooks") return [];
    return hook;
  };
  try {
    const args = { request, origin: "https://my-hub.example.org", receiptFile };
    assert.equal((await ensureWebhook(args)).id, hook.id);
    assert.equal(fs.statSync(receiptFile).mode & 0o777, 0o600);
    await ensureWebhook(args);
    await ensureWebhook({ ...args, existingId: hook.id, hasSecret: true });
    assert.equal(writes, 1);
    fs.unlinkSync(receiptFile);
    await assert.rejects(
      ensureWebhook({ ...args, request: async () => [hook] }),
      /already exists/,
    );
    assert.equal(writes, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("fresh local installation stays empty, adds an explicit example folder and keeps chats off", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-fresh-"));
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      HUB_DATA_DIR: dir,
      PORT: String(port),
      HUB_PROJECT_ROOTS: path.resolve("examples"),
      HUB_ENABLE_CHATS: "0",
      HUB_DEMO: "1",
    },
    stdio: "ignore",
  });
  const base = "http://127.0.0.1:" + port;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(base + "/api/health")).ok;
        if (ready) break;
      } catch {}
      await delay(30);
    }
    assert.ok(ready, "server starts on a fresh installation");
    const state = await (await fetch(base + "/api/state")).json();
    assert.deepEqual(state.projects, []);
    assert.deepEqual(state.subscriptions, []);
    assert.equal(state.initialization, null);
    const response = await fetch(base + "/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Token": state.csrf,
      },
      body: JSON.stringify({ path: path.resolve("examples/notes-app") }),
    });
    assert.equal(response.status, 200);
    const { project } = await response.json();
    assert.ok(project.stack.some((s) => s.name === "React"));
    assert.ok(project.stack.some((s) => s.name === "PostgreSQL"));
    const live = await (
      await fetch(base + "/api/projects/" + project.id + "/live")
    ).json();
    assert.equal(live.chats.status, "unconnected");
    assert.deepEqual(live.chats.chats, []);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, "hub.json"), "utf8"),
    );
    assert.equal(saved.projects.length, 1);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
