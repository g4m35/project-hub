import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

test("local API protects writes and preserves subscription edits across restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-hub-api-"));
  const port = 39871,
    url = "http://127.0.0.1:" + port;
  fs.writeFileSync(
    path.join(dir, "hub.json"),
    JSON.stringify({
      version: 1,
      seeded: true,
      projects: [],
      subscriptions: [],
    }),
  );
  let child;
  async function start() {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: String(port),
        HUB_DATA_DIR: dir,
        HUB_NO_AUTO_DISCOVERY: "1",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url + "/api/health")).ok) return;
      } catch {}
      await delay(30);
    }
    throw new Error("Test server did not start.");
  }
  async function stop() {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
  try {
    await start();
    const state = await (await fetch(url + "/api/state")).json();
    assert.equal(state.subscriptions.length, 0);
    const payload = {
      name: "Disposable test bill",
      amount: 12.5,
      currency: "CAD",
      interval: "monthly",
      nextDue: "2026-12-31",
      projectId: "shared",
    };
    assert.equal(
      (
        await fetch(url + "/api/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      ).status,
      403,
    );
    const headers = {
      "Content-Type": "application/json",
      "X-Hub-Token": state.csrf,
    };
    assert.equal(
      (
        await fetch(url + "/api/subscriptions", {
          method: "POST",
          headers: { ...headers, Origin: "https://example.com" },
          body: JSON.stringify(payload),
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve) => {
      http.get(
        url + "/api/state",
        { headers: { Host: "attacker.example:" + port } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      );
    });
    assert.equal(hostStatus, 403);
    let response = await fetch(url + "/api/subscriptions", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    response = await fetch(url + "/api/subscriptions/" + created.id, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...payload, amount: 15 }),
    });
    assert.equal(response.status, 200);
    await stop();
    await start();
    const restored = await (await fetch(url + "/api/state")).json();
    assert.equal(restored.subscriptions[0].amount, 15);
    assert.equal(restored.subscriptions[0].nextDue, "2026-12-31");
    assert.notEqual(restored.csrf, state.csrf);
    response = await fetch(url + "/api/subscriptions/" + created.id, {
      method: "DELETE",
      headers: { ...headers, "X-Hub-Token": restored.csrf },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await (await fetch(url + "/api/state")).json()).subscriptions.length,
      0,
    );
    assert.equal(fs.statSync(path.join(dir, "hub.json")).mode & 0o777, 0o600);
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
